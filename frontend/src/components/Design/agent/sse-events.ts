/**
 * SSE 事件类型镜像 —— 后端 `agent-backend/src/types.ts` 的 `SSEEvent` 在前端的对应定义。
 *
 * ## 为什么需要（2026-10-05，agent 环节审查 C4 / M4）
 *
 * 修复前前端**没有任何 SSE 事件类型**：`AgentConversation` 的分发是一串
 * `if (data.type === '…')`，而 `data` 来自 `JSON.parse`，全程隐式 `any`。后果：
 *  1. 契约缺口无从发现——后端发的 `plan_received` 前端零处理、零引用，编译期与运行期都无信号；
 *  2. 新增事件类型静默失效——后端加一个事件，前端不编译失败也不报错，只是悄悄不处理；
 *  3. 类型断言泛滥——因为 `data` 是 `any`，每个分支都要 `as any`（共 18 处）。
 *
 * ## 维护约定（宪法 VI：契约两侧同改）
 *
 * 本文件是 `SSEEvent` 的**前端唯一落点**，与后端联合类型一一对应。
 * 改后端事件时**必须**同步本文件，否则 `sse-events.test.ts` 的防漂移用例会失败。
 */
import type { LogEntry } from './execution-log';

/** 叙事块定格结局（镜像后端内联的 outcome）：plan=已提交规划 / answer=直答 / aborted=中断 */
export type NarrativeOutcome = 'plan' | 'answer' | 'aborted';

/** 波次反馈状态（镜像后端内联的 status） */
export type FeedbackStatus = 'running' | 'done';

/**
 * 规划（镜像后端 SubTask / SubTaskPlan）。
 * 参数值沿用后端的「四键包装」形态 { type, required, description, value }
 * （解包逻辑见 plan-editing.ts / param-contract 对应实现）。
 */
export interface PlanParam {
  type?: string;
  required?: boolean;
  description?: string;
  value?: unknown;
}

export interface SubTask {
  seq: number;
  /** 行为子任务：行为英文名（与 function 互斥） */
  behavior: string;
  /** 函数子任务：函数英文名（直连调用，无子 Agent LLM） */
  function?: string;
  params: Record<string, PlanParam>;
  description: string;
  guidance?: string;
  scenario_name: string;
  scenario_id?: number;
  ontology_name: string;
  ontology_id: number;
  depends_on?: number[];
  related_functions?: string[];
  /** 展示名（后端 enrichPlanDisplay 注入，纯展示不参与校验） */
  title?: string;
}

export interface SubTaskPlan {
  subtasks: SubTask[];
}

/**
 * SSE 事件联合（镜像后端 SSEEvent）。判别字段统一为 `type`，
 * 故分发处可 `switch (data.type)` 让 TS 自动收窄，无需 `as any`。
 */
export type SSEEvent =
  | { type: 'token'; token: string }
  | { type: 'narrative'; token: string }
  | { type: 'narrative_end'; outcome: NarrativeOutcome }
  | { type: 'error'; message: string }
  | { type: 'done' }
  /** 最终确认执行的规划（含用户编辑与展示字段）——与 plan_confirm（待确认请求）区分 */
  | { type: 'plan_received'; plan: SubTaskPlan }
  | { type: 'confirm'; confirmId: string; behavior: string; content: string; params?: Record<string, unknown> }
  | { type: 'plan_confirm'; confirmId: string; plan: SubTaskPlan }
  | { type: 'feedback'; status: FeedbackStatus }
  | { type: 'exec_entry'; entry: LogEntry };

/** 事件类型全集（供防漂移测试与穷尽性检查使用） */
export const SSE_EVENT_TYPES = [
  'token', 'narrative', 'narrative_end', 'error', 'done',
  'plan_received', 'confirm', 'plan_confirm', 'feedback', 'exec_entry',
] as const;

export type SSEEventType = SSEEvent['type'];

/** 类型守卫：收窄单个 SSE 事件（替代此前的隐式 any + as any） */
export function isSSEEvent(raw: unknown): raw is SSEEvent {
  if (!raw || typeof raw !== 'object') return false;
  const t = (raw as { type?: unknown }).type;
  return typeof t === 'string' && (SSE_EVENT_TYPES as readonly string[]).includes(t);
}
