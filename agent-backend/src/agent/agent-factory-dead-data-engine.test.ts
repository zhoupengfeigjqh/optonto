/**
 * 已下线的「数据引擎执行服务」条目必须被**清除**，而不是"保留但连不上"（2026-10-19 方案 B）。
 *
 * 背景：该服务已零工具化（`transport=none`，不再挂 `/mcp`），行为工具的唯一提供方是自建发布。
 * 存量配置里指向 `optonto-data-engine-executor:8005`（及更名前容器名）的条目若被保留，
 * Agent 每次发现工具都会连一个 404 端点——静默失效、最难排查。
 *
 * 本文件锁两条边界：
 *  ① 配置层丢弃：条目不出现在 `getConfig()` 返回值里；
 *  ② 发现层不连接：即便用户手工把条目写回文件，`discoverTools` 也不会连它、不产生任何工具。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));
vi.mock('../services/skill-loader.js', () => ({ SkillLoader: class { getSkillDescriptions() { return []; } } }));
vi.mock('../services/llm.js', () => ({ resolveDeepSeekModel: () => ({ id: 'm', provider: 'deepseek' }) }));

/** 连接记录：任何指向 8005 的连接都算方案 B 的回归 */
const connected: string[] = [];

vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    url: string;
    constructor(url: string) { this.url = url; connected.push(url); }
    async connect() {}
    async close() {}
    async listTools() {
      // 只有旧服务（8005）会发布行为工具；本测试要证明它**根本不会被连接**
      if (!this.url.includes(':8005')) return { tools: [] };
      return { tools: [{ name: 'QueryInventory', description: '库存查询', inputSchema: { type: 'object', properties: {} } }] };
    }
    async callTool() { return { content: [{ type: 'text', text: '{}' }], isError: false }; }
  },
}));

import { AgentFactory } from './agent-factory.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { PathAccessController } from '../security/path-access-controller.js';
import { VisibilityGuard } from '../services/visibility-guard.js';

const ONTO = 'http://optonto-ontology-query-mcp:8002/mcp';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'af-dead-de-'));
  connected.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function storeWith(servers: object[]): MCPConfigStore {
  const cfg = join(dir, 'mcp-config.json');
  writeFileSync(cfg, JSON.stringify({ servers }), 'utf-8');
  return new MCPConfigStore(cfg);
}

async function discover(store: MCPConfigStore) {
  const guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
  const factory = new AgentFactory(store, new SkillLoader(null as any), guard);
  return factory.observeDiscoveredTools() as Promise<{ name: string }[]>;
}

describe('已下线的数据引擎执行服务条目', () => {
  it('配置层直接丢弃：当前地址 / 更名前地址 / 手写尾斜杠都不残留', () => {
    const store = storeWith([
      { name: '本体MCP', url: ONTO, enabled: true, builtin: true },
      { name: '数据引擎MCP', url: 'http://optonto-data-engine-executor:8005/mcp', enabled: true },
      { name: '旧引擎', url: 'http://optonto-data-engine-mcp:8005/sse', enabled: true },
      { name: '手写尾斜杠', url: ' http://optonto-data-engine-executor:8005/mcp/ ', enabled: true },
    ]);
    expect(store.getConfig().servers.map(s => s.name)).toEqual(['本体查询MCP', '公共函数MCP']);
  });

  it('发现层不连接 8005：不会产生任何行为工具', async () => {
    const store = storeWith([
      { name: '本体MCP', url: ONTO, enabled: true, builtin: true },
      { name: '数据引擎MCP', url: 'http://optonto-data-engine-executor:8005/mcp', enabled: true },
    ]);
    const tools = await discover(store);
    expect(connected.some(u => u.includes(':8005'))).toBe(false);
    expect(tools).toEqual([]);
  });
});
