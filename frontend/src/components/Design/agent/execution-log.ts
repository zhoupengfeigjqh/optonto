/**
 * 执行记录的纯逻辑（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 抽出来的理由：执行记录的分组规则（顶层条目按时间位置、子任务条目按 seq 归组）是一段
 * 有注释说明的既有约定，混在会话组件里无法单测；抽成纯函数后可覆盖并行子任务交错到达等场景。
 */

/** 一条执行记录（来自 SSE 的 exec_entry 事件） */
export interface LogEntry {
  time: string;
  type: string;
  name: string;
  description?: string;
  params?: any;
  result?: string;
  status: string;
  detail?: string;
  source?: string;
  seq?: number;
  displayName?: string;
  displayLabel?: string;
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
  return start ? `子任务 ${seq}: ${start.displayName || start.name}` : `子任务 ${seq}`;
}
