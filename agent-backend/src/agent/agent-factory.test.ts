/**
 * AgentFactory 单元测试。
 * - createParentAgent 历史映射（summary → assistant +【历史摘要】前缀）
 * - submit_plan 互斥门与键省略容忍
 * - 父/子 Agent 工具职责边界（2026-09 facade 化后：本体行为是一等 MCP 工具，
 *   子 Agent 按 legalCalls.behaviors 的 scope.name 裸名挂载，挂载期过滤即白名单；
 *   参数合法性由工具 inputSchema 在 harness 层校验，运行期参数闸已退役）
 * - 子 Agent 安全闸：闸0 run 级 violation 短路（所有工具）+ 闸1 disable（行为工具，按裸名）
 * - toMountableToolInfo 发布方标记分类（纯函数直测）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';
import { toMountableToolInfo } from './tool-catalog.js';

// 整体替换 pi-agent-core：捕获 new Agent(config) 的 config（含 transformContext）
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));

/** MCP callTool 调用记录（验证 scopeToOntology 的 ontology_id 强制注入与剥 scope） */
const mcpCalls = vi.hoisted(() => ({ list: [] as { name: string; args: any }[] }));

// MCP 配置：一个启用的内置本体MCP server（供 discoverTools 发现工具）
vi.mock('../services/mcp-config-store.js', () => ({
  MCPConfigStore: class { getConfig() { return { servers: [{ name: '本体MCP', url: 'http://mcp-test/sse', enabled: true, builtin: true }] }; } },
}));

/** scope 块构造（MCP server 发布形态：category/name/display_name/场景本体四元组全 const） */
function scopeBlock(category: string, bareName: string, displayName: string, ontologyId: number, ontologyName: string) {
  return { type: 'object', properties: {
    category: { type: 'string', const: category },
    name: { type: 'string', const: bareName },
    display_name: { type: 'string', const: displayName },
    ontology_id: { type: 'integer', const: ontologyId },
    scenario_id: { type: 'integer', const: 1 },
    scenario_name: { type: 'string', const: '生产调度' },
    ontology_name: { type: 'string', const: ontologyName },
  } };
}

