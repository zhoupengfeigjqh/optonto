/**
 * 业务数据闸测试（2026-10-05，C1 收口）。
 *
 * 背景：业务 MCP（business-mcp / 第三方业务系统）暴露的原始业务接口是**写操作**
 * （business-mcp 支持 GET/POST/PUT/DELETE），且无 `x-category` 标记者——消费端兜底归类为
 * 「其他MCP工具」。这类工具一旦进入 Agent 目录，父 Agent 可把它规划成「函数子任务」，
 * 而函数子任务走 `AgentFactory.callFunctionTool` 直连路径，该路径**不经过**
 * `createChildAgent` 的 `guardExecution` 包装——安全确认、disable 权限闸、前置/后置规则闸、
 * 报错预算四道闸一道都没有（等于业务写入零人工闸门直接落库）。
 *
 * 治理口径：`business_data === true`（声明为业务数据）的服务，其**原始未映射工具**
 * 一律不进 Agent 目录；业务接口必须经 `data_engines` 映射发布为「本体行为」才是唯一合法入口
 * （架构文档 §六「行为工具是唯一入口」的必然推论）。
 *
 * 本文件固化三条边界：
 *  ① 拦截：无标记工具被挡（业务数据闸）
 *  ② 放行：带 `x-category` 的平台自身工具照常进目录 —— **防误伤 data-engine-executor
 *     与自建发布**（前者发布本体行为工具，是行为子任务的唯一执行入口）
 *  ③ 不误伤：`business_data` 缺省/false 的第三方服务（图表类等辅助服务）无标记工具照常进
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));
vi.mock('../services/skill-loader.js', () => ({ SkillLoader: class { getSkillDescriptions() { return []; } } }));
vi.mock('../services/llm.js', () => ({ resolveDeepSeekModel: () => ({ id: 'm', provider: 'deepseek' }) }));

// 真实 mcp-config-store（需要 isBusinessDataServer / 内置 URL 常量），用临时配置文件驱动
import { MCPConfigStore } from '../services/mcp-config-store.js';

/** 业务 MCP：声明 business_data=true，工具全是无标记的原始业务接口（写操作） */
const BIZ = 'http://biz:8004/mcp';
/** 同样是业务数据服务，但发布了带 x-category 的本体行为工具（模拟引擎侧/自建发布被误标业务数据） */
const MARKED_BIZ = 'http://biz-marked:8004/mcp';
/** 第三方辅助服务（图表类）：business_data 缺省，无标记工具应照常给 Agent 用 */
const CHART = 'http://chart:9000/mcp';

/**
 * 本体行为工具的完整形态：x-category + 本体上下文 x-ontology-scope（否则 assertToolProtocol 会判版本错配）。
 *
 * 注意 `x-category` / `x-display_name` / `x-ontology-scope` 位于 **inputSchema 内**——都是 JSON Schema
 * 的扩展键（发布端 `mcp-shared/tool_contract.py` 注入的就是 input_schema），
 * 消费端 `tool-catalog.publishedCategory/readOntologyScope` 也从 schema 顶层读，两端口径一致。
 */
const BEHAVIOR_TOOL = {
  name: 'QueryInventory',
  description: '查询库存（本体行为工具）',
  inputSchema: {
    type: 'object',
    properties: {
      ontology_id: { type: 'integer', description: '本体 ID（必填）' },
      keyword: { type: 'string', description: '查询关键字' },
    },
    required: ['ontology_id', 'keyword'],
    'x-category': '本体行为',
    'x-display_name': '查询库存',
    'x-ontology-scope': {
      ontology_id: 1, scenario_id: 1,
      scenario_name: '生产调度', ontology_name: '原材料采购和库存',
    },
  },
};

vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    url: string;
    constructor(url: string) { this.url = url; }
    async connect() {}
    async close() {}
    async listTools() {
      if (this.url === BIZ) {
        // 真实 business-mcp 形态：全部无 x-category 标记，且含 POST/PUT/DELETE 写接口
        return { tools: [
          { name: 'create_order', description: '创建订单（POST）', inputSchema: { type: 'object', properties: {} } },
          { name: 'update_price', description: '调价（PUT）', inputSchema: { type: 'object', properties: {} } },
          { name: 'delete_order', description: '删除订单（DELETE）', inputSchema: { type: 'object', properties: {} } },
        ] };
      }
      if (this.url === MARKED_BIZ) {
        return { tools: [BEHAVIOR_TOOL] };
      }
      if (this.url === CHART) {
        return { tools: [{ name: 'render_chart', description: '渲染图表', inputSchema: { type: 'object', properties: {} } }] };
      }
      // 内置固定服务（本体查询 / 公共函数）在本文件不参与断言，返回空避免干扰
      return { tools: [] };
    }
    async callTool() { return { content: [{ type: 'text', text: '{"success":true,"data":{}}' }], isError: false }; }
  },
}));

