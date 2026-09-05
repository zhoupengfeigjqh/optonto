import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { MCPClient } from '../services/mcp-client.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { resolveDeepSeekModel } from '../services/llm.js';
import { buildParentPrompt, buildGeneralPrompt, CHILD_SYSTEM_PROMPT, timeNote } from './prompts.js';
import { toolResultToText } from '../utils/text-utils.js';
import { subtaskFieldsSchema } from './subtask-contract.js';
import { wrapExecuteWithErrorBudget } from './error-budget.js';
import { buildDisableMessage, securityTerminateResult } from './security-policy.js';
import { PARENT_TOOL_LABELS, SCOPE_KEY, bareBehaviorName, toMountableToolInfo } from './tool-catalog.js';
import type { MountableToolInfo } from './tool-catalog.js';
import type { AgentPort } from './agent-ports.js';
import type { SubtaskPolicy } from './execution-policy.js';
import type { ThreadMessage, SkillContext, SubTaskPlan, SkillSelection, ConversationScope } from '../types.js';

// ─── 工具集配置 ─────────────────────────────

// 父 Agent 本体查询工具白名单（标签表单源在 tool-catalog.PARENT_TOOL_LABELS，此处取 keys 作挂载/剔除依据）
const PARENT_ONTOLOGY_QUERY_TOOLS = Object.keys(PARENT_TOOL_LABELS);

/**
 * LLM 数值字段强转。非法值（空/NaN/非数字）直接抛错，
 * 避免 NaN 作为参数静默传给后端 / 在拓扑排序里被跳过。
 */
