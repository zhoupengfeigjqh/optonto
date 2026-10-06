/**
 * AgentFactory 测试共享装配（2026-10-06 提取，宪法 II 单文件 ≤500 行）。
 *
 * ## 为什么要提取
 *
 * `agent-factory.test.ts` 曾达719 行，其中**180 行是 mock 装配**（5 处 vi.mock +
 * 共享 helper）。若按「一个关注点一个文件」简单切割，每个新文件都得复制这 180 行——
 * 复制 3 份就是 540 行重复 mock，而 mock 一旦漏改就会**静默失效**（测试照跑、
 * 断言却作用在错误的替身上）。故提取本文件，让拆分后的测试文件共享同一套装配。
 *
 * ## 为什么 vi.mock 放在这里仍然生效
 *
 * `vi.mock` 的路径相对**声明它的文件**解析。本文件与被测模块同目录（`src/agent/`），
 * 测试文件在顶部 `import ... from './agent-factory.test-harness.js'` ——
 * harness 先被求值，其中的 mock 即生效，两个测试文件共享同一份注册。
 *
 * ## 拆分后的分工
 *
 * · `agent-factory.test.ts` → 父 Agent 侧（历史映射 / submit_plan）
 * · `agent-factory.child-tools.test.ts` → 子 Agent 侧（工具边界 / 三道安全闸 / 分类纯函数）
 */
import { vi, expect } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';

// 整体替换 pi-agent-core：捕获 new Agent(config) 的 config（含 transformContext）
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));

/** MCP callTool 调用记录（验证 scopeToOntology 的 ontology_id 强制注入与剥 scope）；
 *  responses 可按工具名注入自定义返回（闸2.5 判断用例：信封 data.pass=false） */
export const mcpCalls = vi.hoisted(() => ({
  list: [] as { name: string; args: any }[],
  responses: {} as Record<string, (name: string, args: any) => any>,
}));

// MCP 配置：一个启用的内置本体 MCP server（供 discoverTools 发现工具）
vi.mock('../services/mcp-config-store.js', () => ({
  MCPConfigStore: class { getConfig() { return { servers: [{ name: '本体MCP', url: 'http://mcp-test/sse', enabled: true, builtin: true }] }; } },
  isDataEngineMcpUrl: () => false,
  // 业务数据闸判定（真实实现的同口径：严格 === true，缺省=否）。本装配的服务均未声明该字段 → 闸不生效
  isBusinessDataServer: (s: any) => s?.business_data === true,
}));

/**
 * 发布形态 schema 构造（与 mcp-shared/tool_contract.py 契约一致）：
 * 分类标记 = 顶层 x-category / x-display_name；scope 上下文块只含本体上下文（无标记）。
 */
export function ontoTool(category: string, bareName: string, displayName: string, ontologyId: number,
                ontologyName: string, props: Record<string, any>, required: string[]) {
  return { type: 'object',
    'x-category': category,
    'x-display_name': displayName,
    properties: {
      scope: { type: 'object', properties: {
        name: { type: 'string', const: bareName },
        ontology_id: { type: 'integer', const: ontologyId },
        scenario_id: { type: 'integer', const: 1 },
        scenario_name: { type: 'string', const: '生产调度' },
        ontology_name: { type: 'string', const: ontologyName },
      } },
      ontology_id: { type: 'integer' },
      ...props,
    },
    required };
}

