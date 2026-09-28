/** 聊天区数据结构（自 AgentApp.tsx 抽取，行为不变）。 */
import type { AgentMessage } from '@/api/agent-client';

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
  details: any[];
}

/** 聊天消息：assistant 可携带运行时字段——规划思考挂在消息内部（runId 定位本轮消息；
 *  头像/思考/正文一体，不再是独立数组项，从结构上消除空白占位气泡与头像错位）。
 *  narrative 为临时态，不写回历史。 */
export type ChatMessage = (AgentMessage & {
  runId?: number;
  narrative?: string;
  narrativeStreaming?: boolean;
}) | SubtaskChatItem;
