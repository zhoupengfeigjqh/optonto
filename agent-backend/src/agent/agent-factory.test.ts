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
// MCPClient 假实现：listTools 返回 executeOntoBehavior（inputSchema 带 ontology_id），callTool 返回成功。
// 不连真实网络——discoverTools 会 new MCPClient(url) 并 connect/listTools。
vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: [{ name: 'executeOntoBehavior', description: '执行本体行为', inputSchema: { type: 'object', properties: { behavior_name: { type: 'string' }, ontology_id: { type: 'integer' }, params: { type: 'object' } }, required: ['behavior_name', 'ontology_id'] } }] };
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
 */
async function captureChildTools() {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createChildAgent(
    { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 },
    'CreatePurchaseRecord', ['rawMaterialId', 'qty'],
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
