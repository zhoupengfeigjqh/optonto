/**
 * 执行记录的纯逻辑（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 抽出来的理由：执行记录的分组规则（顶层条目按时间位置、子任务条目按 seq 归组）是一段
 * 有注释说明的既有约定，混在会话组件里无法单测；抽成纯函数后可覆盖并行子任务交错到达等场景。
 */

/** 一条执行记录（来自 SSE 的 exec_entry 事件） */
export interface LogEntry {
  time: string;
  /**
   * 条目类型（镜像后端 `ExecutionEntry.type`）。
   * 此前是 `string` —— 后端的五态联合被降级，丢掉了穷尽性检查：
   * 测试里能造出后端永不发的类型（如 'security'）而不被发现（2026-10-05 修正，审查 H3/H5）。
   */
  type: 'subtask_start' | 'subtask_done' | 'tool_call' | 'security_confirm' | 'subtask_input';
  name: string;
  description?: string;
  params?: any;
  result?: string;
  /** 状态（镜像后端 `ExecutionEntry.status`；此前同样是 `string`） */
  status: 'running' | 'done' | 'failed';
  detail?: string;
  source?: 'parent' | 'child';
  /**
   * SDK 工具调用 id —— running → done 的唯一配对键（后端 ExecutionEntry.toolCallId）。
   *
   * 缺省时前端回退到「type+name+seq+source」匹配：父 Agent 的条目不带 seq，
   * 同名工具连续调用两次会互相覆盖（agent 环节审查 C5）。
   */
  toolCallId?: string;
  seq?: number;
  /** 中文名（行为/函数 title，空则回退子任务描述）；「中文（英文）」由渲染层拼 */
  title?: string;
}

/** 渲染节点：顶层条目，或一个子任务组 */
export type LogNode =
  | { kind: 'top'; entry: LogEntry }
  | { kind: 'subtask'; seq: number; entries: LogEntry[] };

/** 子任务组内不计入「步数」的事件类型：起止由组标题表达，input 是指令不是步骤 */
export const NON_STEP_TYPES = ['subtask_start', 'subtask_done', 'subtask_input'];

/**
 * 按原始事件顺序生成渲染节点：
 * 顶层条目（父/全局）在时间位置出现；子任务条目按 seq 归入同一组。
 *
 * 注意不能按「相邻才合并」实现——并行子任务的事件会交错到达，
 * 相邻合并会把同一子任务拆成多个组。
 */
export function groupExecutionLog(log: LogEntry[]): LogNode[] {
  const nodes: LogNode[] = [];
  const seqNodes = new Map<number, LogNode & { kind: 'subtask' }>();
  for (const e of log) {
    if (e.source === 'child' && e.seq != null) {
      let node = seqNodes.get(e.seq);
      if (!node) {
        node = { kind: 'subtask', seq: e.seq, entries: [] };
        seqNodes.set(e.seq, node);
        nodes.push(node);
      }
      node.entries.push(e);
    } else {
      nodes.push({ kind: 'top', entry: e });
    }
  }
  return nodes;
}

/** 子任务组的「N 步」计数 */
export function countSubtaskSteps(entries: LogEntry[]): number {
  return entries.filter(e => !NON_STEP_TYPES.includes(e.type)).length;
}

/** 子任务组的步骤明细（剔除起止与指令，只留执行动作） */
export function subtaskStepEntries(entries: LogEntry[]): LogEntry[] {
  return entries.filter(e => !NON_STEP_TYPES.includes(e.type));
}

/**
 * 子任务组标题上的状态。
 * 取 subtask_done 优先：标题按 seq 归组后，start 事件不再被 done 覆盖，
 * 因此完成态必须显式从 done 事件读取，否则永远停在 running。
 */
export function subtaskStatus(entries: LogEntry[]): string {
  const done = entries.find(e => e.type === 'subtask_done');
  const start = entries.find(e => e.type === 'subtask_start');
  return done?.status || start?.status || 'running';
}

/** 子任务组标题（`子任务 {seq}: {显示名}`） */
export function subtaskTitle(entries: LogEntry[], seq: number): string {
  const start = entries.find(e => e.type === 'subtask_start');
  return start ? `子任务 ${seq}: ${start.title || start.name}` : `子任务 ${seq}`;
}

/**
 * 执行记录去重合并（**running → done 的配对**，纯函数；2026-10-05 C5 修复）。
 *
 * 从 `AgentConversation` 的 SSE 分发里抽出——它是纯状态变换，与渲染无关，
 * 且是「执行记录是否错乱」的唯一判定点，值得独立单测（原先埋在组件内无从断言）。
 *
 * 配对键：
 *  ① **优先 `toolCallId`**（后端下发的 SDK 调用 id）：父 Agent 的工具调用条目不带 seq，
 *     靠 type+name+seq 匹配会让「同名工具连续/并发调用两次」互相覆盖——
 *     第 2 次 running 被丢弃、第 2 次 done 覆盖第 1 次的 result（agent 环节审查 C5）。
 *  ② 无 `toolCallId` 的条目（subtask_start/done、security_confirm、subtask_input）
 *     本就只有单条或成对形态，回退到 type+name+seq+source。
 *
 * 语义：
 *  - 命中 running 且新条目非 running → 就地更新为终态（保留 time 等首次写入的字段）；
 *  - 命中 running 且新条目仍是 running → 幂等丢弃（重复 start）；
 *  - 未命中 → 追加。
 */
export function mergeExecEntry(prev: LogEntry[], entry: LogEntry): LogEntry[] {
  const idx = prev.findIndex(e =>
    e.status === 'running'
    && (entry.toolCallId
      ? e.toolCallId === entry.toolCallId
      : e.type === entry.type && e.name === entry.name && e.seq === entry.seq && e.source === entry.source));
  if (idx < 0) return [...prev, entry];
  // 重复 start：同键的 running 已在位，忽略（避免同一次调用被记成两条）
  if (entry.status === 'running') return prev;
  const next = [...prev];
  next[idx] = {
    ...next[idx],
    status: entry.status,
    detail: entry.detail,
    params: entry.params,
    result: entry.result,
    source: entry.source ?? next[idx].source,
    toolCallId: entry.toolCallId ?? next[idx].toolCallId,
    seq: entry.seq ?? next[idx].seq,
    title: entry.title ?? next[idx].title,
    description: entry.description ?? next[idx].description,
  };
  return next;
}