import { AgentFactory } from './agent-factory.js';
import { SkillLoader } from '../services/skill-loader.js';
import { PathAccessController } from '../security/path-access-controller.js';
import { VisibilityGuard } from '../services/visibility-guard.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'afbiz-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(servers: object[]) {
  const cfg = join(dir, 'mcp-config.json');
  writeFileSync(cfg, JSON.stringify({ servers }), 'utf-8');
  return new MCPConfigStore(cfg);
}

async function discover(store: MCPConfigStore) {
  const guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
  const factory = new AgentFactory(store, new SkillLoader(null as any), guard);
  return factory.observeDiscoveredTools() as Promise<{ name: string }[]>;
}

describe('业务数据闸：business_data=true 的服务，原始未映射工具不进 Agent 目录', () => {
  it('业务 MCP 的写接口（无 x-category）全部被挡，目录为空', async () => {
    const store = writeConfig([
      { name: '业务系统采购与库存MCP', url: BIZ, enabled: true, business_data: true },
    ]);
    // 修复前：create_order / update_price / delete_order 三个写接口都会进目录，
    //         父 Agent 可规划成函数子任务走 callFunctionTool 直连（零安全确认）
    expect(await discover(store)).toHaveLength(0);
  });

  it('端到端：被挡的业务接口无法被直连调用（函数子任务路径返回失败而非执行成功）', async () => {
    const store = writeConfig([
      { name: '业务系统采购与库存MCP', url: BIZ, enabled: true, business_data: true },
    ]);
    const guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
    const factory = new AgentFactory(store, new SkillLoader(null as any), guard);
    // 函数子任务唯一执行入口：按名定位不到 → 明确失败，绝不静默放过
    const res = await factory.callFunctionTool('create_order', 1, {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain('不在可挂载工具清单中');
  });
});

describe('业务数据闸：只挡无标记工具，不误伤平台自身工具', () => {
  it('business_data=true 的服务发布的【本体行为】工具照常进目录（行为子任务执行入口不可被挡）', async () => {
    const store = writeConfig([
      { name: '某被误标业务数据的引擎服务', url: MARKED_BIZ, enabled: true, business_data: true },
    ]);
    const tools = await discover(store);
    // 防回归：若闸写成「business_data=true 就跳过整个 server」，本体行为工具会被挡掉，
    // 所有行为子任务失去执行入口
    expect(tools.map(t => t.name)).toEqual(['QueryInventory']);
  });
});

describe('业务数据闸：不误伤非业务数据的第三方服务', () => {
  it('business_data 缺省的无标记工具照常进目录（图表类辅助服务仍可给 Agent 用）', async () => {
    const store = writeConfig([
      { name: '图表服务', url: CHART, enabled: true },
    ]);
    expect((await discover(store)).map(t => t.name)).toEqual(['render_chart']);
  });

  it('business_data=false 显式关闭闸，与缺省同口径', async () => {
    const store = writeConfig([
      { name: '图表服务', url: CHART, enabled: true, business_data: false },
    ]);
    expect((await discover(store)).map(t => t.name)).toEqual(['render_chart']);
  });
});

describe('业务数据闸与可见性收编的边界', () => {
  it('已配映射的接口仍按收编隐藏（既有行为不变），未映射的由业务数据闸兜住', async () => {
    // create_order 已配 data_engines 映射 → 由「配映射即收编」隐藏
    const d = join(dir, 'onto_market', '生产调度', '原材料采购和库存');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'ontology.yaml'), 'metadata: {}\nbehaviors: []\n', 'utf-8');
    writeFileSync(join(d, 'data_engines.yaml'), [
      '- name: 创建订单',
      '  behavior_name: CreateOrder',
      `  target: {server_url: "${BIZ}", tool_name: create_order}`,
    ].join('\n'), 'utf-8');

    const store = writeConfig([
      { name: '业务系统采购与库存MCP', url: BIZ, enabled: true, business_data: true },
    ]);
    // create_order 被收编藏、update_price/delete_order 被业务数据闸挡 → 目录仍为空
    expect(await discover(store)).toHaveLength(0);
  });
});
