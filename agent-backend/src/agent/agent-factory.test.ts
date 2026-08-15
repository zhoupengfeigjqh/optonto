/**
 * AgentFactory.createParentAgent 历史映射单元测试。
 * 验证：summary 角色（短期记忆压缩摘要）喂给父 Agent 前被映射为 assistant 并加【历史摘要】前缀，
 * 避免模型把它当成助手上一轮真实发言；user 保持 user 角色，其余角色原样映射为 assistant。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';

// 整体替换 pi-agent-core：捕获 new Agent(config) 的 config（含 transformContext）
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));

// MCP 配置：一个启用的内置本体MCP server（供 discoverTools 发现工具）
vi.mock('../services/mcp-config-store.js', () => ({
  MCPConfigStore: class { getConfig() { return { servers: [{ name: '本体MCP', url: 'http://mcp-test/sse', enabled: true, builtin: true }] }; } },
}));
// MCPClient 假实现：listTools 返回混合工具集（本体浏览 list* + 执行 execute + 公共函数），callTool 返回成功。
// 不连真实网络——discoverTools 会 new MCPClient(url) 并 connect/listTools。
vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: [
        { name: 'executeOntoBehavior', description: '执行本体行为', inputSchema: { type: 'object', properties: { behavior_name: { type: 'string' }, ontology_id: { type: 'integer' }, params: { type: 'object' } }, required: ['behavior_name', 'ontology_id'] } },
        { name: 'calcSafetyStock', description: '计算安全库存', inputSchema: { type: 'object', properties: { ontology_id: { type: 'integer' }, currentStock: { type: 'number' }, safetyStock: { type: 'number' } }, required: ['ontology_id'] } },
        { name: 'sumRawNotArrivalQty', description: '未到位数求和', inputSchema: { type: 'object', properties: { ontology_id: { type: 'integer' }, purchaseRecordSet: { type: 'array' } }, required: ['ontology_id'] } },
        { name: 'listOntoBehaviors', description: '列出本体行为', inputSchema: { type: 'object', properties: { ontology_id: { type: 'integer' } } } },
        { name: 'getCurrentDate', description: '当前日期', inputSchema: { type: 'object', properties: {} } },
        { name: 'weatherQuery', description: '外部天气查询', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } },
      ] };
    }
    async callTool() { return { content: [{ type: 'text', text: '{"ok":true}' }], isError: false }; }
  },
}));
// SkillLoader 只用到 getSkillDescriptions（tools 的 execute 不在此路径触发）
vi.mock('../services/skill-loader.js', () => ({
  SkillLoader: class { getSkillDescriptions() { return []; } },
}));
// 模型解析：返回假模型，避免真实解析
vi.mock('../services/llm.js', () => ({
  resolveDeepSeekModel: () => ({ id: 'deepseek-v4-flash', provider: 'deepseek' }),
}));

import { AgentFactory } from './agent-factory.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
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
 * legalCalls 默认含主行为 + 一个规则关联行为 + 一个关联函数，供白名单/硬检查测试共用。
 */
async function captureChildTools(legalCalls = { behaviors: ['CreatePurchaseRecord', 'QuerySupplier'], functions: ['calcSafetyStock', 'getCurrentDate'] }) {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createChildAgent(
    { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 },
    'CreatePurchaseRecord', ['rawMaterialId', 'qty'], undefined, legalCalls,
  );
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return mockedAgent.mock.calls[0][0].initialState.tools as any[];
}

describe('AgentFactory.scopeToOntology 主行为必填参数硬检查', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('必填参数缺失时 executeOntoBehavior 抛异常（pi-agent 以抛异常识别工具错误 → 触发子 Agent 重试）', async () => {
    const tools = await captureChildTools();
    const tool = tools.find(t => t.name === 'executeOntoBehavior');
    expect(tool).toBeTruthy();
    await expect(
      tool.execute('call-1', { behavior_name: 'CreatePurchaseRecord', params: { supplierName: '宝钢' } }),
    ).rejects.toThrow(/禁止执行：必填参数缺失 rawMaterialId、qty/);
  });

  it('必填参数齐全时放行并强制注入 ontology_id', async () => {
    const tools = await captureChildTools();
    const tool = tools.find(t => t.name === 'executeOntoBehavior');
    const result = await tool.execute('call-2', { behavior_name: 'CreatePurchaseRecord', params: { rawMaterialId: 1, qty: 10 } });
    expect(result).toBeTruthy();
  });

  it('非主行为调用不触发硬检查（规则查询行为）', async () => {
    const tools = await captureChildTools();
    const tool = tools.find(t => t.name === 'executeOntoBehavior');
    const result = await tool.execute('call-3', { behavior_name: 'QuerySupplier', params: {} });
    expect(result).toBeTruthy();
  });
});

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