/** 元数据查询工具（父 Agent 专用；x-category=本体查询） */
export function queryTool(displayName: string, props: Record<string, any> = {}) {
  return { type: 'object',
    'x-category': '本体查询',
    'x-display_name': displayName,
    properties: { ontology_id: { type: 'integer' }, ...props },
    required: ['ontology_id'] };
}
// MCPClient 假实现：listTools 返回混合工具集（本体行为工具 + 本体函数 + 本体查询 + 公共函数 + 外部工具）。
// 不连真实网络——discoverTools 会 new MCPClient(url) 并 connect/listTools。
vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: [
        // 本体行为工具（工具名即行为名；编译 inputSchema 含约束）
        { name: 'CreatePurchaseRecord', description: '创建采购记录',
          inputSchema: ontoTool('本体行为', 'CreatePurchaseRecord', '创建采购记录', 1, '原材料采购和库存',
            { rawMaterialId: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 1, maximum: 100 } },
            ['ontology_id', 'rawMaterialId']) },
        { name: 'QuerySupplier', description: '查询供应商',
          inputSchema: ontoTool('本体行为', 'QuerySupplier', '查询供应商', 1, '原材料采购和库存',
            { supplierName: { type: 'string' } }, ['ontology_id']) },
        // 另一本体的行为（不在合法集合 → 不挂载）
        { name: 'DeleteInventory', description: '删除库存',
          inputSchema: ontoTool('本体行为', 'DeleteInventory', '删除库存', 2, '订单排程', {}, ['ontology_id']) },
        // 本体函数
        { name: 'calcSafetyStock', description: '计算安全库存',
          inputSchema: ontoTool('本体函数', 'calcSafetyStock', '计算安全库存', 1, '原材料采购和库存',
            { currentStock: { type: 'number' }, safetyStock: { type: 'number' } }, ['ontology_id']) },
        { name: 'sumRawNotArrivalQty', description: '未到位数求和',
          inputSchema: ontoTool('本体函数', 'sumRawNotArrivalQty', '未到位数求和', 2, '订单排程',
            { purchaseRecordSet: { type: 'array' } }, ['ontology_id']) },
        // 本体查询工具（父 Agent 专属）
        { name: 'listOntoBehaviors', description: '列出本体行为', inputSchema: queryTool('查询行为清单') },
        { name: 'listOntoFunctions', description: '列出本体函数（元数据查询）',
          inputSchema: queryTool('查询函数清单', { keyword: { type: 'string' } }) },
        { name: 'listOntoProcesses', description: '列出本体业务流程', inputSchema: queryTool('查询流程清单') },
        // 公共函数（x-category 扩展键标记）
        { name: 'getCurrentDate', description: '当前日期', inputSchema: { type: 'object', properties: {}, 'x-category': '公共函数', 'x-display_name': '当前日期' } },
        // 外部 MCP 工具（无标记，排除法归类）
        { name: 'weatherQuery', description: '外部天气查询', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } },
      ] };
    }
    async callTool(name: string, args: any) {
      mcpCalls.list.push({ name, args });
      const override = mcpCalls.responses[name];
      if (override) return override(name, args);
      return { content: [{ type: 'text', text: '{"ok":true}' }], isError: false };
    }
  },
}));

// SkillLoader 只用到 getSkillDescriptions（tools 的 execute 不在此路径触发）
vi.mock('../services/skill-loader.js', () => ({
  SkillLoader: class {
    getSkillDescriptions() { return []; }
  },
}));

// 模型解析：返回假模型，避免真实解析
vi.mock('../services/llm.js', () => ({
  resolveDeepSeekModel: () => ({ id: 'deepseek-v4-flash', provider: 'deepseek' }),
}));

import { AgentFactory } from './agent-factory.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { createSecurityGate } from './security-policy.js';
import type { ChildSecurityCtx } from './security-policy.js';
import { createToolErrorBudget } from './error-budget.js';
import type { SubtaskPolicy, RuleGate, LegalCalls } from './execution-policy.js';
import type { ThreadMessage, ConversationScope } from '../types.js';

export const mockedAgent = vi.mocked(Agent);

