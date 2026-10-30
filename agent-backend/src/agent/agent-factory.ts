import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { MCPClient } from '../services/mcp-client.js';
import { MCPConfigStore, isBusinessDataServer } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { VisibilityGuard } from '../services/visibility-guard.js';
import { resolveDeepSeekModel } from '../services/llm.js';
import { buildParentPrompt, buildGeneralPrompt, CHILD_SYSTEM_PROMPT, timeNote } from './prompts.js';
import { toolResultToText } from '../utils/text-utils.js';
import { subtaskFieldsSchema } from './subtask-contract.js';
import { toFiniteNum } from './param-contract.js';
import { createLoadSkillTool, createSubmitPlanTool, createListPlannableFunctionsTool } from './parent-tools.js';
import { wrapExecuteWithErrorBudget } from './error-budget.js';
import { buildDisableMessage, securityTerminateResult } from './security-policy.js';
import {
  CATEGORY, assertToolProtocol, isQueryTool, publishedCategory,
  readOntologyScope, stripOntologyScope, toMountableToolInfo,
} from './tool-catalog.js';
import type { MountableToolInfo, OntologyScope } from './tool-catalog.js';
import type { AgentPort } from './agent-ports.js';
import type { SubtaskPolicy } from './execution-policy.js';
import { missingRuleFunctions, parseRuleVerdict } from './execution-policy.js';
import type { ThreadMessage, SkillContext, SubTaskPlan, SkillSelection, ConversationScope } from '../types.js';

// ─── 工具集配置 ─────────────────────────────

// 父 Agent 挂载的本体查询工具由发布方分类标记决定（x-category=本体查询），不再硬编码名单

/**

/**
 * AgentFactory — 使用 pi-agent-core SDK 创建 Agent 实例。
 *
 * 两阶段 Skill 加载：
 * 阶段 1（初始）：system prompt 只放技能名称和描述
 * 阶段 2（按需）：Agent 调用 load_skill 工具加载完整 SKILL.md
 */
/** 发现期工具：SDK 工具 + 从发布 schema 提升出来的本体元数据（不是参数，故不留在 parameters 里） */
export type DiscoveredTool = AgentTool & { ontologyScope?: OntologyScope };

export class AgentFactory {
  /** 按 MCP server URL 缓存连接，避免每个 Agent/子任务新建连接造成传输资源泄漏 */
  private clientCache = new Map<string, MCPClient>();
  /** 按 run 作用域缓存的工具发现结果（closeAll 时清空）。一次 run 内工具列表不变，避免父/子 Agent 每次创建都重复 listTools */
  private toolsCache: DiscoveredTool[] | null = null;

  constructor(
    private mcpConfigStore: MCPConfigStore,
    private skillLoader: SkillLoader,
    /** 可见性收编守卫（配映射即收编）：可选注入，缺省不收编（单测便捷） */
    private visibilityGuard?: VisibilityGuard,
  ) {}

