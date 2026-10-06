/**
 * 数据引擎MCP 工具范围选择与收编豁免测试（2026-10-04 口径变更）：
 * - 数据引擎MCP 不再是内置服务，但 allowed_tools 工具范围选择照常生效（与 antv 等手工配置同权）
 * - 「行为工具永不收编」不变式改按 URL 豁免：即使病态地把引擎映射指向数据引擎MCP 自己，
 *   其行为工具也不得对 Agent 隐藏
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));
vi.mock('../services/skill-loader.js', () => ({ SkillLoader: class { getSkillDescriptions() { return []; } } }));
vi.mock('../services/llm.js', () => ({ resolveDeepSeekModel: () => ({ id: 'm', provider: 'deepseek' }) }));

// 真实 mcp-config-store（需要 isDataEngineMcpUrl / URL 常量），用临时配置文件驱动
import { MCPConfigStore, BUILTIN_DATA_ENGINE_MCP_URL } from '../services/mcp-config-store.js';

const DE = BUILTIN_DATA_ENGINE_MCP_URL;
const ONTO = 'http://optonto-ontology-mcp:8002/mcp';

vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    url: string;
    constructor(url: string) { this.url = url; }
    async connect() {}
    async close() {}
    async listTools() {
      if (this.url === DE) {
        return { tools: [
          { name: 'query_inventories', description: '库存查询（本体行为工具）', inputSchema: { type: 'object', properties: {} } },
          { name: 'start_polling_task', description: '轮询排产任务状态（本体行为工具）', inputSchema: { type: 'object', properties: {} } },
        ] };
      }
      return { tools: [] };
    }
    async callTool() { return { content: [{ type: 'text', text: '{}' }], isError: false }; }
  },
}));

import { AgentFactory } from './agent-factory.js';
import { SkillLoader } from '../services/skill-loader.js';
import { PathAccessController } from '../security/path-access-controller.js';
import { VisibilityGuard } from '../services/visibility-guard.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'afde-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(servers: object[]) {
  const cfg = join(dir, 'mcp-config.json');
  writeFileSync(cfg, JSON.stringify({ servers }), 'utf-8');
  return new MCPConfigStore(cfg);
}

/** 病态映射：把引擎 target 指向数据引擎MCP 自己的行为工具（收编豁免必须拦住） */
function writeSelfMapping() {
  const d = join(dir, 'onto_market', '生产调度', '原材料采购和库存');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'ontology.yaml'), 'metadata: {}\nbehaviors: []\n', 'utf-8');
  writeFileSync(join(d, 'data_engines.yaml'), [
    '- name: 查询库存',
    '  behavior_name: queryInventory',
    `  target: {server_url: "${DE}", tool_name: query_inventories}`,
  ].join('\n'), 'utf-8');
}

async function discover(store: MCPConfigStore) {
  const guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
  const factory = new AgentFactory(store, new SkillLoader(null as any), guard);
  return factory.observeDiscoveredTools() as Promise<{ name: string; description: string }[]>;
}

describe('数据引擎MCP 工具范围选择（预置服务口径）', () => {
  it('allowed_tools 只注册选中工具（范围外的不注册）', async () => {
    const store = writeConfig([
      { name: '本体MCP', url: ONTO, enabled: true, builtin: true },
      { name: '数据引擎MCP', url: DE, enabled: true, allowed_tools: ['query_inventories'] },
    ]);
    const tools = await discover(store);
    expect(tools.map(t => t.name)).toEqual(['query_inventories']);
  });

  it('未设置 allowed_tools 时注册全部工具', async () => {
    const store = writeConfig([
      { name: '数据引擎MCP', url: DE, enabled: true },
    ]);
    const tools = await discover(store);
    expect(tools.map(t => t.name).sort()).toEqual(['query_inventories', 'start_polling_task']);
  });

  it('服务停用时整站工具不注册', async () => {
    const store = writeConfig([
      { name: '数据引擎MCP', url: DE, enabled: false },
    ]);
    expect(await discover(store)).toHaveLength(0);
  });

  it('收编豁免：引擎映射指向数据引擎MCP 自己时，行为工具仍对 Agent 可见', async () => {
    writeSelfMapping();
    const store = writeConfig([
      { name: '数据引擎MCP', url: DE, enabled: true },
    ]);
    const tools = await discover(store);
    // 若豁免失效，query_inventories 会被「配映射即收编」隐藏——这里必须两个都在
    expect(tools.map(t => t.name).sort()).toEqual(['query_inventories', 'start_polling_task']);
  });
});
