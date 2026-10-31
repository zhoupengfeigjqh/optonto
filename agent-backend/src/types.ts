// ─── Thread 类型（与前端 Thread 接口对齐） ─────────────────────────

export interface ThreadMessage {
  /** summary：短期记忆压缩生成的对话摘要（持久化在 messages 中，组装父Agent上下文时前置为历史背景） */
  role: 'user' | 'assistant' | 'toolResult' | 'summary';
  content: string;
  timestamp: string;
}

/** 用户在新建对话时选择的本体范围单元（scenario+ontology 名定位，id 由 ontology.yaml.metadata 解析） */
export interface OntologySelection {
  scenario: string;
  ontology: string;
}

/** 技能引用（由所选本体目录自动反查得到，用户不再直接选技能） */
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
  /** 本次对话的本体范围（用户显式选择）。空数组 = 通用问答模式（不挂业务工具） */
  ontology_scope: OntologySelection[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/**
 * 场景/本体上下文四元组。
 * 取自 `<本体>/ontology.yaml` 的 metadata（身份唯一来源，与 core / mcp-shared 同口径），
 * 是 agent 所有操作的权威来源，不从 URL/body 提取。
 */
export interface SkillContext {
  scenario_name: string;
  scenario_id: number;
  ontology_name: string;
  ontology_id: number;
}

/**
 * 一轮对话的本体作用域（ChatSession 由 thread.ontology_scope 一次性解析，编排全程只传此对象）：
 *  - contexts：所选本体的权威四元组（取自 ontology.yaml.metadata）——父 Agent 提示词注入、
 *    list* 工具/listPlannableFunctions/PlanGate 三道硬闸的允许集，皆以此为唯一事实源
 *  - skills：所选本体目录下自动反查到的全部技能（用户无感），load_skill 可选集与提示词注入源
 * contexts 为空 = 通用问答模式（父 Agent 不挂任何业务工具）。
 */
export interface ConversationScope {
  contexts: SkillContext[];
  skills: SkillSelection[];
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
  /** 绑定行为（唯一）：spec 003 起由 related_behaviors 数组收缩为标量 */
  behavior: string;
  /** 关联函数（本体函数∪公共函数）：执行过即留痕；其中 judge_functions 为判断函数 */
  related_functions?: string[];
  /** 判断函数（2026-09-30 口径 B：类型即角色）：本体且 type=VALIDATION 的关联函数子集——
   *  gateway 解析产物，运行期闸在主行为工具调用前核查其统一信封 data.pass/reason
   *  （pass=false 或缺失 pass → fail-closed 拒绝主行为）。 */
  judge_functions?: string[];
  data_supplements?: string[];
  /**
   * 规则设计（设计期表达，spec 007）：平台设计面维护的条件组合 + 结果说明。
   * **运行期不消费**——规则闸只认 `related_functions` / `judge_functions`，
   * 不要在此读取或派生判定逻辑。
   */
  rule_design?: Record<string, unknown> | null;
}

/** 概念属性信息 */
export interface ConceptInfo {
  name: string;
  title: string;
  attributes: {
    name: string;
    type: string;
    title: string;
    /** 属性约束（唯一/非空/枚举/匹配模式/取值范围）。规划期枚举/正则/取值范围校验的权威来源（按属性名回溯，单一事实源）。 */
    constraint?: { unique?: boolean; required?: boolean; enum?: (string | number)[]; pattern?: string; min?: number; max?: number } | null;
  }[];
}

/** 行为元信息（OntologyGateway 提取结果） */
export interface BehaviorMeta {
  /** 行为中文名（title），用于展示 */
  title?: string;
  params: Record<string, any>;
  preRules: RuleDetail[];
  postRules: RuleDetail[];
  /** 安全管控。confirm=false 为显式关闭，覆盖 isWrite 强制确认（判定见 execution-policy.needsSecurityConfirm）；
   *  scope 为权限范围（恒数组）：含 'disable' 时行为被禁用，行为工具层硬中断（security-policy.SecurityGate）。 */
  security?: { confirm: boolean; confirm_content: string; scope: string[] };
  concepts: ConceptInfo[];
  /** 是否写操作（API + POST/PATCH/DELETE）。写操作无论有无 security 登记都强制人工确认。 */
  isWrite: boolean;
  /**
   * **本体元数据不可用**（fail-closed 标记，2026-10-05）：`ontology.yaml` 缺失 / YAML 解析失败，
   * 或该行为名在 `behaviors[]` 中查不到 —— 即**拿不到 `op_type`，无法判断这个行为是否安全**。
   *
   * 置位时的语义（与「元数据可用但 securities 未登记」是两件不同的事，后者是正常业务状态——
   * securities 是全花名册，core 保存时保证每个行为恒定一条记录）：
   *  - `isWrite` 一律为 `true`（拿不到就按最坏假设当写操作）→ 即便调用方漏判也不会跳过安全确认；
   *  - `needsSecurityConfirm` 返回 `false`（**不弹确认**）→ 确认也无意义，SubtaskRunner 会直接判失败；
   *  - `SubtaskRunner.run` 见到即拒绝执行并给出明确原因 → 行为工具零调用，不会绕过任何闸门落库。
   *
   * 为什么要显式标记而不是直接抛错：`getBehaviorMeta` 的调用点分布在规划展示（enrichPlanDisplay）、
   * 波次分类、执行策略派生等处，抛错会把「一次配置读取失败」放大成整个 run 崩溃；
   * 而静默按读操作放行（历史行为）会让**写操作零确认直接执行**——失效方向最危险。
   * 标记 + 就地拒绝是「故障暴露但可控」的最小代价。
   */
  unavailable?: boolean;
}

/** 函数元信息（文件声明侧合一查询结果：本体函数 functions[] → 公共函数 functions.json，都不在 → null）。
 *  与 function-catalog.FunctionInfo 区分：本类型是 gateway 文件投影（snake_case 贴 yaml/json 源形），
 *  FunctionInfo 是 run 级目录快照的单出口返回单元（camelCase 编排侧）。 */
export interface FunctionMeta {
  title: string;
  description?: string;
  params: Record<string, any>;
  /** 函数类型英文码（本体函数 functions[].type：VALIDATION 即判断函数；公共函数恒为空串） */
  type?: string;
}

/** 子任务执行结果 */
export interface SubTaskResult {
  seq: number;
  /** 执行目标名：行为子任务为行为名，函数子任务为函数名（结果侧不再区分二者，统一在此） */
  task: string;
  success: boolean;
  error?: string;
  /** 是否因用户中断/拒绝而终止（区别于常规失败） */
  aborted?: boolean;
  /** 是否因安全管控（权限范围 disable）在工具层硬中断——orchestrator 据此判 securityBlocked 结局、中断整个 run（区别于常规失败/用户中断） */
  securityViolation?: boolean;
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
  /**
   * SDK 工具调用 id（pi-agent-core 的 `toolCallId`）——**running → done 的唯一配对键**。
   *
   * 为什么必需（2026-10-05，agent 环节审查 C5）：前端靠「type+name+status+seq」匹配
   * start 与 end，而**父 Agent 的工具调用不带 seq**（seq 仅子任务相关），两侧 `undefined === undefined`
   * 恒成立——父 Agent 连续两次调用同名工具（如 listOntoBehaviors）时，第 2 次 running 会被丢弃、
   * 第 2 次 done 覆盖第 1 次的 result，执行记录出现错乱。
   * 带 toolCallId 后配对唯一，与「同名工具并发/连续调用」天然区分。
   *
   * 不带该键的条目（subtask_start/done、security_confirm、subtask_input、父侧 load_skill 汇总条）
   * 本就只有单条或成对形态，前端按缺省键处理即可。
   */
  toolCallId?: string;
  /** 所属子任务编号（仅子任务相关条目），前端据此分组展示 */
  seq?: number;
  /** 子任务中文名（行为/函数 title，空则回退子任务描述）。全平台"中文名"的唯一字段名；
   *  「中文（英文）」组合串由渲染层按 title/name 拼接，不再作为字段下发 */
  title?: string;
  /** 子任务描述（父 Agent 生成），聊天区标题副行用 */
  description?: string;
}

// ─── SSE 事件类型 ──────────────────────────────

export type SSEEvent =
  | { type: 'token'; token: string }
  | { type: 'narrative'; token: string } // 规划阶段父Agent叙事（前端折叠块展示，不进正文/历史）
  | { type: 'narrative_end'; outcome: 'plan' | 'answer' | 'aborted' } // 叙事块定格：plan=已提交规划；answer=直答（前端撤块、正文回流）；aborted=中断
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'plan_received'; plan: SubTaskPlan }
  | { type: 'confirm'; confirmId: string; behavior: string; content: string; params?: Record<string, any> }
  | { type: 'plan_confirm'; confirmId: string; plan: SubTaskPlan }
  | { type: 'feedback'; status: 'running' | 'done' }
  | { type: 'exec_entry'; entry: ExecutionEntry };

// ─── API 请求类型 ──────────────────────────────