  /**
   * 获取（或创建）指定 URL 的 MCP 客户端。同一 URL+headers 组合全程复用一条连接。
   */
  private getOrCreateClient(url: string, headers?: Record<string, string>): MCPClient {
    // headers 进缓存键：同 URL 不同凭据是两条不同连接，不可串
    const key = headers && Object.keys(headers).length > 0 ? `${url}#${JSON.stringify(headers)}` : url;
    let client = this.clientCache.get(key);
    if (!client) {
      client = new MCPClient(url, headers);
      this.clientCache.set(key, client);
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
   * 工具发现结果的公开观察口（2026-10-06，宪法 II：跨模块能力 MUST 提升为公开 API）。
   *
   * `discoverTools` 是私有方法，但三个测试文件（visibility / dead-data-engine /
   * business-data）都需要读它的产出，且此前是`(factory as any).discoverTools()`
   * —— 用类型断言强穿封装，等价于「私有成员被外部依赖」，一旦内部改名测试就静默失效。
   *
   * 范式同 `Orchestrator.hasActiveRun()`：显式开洞，洞的用途与稳定性写进注释。
   * 仅供测试与诊断观察，**MUST NOT** 用于业务判断。
   */
  observeDiscoveredTools(): Promise<DiscoveredTool[]> {
    return this.discoverTools();
  }

  /**
   * 创建父 Agent（规划专家）。
   * 本体模式（scope.contexts 非空）：注册 load_skill + submit_plan + listPlannableFunctions（本地内部工具，只读）
   * + 本体查询工具（list*，按本体范围硬过滤）；技能为所选本体目录自动反查（用户无感）。
   * 通用模式（scope.contexts 为空）：不挂任何业务工具，纯问答（进不了规划/执行路径）。
   * 函数/外部工具不挂父 Agent——由 listPlannableFunctions 实时发现，父 Agent 选定后经 related_functions 下放子 Agent、或直接规划为函数子任务。
   * 父 Agent 不挂执行工具（本体行为工具）——业务执行由子 Agent 独占，
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

    const loadSkillTool = createLoadSkillTool(
      (s, o, n) => this.skillLoader.loadSkill(s, o, n), scope.skills, onSkillLoaded,
    );
    const submitPlanTool = createSubmitPlanTool(onPlanSubmitted);
    const listPlannableFunctionsTool = createListPlannableFunctionsTool(
      () => this.getMountableToolCatalog(), allowedOntologyIds,
    );
    // MCP 配置全局唯一，不区分场景/本体。父 Agent 只挂本体查询 list*（规划时了解行为/参数/概念/规则/函数元数据），
    // 并按本体范围包一层硬过滤（越界本体直接报错，不靠提示词自觉）；
    // 函数与外部工具一律不挂——由 listPlannableFunctions 实时发现，父 Agent 选定后经 related_functions 下放子 Agent。
    const allMcp = await this.discoverTools();
    const parentMcpTools = allMcp
      .filter(t => isQueryTool(t.parameters))
      .map(t => this.scopeListTool(t, scope.contexts));
    const tools: AgentTool[] = [loadSkillTool, submitPlanTool, listPlannableFunctionsTool, ...parentMcpTools];

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
   * 挂载业务执行工具集：本体行为工具（按 policy.legalCalls.behaviors，工具名即行为名）
   * + 本体函数/公共函数/其他 MCP 工具（一律按 policy.legalCalls.functions = 规则声明 ∪ 父 Agent related_functions 挂载）。
   * 挂载期过滤即白名单机制：未挂载的工具子 Agent 物理上不可调用，无需运行期名单闸。
   * 参数合法性由工具 inputSchema（core 编译，含 enum/pattern/min/max/必填约束）在 harness 层校验。
   * 不挂 load_skill / submit_plan / list* 本体浏览工具——子 Agent 只执行业务，无需自行浏览本体元数据。
   * context 来自 SKILL.md frontmatter 提取，不从 URL/body 获取。
   * policy 为 buildSubtaskPolicy 派生的完整执行策略（合法清单/安全上下文/报错预算），
   * 安全闸与预算包装恒在——不存在"半设防"形态，缺哪样都编译不过。
   *
   * 本体归属**不在 agent 侧注入或覆盖**：`ontology_id` 是工具必填参数，由子 Agent（LLM）填写，
   * 执行底座据发布时固化的 scope 校验一致性。agent 的归属闸 = 挂载期只挂本子任务本体的工具。
   */
  async createChildAgent(context: SkillContext, policy: SubtaskPolicy): Promise<AgentPort> {
    const { scenario_name: scenario, ontology_name: ontology, ontology_id: ontologyId } = context;
    const model = resolveDeepSeekModel();
    // MCP 配置全局唯一，不区分场景/本体
    const allMcp = await this.discoverTools();
    // 剔除本体浏览工具（list*）——子 Agent 只执行业务。
    const legal = policy.legalCalls;
    const mcpTools = allMcp
      .filter(tool => {
        if (isQueryTool(tool.parameters)) return false; // 元数据查询工具父 Agent 专用
        const category = publishedCategory(tool.parameters);
        // 本体行为工具：工具名即行为裸名（契约⑤）
        if (category === CATEGORY.BEHAVIOR) return legal.behaviors.includes(tool.name);
        // 本体函数 / 公共函数 / 其他 MCP 工具：一律按 legalCalls.functions（规则声明 ∪ 父 Agent related_functions）挂载
        return legal.functions.includes(tool.name);
      })
      .map(tool => this.guardExecution(tool, policy));
    const systemPrompt = `${CHILD_SYSTEM_PROMPT}\n\n## 当前上下文\n- 场景: ${scenario}\n- 本体: ${ontology}\n- 本体ID: ${ontologyId}\n\n`
      + `直接调用已挂载的行为/函数工具（工具名即行为名/函数名），参数结构以各工具 schema 为准。`
      + `调用本体行为/本体函数时 ontology_id 是必填参数，须填 ${ontologyId}（本子任务的所属本体）；填错会被执行底座拒绝。${timeNote()}`;
    const agent = new Agent({
      initialState: { systemPrompt, model, tools: mcpTools, thinkingLevel: 'off' },
    });
    return agent;
  }

  /**
   * 直连调用函数/MCP 工具（函数子任务确定性执行，不经子 Agent LLM）。
   * 从已发现工具清单按名定位工具；本体函数的 `ontology_id` 若计划期未填，用子任务本体补齐
   * （调用方已填则**原样透传**——绝不静默覆盖，否则一致性校验就失去意义）。
   * 复用 discoverTools 的原始 execute（内含 ontology_id/scenario_id 数字强转 + isError→抛错），调用一次即返回。
   * 不抛异常：错误一律折叠为 { isError: true }，由 orchestrator 记入结果，避免函数失败打断整波并行。
   */
  async callFunctionTool(functionName: string, ontologyId: number, params: Record<string, any>): Promise<{ text: string; isError: boolean }> {
    const all = await this.discoverTools();
    const found = all.find(tool => tool.name === functionName);
    if (!found) {
      return { text: `函数 ${functionName} 不在可挂载工具清单中`, isError: true };
    }
    // 本体函数判定用发布方分类标记（x-category），不靠 ontology_id 属性猜测：
    // 外部工具碰巧带 ontology_id 参数时按原样透传，不被误补本体 id
    const isOntoFn = publishedCategory(found.parameters) === CATEGORY.FUNCTION;
    const hasOntologyId = (params as any)?.ontology_id !== undefined && (params as any)?.ontology_id !== null;
    const p = isOntoFn && !hasOntologyId ? { ...params, ontology_id: ontologyId } : { ...params };
    try {
      const res = await found.execute('direct-function-call', p);
      return { text: toolResultToText(res.content), isError: false };
    } catch (e: any) {
      return { text: e?.message || String(e), isError: true };
    }
  }

  /**
   * 执行类工具的安全闸包装（不改 schema、不改参数）：
   * - 三道安全闸（按序，见 execute 内；参数合法性由工具 inputSchema 在 harness 层校验，不再设运行期参数闸）：
   *   闸0 入口短路（violation 已置位 → 一律 terminate，中断信号广播到全 run）→
   *   闸1 disable（本体行为工具按行为名查禁用集合：置 violation + terminate，不抛错不走预算，无自纠空间）→
   *   闸2 前置规则留痕（仅主行为：前置规则关联函数未成功执行 → 抛错引导补跑，可恢复走报错预算）
   *   （行为/函数工具的合法性已在 createChildAgent 挂载期按 legalCalls 过滤，机制即白名单）
   * - 成功台账：execute 正常 resolve 后把工具名记入 policy.ruleGate.succeeded（后置闸收尾核查的数据源）
   *
   * 这里**不再改写参数**：本体元数据在发现期已从参数面剥离（LLM 看不到），`ontology_id` 是
   * 调用方必填、原样透传——覆盖它会掩盖调用方填错的本体，让执行底座的一致性校验形同虚设。
   */
  private guardExecution(tool: AgentTool, policy: SubtaskPolicy): AgentTool {
    const { security, errorBudget } = policy;
    const category = publishedCategory(tool.parameters);
    const isBehavior = category === CATEGORY.BEHAVIOR;
    // 行为名 = 工具名（契约⑤）
    const behaviorName = tool.name;
    const originalExecute = tool.execute;
    // 判断函数集合（裁决解析触发名单）：仅本体且 type=VALIDATION 的判断函数会产生裁决结论；
    // 普通关联函数（CALCULATION/公共函数）即使返回同名 pass 字段也不进裁决台账（口径 B：类型即角色）。
    const judgeFnNames = new Set(
      [...policy.ruleGate.pre, ...policy.ruleGate.post].flatMap(r => r.judgeFunctions),
    );
    const execute = async (toolCallId: string, params: any) => {
      // ── 闸0 入口短路（所有工具）：run 内任一调用已命中 disable（violation 置位）→ 一律 terminate ──
      // 中断信号的广播器：兄弟子 Agent 共享同一 gate，一个出事全场后续工具调用零执行；
      // 并行批场景下同批后续调用也全带 terminate，shouldTerminateToolBatch 的 every() 整批命中硬停。
      if (security.gate.violation) {
        return securityTerminateResult(security.gate.violation);
      }
      const p = params as any; // 参数原样透传（ontology_id 由调用方填写，底座校验）

      // ── 闸1 disable（策略级拒绝）──
      // 行为工具按行为名查禁用集合——行为名才是 securities 登记键。
      // 命中：置 run 级 violation（first-writer-wins）+ 返回 terminate:true，真实 MCP 调用零发生。
      // 不抛错、不计报错预算：策略拒绝无自纠空间（重试必败），terminate 当场停内层循环（与预算超限同机制），
      // SubtaskRunner 见 violation 返回 securityViolation 失败 → orchestrator 以 securityBlocked 中断整个 run。
      if (isBehavior) {
        const bare = behaviorName;
        if (security.disabled.has(bare)) {
          security.gate.violation ??= buildDisableMessage(bare, security.disabled.get(bare));
          return securityTerminateResult(security.gate.violation);
        }
        // ── 闸2.5 前置判断函数判断核查（仅主行为，2026-09-30 口径 B）──
        // 判断函数（本体且 type=VALIDATION 的关联函数）已执行且 data.pass=false →
        // 判断拒绝：结论已定，重试无意义（抛错由报错预算熔断）。
        if (bare === policy.ruleGate.mainBehavior && policy.ruleGate.pre.length > 0) {
          for (const info of policy.ruleGate.pre) {
            for (const fn of info.judgeFunctions) {
              const v = policy.ruleGate.verdicts.get(fn);
              if (v && !v.pass) {
                throw new Error(
                  `前置规则 ${info.name} 判断不通过（函数 ${fn}）：${v.reason || '未提供原因'}。` +
                  `规则判断已拒绝本次执行，请勿重试主行为；如需继续请先处理规则不通过的原因。`
                );
              }
            }
          }
          // ── 闸2 前置规则留痕（仅主行为；补充接口不闸——闸了则规则取数无路）──
          // 关联函数须先成功执行（留痕）；其中判断函数还须有判断结论（缺 pass → fail-closed），
          // 否则抛错列出缺哪个规则的哪个函数，子 Agent 据此前置补跑后重试
          // （可恢复，不中止子任务；连续硬闯由报错预算熔断）。
          const missing = missingRuleFunctions(policy.ruleGate.pre, policy.ruleGate.succeeded, policy.ruleGate.verdicts);
          if (missing.length > 0) {
            throw new Error(
              `前置规则留痕缺失，本行为暂不能执行。请先成功调用以下规则关联函数完成前置验证，再重试本行为：\n` +
              missing.map(m => `- 规则 ${m.rule}：函数 ${m.functions.join('、')}`).join('\n')
            );
          }
        }
      }
      // 成功台账：execute 正常 resolve 即记（抛错不记）。函数名=工具名，后置闸/前置闸按名查此集合；
      // 行为名也一并记录（可能带前缀，台账查询只按函数名，行为条目自然不被命中，无副作用）。
      const result = await originalExecute(toolCallId, p);
      policy.ruleGate.succeeded.add(tool.name);
      // 判断台账：规则关联函数成功执行后解析信封 data.pass/reason；
      // 解析失败（非信封/缺 pass）不记 → 前置闸按「未执行」fail-closed，不静默放行。
      if (judgeFnNames.has(tool.name)) {
        const verdict = parseRuleVerdict(result);
        if (verdict) policy.ruleGate.verdicts.set(tool.name, verdict);
      }
      return result;
    };
    return {
      ...tool,
      // 恒包上报错计数——预算由策略对象保证存在，不再有"无预算"形态
      execute: wrapExecuteWithErrorBudget(execute, errorBudget),
    };
  }

  /**
   * 可挂载工具目录（单一事实源）：本体行为 / 本体函数 / 公共函数 / 其他 MCP 工具
   *（本体查询类在此不出现——父 Agent 专用，不进子任务可规划清单）。
   * 供父 Agent 的 listPlannableFunctions 工具（规划发现，本体行为条目会被剔除——行为规划走 listOntoBehaviors）
   * 与规划校验（函数名/参数结构与行为编译 schema 数据源）共用。
   * 每个条目：
   *   - category：发布方 x-category 标记（五类之一），无标记 = 其他MCP工具（外部）
   *   - title：中文显示名（发布方 x-title），无则上层兜底
   *   - params：完整参数结构（inputSchema 剔除 scope/ontology_id 后经 schemaToDeclaredParams 转声明形状
   *     {key: {type, required, description(含示例), example?}}），与子任务 params 填法同形
   *   - schema：编译 inputSchema 原文（剥 scope/ontology_id），规划期参数校验（TypeBox）的数据源
   *   - scope（本体执行类独有）：所属场景/本体真实值 {name 裸名 + ontology_id/scenario_id/scenario_name/ontology_name}，
   *     来自发布端 scope 上下文块（非输入参数）
   * 只读：仅返回工具元数据，不调用任何工具、无副作用。
   */
  async getMountableToolCatalog(): Promise<MountableToolInfo[]> {
    const all = await this.discoverTools();
    // 剔除元数据查询工具（父 Agent 专用）；其余（本体行为 / 本体函数 / 公共函数 / 其他 MCP 工具）均是可挂载项。
    // 函数三类是 related_functions / 函数子任务 function 的取值域；本体行为是子 Agent 行为挂载与规划期参数校验的数据源。
    return all
      .filter(t => !isQueryTool(t.parameters))
      .map(t => toMountableToolInfo(t));
  }

  /**
   * 从 MCP 配置中连接启用的服务，自动发现并注册工具。
   */
  private async discoverTools(): Promise<DiscoveredTool[]> {
    // 一次 run 内工具列表不变：缓存发现结果，避免父/子 Agent 每次创建都重复 listTools。
    // 缓存生命周期与连接缓存一致，由 closeAll() 在 run 结束时清空。
    if (this.toolsCache) return this.toolsCache;
    // MCP 配置全局唯一（./config/mcp-config.json），不区分场景/本体
    const mcpConfig = this.mcpConfigStore.getConfig();
    const tools: DiscoveredTool[] = [];

    for (const server of mcpConfig.servers) {
      if (!server.enabled) continue;

      let client: MCPClient | null = null;
      try {
        // 复用缓存连接（connect 幂等），避免每个 Agent 新建连接；headers（远程鉴权）随配置下发
        client = this.getOrCreateClient(server.url, server.headers);
        await client.connect();

        const result = await client.listTools();
        const mcpTools = result.tools || [];
        let hiddenCount = 0;
        // 业务数据闸（C1 收口，2026-10-05）：本服务是否声明为业务数据——决定其原始未映射工具能否进目录
        const businessDataGate = isBusinessDataServer(server);
        let businessBlockedCount = 0;

        for (const t of mcpTools) {
          const toolName = t.name as string;
          if (server.allowed_tools && server.allowed_tools.length > 0 && !server.allowed_tools.includes(toolName)) {
            continue;
          }
          // 可见性收编（配映射即收编，架构文档 §六）：已映射接口的原始工具对 Agent 隐藏，
          // 行为工具是唯一入口——绕过它会跳过映射翻译/RuleGate/安全管控。**内置固定项**（本体查询 MCP、
          // 公共函数 MCP，server.builtin）永不收编。
          //
          // 2026-10-19 方案 B：数据引擎执行服务已零工具化（不再挂 /mcp），行为工具的唯一发布方是
          // 自建发布容器——其 URL 从不作为映射 target，故天然不会被收编，无需再按 URL 豁免。
          if (!server.builtin && this.visibilityGuard?.isHidden(server.url, toolName)) {
            hiddenCount++;
            continue;
          }
          // 优先用 MCP 提供的原生 JSON Schema 做参数校验与类型强转，
          // 无 schema 时退回宽松校验（validateToolArguments 原生支持 JSON Schema）
          const inputSchema = (t as any).inputSchema;
          // 业务数据闸（C1 收口，2026-10-05）：声明为业务数据的服务，其【原始未映射工具】
          // （无 x-category 标记者 = 消费端兜底归类的「其他MCP工具」）一律不进 Agent 目录——
          // 业务接口必须经 data_engines 映射发布为「本体行为」才是唯一合法入口（架构文档 §六）。
          //
          // 为什么必须挡：原始业务接口是写操作（business-mcp 支持 POST/PUT/DELETE）。一旦被父 Agent
          // 规划成「函数子任务」，就走 callFunctionTool 直连路径（agent-factory.ts:233），而该路径
          // 【不经过】createChildAgent 的 guardExecution 包装（:263）——安全确认、disable 权限闸、
          // 前置/后置规则闸、报错预算四道闸一道都没有，等于业务写入零人工闸门直接落库。
          //
          // 为什么只挡无标记者：带 x-category 的平台自身工具照常进目录，否则会误伤——
          //   · data-engine-executor 发布的是【本体行为】工具（行为子任务的唯一执行入口）
          //   · 自建发布按 kind 发布本体函数 / 本体行为
          // 这两类即便被标 business_data=true 也必须放行。
          if (businessDataGate && !publishedCategory(inputSchema)) {
            businessBlockedCount++;
            continue;
          }
          // 消费边界协议校验：分类标记与本体上下文必须自洽（版本错配即快速失败，不静默降级）
          assertToolProtocol(toolName, inputSchema);
          // 本体上下文是**工具元数据而非参数**：发现期提升为独立字段，交给 LLM 的 schema 去掉它
          const hasSchema = inputSchema && typeof inputSchema === 'object' && Object.keys(inputSchema).length > 0;
          tools.push({
            name: toolName,
            label: toolName,
            description: (t.description as string) || `[${server.name}] ${toolName}`,
            parameters: hasSchema
              ? stripOntologyScope(inputSchema)
              : Type.Object({}, { additionalProperties: true }),
            ontologyScope: readOntologyScope(inputSchema),
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

        // 两类拦截都进日志：治理动作对用户不可见（工具"凭空消失"会表现为 LLM 说没这工具），
        // 运维必须能从启动日志一眼看出是收编隐藏还是业务数据闸拦的
        const notes = [
          hiddenCount > 0 ? `收编隐藏 ${hiddenCount} 个已映射原始工具` : '',
          businessBlockedCount > 0 ? `业务数据闸拦截 ${businessBlockedCount} 个原始未映射工具（该服务已标记 business_data=true，业务接口须经映射发布为本体行为）` : '',
        ].filter(Boolean);
        console.log(`[MCP] ${server.name}: 发现 ${mcpTools.length} 个工具${notes.length > 0 ? `，${notes.join('；')}` : ''}`);
      } catch (e: any) {
        // 保留 stack：MCP 连接失败是运维高频问题，只留 message 会让「为什么连不上」无从查证
        // （宪法 IX 故障可观测：原始错误必须落日志）
        console.error(`[MCP] ${server.name} 连接失败（${server.url}）:`, e);
      }
    }

    this.toolsCache = tools;
    return tools;
  }
}