/**
 * 捕获到的 Agent 构造配置（**测试边界的一次性类型收敛**，2026-10-05）。
 *
 * pi-agent-core 的 `Agent` 构造参数里 `initialState` / `transformContext` 等在 SDK 类型上
 * 大量是可选的，而 AgentFactory 必定传全；直接 `mockedAgent.mock.calls[0][0].initialState.x`
 * 会在每个调用处重复触发 "possibly undefined"。这里统一收敛为 `any`，
 * 调用处不再散落非空断言——**一处收敛，噪声归零**。
 */
export function capturedConfig(): any {
  return mockedAgent.mock.calls[0][0];
}
/** 捕获的 Agent 初始状态（tools / systemPrompt 等） */
export function capturedState(): any {
  return capturedConfig().initialState;
}
/** 捕获的工具清单（测试按工具名检索，统一 any[] 免去逐处断言） */
export function capturedTools(): any[] {
  return capturedState().tools as any[];
}
/** transformContext 的产物：测试按「有 role/content 字段」的消息形态访问 */
export type CapturedMsg = { role: string; content: any };

/** 测试对话作用域：本体 1（允许集 = {1}） */
export const SCOPE: ConversationScope = {
  contexts: [{ scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 }],
  skills: [],
};
/** 通用问答模式（零本体） */
export const GENERAL: ConversationScope = { contexts: [], skills: [] };

export function mkHistory(): ThreadMessage[] {
  const t = (n: number) => new Date(Date.now() - (5 - n) * 60_000).toISOString();
  return [
    { role: 'summary', content: '用户确认采购高强度钢板 0.1 吨，供应商宝钢，尚未下单。', timestamp: t(1) },
    { role: 'user', content: '请帮我查一下库存', timestamp: t(2) },
    { role: 'assistant', content: '好的，我来查询。', timestamp: t(3) },
    { role: 'toolResult', content: '{inventory: 5}', timestamp: t(4) },
  ];
}
export async function captureTransformContext(): Promise<{ config: any; transformed: CapturedMsg[] }> {
  const factory = mkFactory();
  await factory.createParentAgent(SCOPE, mkHistory(), () => {});
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  const config = capturedConfig();
  const transformed = (await config.transformContext([])) as CapturedMsg[];
  return { config, transformed };
}

/**
 * 完整策略对象直造（生产路径由 buildSubtaskPolicy 派生；工厂只消费不派生）：
 * legalCalls 默认含主行为 + 一个规则关联行为 + 关联函数。
 */
export function mkPolicy(over?: { legalCalls?: LegalCalls; security?: ChildSecurityCtx; ruleGate?: RuleGate }): SubtaskPolicy {
  return {
    legalCalls: over?.legalCalls ?? { behaviors: ['CreatePurchaseRecord', 'QuerySupplier'], functions: ['calcSafetyStock', 'getCurrentDate'] },
    errorBudget: createToolErrorBudget(),
    security: over?.security ?? { disabled: new Map<string, string>(), gate: createSecurityGate() },
    ruleGate: over?.ruleGate ?? { mainBehavior: 'CreatePurchaseRecord', pre: [], post: [], succeeded: new Set(), verdicts: new Map() },
  };
}

/** 造一个工厂实例（依赖均为上述 mock 替身，不触真实磁盘/网络/LLM） */
export function mkFactory(): AgentFactory {
  return new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
}

/**
 * 捕获子 Agent 配置中的工具列表（createChildAgent → discoverTools → scopeToOntology）。
 * 走公开路径而非直接调私有 scopeToOntology，保证测试覆盖的是真实装配链路。
 */
export async function captureChildTools(legalCalls?: LegalCalls, security?: ChildSecurityCtx, ruleGate?: RuleGate) {
  await mkFactory().createChildAgent(
    { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 },
    mkPolicy({ legalCalls, security, ruleGate }),
  );
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return capturedTools();
}

/** 捕获父 Agent 工具列表（createParentAgent → discoverTools → 分类过滤，走公开路径） */
export async function captureParentTools() {
  await mkFactory().createParentAgent(SCOPE, [], () => {});
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return capturedTools();
}