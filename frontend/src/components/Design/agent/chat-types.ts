/** 聊天区数据结构（自 AgentApp.tsx 抽取）。 */
import type { AgentMessage } from '@/api/agent-client';
import type { LogEntry } from './execution-log';

/**
 * 本轮的 assistant 消息（在历史消息基础上携带运行时字段）。
 *
 * 为什么要单独具名（2026-10-05，agent 环节审查 M4）：此前 `ChatMessage` 用
 * `AgentMessage & { runId?, narrative?, narrativeStreaming? }` 内联交叉，而
 * `AgentMessage.role` 本身是四态联合——交叉后 `Extract<..., { role: 'assistant' }>`
 * 收窄得到 `never`（交叉类型的 role 仍可能是 'user'），于是每处都只能 `as any`。
 * 具名 + 收窄到字面量后守卫函数可正常工作，`as any` 随之消失。
 *
 * `narrative` 为规划思考块的临时态，不写回历史。
 */
export interface AssistantChatMessage extends AgentMessage {
  role: 'assistant';
  /** 所属对话轮次 id（每次发消息自增），多轮定位用 */
  runId?: number;
  /** 规划思考过程（折叠块展示） */
  narrative?: string;
  /** 思考区是否仍在流式（控制转圈） */
  narrativeStreaming?: boolean;
}

/** 聊天内嵌的子任务执行块（由 exec_entry 事件构建） */
export interface SubtaskChatItem {
  role: 'subtask';
  /** 所属对话轮次 id（每次发消息自增），避免多轮对话的 seq 冲突 */
  runId: number;
  seq: number;
  behavior: string;
  /** 展示名：中文（英文），如 创建采购记录（CreatePurchaseRecord） */
  displayName?: string;
  /** 纯中文展示名（行为中文名或子任务描述），聊天区标题用 */
  displayLabel?: string;
  /** 子任务描述（父 Agent 生成），标题副行用 */
  description?: string;
  status: 'running' | 'done' | 'failed';
  /** 执行明细条目（tool_call / subtask_input / security_confirm 等） */
  details: LogEntry[];
}

/** 聊天消息：历史消息（含本轮 assistant 运行时字段）或运行时子任务执行块 */
export type ChatMessage = AssistantChatMessage | AgentMessage | SubtaskChatItem;

/** 收窄为 assistant 消息（替代此前的 `as any`） */
export function isAssistantMessage(m: ChatMessage): m is AssistantChatMessage {
  return m.role === 'assistant';
}

/** 收窄为子任务执行块 */
export function isSubtaskItem(m: ChatMessage): m is SubtaskChatItem {
  return m.role === 'subtask';
}