function toFiniteNum(value: any, label: string): number {
  if (value === '' || value === null || value === undefined) throw new Error(`${label} 为空`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} 不是有效数字: ${value}`);
  return n;
}

/**
 * AgentFactory — 使用 pi-agent-core SDK 创建 Agent 实例。
 *
 * 两阶段 Skill 加载：
 * 阶段 1（初始）：system prompt 只放技能名称和描述
 * 阶段 2（按需）：Agent 调用 load_skill 工具加载完整 SKILL.md
 */
export class AgentFactory {
  /** 按 MCP server URL 缓存连接，避免每个 Agent/子任务新建连接造成传输资源泄漏 */
  private clientCache = new Map<string, MCPClient>();
  /** 按 run 作用域缓存的工具发现结果（closeAll 时清空）。一次 run 内工具列表不变，避免父/子 Agent 每次创建都重复 listTools */
  private toolsCache: AgentTool[] | null = null;

  constructor(
    private mcpConfigStore: MCPConfigStore,
    private skillLoader: SkillLoader,
  ) {}

  /**
   * 获取（或创建）指定 URL 的 MCP 客户端。同一 URL 全程复用一条连接。
   */
  private getOrCreateClient(url: string): MCPClient {
    let client = this.clientCache.get(url);
    if (!client) {
      client = new MCPClient(url);
      this.clientCache.set(url, client);
    }
    return client;
  }

  /**
   * 关闭所有缓存的 MCP 连接并清空缓存。编排结束（无论成功/失败/中断）时调用。
   */
  async closeAll(): Promise<void> {
    this.toolsCache = null; // run 结束，清工具缓存
    const clients = [...this.clientCache.values()];
    this.clientCache.clear();
    await Promise.allSettled(clients.map(c => c.close().catch(() => {})));
  }

  /**
   * 创建父 Agent（规划专家）。
   * 本体模式（scope.contexts 非空）：注册 load_skill + submit_plan + listAllMcpFunctions（本地内部工具，只读）
   * + 本体查询工具（list*，按本体范围硬过滤）；技能为所选本体目录自动反查（用户无感）。
   * 通用模式（scope.contexts 为空）：不挂任何业务工具，纯问答（进不了规划/执行路径）。
   * 函数/外部工具不挂父 Agent——由 listAllMcpFunctions 实时发现，父 Agent 选定后经 related_functions 下放子 Agent、或直接规划为函数子任务。
   * 父 Agent 不挂执行工具（本体行为 facade 工具）——业务执行由子 Agent 独占，
   * 从机制上杜绝父 Agent 规划阶段自执行/与子任务双重执行。
   * - onSkillLoaded：父 Agent 调用 load_skill 时触发，通知 orchestrator 记录已加载的技能名。
   * - onPlanSubmitted：父 Agent 调用 submit_plan 提交规划时触发，规划已通过 TypeBox schema 校验。
   */
  async createParentAgent(
    scope: ConversationScope,
    history: ThreadMessage[],
    onSkillLoaded: (skillName: string) => void,
    onPlanSubmitted?: (plan: SubTaskPlan) => void,
  ): Promise<AgentPort> {
    const model = resolveDeepSeekModel();

    // ── 通用问答模式：未选本体 → 零业务工具，纯对话（无 submit_plan ⇒ 永远进不了执行路径）──
    if (scope.contexts.length === 0) {
      const agent = new Agent({
        initialState: { systemPrompt: buildGeneralPrompt(), model, tools: [], thinkingLevel: 'off' },
        transformContext: async (messages) => [...this.toHistoryMessages(history), ...messages],
      });
      return agent;
    }

    // ── 本体模式 ──
    // 允许集（硬闸锚点）：用户所选本体的 ontology_id 集合，list*/函数清单/规划校验三处共用
    const allowedOntologyIds = new Set(scope.contexts.map(c => c.ontology_id));
    // 技能 name+description 进 system prompt；本体信息列表是 id 的权威来源（严禁臆造）
    const descriptions = this.skillLoader.getSkillDescriptions(scope.skills);
    const systemPrompt = buildParentPrompt(descriptions, scope.contexts);

    const loadSkillTool = this.createLoadSkillTool(scope.skills, onSkillLoaded);
    const submitPlanTool = this.createSubmitPlanTool(onPlanSubmitted);
    const listAllMcpFunctionsTool = this.createListAllMcpFunctionsTool(allowedOntologyIds);
    // MCP 配置全局唯一，不区分场景/本体。父 Agent 只挂本体查询 list*（规划时了解行为/参数/概念/规则/函数元数据），
    // 并按本体范围包一层硬过滤（越界本体直接报错，不靠提示词自觉）；
    // 函数与外部工具一律不挂——由 listAllMcpFunctions 实时发现，父 Agent 选定后经 related_functions 下放子 Agent。
    const allMcp = await this.discoverTools();
    const parentMcpTools = allMcp
      .filter(t => PARENT_ONTOLOGY_QUERY_TOOLS.includes(t.name))
      .map(t => this.scopeListTool(t, scope.contexts));
    const tools: AgentTool[] = [loadSkillTool, submitPlanTool, listAllMcpFunctionsTool, ...parentMcpTools];

    const agent = new Agent({
      initialState: { systemPrompt, model, tools, thinkingLevel: 'off' },
      transformContext: async (messages) => [...this.toHistoryMessages(history), ...messages],
    });
    return agent;
  }

  /** 线程历史 → SDK 消息（summary 角色加【历史摘要】前缀，避免模型当成自己上一轮真实发言） */
  private toHistoryMessages(history: ThreadMessage[]): AgentMessage[] {
    return history.map(msg => {
      if (msg.role === 'user') {
        return { role: 'user', content: msg.content, timestamp: Date.parse(msg.timestamp) || Date.now() } as unknown as AgentMessage;
      }
      const text = msg.role === 'summary' ? `【历史摘要】${msg.content}` : msg.content;
      return { role: 'assistant', content: [{ type: 'text', text }], timestamp: Date.parse(msg.timestamp) || Date.now() } as unknown as AgentMessage;
    });
  }

  /**
   * list* 本体查询工具的本体范围硬过滤（agent 层闸，防 LLM 越界查询）：
   *  - 带 ontology_id 参数的 6 个工具（listOnto*）：越界直接抛错，LLM 自纠
   *  - listScenarios/listOntologies（全局清单）：结果按允许集过滤（JSON 数组形状可识别时；
   *    解析失败原样放行——只泄名称不泄数据，真正的闸在上面 6 个工具与 PlanGate）
   */
  private scopeListTool(tool: AgentTool, contexts: SkillContext[]): AgentTool {
    const allowedOntologyIds = new Set(contexts.map(c => c.ontology_id));
    const allowedScenarioIds = new Set(contexts.map(c => c.scenario_id));
    const allowedList = contexts.map(c => `${c.ontology_name}（ontology_id=${c.ontology_id}）`).join('、');
    const hasOntologyIdParam = !!((tool.parameters as any)?.properties?.ontology_id);
    const originalExecute = tool.execute;
    const execute = async (toolCallId: string, params: any) => {
      const p = params as any;
      if (hasOntologyIdParam) {
        const oid = Number(p?.ontology_id);
        if (!allowedOntologyIds.has(oid)) {
          throw new Error(`ontology_id=${p?.ontology_id} 不在本次对话的本体范围内（允许：${allowedList}），请改用允许的本体 ID`);
        }
        return originalExecute(toolCallId, params);
      }
      const result = await originalExecute(toolCallId, params);
      // 全局清单工具：过滤出允许的场景/本体（形状可识别才过滤，解析失败放行）
      try {
        const text = toolResultToText((result as any).content);
        const data = JSON.parse(text);
        if (!Array.isArray(data)) return result;
        const isScenarioList = tool.name === 'listScenarios';
        const filtered = data.filter((item: any) => {
          const id = Number(item?.id ?? item?.ontology_id);
          return isScenarioList ? allowedScenarioIds.has(id) : allowedOntologyIds.has(id);
        });
        return { ...(result as any), content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
      } catch {
        return result;
      }
    };
    return { ...tool, execute };
  }

  /**
   * 创建子 Agent（执行专家）。
   * 挂载业务执行工具集：本体行为工具（按 policy.legalCalls.behaviors，scope.name 裸名匹配）
   * + 本体函数/公共函数/其他 MCP 工具（一律按 policy.legalCalls.functions = 规则声明 ∪ 父 Agent related_functions 挂载）。
   * 挂载期过滤即白名单机制：未挂载的工具子 Agent 物理上不可调用，无需运行期名单闸。
   * 参数合法性由工具 inputSchema（core 编译，含 enum/pattern/min/max/必填约束）在 harness 层校验。
   * 不挂 load_skill / submit_plan / list* 本体浏览工具——子 Agent 只执行业务，无需自行浏览本体元数据。
   * context 来自 SKILL.md frontmatter 提取，不从 URL/body 获取。
   * policy 为 buildSubtaskPolicy 派生的完整执行策略（合法清单/安全上下文/报错预算），
   * 安全闸与预算包装恒在——不存在"半设防"形态，缺哪样都编译不过。
   */
  async createChildAgent(context: SkillContext, policy: SubtaskPolicy): Promise<AgentPort> {
    const { scenario_name: scenario, ontology_name: ontology, ontology_id: ontologyId } = context;
    const model = resolveDeepSeekModel();
    // MCP 配置全局唯一，不区分场景/本体
    const allMcp = await this.discoverTools();
    // 剔除本体浏览工具（list*）——子 Agent 只执行业务。
    // 执行工具按当前本体锁定：ontology_id 从参数剔除并强制注入，杜绝跨本体干扰
    // （无 ontology_id 的工具如公共函数/新增 MCP 原样透传）。
    const legal = policy.legalCalls;
    const mcpTools = allMcp
      .filter(tool => {
        if (PARENT_ONTOLOGY_QUERY_TOOLS.includes(tool.name)) return false; // 剔除 list*
        const scopeProps = (tool.parameters as any)?.properties?.[SCOPE_KEY]?.properties;
        const category = scopeProps?.category?.const;
        // 本体行为工具：按 scope.name 裸名匹配合法行为集合（工具名可能带 onto{id}__ 前缀，不能按工具名比）
        if (category === '本体行为') return legal.behaviors.includes(scopeProps?.name?.const ?? '');
        // 本体函数 / 公共函数 / 其他 MCP 工具：一律按 legalCalls.functions（规则声明 ∪ 父 Agent related_functions）挂载
        return legal.functions.includes(tool.name);
      })
      .map(tool => this.scopeToOntology(tool, ontologyId, policy));
    const systemPrompt = `${CHILD_SYSTEM_PROMPT}\n\n## 当前上下文\n- 场景: ${scenario}\n- 本体: ${ontology}\n- 本体ID: ${ontologyId}\n\n直接调用已挂载的行为/函数工具（工具名即行为名/函数名），参数结构以各工具 schema 为准。${timeNote()}`;
    const agent = new Agent({
      initialState: { systemPrompt, model, tools: mcpTools, thinkingLevel: 'off' },
    });
    return agent;
  }

  /**
   * 直连调用函数/MCP 工具（函数子任务确定性执行，不经子 Agent LLM）。
   * 从已发现工具清单按名定位工具；本体函数工具 schema 带 ontology_id → 强制注入本体 id（与 scopeToOntology 同源锁定），
   * 公共函数/其他 MCP 工具无 ontology_id → 参数原样透传。
   * 复用 discoverTools 的原始 execute（内含 ontology_id/scenario_id 数字强转 + isError→抛错），调用一次即返回。
   * 不抛异常：错误一律折叠为 { isError: true }，由 orchestrator 记入结果，避免函数失败打断整波并行。
   */
  async callFunctionTool(functionName: string, ontologyId: number, params: Record<string, any>): Promise<{ text: string; isError: boolean }> {
    const all = await this.discoverTools();
    const found = all.find(tool => tool.name === functionName);
    if (!found) {
      return { text: `函数 ${functionName} 不在可挂载工具清单中`, isError: true };
    }
    const props = (found.parameters as any)?.properties;
    // 本体函数判定用发布方标记（scope.category const），不靠 ontology_id 属性猜测：
    // 外部工具碰巧带 ontology_id 参数时按原样透传，不被误注入本体 id
    const isOntoFn = props?.[SCOPE_KEY]?.properties?.category?.const === '本体函数';
    const p = isOntoFn ? { ...params, ontology_id: ontologyId } : { ...params };
    try {
      const res = await found.execute('direct-function-call', p);
      return { text: toolResultToText(res.content), isError: false };
    } catch (e: any) {
      return { text: e?.message || String(e), isError: true };
    }
  }

  /**
   * 将执行类工具限定到指定本体：
   * - 参数 schema 剔除 ontology_id（LLM 不需要也不能指定所属本体）与 scope 块（规划元数据）
   * - 调用时强制注入本体的 ontology_id，忽略 LLM 传入的任何 id
   * - 两道安全闸（按序，见 execute 内；参数合法性由工具 inputSchema 在 harness 层校验，不再设运行期参数闸）：
   *   闸0 入口短路（violation 已置位 → 一律 terminate，中断信号广播到全 run）→
   *   闸1 disable（本体行为工具按 scope.name 裸名查禁用集合：置 violation + terminate，不抛错不走预算，无自纠空间）
   *   （行为/函数工具的合法性已在 createChildAgent 挂载期按 legalCalls 过滤，机制即白名单）
   * 无 ontology_id 的工具（如公共函数/新增 MCP）原样返回。
   */
  private scopeToOntology(tool: AgentTool, ontologyId: number, policy: SubtaskPolicy): AgentTool {
    const { security, errorBudget } = policy;
    const schema = tool.parameters as any;
    const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : null;
    const scopeProps = props?.[SCOPE_KEY]?.properties;
    const category = scopeProps?.category?.const;
    // 本体锁定对象：本体行为（facade）+ 本体函数，均按发布方标记（scope.category const）判定。
    // 不靠 ontology_id 属性猜测——外部工具碰巧带该参数时不会被误剥参数/误注入本体 id
    const isBehavior = category === '本体行为';
    const needLock = category === '本体函数' || isBehavior;
    // 仅锁定的工具做 ontology_id 剔除 + 强制注入；其余（公共函数/外部 MCP）原样透传参数
    let nextParameters = schema;
    if (needLock && props) {
      const nextProps = { ...props };
      delete nextProps.ontology_id;
      delete nextProps[SCOPE_KEY]; // scope 是规划元数据（非输入参数），子 Agent 不该看见/填写
      const required = Array.isArray(schema.required)
        ? (schema.required as string[]).filter(k => k !== 'ontology_id')
        : undefined;
      nextParameters = { ...schema, properties: nextProps, ...(required ? { required } : {}) };
    }
    const originalExecute = tool.execute;
    const execute = async (toolCallId: string, params: any) => {
      // ── 闸0 入口短路（所有工具）：run 内任一调用已命中 disable（violation 置位）→ 一律 terminate ──
      // 中断信号的广播器：兄弟子 Agent 共享同一 gate，一个出事全场后续工具调用零执行；
      // 并行批场景下同批后续调用也全带 terminate，shouldTerminateToolBatch 的 every() 整批命中硬停。
      if (security.gate.violation) {
        return securityTerminateResult(security.gate.violation);
      }
      const p = needLock ? { ...(params as any), ontology_id: ontologyId } : (params as any); // 强制锁定

      // ── 闸1 disable（策略级拒绝）──
      // 行为工具按 scope.name 裸名查禁用集合（工具名可能带 onto{id}__ 前缀，裸名才是 securities 登记键）。
      // 命中：置 run 级 violation（first-writer-wins）+ 返回 terminate:true，真实 MCP 调用零发生。
      // 不抛错、不计报错预算：策略拒绝无自纠空间（重试必败），terminate 当场停内层循环（与预算超限同机制），
      // SubtaskRunner 见 violation 返回 securityViolation 失败 → orchestrator 以 securityBlocked 中断整个 run。
      if (isBehavior) {
        const bare = scopeProps?.name?.const ?? bareBehaviorName(tool.name);
        if (security.disabled.has(bare)) {
          security.gate.violation ??= buildDisableMessage(bare, security.disabled.get(bare));
          return securityTerminateResult(security.gate.violation);
        }
      }
      return originalExecute(toolCallId, p);
    };
    return {
      ...tool,
      ...(nextParameters !== schema ? { parameters: nextParameters } : {}),
      // 恒包上报错计数——预算由策略对象保证存在，不再有"无预算"形态
      execute: wrapExecuteWithErrorBudget(execute, errorBudget),
    };
  }

  /**
   * 创建 load_skill 工具。
   * Agent 在需要某个技能的完整知识时调用。
   * 从本对话选中的技能列表解析该技能的 (scenario, ontology) 再加载全文，支持跨本体。
   * 加载后通过 onSkillLoaded 回调通知 orchestrator 记录。
   */
  private createLoadSkillTool(skills: SkillSelection[], onSkillLoaded?: (skillName: string) => void): AgentTool {
    return {
      name: 'load_skill',
      label: '加载技能知识',
      description: '加载指定技能的完整知识文件。当用户问题涉及某个技能领域时，先调用此工具获取完整知识再回答。',
      parameters: Type.Object({
        skill_name: Type.String({ description: '技能名称，如 raw-material-inventory' }),
      }),
      execute: async (toolCallId, params) => {
        const p = params as any;
        const skillName = p.skill_name as string;
        const sel = skills.find(s => s.name === skillName);
        if (!sel) throw new Error(`技能 "${skillName}" 不在本对话选中的技能中`);
        const content = this.skillLoader.loadSkill(sel.scenario, sel.ontology, skillName);
        if (onSkillLoaded) onSkillLoaded(skillName);
        return {
          content: [{ type: 'text', text: content }],
          details: { skill_name: skillName, scenario: sel.scenario, ontology: sel.ontology },
        };
      },
    };
  }

  /**
   * 创建 submit_plan 工具。
   * 父 Agent 通过工具调用提交结构化规划，参数经 SDK 的 validateToolArguments 按
   * TypeBox schema 校验（缺字段/类型错误会自动强转并让 LLM 自纠），
   * 规划通过 onPlanSubmitted 回调交给 orchestrator，不再依赖正则抓取文本 JSON。
   */
  private createSubmitPlanTool(onPlanSubmitted?: (plan: SubTaskPlan) => void): AgentTool {
    return {
      name: 'submit_plan',
      label: '提交子任务规划',
      description: '当用户需求属于业务操作、需要拆分为多个子任务执行时，调用本工具提交完整的子任务执行规划。',
      parameters: Type.Object({
        // 子任务字段单一事实源：subtask-contract 声明表（提示词字段表与本 schema 同源，必填性不再漂移）
        subtasks: Type.Array(Type.Object(subtaskFieldsSchema())),
        reasoning: Type.Optional(Type.String()),
      }),
      execute: async (toolCallId, params) => {
        const plan = params as { subtasks: Array<Record<string, any>> };
        // 规整数值字段：LLM 可能输出字符串数字，统一转 number 供拓扑排序/seq 匹配使用。
        // 非法值直接抛错 → submit_plan 工具报错，父 Agent 看到后可自纠，避免 NaN 静默跳过。
        for (const st of plan.subtasks) {
          st.seq = toFiniteNum(st.seq, '子任务 seq');
          st.scenario_id = st.scenario_id != null && st.scenario_id !== '' ? toFiniteNum(st.scenario_id, `子任务 ${st.seq} 的 scenario_id`) : undefined;
          st.ontology_id = toFiniteNum(st.ontology_id, `子任务 ${st.seq} 的 ontology_id`);
          if (Array.isArray(st.depends_on)) st.depends_on = st.depends_on.map(d => toFiniteNum(d, `子任务 ${st.seq} 的 depends_on`));
          // 行为/函数互斥：有且只有一个非空。缺键/空白统一规整为空串并回写——
          // 下游校验器与执行分支用 `if (st.function)` 裸真值判别，" " 这类空白串不规约会走错分支。
          st.behavior = typeof st.behavior === 'string' ? st.behavior.trim() : '';
          st.function = typeof st.function === 'string' ? st.function.trim() : '';
          const hasBehavior = st.behavior !== '';
          const hasFunction = st.function !== '';
          if (hasBehavior === hasFunction) {
            throw new Error(`子任务 ${st.seq} 必须且只能填写 behavior 或 function 之一（当前 behavior="${st.behavior}"，function="${st.function}"）`);
          }
          // related_functions 只服务于行为子任务（子 Agent 执行取数/计算的函数挂载面）：
          // 行为子任务可填可不填；函数子任务自身即函数直连调用（无子 Agent），必须为空。
          if (Array.isArray(st.related_functions)) {
            st.related_functions = st.related_functions.filter((f: any) => typeof f === 'string' && f.trim() !== ''); // 规整回写：剔除空白项
          }
          if (hasFunction && Array.isArray(st.related_functions) && st.related_functions.length > 0) {
            throw new Error(`子任务 ${st.seq} 是函数子任务（function="${st.function}"），related_functions 必须为空（该字段仅用于行为子任务，当前 ${JSON.stringify(st.related_functions)}）`);
          }
        }
        if (onPlanSubmitted) onPlanSubmitted(plan as unknown as SubTaskPlan);
        return {
          content: [{ type: 'text', text: '已接收执行规划，将按序执行。' }],
          details: { submitted: true },
        };
      },
    };
  }

  /**
   * 可挂载工具目录（单一事实源）：本体行为 / 本体函数 / 公共函数 / 其他 MCP 工具四类。
   * 供父 Agent 的 listAllMcpFunctions 工具（规划发现，本体行为条目会被剔除——行为规划走 listOntoBehaviors）
   * 与规划校验（函数名/参数结构与行为编译 schema 数据源）共用。
   * 每个条目：
   *   - category：发布方标记（本体行为/本体函数 scope.category / 公共函数 x-category），无标记 = 其他MCP工具
   *   - displayName：中文显示名（scope.display_name / x-display_name），无则上层兜底
   *   - params：完整参数结构（inputSchema 剔除 scope 后经 schemaToDeclaredParams 转声明形状
   *     {key: {type, required, description(含示例), example?}}），与子任务 params 填法同形
   *   - schema：编译 inputSchema 原文（剥 scope/ontology_id），规划期参数校验（TypeBox）的数据源
   *   - scope（本体行为/函数独有）：所属场景/本体真实值 {ontology_id/scenario_id/scenario_name/ontology_name/name 裸名}，
   *     来自 MCP server 工具 schema 前置的 scope 块（非输入参数）
   * 只读：仅返回工具元数据，不调用任何工具、无副作用。
   */
  async getMountableToolCatalog(): Promise<MountableToolInfo[]> {
    const all = await this.discoverTools();
    // 只剔除本体浏览 list*（元数据查询工具）；其余（本体行为 / 本体函数 / 公共函数 / 其他 MCP 工具）均是可挂载项。
    // 函数三类是 related_functions / 函数子任务 function 的取值域；本体行为是子 Agent 行为挂载与规划期参数校验的数据源。
    return all
      .filter(t => !PARENT_ONTOLOGY_QUERY_TOOLS.includes(t.name))
      .map(t => toMountableToolInfo(t));
  }

  /**
   * 创建 listAllMcpFunctions 工具（父 Agent 内部工具，本地实现，只读）。
   * 列出可规划/可下放的函数与工具清单（本体函数 / 公共函数 / 其他 MCP 工具三类合一），
   * 供父 Agent 规划函数子任务（function 字段）、行为子任务的 related_functions、以及填子任务 params。
   * 与 MCP 版 listOntoFunctions（本体函数元数据查询）分工：那个只查指定本体的函数元数据，这个管"能规划什么"。
   * 本体范围硬过滤：本体函数恒限定在本次对话所选本体集合内（无论是否传 ontology_id），
   * 传了范围外的 ontology_id 直接报错；公共函数/其他MCP工具是全局工具，始终保留。
   * 参数 ontology_id 与 keyword 均可选，与关系：
   *   - ontology_id：仅过滤本体函数（按 scope.ontology_id 精确匹配，且必须在允许集内）
   *   - keyword：对 name/description 大小写不敏感模糊匹配
   *   - 都不传 → 返回允许集内全部
   * 本地实现且不进 MCP server 的原因：①其他 MCP 工具只存在于 agent-backend 的 discoverTools() 清单中，
   * core-backend 无法感知；②与 submit_plan/load_skill 同为父 Agent 内部工具，不暴露给外部消费方与子 Agent。
   * 只读：仅返回工具元数据，不调用任何工具、无副作用——
   * 与父 Agent「只规划、不执行」的职责边界一致，避免父 Agent 借此执行外部副作用工具。
   */
  private createListAllMcpFunctionsTool(allowedOntologyIds: ReadonlySet<number>): AgentTool {
    return {
      name: 'listAllMcpFunctions',
      label: '列出可规划函数/工具',
      description: '列出当前可规划为子任务的函数/工具清单（本体函数 / 公共函数 / 其他 MCP 工具，含名称、分类、描述、完整参数结构、本体函数所属场景/本体）。用于规划函数子任务（function 字段）、行为子任务的 related_functions、以及填子任务 params。参数 ontology_id（按本体过滤，仅滤本体函数，且必须在本次对话本体范围内）与 keyword（按名称/描述搜索）均可选，与关系；都不传返回范围内全部。只读，不会调用这些工具。',
      parameters: Type.Object({
        ontology_id: Type.Optional(Type.Union([Type.Number(), Type.String()], { description: '本体 ID（可选）。填了则本体函数只返回该本体下的（必须在本次对话本体范围内）；公共函数/其他MCP工具为全局工具，不受此过滤' })),
        keyword: Type.Optional(Type.String({ description: '搜索关键词（可选），模糊匹配函数/工具名称或描述' })),
      }),
      execute: async (_toolCallId, params) => {
        const p = params as any;
        // LLM 可能传字符串数字，统一规整；非法值抛错让父 Agent 自纠
        const oid = p?.ontology_id !== undefined && p?.ontology_id !== null && p?.ontology_id !== ''
          ? toFiniteNum(p.ontology_id, 'ontology_id')
          : undefined;
        // 本体范围硬闸：显式指定了范围外的本体 → 报错（不静默返空，避免 LLM 误判"该本体无函数"）
        if (oid !== undefined && !allowedOntologyIds.has(oid)) {
          throw new Error(`ontology_id=${oid} 不在本次对话的本体范围内（允许：${[...allowedOntologyIds].join('、')}）`);
        }
        const kw = typeof p?.keyword === 'string' && p.keyword.trim() !== '' ? p.keyword.trim().toLowerCase() : undefined;
        let catalog = (await this.getMountableToolCatalog())
          // 本体行为不进本清单：行为子任务规划走 listOntoBehaviors（花名册+规则关联），这里只列函数/工具
          .filter(t => t.category !== '本体行为')
          // 本体范围硬过滤：本体函数恒限定在允许集内；全局工具（公共函数/其他MCP工具）无本体归属，始终保留
          .filter(t => t.category !== '本体函数' || allowedOntologyIds.has(Number(t.scope?.ontology_id)));
        if (oid !== undefined) {
          catalog = catalog.filter(t => t.category !== '本体函数' || Number(t.scope?.ontology_id) === oid);
        }
        if (kw !== undefined) {
          catalog = catalog.filter(t => t.name.toLowerCase().includes(kw) || (t.description || '').toLowerCase().includes(kw));
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(catalog, null, 2) }],
          details: { count: catalog.length },
        };
      },
    };
  }

  /**
   * 从 MCP 配置中连接启用的服务，自动发现并注册工具。
   */
  private async discoverTools(): Promise<AgentTool[]> {
    // 一次 run 内工具列表不变：缓存发现结果，避免父/子 Agent 每次创建都重复 listTools。
    // 缓存生命周期与连接缓存一致，由 closeAll() 在 run 结束时清空。
    if (this.toolsCache) return this.toolsCache;
    // MCP 配置全局唯一（./config/mcp-config.json），不区分场景/本体
    const mcpConfig = this.mcpConfigStore.getConfig();
    const tools: AgentTool[] = [];

    for (const server of mcpConfig.servers) {
      if (!server.enabled) continue;

      let client: MCPClient | null = null;
      try {
        // 复用缓存连接（connect 幂等），避免每个 Agent 新建 SSE 连接
        client = this.getOrCreateClient(server.url);
        await client.connect();

        const result = await client.listTools();
        const mcpTools = result.tools || [];

        for (const t of mcpTools) {
          const toolName = t.name as string;
          if (server.allowed_tools && server.allowed_tools.length > 0 && !server.allowed_tools.includes(toolName)) {
            continue;
          }
          // 优先用 MCP 提供的原生 JSON Schema 做参数校验与类型强转，
          // 无 schema 时退回宽松校验（validateToolArguments 原生支持 JSON Schema）
          const inputSchema = (t as any).inputSchema;
          tools.push({
            name: toolName,
            label: toolName,
            description: (t.description as string) || `[${server.name}] ${toolName}`,
            parameters: inputSchema && typeof inputSchema === 'object' && Object.keys(inputSchema).length > 0
              ? inputSchema
              : Type.Object({}, { additionalProperties: true }),
            execute: async (toolCallId, params) => {
              if (!client) throw new Error('MCP 未连接');
              const p = params as any;
              // LLM 可能传字符串类型，强制转数字；非法值抛错置工具失败，子 Agent 可自纠
              if (p.ontology_id !== undefined) p.ontology_id = toFiniteNum(p.ontology_id, 'ontology_id');
              if (p.scenario_id !== undefined) p.scenario_id = toFiniteNum(p.scenario_id, 'scenario_id');
              const result = await client.callTool(toolName, p);
              const text = toolResultToText(result.content);
              if (result.isError) {
                // 抛异常让 pi-agent 识别为工具错误（返回 isError 字段会被吞掉，重试不触发）
                throw new Error(text);
              }
              return { content: [{ type: 'text', text }], details: {} };
            },
          });
        }

        console.log(`[MCP] ${server.name}: 发现 ${mcpTools.length} 个工具`);
      } catch (e: any) {
        console.error(`[MCP] ${server.name} 连接失败: ${e.message}`);
      }
    }

    this.toolsCache = tools;
    return tools;
  }
}