// MCPClient 假实现：listTools 返回混合工具集（本体行为 facade + 本体函数 + 本体浏览 list* + 公共函数 + 外部工具）。
// 不连真实网络——discoverTools 会 new MCPClient(url) 并 connect/listTools。
vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: [
        // 本体行为工具（facade，工具名即行为名；编译 inputSchema 含约束）
        { name: 'CreatePurchaseRecord', description: '创建采购记录', inputSchema: { type: 'object', properties: {
          scope: scopeBlock('本体行为', 'CreatePurchaseRecord', '创建采购记录', 1, '原材料采购和库存'),
          ontology_id: { type: 'integer' },
          rawMaterialId: { type: 'string', minLength: 1 },
          qty: { type: 'integer', minimum: 1, maximum: 100 },
        }, required: ['ontology_id', 'rawMaterialId'] } },
        { name: 'QuerySupplier', description: '查询供应商', inputSchema: { type: 'object', properties: {
          scope: scopeBlock('本体行为', 'QuerySupplier', '查询供应商', 1, '原材料采购和库存'),
          ontology_id: { type: 'integer' },
          supplierName: { type: 'string' },
        }, required: ['ontology_id'] } },
        // 跨本体重名行为 → 带 onto{id}__ 前缀（scope.name 裸名才是匹配键）
        { name: 'onto2__QuerySupplier', description: '查询供应商（订单排程）', inputSchema: { type: 'object', properties: {
          scope: scopeBlock('本体行为', 'QuerySupplier', '查询供应商', 2, '订单排程'),
          ontology_id: { type: 'integer' },
        }, required: ['ontology_id'] } },
        // 另一本体的行为（不在合法集合 → 不挂载）
        { name: 'DeleteInventory', description: '删除库存', inputSchema: { type: 'object', properties: {
          scope: scopeBlock('本体行为', 'DeleteInventory', '删除库存', 2, '订单排程'),
          ontology_id: { type: 'integer' },
        }, required: ['ontology_id'] } },
        // 本体函数
        { name: 'calcSafetyStock', description: '计算安全库存', inputSchema: { type: 'object', properties: {
          scope: scopeBlock('本体函数', 'calcSafetyStock', '计算安全库存', 1, '原材料采购和库存'),
          ontology_id: { type: 'integer' }, currentStock: { type: 'number' }, safetyStock: { type: 'number' },
        }, required: ['ontology_id'] } },
        { name: 'sumRawNotArrivalQty', description: '未到位数求和', inputSchema: { type: 'object', properties: {
          scope: scopeBlock('本体函数', 'sumRawNotArrivalQty', '未到位数求和', 2, '订单排程'),
          ontology_id: { type: 'integer' }, purchaseRecordSet: { type: 'array' },
        }, required: ['ontology_id'] } },
        // 本体浏览工具（父 Agent 专属）
        { name: 'listOntoBehaviors', description: '列出本体行为', inputSchema: { type: 'object', properties: { ontology_id: { type: 'integer' } } } },
        { name: 'listOntoFunctions', description: '列出本体函数（元数据查询）', inputSchema: { type: 'object', properties: { ontology_id: { type: 'integer' }, keyword: { type: 'string' } }, required: ['ontology_id'] } },
        { name: 'listOntoProcesses', description: '列出本体业务流程', inputSchema: { type: 'object', properties: { ontology_id: { type: 'integer' } }, required: ['ontology_id'] } },
        // 公共函数（x-category 扩展键标记）
        { name: 'getCurrentDate', description: '当前日期', inputSchema: { type: 'object', properties: {}, 'x-category': '公共函数', 'x-display_name': '当前日期' } },
        // 外部 MCP 工具（无标记，排除法归类）
        { name: 'weatherQuery', description: '外部天气查询', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } },
      ] };
    }
    async callTool(name: string, args: any) {
      mcpCalls.list.push({ name, args });
      return { content: [{ type: 'text', text: '{"ok":true}' }], isError: false };
    }
  },
}));
// SkillLoader 只用到 getSkillDescriptions / getSelectedContexts（tools 的 execute 不在此路径触发）
vi.mock('../services/skill-loader.js', () => ({
  SkillLoader: class {
    getSkillDescriptions() { return []; }
    getSelectedContexts() {
      return [{ scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 }];
    }
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
import type { SubtaskPolicy } from './execution-policy.js';
import type { LegalCalls } from './execution-policy.js';
import type { ThreadMessage } from '../types.js';

const mockedAgent = vi.mocked(Agent);

function mkHistory(): ThreadMessage[] {
  const t = (n: number) => new Date(Date.now() - (5 - n) * 60_000).toISOString();
  return [
    { role: 'summary', content: '用户确认采购高强度钢板 0.1 吨，供应商宝钢，尚未下单。', timestamp: t(1) },
    { role: 'user', content: '请帮我查一下库存', timestamp: t(2) },
    { role: 'assistant', content: '好的，我来查询。', timestamp: t(3) },
    { role: 'toolResult', content: '{inventory: 5}', timestamp: t(4) },
  ];
}

async function captureTransformContext() {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createParentAgent([], mkHistory(), () => {});
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  const config = mockedAgent.mock.calls[0][0];
  const transformed = await config.transformContext([]);
  return { config, transformed };
}

describe('AgentFactory.createParentAgent 历史映射', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('summary 消息映射为 assistant 且加【历史摘要】前缀', async () => {
    const { transformed } = await captureTransformContext();
    const summaryMsg = transformed[0];
    expect(summaryMsg.role).toBe('assistant');
    expect(summaryMsg.content).toEqual([{ type: 'text', text: '【历史摘要】用户确认采购高强度钢板 0.1 吨，供应商宝钢，尚未下单。' }]);
  });

  it('user 消息保持 user 角色、内容原样', async () => {
    const { transformed } = await captureTransformContext();
    expect(transformed[1].role).toBe('user');
    expect(transformed[1].content).toBe('请帮我查一下库存');
  });

  it('assistant / toolResult 映射为 assistant、内容原样、不加前缀', async () => {
    const { transformed } = await captureTransformContext();
    expect(transformed[2].role).toBe('assistant');
    expect(transformed[2].content).toEqual([{ type: 'text', text: '好的，我来查询。' }]);
    expect(transformed[3].role).toBe('assistant');
    expect(transformed[3].content).toEqual([{ type: 'text', text: '{inventory: 5}' }]);
  });

  it('历史消息按原顺序置于实时消息之前', async () => {
    const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
    await factory.createParentAgent([], mkHistory(), () => {});
    const config = mockedAgent.mock.calls[0][0];
    const transformed = await config.transformContext([{ role: 'user', content: '当前问题' }]);
    expect(transformed.length).toBe(5); // 4 条历史 + 1 条实时
    expect(transformed[4].content).toBe('当前问题');
    expect(transformed[0].role).toBe('assistant'); // 首条仍是历史（summary）
  });
});

/**
 * 捕获子 Agent 配置中的工具列表（createChildAgent → discoverTools → scopeToOntology）。
 * 走公开路径而非直接调私有 scopeToOntology，保证测试覆盖的是真实装配链路。
 * policy 完整策略对象直造（生产路径由 buildSubtaskPolicy 派生；工厂只消费不派生）：
 * legalCalls 默认含主行为 + 一个规则关联行为 + 关联函数。
 */
function mkPolicy(over?: { legalCalls?: LegalCalls; security?: ChildSecurityCtx }): SubtaskPolicy {
  return {
    legalCalls: over?.legalCalls ?? { behaviors: ['CreatePurchaseRecord', 'QuerySupplier'], functions: ['calcSafetyStock', 'getCurrentDate'] },
    errorBudget: createToolErrorBudget(),
    security: over?.security ?? { disabled: new Map<string, string>(), gate: createSecurityGate() },
  };
}

async function captureChildTools(legalCalls?: LegalCalls, security?: ChildSecurityCtx) {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createChildAgent(
    { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 },
    mkPolicy({ legalCalls, security }),
  );
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return mockedAgent.mock.calls[0][0].initialState.tools as any[];
}

/**
 * 捕获父 Agent 工具列表（createParentAgent → discoverTools → PARENT_ONTOLOGY_QUERY_TOOLS 白名单过滤）。
 * 走公开路径，验证父 Agent 从机制上不挂执行工具（工具职责边界）。
 */
async function captureParentTools() {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createParentAgent([], [], () => {});
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return mockedAgent.mock.calls[0][0].initialState.tools as any[];
}

describe('AgentFactory submit_plan 互斥门与键省略容忍', () => {
  beforeEach(() => mockedAgent.mockClear());

  const baseSub = () => ({
    seq: 1, params: {}, description: 'd', guidance: 'g',
    scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1,
  });

  it('schema 层不再强制 behavior 键（LLM 对函数子任务本能省略该键，不应在 schema 层被拒）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    const required: string[] = (tool.parameters as any).properties.subtasks.items.required ?? [];
    expect(required).not.toContain('behavior');
    expect(required).not.toContain('function');
  });

  it('函数子任务省略 behavior 键 → 正常提交，behavior 规整为空串', async () => {
    let received: any = null;
    const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
    await factory.createParentAgent([], [], () => {}, (plan) => { received = plan; });
    const sp = (mockedAgent.mock.calls[0][0].initialState.tools as any[]).find(t => t.name === 'submit_plan');
    const sub = { ...baseSub(), function: 'sumRawNotArrivalQty' }; // 无 behavior 键
    const res = await sp.execute('c1', { subtasks: [sub] });
    expect(res.details.submitted).toBe(true);
    expect(received.subtasks[0].behavior).toBe('');
    expect(received.subtasks[0].function).toBe('sumRawNotArrivalQty');
  });

  it('behavior/function 都省略 → 互斥门抛错（语义校验在 execute，不依赖 schema）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    await expect(tool.execute('c2', { subtasks: [baseSub()] }))
      .rejects.toThrow('必须且只能填写 behavior 或 function 之一');
  });

  it('behavior 填纯空白串 + function 正常 → 空白规整为空串，按函数子任务放行（下游裸真值判别不再被骗）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    const plan: any = { subtasks: [{ ...baseSub(), behavior: '  ', function: 'sumRawNotArrivalQty' }] };
    const res = await tool.execute('c3', plan);
    expect(res.details.submitted).toBe(true);
    expect(plan.subtasks[0].behavior).toBe(''); // 规整已回写
  });

  it('函数子任务填了 related_functions → 硬门抛错（该字段仅用于行为子任务）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    await expect(tool.execute('c4', { subtasks: [{ ...baseSub(), function: 'sumRawNotArrivalQty', related_functions: ['getCurrentDate'] }] }))
      .rejects.toThrow('related_functions 必须为空');
  });

  it('行为子任务可填可不填 related_functions → 均放行；填了则规整回写（剔除空白项）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    // 不填 → 放行
    const res1 = await tool.execute('c5', { subtasks: [{ ...baseSub(), behavior: 'CreatePurchaseRecord' }] });
    expect(res1.details.submitted).toBe(true);
    // 填了（含空白项）→ 放行且规整
    const plan: any = { subtasks: [{ ...baseSub(), behavior: 'CreatePurchaseRecord', related_functions: ['getCurrentDate', ' '] }] };
    const res2 = await tool.execute('c6', plan);
    expect(res2.details.submitted).toBe(true);
    expect(plan.subtasks[0].related_functions).toEqual(['getCurrentDate']);
  });

  it('函数子任务 related_functions 缺省或空数组 → 放行（规整后为空视同未填）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    const res1 = await tool.execute('c7', { subtasks: [{ ...baseSub(), function: 'sumRawNotArrivalQty' }] });
    expect(res1.details.submitted).toBe(true);
    const res2 = await tool.execute('c8', { subtasks: [{ ...baseSub(), function: 'sumRawNotArrivalQty', related_functions: ['  '] }] });
    expect(res2.details.submitted).toBe(true);
  });
});

