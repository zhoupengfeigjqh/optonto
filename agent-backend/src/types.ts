// ─── Thread 类型（与前端 Thread 接口对齐） ─────────────────────────

export interface ThreadMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp: string;
}

export interface Thread {
  id: string;
  title: string;
  status: 'active' | 'archived';
  messages: ThreadMessage[];
  created_at: string;
  updated_at: string;
  scenario_name: string;
  ontology_name: string;
  skill_names: string[];
  /** pi-agent-core 完整消息状态，用于跨轮次恢复对话上下文（含 tool call/result） */
  agent_messages?: any[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

// ─── Skill 类型 ─────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  /** SKILL.md 第一段的简短摘要 */
  summary?: string;
}

/** 技能描述（仅元数据，不含正文） */
export interface SkillDescription {
  name: string;
  description: string;
}

// ─── SSE 事件类型 ──────────────────────────────

export type SSEEvent =
  | { type: 'token'; token: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'tool_start'; name: string; toolCallId?: string; args?: any }
  | { type: 'tool_end'; name: string; result: string };

// ─── API 请求类型 ──────────────────────────────

export interface CreateThreadBody {
  title: string;
  skill_names: string[];
}

export interface ChatBody {
  message: string;
}

export interface ApiError {
  error: string;
}
