/**
 * 父 Agent 的三个内部工具构造器——自 `agent-factory.ts` 抽取。
 *
 * 抽取动因（2026-10-05，宪法 II 单文件 ≤500 行）：这三个工具与 Agent 生命周期
 * （连接管理、Agent 创建、工具发现）无关，是**独立的工具定义**，却挤在工厂类里。
 * 抽成纯函数后可不构造 AgentFactory 直接测工具 schema 与 execute 行为。
 *
 * ## 为什么是「内部工具」而非 MCP 工具
 *
 * 三者都只在父 Agent 内本地实现，不注册进任何 MCP server：
 *  - `load_skill`：依赖本次对话选中的技能列表（会话态，无外部契约）
 *  - `submit_plan`：规划只来自本工具的 schema 校验结果，不走 MCP
 *  - `listPlannableFunctions`：其他 MCP 工具只存在于 agent-backend 的 discoverTools()
 *    清单中，core-backend 无法感知，故只能在本地组装
 *
 * ## 依赖注入
 *
 * 原实现是类方法，直接摸 `this.skillLoader` / `this.getMountableToolCatalog()`。
 * 抽成纯函数后必须显式注入——这不是为了测试便利，而是让「这个工具到底依赖什么」
 * 在签名上一目了然（宪法 II：接口即契约）。
 */
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { subtaskFieldsSchema } from './subtask-contract.js';
import { toFiniteNum } from './param-contract.js';
import { CATEGORY, type MountableToolInfo } from './tool-catalog.js';
import type { SkillSelection, SubTaskPlan } from '../types.js';

/** 技能全文加载（对齐 SkillLoader.loadSkill 签名） */
export type LoadSkillFn = (scenario: string, ontology: string, skillName: string) => string;

/** 可挂载工具目录读取（对齐 AgentFactory.getMountableToolCatalog） */
export type GetCatalogFn = () => Promise<MountableToolInfo[]>;

/**
 * 创建 load_skill 工具。
 * Agent 在需要某个技能的完整知识时调用。
 * 从本对话选中的技能列表解析该技能的 (scenario, ontology) 再加载全文，支持跨本体。
 * 加载后通过 onSkillLoaded 回调通知 orchestrator 记录。
 */
export function createLoadSkillTool(
  loadSkill: LoadSkillFn,
  skills: SkillSelection[],
  onSkillLoaded?: (skillName: string) => void,
): AgentTool {
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
      const content = loadSkill(sel.scenario, sel.ontology, skillName);
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
export function createSubmitPlanTool(onPlanSubmitted?: (plan: SubTaskPlan) => void): AgentTool {
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
 * 创建 listPlannableFunctions 工具（父 Agent 内部工具，本地实现，只读）。
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
export function createListPlannableFunctionsTool(
  getCatalog: GetCatalogFn,
  allowedOntologyIds: ReadonlySet<number>,
): AgentTool {
  return {
    name: 'listPlannableFunctions',
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
      let catalog = (await getCatalog())
        // 本体行为不进本清单：行为子任务规划走 listOntoBehaviors（**就绪**行为花名册+规则关联），这里只列函数/工具
        .filter(t => t.category !== CATEGORY.BEHAVIOR)
        // 本体范围硬过滤：本体函数恒限定在允许集内；全局工具（公共函数/其他MCP工具）无本体归属，始终保留
        .filter(t => t.category !== CATEGORY.FUNCTION || allowedOntologyIds.has(Number(t.scope?.ontology_id)));
      if (oid !== undefined) {
        catalog = catalog.filter(t => t.category !== CATEGORY.FUNCTION || Number(t.scope?.ontology_id) === oid);
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