describe('AgentFactory 父 Agent 工具职责边界', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('父 Agent 挂 load_skill 与 submit_plan', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).toContain('load_skill');
    expect(names).toContain('submit_plan');
  });

  it('父 Agent system prompt 含本次对话本体信息列表（scenario/ontology 四元组）', async () => {
    const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
    await factory.createParentAgent([], mkHistory(), () => {});
    const prompt = mockedAgent.mock.calls[0][0].initialState.systemPrompt as string;
    expect(prompt).toContain('## 本次对话本体信息');
    expect(prompt).toContain('场景：生产调度（scenario_id=1）｜本体：原材料采购和库存（ontology_id=1）');
  });

  it('父 Agent 挂只读 listAllMcpFunctions：函数/工具三类清单（本体行为不在其列——行为规划走 listOntoBehaviors）', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listAllMcpFunctions');
    expect(tool).toBeTruthy();
    const result = await tool.execute('call-list', {});
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.map((t: any) => t.name);
    expect(names).toContain('weatherQuery'); // 其他 MCP 工具可见（可规划为函数子任务 / related_functions）
    expect(names).toContain('calcSafetyStock'); // 本体函数可见
    expect(names).toContain('getCurrentDate'); // 公共函数可见
    expect(names).not.toContain('CreatePurchaseRecord'); // 本体行为不进函数清单（规划走 listOntoBehaviors）
    expect(names).not.toContain('QuerySupplier');
    expect(names).not.toContain('listOntoBehaviors'); // 本体浏览不属可规划域
    expect(names).not.toContain('listOntoFunctions'); // MCP 版函数元数据查询工具不属可规划域（与本地清单工具共存不串扰）
    expect(names).not.toContain('executeOntoBehavior'); // 分发器已彻底退役
    // 分类正确
    const byName = Object.fromEntries(parsed.map((t: any) => [t.name, t]));
    expect(byName['calcSafetyStock'].category).toBe('本体函数');
    expect(byName['getCurrentDate'].category).toBe('公共函数');
    expect(byName['weatherQuery'].category).toBe('其他MCP工具');
    // 完整参数结构（type/required/description/example）
    expect(byName['getCurrentDate'].params).toEqual({});
    expect(byName['weatherQuery'].params).toEqual({ city: { type: 'string', required: false } });
    // 本体函数：params 剔除 scope/ontology_id，另附 scope 真实值（含 name 裸名；父 Agent 填子任务场景/本体字段用）
    expect(byName['calcSafetyStock'].params).toEqual({
      currentStock: { type: 'number', required: false },
      safetyStock: { type: 'number', required: false },
    });
    expect(byName['calcSafetyStock'].scope).toEqual({
      name: 'calcSafetyStock',
      ontology_id: 1, scenario_id: 1, scenario_name: '生产调度', ontology_name: '原材料采购和库存',
    });
    expect(byName['weatherQuery'].scope).toBeUndefined(); // 非本体函数无 scope
  });

  it('listAllMcpFunctions 按 ontology_id 过滤：只滤本体函数（按 scope 匹配），全局工具（公共/其他MCP）保留', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listAllMcpFunctions');
    const parsed = JSON.parse((await tool.execute('call-f1', { ontology_id: 1 })).content[0].text);
    const names = parsed.map((t: any) => t.name);
    expect(names).toContain('calcSafetyStock'); // scope.ontology_id=1 命中
    expect(names).not.toContain('sumRawNotArrivalQty'); // 本体函数但无匹配 scope → 被过滤
    expect(names).toContain('getCurrentDate'); // 公共函数是全局工具，保留
    expect(names).toContain('weatherQuery'); // 其他MCP工具是全局工具，保留
  });

  it('listAllMcpFunctions 按 keyword 过滤：模糊匹配名称/描述（大小写不敏感）', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listAllMcpFunctions');
    const byKw = JSON.parse((await tool.execute('call-f2', { keyword: 'WEATHER' })).content[0].text);
    expect(byKw.map((t: any) => t.name)).toEqual(['weatherQuery']);
    const byDesc = JSON.parse((await tool.execute('call-f3', { keyword: '安全库存' })).content[0].text);
    expect(byDesc.map((t: any) => t.name)).toEqual(['calcSafetyStock']);
  });

  it('listAllMcpFunctions 双过滤为与关系；ontology_id 接受字符串数字', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listAllMcpFunctions');
    // ontology_id='1'（字符串）AND keyword='库存' → 只剩 calcSafetyStock（全局工具不含关键词也被滤掉）
    const parsed = JSON.parse((await tool.execute('call-f4', { ontology_id: '1', keyword: '库存' })).content[0].text);
    expect(parsed.map((t: any) => t.name)).toEqual(['calcSafetyStock']);
  });

  it('父 Agent 只挂本体查询工具（list*），不挂函数/外部工具', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).toContain('listOntoBehaviors');
    expect(names).toContain('listOntoFunctions'); // MCP 版本体函数元数据查询工具（恢复挂载，判断3 用）
    expect(names).toContain('listOntoProcesses'); // 本体业务流程查询工具
    expect(names).toContain('listAllMcpFunctions'); // 本地内部工具：可规划函数/工具清单（只读）
    expect(names).not.toContain('getCurrentDate'); // 公共函数不挂父 Agent（由 listAllMcpFunctions 发现）
  });

  it('父 Agent 不挂任何执行工具（行为 facade / 本体函数 / 外部工具）', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).not.toContain('CreatePurchaseRecord'); // 行为工具不挂父 Agent（业务执行由子 Agent 独占）
    expect(names).not.toContain('executeOntoBehavior'); // 分发器已退役
    expect(names).not.toContain('calcSafetyStock'); // 本体函数不挂父 Agent
    expect(names).not.toContain('sumRawNotArrivalQty');
    expect(names).not.toContain('weatherQuery'); // 外部工具不挂父 Agent
  });
});