describe('AgentFactory 父 Agent 工具职责边界', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('父 Agent 挂 load_skill 与 submit_plan', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).toContain('load_skill');
    expect(names).toContain('submit_plan');
  });

  it('父 Agent 挂只读 list_mcp_tools，返回紧凑可挂载工具清单（名字+分类+描述，剔除 list* 与 executeOntoBehavior）', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'list_mcp_tools');
    expect(tool).toBeTruthy();
    const result = await tool.execute('call-list', {});
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    const names = parsed.map((t: any) => t.name);
    expect(names).toContain('weatherQuery'); // 其他 MCP 工具可见（供父 Agent 规划 related_functions）
    expect(names).toContain('calcSafetyStock'); // 本体函数可见
    expect(names).not.toContain('listOntoBehaviors'); // 本体浏览不属可挂载域
    expect(names).not.toContain('executeOntoBehavior'); // 行为执行不属可挂载域
    // 分类正确且紧凑（不返回参数 schema）
    const byName = Object.fromEntries(parsed.map((t: any) => [t.name, t]));
    expect(byName['calcSafetyStock'].category).toBe('本体函数');
    expect(byName['getCurrentDate'].category).toBe('公共函数');
    expect(byName['weatherQuery'].category).toBe('其他MCP工具');
    expect(byName['weatherQuery'].parameters).toBeUndefined();
  });

  it('父 Agent 只挂本体查询工具（list*），不挂函数/外部工具', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).toContain('listOntoBehaviors');
    expect(names).not.toContain('getCurrentDate'); // 公共函数不挂父 Agent（由 list_mcp_tools 发现）
  });

  it('父 Agent 不挂 executeOntoBehavior / 本体函数 / 外部工具', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).not.toContain('executeOntoBehavior');
    expect(names).not.toContain('calcSafetyStock'); // 本体函数不挂父 Agent
    expect(names).not.toContain('sumRawNotArrivalQty');
    expect(names).not.toContain('weatherQuery'); // 外部工具不挂父 Agent
  });
});

describe('AgentFactory 子 Agent 工具职责边界', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('子 Agent 挂执行工具 + 合法本体函数 + 公共函数，不挂本体浏览工具', async () => {
    const names = (await captureChildTools()).map(t => t.name);
    expect(names).toContain('executeOntoBehavior');
    expect(names).toContain('calcSafetyStock'); // legalCalls.functions 声明的本体函数
    expect(names).toContain('getCurrentDate');
    expect(names).not.toContain('listOntoBehaviors');
    expect(names).not.toContain('executeOntoFunction');
  });
});

describe('AgentFactory 子 Agent 白名单闸门', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('executeOntoBehavior 调用非法 behavior_name → 抛错拒绝（不进 MCP）', async () => {
    const tools = await captureChildTools();
    const tool = tools.find(t => t.name === 'executeOntoBehavior');
    expect(tool).toBeTruthy();
    await expect(
      tool.execute('call-1', { behavior_name: 'DeleteInventory', params: {} }),
    ).rejects.toThrow(/不在本子任务合法行为列表/);
  });

  it('executeOntoBehavior 调用合法规则关联行为（data_supplements）→ 放行', async () => {
    const tools = await captureChildTools();
    const tool = tools.find(t => t.name === 'executeOntoBehavior');
    const result = await tool.execute('call-2', { behavior_name: 'QuerySupplier', params: {} });
    expect(result).toBeTruthy();
  });

  it('本体函数工具按挂载期过滤：只挂 legalCalls.functions 声明的函数', async () => {
    const tools = await captureChildTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('calcSafetyStock'); // legalCalls.functions 含 calcSafetyStock
    expect(names).not.toContain('sumRawNotArrivalQty'); // 未声明的本体函数不挂（挂载期白名单过滤）
  });

  it('公共函数按挂载期过滤：未声明的公共函数不挂（不再恒挂全部）', async () => {
    const tools = await captureChildTools({ behaviors: ['CreatePurchaseRecord', 'QuerySupplier'], functions: ['calcSafetyStock'] });
    const names = tools.map(t => t.name);
    expect(names).not.toContain('getCurrentDate'); // 公共函数未在 legalCalls.functions 声明 → 不挂
  });

  it('其他 MCP 工具（无 ontology_id、非公共函数）默认不挂，父 Agent 指定才挂', async () => {
    // 默认 legalCalls.functions 不含 weatherQuery → 不挂（不再恒挂新增 MCP）
    const defaultTools = await captureChildTools();
    expect(defaultTools.map(t => t.name)).not.toContain('weatherQuery');
    // 父 Agent 指定 weatherQuery 进 related_functions → legalCalls.functions 含它 → 挂载
    mockedAgent.mockClear();
    const withExternal = await captureChildTools({ behaviors: ['CreatePurchaseRecord', 'QuerySupplier'], functions: ['calcSafetyStock', 'getCurrentDate', 'weatherQuery'] });
    const names = withExternal.map(t => t.name);
    expect(names).toContain('weatherQuery');
  });

  it('本体函数工具：子 Agent 视角 schema 已剔除 ontology_id', async () => {
    const tools = await captureChildTools();
    const tool = tools.find(t => t.name === 'calcSafetyStock');
    expect(tool).toBeTruthy();
    const props = (tool.parameters as any)?.properties ?? {};
    const required = (tool.parameters as any)?.required ?? [];
    // 本体函数工具与 executeOntoBehavior 一样：子 Agent 不感知 ontology_id（由 scopeToOntology 强制注入）
    expect('ontology_id' in props).toBe(false);
    expect(required).not.toContain('ontology_id');
    const result = await tool.execute('call-5', { currentStock: 10, safetyStock: 5 });
    expect(result).toBeTruthy();
  });
});
