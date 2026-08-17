// ─── Thread 类型（与前端 Thread 接口对齐） ─────────────────────────

export interface ThreadMessage {
  /** summary：短期记忆压缩生成的对话摘要（持久化在 messages 中，组装父Agent上下文时前置为历史背景） */
  role: 'user' | 'assistant' | 'toolResult' | 'summary';
  content: string;
  timestamp: string;
}

/** 选中的技能及其所在本体/场景（跨本体技能选择的存储单元） */
export interface SkillSelection {
  name: string;
  scenario: string;
  ontology: string;
}

export interface Thread {
  id: string;
  title: string;
  status: 'active' | 'archived';
  messages: ThreadMessage[];
  created_at: string;
  updated_at: string;
  scenario_name: string;
  scenario_id?: number;
  ontology_name: string;
  ontology_id?: number;
  skill_names: SkillSelection[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/**
 * 从 SKILL.md 提取的场景/本体上下文。
 * 由 SkillLoader.extractSkillContext() 解析 frontmatter 得到，
 * 是 agent 所有操作的权威来源，不从 URL/body 提取。
 */
export interface SkillContext {
  scenario_name: string;
  scenario_id: number;
  ontology_name: string;
  ontology_id: number;
}

// ─── Skill 类型 ─────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  /** SKILL.md 第一段的简短摘要 */
  summary?: string;
  /** 技能所在场景 */
  scenario?: string;
  /** 技能所在本体 */
  ontology?: string;
}

/** 技能描述（仅元数据，不含正文） */
export interface SkillDescription {
  name: string;
  description: string;
}

// ─── 多 Agent 编排类型 ─────────────────────────

/** 单个子任务规划 */
export interface SubTask {
  seq: number;
  behavior: string;
  /** 函数子任务：直接调用本体函数/公共函数（统计/聚合等纯计算），与 behavior 互斥。
   *  函数节点时 behavior 为空串，function 填函数英文名；不经过子 Agent LLM，由 orchestrator 直连 MCP 执行。 */
  function?: string;
  params: Record<string, any>;
  description: string;
  guidance?: string;
  scenario_name: string;
  scenario_id?: number;
  ontology_name: string;
  ontology_id: number;
  depends_on?: number[];
  /** 父 Agent 指定的本子任务可能用到的函数（英文函数名，含公共函数）。与规则声明的 related_functions 取并集后挂载给子 Agent。 */
  related_functions?: string[];
}

/** 父Agent 输出的完整规划 */
export interface SubTaskPlan {
  subtasks: SubTask[];
}

/** 规则明细（含结构化详情） */
export interface RuleDetail {
  name: string;
  description: string;
  position: '前置' | '后置';
  related_behaviors: string[];
  rule_detail?: any;
  related_functions?: string[];
  data_supplements?: string[];
}

/** 概念属性信息 */
export interface ConceptInfo {
  name: string;
  display_name: string;
  attributes: { name: string; type: string; display_name: string }[];
}

/** 行为元信息（OntologyGateway 提取结果） */
export interface BehaviorMeta {
  /** 行为中文名（display_name），用于展示 */
  display_name?: string;
  params: Record<string, any>;
  preRules: RuleDetail[];
  postRules: RuleDetail[];
  security?: { audit_node: string; audit_content: string };
  concepts: ConceptInfo[];
  /** 是否写操作（API + POST/PATCH/DELETE）。写操作无论有无 security 登记都强制人工确认。 */
  isWrite: boolean;
}

/** 子任务执行结果 */
export interface SubTaskResult {
  seq: number;
  behavior: string;
  success: boolean;
  error?: string;
  /** 是否因用户中断/拒绝而终止（区别于常规失败） */
  aborted?: boolean;
  summary: string;
}

/** 执行记录条目 */
export interface ExecutionEntry {
  time: string;
  type: 'subtask_start' | 'subtask_done' | 'tool_call' | 'security_confirm' | 'subtask_input';
  name: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
  params?: any;
  result?: string;
  source?: 'parent' | 'child';
  /** 所属子任务编号（仅子任务相关条目），前端据此分组展示 */
  seq?: number;
  /** 子任务展示名：中文（英文），如 创建采购记录（CreatePurchaseRecord）。执行记录侧面板用 */
  displayName?: string;
  /** 纯中文展示名（行为 display_name 或子任务描述），聊天区用 */
  displayLabel?: string;
  /** 子任务描述（父 Agent 生成），聊天区标题副行用 */
  description?: string;
}

// ─── SSE 事件类型 ──────────────────────────────

export type SSEEvent =
  | { type: 'token'; token: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'plan_received'; plan: SubTaskPlan }
  | { type: 'confirm'; confirmId: string; behavior: string; content: string; params?: Record<string, any> }
  | { type: 'plan_confirm'; confirmId: string; plan: SubTaskPlan }
  | { type: 'feedback'; status: 'running' | 'done' }
  | { type: 'exec_entry'; entry: ExecutionEntry };

// ─── API 请求类型 ──────────────────────────────