describe('AgentFactory 子 Agent 工具职责边界与挂载期过滤（机制即白名单）', () => {
  beforeEach(() => { mockedAgent.mockClear(); mcpCalls.list.length = 0; });

  it('子 Agent 挂合法行为工具 + 合法函数，不挂本体浏览工具/非法行为/分发器', async () => {
    const names = (await captureChildTools()).map(t => t.name);
    expect(names).toContain('CreatePurchaseRecord'); // legalCalls.behaviors 主行为
    expect(names).toContain('QuerySupplier');        // legalCalls.behaviors 规则关联行为
    expect(names).toContain('calcSafetyStock');      // legalCalls.functions 声明的本体函数
    expect(names).toContain('getCurrentDate');       // legalCalls.functions 声明的公共函数
    expect(names).not.toContain('DeleteInventory');  // 未声明的行为不挂（挂载期过滤）
    expect(names).not.toContain('listOntoBehaviors');
    expect(names).not.toContain('listOntoFunctions');
    expect(names).not.toContain('executeOntoBehavior'); // 分发器已退役
  });

  it('行为工具按 scope.name 裸名匹配：跨本体重名的前缀工具同裸名也会挂载（onto{id}__ 前缀不构成绕过）', async () => {
    const names = (await captureChildTools()).map(t => t.name);
    // legal.behaviors 含裸名 QuerySupplier → 本体重名冲突的前缀工具同样命中（scope.name 同源）
    expect(names).toContain('onto2__QuerySupplier');
    // 换成不含 QuerySupplier 的合法集合 → 两个 QuerySupplier 工具都不挂
    mockedAgent.mockClear();
    const names2 = (await captureChildTools({ behaviors: ['CreatePurchaseRecord'], functions: [] })).map(t => t.name);
    expect(names2).not.toContain('QuerySupplier');
    expect(names2).not.toContain('onto2__QuerySupplier');
  });

  it('本体函数/公共函数按挂载期过滤：只挂 legalCalls.functions 声明的', async () => {
    const tools = await captureChildTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('calcSafetyStock');
    expect(names).not.toContain('sumRawNotArrivalQty'); // 未声明的本体函数不挂
    mockedAgent.mockClear();
    const names2 = (await captureChildTools({ behaviors: ['CreatePurchaseRecord'], functions: ['calcSafetyStock'] })).map(t => t.name);
    expect(names2).not.toContain('getCurrentDate'); // 公共函数未声明 → 不挂（不再恒挂全部）
  });

  it('其他 MCP 工具默认不挂，父 Agent 经 related_functions 指定才挂', async () => {
    const defaultTools = await captureChildTools();
    expect(defaultTools.map(t => t.name)).not.toContain('weatherQuery');
    mockedAgent.mockClear();
    const withExternal = await captureChildTools({ behaviors: ['CreatePurchaseRecord'], functions: ['weatherQuery'] });
    expect(withExternal.map(t => t.name)).toContain('weatherQuery');
  });

  it('行为/函数工具：子 Agent 视角 schema 已剔除 ontology_id 与 scope 块；调用时强制注入本run本体 id', async () => {
    const tools = await captureChildTools();
    const behTool = tools.find(t => t.name === 'CreatePurchaseRecord');
    const behProps = (behTool.parameters as any)?.properties ?? {};
    expect('ontology_id' in behProps).toBe(false);
    expect('scope' in behProps).toBe(false);
    // 编译 schema 的参数与约束原样保留（harness 校验依据）
    expect(behProps.qty).toEqual({ type: 'integer', minimum: 1, maximum: 100 });
    await behTool.execute('call-1', { rawMaterialId: 'RM-1', qty: 10 });
    expect(mcpCalls.list[0].name).toBe('CreatePurchaseRecord');
    expect(mcpCalls.list[0].args).toEqual({ rawMaterialId: 'RM-1', qty: 10, ontology_id: 1 }); // 强制注入

    const fnTool = tools.find(t => t.name === 'calcSafetyStock');
    expect('ontology_id' in ((fnTool.parameters as any)?.properties ?? {})).toBe(false);
    await fnTool.execute('call-2', { currentStock: 10, safetyStock: 5 });
    expect(mcpCalls.list[1].args).toEqual({ currentStock: 10, safetyStock: 5, ontology_id: 1 });
  });

  it('前缀行为工具同样被锁定到当前本体（ontology_id 强制注入本run值，忽略工具自带 scope 所属本体）', async () => {
    const tools = await captureChildTools();
    const prefixed = tools.find(t => t.name === 'onto2__QuerySupplier');
    await prefixed.execute('call-3', {});
    // scopeToOntology 一律注入本run ontology_id=1（跨本体调用由编排层另行负责，子 Agent 视角恒锁本run本体）
    expect(mcpCalls.list[0].args.ontology_id).toBe(1);
  });
});

