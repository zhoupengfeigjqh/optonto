/**
 * discoverTools 可见性收编接线测试（配映射即收编，架构文档 §六）：
 * - 非内置 MCP 服务上"已被某本体 data_engine 映射"的原始工具对 Agent 隐藏
 * - 内置服务（ontology-mcp/data-engine-mcp）永不收编——同名工具照样挂载
 * - 未映射的普通外部工具不受影响
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));
vi.mock('../services/skill-loader.js', () => ({ SkillLoader: class { getSkillDescriptions() { return []; } } }));
vi.mock('../services/llm.js', () => ({ resolveDeepSeekModel: () => ({ id: 'm', provider: 'deepseek' }) }));

const BIZ = 'http://optonto-business-mcp:8004/sse';
const ONTO = 'http://optonto-ontology-mcp:8002/sse';

// 一个内置本体MCP + 一个手工配置的 business-mcp（模拟业务系统）
vi.mock('../services/mcp-config-store.js', () => ({
  MCPConfigStore: class {
    getConfig() {
      return { servers: [
        { name: '本体MCP', url: ONTO, enabled: true, builtin: true },
        { name: '业务系统MCP', url: BIZ, enabled: true, builtin: false },
      ] };
    }
  },
}));

// MCPClient 假实现：按 url 区分服务；两边各有一个同名 query_inventories（内置侧是本体行为 facade）
vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    url: string;
    constructor(url: string) { this.url = url; }
    async connect() {}
    async close() {}
    async listTools() {
      if (this.url === BIZ) {
        return { tools: [
          { name: 'query_inventories', description: '原始库存查询', inputSchema: { type: 'object', properties: {} } },
          { name: 'query_suppliers', description: '原始供应商查询', inputSchema: { type: 'object', properties: {} } },
        ] };
      }
      return { tools: [
        { name: 'query_inventories', description: '库存查询（本体行为 facade）', inputSchema: { type: 'object', properties: {} } },
      ] };
    }
    async callTool() { return { content: [{ type: 'text', text: '{}' }], isError: false }; }
  },
}));

import { AgentFactory } from './agent-factory.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { PathAccessController } from '../security/path-access-controller.js';
import { VisibilityGuard } from '../services/visibility-guard.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'afv-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 在 .data 写一个本体：data_engines 把 business-mcp 的 query_inventories 收编 */
function writeMapping() {
  const d = join(dir, 'onto_market', '生产调度', '原材料采购和库存');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'ontology.yaml'), 'metadata: {}\nbehaviors: []\n', 'utf-8');
  writeFileSync(join(d, 'data_engines.yaml'), [
    '- name: 查询库存',
    '  behavior_name: queryInventory',
    `  target: {server_url: "${BIZ}", tool_name: query_inventories}`,
  ].join('\n'), 'utf-8');
}

async function discover(guard?: VisibilityGuard) {
  const factory = new AgentFactory(new MCPConfigStore('' as any), new SkillLoader(null as any), guard);
  return (factory as any).discoverTools() as Promise<{ name: string; description: string }[]>;
}

describe('discoverTools 可见性收编', () => {
  it('非内置服务的已映射原始工具被隐藏；内置同名工具保留；未映射工具不受影响', async () => {
    writeMapping();
    const guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
    const tools = await discover(guard);
    const biz = tools.filter(t => t.description.includes('原始'));
    expect(biz.map(t => t.name)).toEqual(['query_suppliers']); // query_inventories 被收编
    expect(tools.filter(t => t.name === 'query_inventories')).toHaveLength(1); // 内置 facade 保留
    expect(tools.find(t => t.name === 'query_inventories')!.description).toContain('facade');
  });

  it('无映射（空 .data）时全部可见；未注入 guard 时不收编', async () => {
    const guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
    expect((await discover(guard)).length).toBe(3);
    expect((await discover(undefined)).length).toBe(3);
  });
});