describe('AgentFactory 子 Agent disable 硬闸（工具层单点，terminate + run 级共享闸）', () => {
  beforeEach(() => { mockedAgent.mockClear(); mcpCalls.list.length = 0; });

  const mkSecurity = (disabled: [string, string][] = []): ChildSecurityCtx => ({
    disabled: new Map<string, string>(disabled),
    gate: createSecurityGate(),
  });

  it('闸1：调用禁用行为工具 → 真实工具零执行，返回 terminate + 置 run 级 violation（不抛错、不走报错预算）', async () => {
    const security = mkSecurity([['CreatePurchaseRecord', '创建采购记录']]);
    const tools = await captureChildTools(undefined, security);
    const tool = tools.find(t => t.name === 'CreatePurchaseRecord');
    const result = await tool.execute('call-d1', { rawMaterialId: 'RM-1', qty: 10 });
    expect(result.terminate).toBe(true);                       // pi-agent 内层循环当场停
    expect(result.content[0].text).toContain('权限范围为 disable');
    expect(result.content[0].text).toContain('创建采购记录（CreatePurchaseRecord）');
    expect(security.gate.violation).toContain('权限范围为 disable'); // run 级信号已广播
    expect(mcpCalls.list).toHaveLength(0);                     // 真实 MCP 调用零发生
  });

  it('闸1：前缀工具按 scope.name 裸名命中禁用集合（前缀不构成绕过）', async () => {
    const security = mkSecurity([['QuerySupplier', '查询供应商']]);
    const tools = await captureChildTools(undefined, security);
    const prefixed = tools.find(t => t.name === 'onto2__QuerySupplier');
    const result = await prefixed.execute('call-d2', {});
    expect(result.terminate).toBe(true);
    expect(security.gate.violation).toContain('查询供应商（QuerySupplier）');
    expect(mcpCalls.list).toHaveLength(0);
  });

  it('闸0 入口短路：violation 已置位 → 任意工具调用（行为/本体函数）一律 terminate，真实执行零发生', async () => {
    const security = mkSecurity();
    security.gate.violation = '🔒 行为已被禁用：其他子任务命中';
    const tools = await captureChildTools(undefined, security);
    const behTool = tools.find(t => t.name === 'QuerySupplier');
    const r1 = await behTool.execute('call-s1', { supplierName: '宝钢' });
    expect(r1.terminate).toBe(true);
    expect(r1.content[0].text).toContain('其他子任务命中');
    const fnTool = tools.find(t => t.name === 'calcSafetyStock');
    const r2 = await fnTool.execute('call-s2', { currentStock: 1, safetyStock: 2 });
    expect(r2.terminate).toBe(true);                           // 函数工具同样被短路
    expect(mcpCalls.list).toHaveLength(0);
  });

  it('first-writer-wins：violation 只记首次命中文案（后续调用走闸0 原样回显）', async () => {
    const security = mkSecurity([['CreatePurchaseRecord', '创建采购记录'], ['QuerySupplier', '查询供应商']]);
    const tools = await captureChildTools(undefined, security);
    await tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-f1', {});
    const r2 = await tools.find(t => t.name === 'QuerySupplier').execute('call-f2', {});
    expect(security.gate.violation).toContain('CreatePurchaseRecord');
    expect(security.gate.violation).not.toContain('查询供应商');
    expect(r2.content[0].text).toContain('CreatePurchaseRecord'); // 闸0 回显首次文案
  });

  it('非禁用行为正常放行，gate 不置位', async () => {
    const security = mkSecurity([['CreatePurchaseRecord', '创建采购记录']]);
    const tools = await captureChildTools(undefined, security);
    const tool = tools.find(t => t.name === 'QuerySupplier');
    const result = await tool.execute('call-p1', { supplierName: '宝钢' });
    expect(result).toBeTruthy();
    expect(result.terminate).toBeUndefined();
    expect(security.gate.violation).toBeNull();
    expect(mcpCalls.list).toHaveLength(1); // 真实执行发生
  });
});

// ─── toMountableToolInfo：发布方标记分类（纯函数，脱离 MCP 连接直测） ─────────────

describe('toMountableToolInfo 标记分类', () => {
  it('本体函数：scope.category 标记 → 归本体函数，剥离 scope/ontology_id，scope 留场景本体四值 + name 裸名', () => {
    const info = toMountableToolInfo({
      name: 'calcSafetyStock',
      description: '计算安全库存',
      parameters: { type: 'object', properties: {
        scope: { type: 'object', properties: {
          category: { const: '本体函数' }, name: { const: 'calcSafetyStock' }, display_name: { const: '计算安全库存' },
          ontology_id: { const: 1 }, scenario_id: { const: 1 },
          scenario_name: { const: '生产调度' }, ontology_name: { const: '原材料采购和库存' },
        } },
        ontology_id: { type: 'integer' }, currentStock: { type: 'number' },
      }, required: ['ontology_id'] },
    });
    expect(info.category).toBe('本体函数');
    expect(info.displayName).toBe('计算安全库存');
    expect(info.params).toEqual({ currentStock: { type: 'number', required: false } }); // ontology_id/scope 已剥离
    expect(info.scope).toEqual({ name: 'calcSafetyStock', ontology_id: 1, scenario_id: 1, scenario_name: '生产调度', ontology_name: '原材料采购和库存' });
    // schema 原文（剥 scope/ontology_id）随条目携带——规划期参数校验数据源
    expect(info.schema?.properties).toEqual({ currentStock: { type: 'number' } });
  });

  it('本体行为：scope.category=本体行为 → 归类正确，scope.name 裸名保留（前缀工具的挂载过滤/disable 闸匹配键）', () => {
    const info = toMountableToolInfo({
      name: 'onto1__CreatePurchaseRecord', // 跨本体重名 → 带前缀
      description: '创建采购记录',
      parameters: { type: 'object', properties: {
        scope: { type: 'object', properties: {
          category: { const: '本体行为' }, name: { const: 'CreatePurchaseRecord' }, display_name: { const: '创建采购记录' },
          ontology_id: { const: 1 }, scenario_id: { const: 1 },
          scenario_name: { const: '生产调度' }, ontology_name: { const: '原材料采购和库存' },
        } },
        ontology_id: { type: 'integer' },
        qty: { type: 'integer', minimum: 1, maximum: 100 },
      }, required: ['ontology_id'] },
    });
    expect(info.category).toBe('本体行为');
    expect(info.name).toBe('onto1__CreatePurchaseRecord'); // 工具名原样（挂载键）
    expect(info.scope?.name).toBe('CreatePurchaseRecord'); // 裸名（匹配键）
    expect(info.params.qty).toEqual({ type: 'integer', required: false });
    expect(info.schema?.properties?.qty).toEqual({ type: 'integer', minimum: 1, maximum: 100 }); // 约束随 schema 携带
  });

  it('公共函数：x-category 标记 → 归公共函数，x-display_name 进 displayName', () => {
    const info = toMountableToolInfo({
      name: 'getCurrentDate', description: '当前日期',
      parameters: { type: 'object', properties: {}, 'x-category': '公共函数', 'x-display_name': '当前日期' },
    });
    expect(info.category).toBe('公共函数');
    expect(info.displayName).toBe('当前日期');
    expect(info.scope).toBeUndefined();
  });

  it('无标记 → 归其他MCP工具（排除法）', () => {
    const info = toMountableToolInfo({
      name: 'weatherQuery', description: '天气',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
    });
    expect(info.category).toBe('其他MCP工具');
    expect(info.displayName).toBeUndefined();
  });

  it('回归：外部工具碰巧带 ontology_id 参数 → 仍归其他MCP工具，参数不被误删（hasOntologyId 特征猜测已退役）', () => {
    const info = toMountableToolInfo({
      name: 'externalReport', description: '外部报表',
      parameters: { type: 'object', properties: { ontology_id: { type: 'integer' }, title: { type: 'string' } }, required: ['ontology_id'] },
    });
    expect(info.category).toBe('其他MCP工具');
    expect(info.params.ontology_id).toBeTruthy(); // 真实业务参数原样保留
    expect(info.scope).toBeUndefined();
  });

  it('版本错配告警：带 scope 块但无 category 标记 → console.warn 提示 core-backend 过旧', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const info = toMountableToolInfo({
        name: 'legacyFn', description: '',
        parameters: { type: 'object', properties: { scope: { type: 'object', properties: { ontology_id: { const: 1 } } } } },
      });
      expect(info.category).toBe('其他MCP工具'); // 无标记仍走排除法
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain('core-backend 版本过旧');
    } finally {
      warn.mockRestore();
    }
  });
});
