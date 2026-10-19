/**
 * MCP 配置存储（MCPConfigStore）规整契约测试。
 *
 * 四组语义：
 * 1. 内置固定项（**本体查询 MCP** 与 **公共函数 MCP**，2026-10-05 起两者并列）：恒存在、恒启用、
 *    恒全选、恒在队首（顺序固定）、不可编辑/停用/删除，篡改会被 normalize 复位；
 * 2. 数据引擎执行服务条目（2026-10-19 起**已下线**）：不再预置；存量配置里指向它的条目
 *    （当前 8005 地址与更名前容器名，任意路径/斜杠）一律被 normalize 丢弃、不复活；
 * 3. 存量配置归位（2026-10-04 服务更名 / 端口收敛的迁移保证）：旧 URL 命中的条目必须被
 *    **替换**为新条目，而不是与新条目并存——否则 Agent 会同时挂载两个本体查询服务，
 *    或挂到已不存在的容器上（静默失效，最难排查）。
 * 4. 公共函数发布不变量：默认挂载必须含公共函数 MCP，否则引用公共函数的规则会被永久判缺口。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  MCPConfigStore, BUILTIN_MCP_URL, BUILTIN_COMMON_FUNCTION_MCP_URL, isBusinessDataServer,
} from './mcp-config-store.js';

let dir: string;
let cfgPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-cfg-'));
  cfgPath = join(dir, 'mcp-config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (servers: any[]) => writeFileSync(cfgPath, JSON.stringify({ servers }, null, 2), 'utf-8');

describe('MCPConfigStore 规整', () => {
  it('无配置文件：默认种子只有两个内置项（本体查询MCP + 公共函数MCP）', () => {
    const config = new MCPConfigStore(cfgPath).getConfig();
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0]).toMatchObject({ name: '本体查询MCP', url: BUILTIN_MCP_URL, enabled: true, builtin: true });
    expect(config.servers[1]).toMatchObject({ name: '公共函数MCP', url: BUILTIN_COMMON_FUNCTION_MCP_URL, enabled: true, builtin: true });
  });

  it('存量数据引擎条目被丢弃（不复活、不残留失效连接）', () => {
    write([
      { name: '本体MCP', url: BUILTIN_MCP_URL, enabled: false, builtin: true },
      { name: '数据引擎MCP', url: 'http://optonto-data-engine-executor:8005/mcp', enabled: true, allowed_tools: ['queryInventory'] },
    ]);
    const config = new MCPConfigStore(cfgPath).getConfig();
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0]).toMatchObject({ name: '本体查询MCP', enabled: true, builtin: true });
    expect(config.servers.some(s => s.url.includes(':8005'))).toBe(false);
  });

  it('更名前容器名 / 历史路径的数据引擎条目同样被丢弃（host:port 判定）', () => {
    write([
      { name: '旧引擎-1', url: 'http://optonto-data-engine-mcp:8005/sse', enabled: true },
      { name: '旧引擎-2', url: 'http://optonto-data-engine-mcp:8005/mcp', enabled: true },
      { name: '手写尾斜杠', url: ' http://optonto-data-engine-executor:8005/mcp/ ', enabled: true },
    ]);
    const config = new MCPConfigStore(cfgPath).getConfig();
    expect(config.servers.map(s => s.name)).toEqual(['本体查询MCP', '公共函数MCP']);
  });

  it('saveConfig 同样丢弃数据引擎条目：本体查询恒启用、其余用户服务原样保留', () => {
    const store = new MCPConfigStore(cfgPath);
    store.saveConfig({ servers: [
      { name: '本体MCP', url: 'http://tampered/mcp', enabled: false, builtin: false } as any,
      { name: '数据引擎执行服务', url: 'http://optonto-data-engine-executor:8005/mcp', enabled: false },
      { name: '官方发布', url: 'http://optonto-mcp-publish-x:8100/mcp', enabled: true },
    ] });
    const saved = store.getConfig();
    expect(saved.servers[0]).toMatchObject({ name: '本体查询MCP', url: BUILTIN_MCP_URL, enabled: true, builtin: true });
    expect(saved.servers.some(s => s.name === '数据引擎执行服务')).toBe(false);
    expect(saved.servers.find(s => s.name === '官方发布')!.enabled).toBe(true);
  });

  it('内置识别容忍 URL 差异（尾斜杠 / 两侧空白）——本体查询与公共函数同口径', () => {
    // 显示名故意不占保留名：只靠 URL 判定，验证两条内置的容错口径一致
    write([
      { name: '我改的查询服务', url: ` ${BUILTIN_MCP_URL}/ `, enabled: true },
      { name: '我改的公共函数', url: ` ${BUILTIN_COMMON_FUNCTION_MCP_URL}  `, enabled: false },
    ]);
    const config = new MCPConfigStore(cfgPath).getConfig();
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0]).toMatchObject({ name: '本体查询MCP', url: BUILTIN_MCP_URL, enabled: true, builtin: true });
    expect(config.servers[1]).toMatchObject({ name: '公共函数MCP', url: BUILTIN_COMMON_FUNCTION_MCP_URL, enabled: true, builtin: true });
  });
});

/**
 * `business_data`（是否业务数据，2026-10-05）—— **C1 收口的配置层底座**。
 *
 * 该字段有两条消费语义（见 MCPServerConfig.business_data 注释）：
 *  ① UI：「接口映射 → 目标 MCP 服务」下拉只列 `business_data === true` 的服务；
 *  ② Agent 目录准入：声明为业务数据的服务，其无 `x-category` 的原始工具不进 Agent 目录
 *     （`agent-factory.discoverTools` 消费，单点收口）。
 *
 * 本组固化配置层自身的三条契约：**normalize 原样透传**（不被 builtin 归位逻辑吞掉）、
 * **判定口径单一**（缺省=否）、**内置固定项不带该标记**。
 */
describe('business_data 标记（2026-10-05）', () => {
  it('normalize 原样透传 business_data（true / false 均不被 builtin 归位逻辑吞掉）', () => {
    write([
      { name: '业务系统采购与库存MCP', url: 'http://biz:8004/mcp', enabled: true, business_data: true },
      { name: '图表服务', url: 'http://chart:9000/mcp', enabled: true, business_data: false },
    ]);
    const config = new MCPConfigStore(cfgPath).getConfig();
    const biz = config.servers.find(s => s.name === '业务系统采购与库存MCP')!;
    const chart = config.servers.find(s => s.name === '图表服务')!;
    expect(biz.business_data).toBe(true);
    expect(chart.business_data).toBe(false);
  });

  it('缺省视为「否」——未声明该字段的历史配置不会被误判为业务数据服务', () => {
    // 存量配置迁移场景：字段是后加的，老配置一律没有它。若缺省被判 true，
    // 升级后所有第三方服务的历史工具会集体从 Agent 目录消失
    expect(isBusinessDataServer({ name: 'x', url: 'u', enabled: true })).toBe(false);
    expect(isBusinessDataServer({ name: 'x', url: 'u', enabled: true, business_data: undefined })).toBe(false);
    expect(isBusinessDataServer(null)).toBe(false);
    expect(isBusinessDataServer(undefined)).toBe(false);
  });

  it('严格取 true：字符串 "true" / 数值 1 都不算业务数据（避免手改配置绕过闸门）', () => {
    expect(isBusinessDataServer({ name: 'x', url: 'u', enabled: true, business_data: true })).toBe(true);
    expect(isBusinessDataServer({ name: 'x', url: 'u', enabled: true, business_data: 'true' } as any)).toBe(false);
    expect(isBusinessDataServer({ name: 'x', url: 'u', enabled: true, business_data: 1 } as any)).toBe(false);
  });

  it('内置固定项不带 business_data（本体查询 / 公共函数恒为非业务数据服务）', () => {
    const config = new MCPConfigStore(cfgPath).getConfig();
    for (const s of config.servers.filter(x => x.builtin)) {
      expect(isBusinessDataServer(s), `内置服务 ${s.name} 不应被标为业务数据`).toBe(false);
    }
  });
});

describe('存量配置归位（2026-10-04 服务更名）', () => {
  it('旧本体查询 URL 归位为新地址；旧数据引擎条目被清除', () => {
    write([
      { name: '本体MCP', url: 'http://optonto-ontology-mcp:8002/mcp', enabled: true, builtin: true },
      { name: '数据引擎MCP', url: 'http://optonto-data-engine-mcp:8005/mcp', enabled: true },
    ]);
    const config = new MCPConfigStore(cfgPath).getConfig();
    const onto = config.servers.filter(s => s.url.includes(':8002'));
    expect(onto).toHaveLength(1);
    expect(onto[0].url).toBe(BUILTIN_MCP_URL);
    expect(config.servers.some(s => s.url.includes(':8005'))).toBe(false);
  });

  it('旧本体查询 URL + 旧显示名（builtin 残留）也能被识别为内置并归位', () => {
    write([{ name: '本体MCP', url: 'http://optonto-ontology-mcp:8002/mcp', enabled: true }]);
    const config = new MCPConfigStore(cfgPath).getConfig();
    // 内置恒存在：本体查询归位 + 公共函数恒补齐（共 2 条，顺序固定）
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0]).toMatchObject({ name: '本体查询MCP', url: BUILTIN_MCP_URL, builtin: true });
    expect(config.servers[1]).toMatchObject({ name: '公共函数MCP', url: BUILTIN_COMMON_FUNCTION_MCP_URL, builtin: true });
  });
});
/**
 * 防回归（2026-10-04）：**公共函数必须有人发布**。
 *
 * 背景：规则的 related_functions 可引用公共函数，规则闸要求「关联函数执行过」才算满足；
 * 而 Agent 只能通过 MCP 工具调用函数。2026-10-04 之前公共函数一度**无任何服务发布**
 * （瘦身时从本体 MCP 服务移除了函数/公共函数工具面），导致引用公共函数的规则被永久判缺口、
 * 阻断行为执行。故把这条不变量固化为测试：manifest 里的每个公共函数，都必须能在
 * agent 的默认挂载服务里被解析到（默认配置里必须有公共函数 MCP 这一条）。
 */
describe('公共函数发布不变量（防回归）', () => {
  it('默认配置里必须有公共函数 MCP 条目（否则规则闸对公共函数永远判缺口）', async () => {
    const { MCPConfigStore, BUILTIN_COMMON_FUNCTION_MCP, BUILTIN_COMMON_FUNCTION_MCP_URL } =
      await import('./mcp-config-store.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cfg-commonfn-'));
    try {
      const store = new MCPConfigStore(join(dir, 'mcp-config.json'));
      const config = store.getConfig();
      const entry = config.servers.find(s => s.url === BUILTIN_COMMON_FUNCTION_MCP_URL);
      expect(entry, '默认配置缺少公共函数 MCP（规则引用公共函数将永远判缺口）').toBeDefined();
      expect(entry!.enabled).toBe(true);
      expect(entry!.name).toBe(BUILTIN_COMMON_FUNCTION_MCP.name);
      expect(entry!.builtin).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('公共函数 MCP 是内置固定项：删掉条目会被复活', async () => {
    const { MCPConfigStore, BUILTIN_COMMON_FUNCTION_MCP_URL } = await import('./mcp-config-store.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cfg-commonfn2-'));
    try {
      const path = join(dir, 'mcp-config.json');
      writeFileSync(path, JSON.stringify({ servers: [
        { name: '本体查询MCP', url: 'http://optonto-ontology-query-mcp:8002/mcp', enabled: true, builtin: true },
      ] }), 'utf-8');
      const config = new MCPConfigStore(path).getConfig();
      expect(config.servers.some(s => s.url === BUILTIN_COMMON_FUNCTION_MCP_URL)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('公共函数 MCP 不可修改：停用 / 限工具范围 / 篡改 URL 都会被复位，其他服务不受影响', async () => {
    const { MCPConfigStore, BUILTIN_COMMON_FUNCTION_MCP_URL } = await import('./mcp-config-store.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cfg-commonfn3-'));
    try {
      const path = join(dir, 'mcp-config.json');
      writeFileSync(path, JSON.stringify({ servers: [
        { name: '本体查询MCP', url: 'http://optonto-ontology-query-mcp:8002/mcp', enabled: true, builtin: true },
        { name: '公共函数MCP', url: 'http://tampered/mcp', enabled: false, allowed_tools: ['filterData'] },
        { name: '自家服务', url: 'http://my:9000/mcp', enabled: true },
      ] }), 'utf-8');
      const config = new MCPConfigStore(path).getConfig();
      const cf = config.servers.find(s => s.builtin && s.url === BUILTIN_COMMON_FUNCTION_MCP_URL)!;
      expect(cf, '被篡改 URL 的公共函数条目必须被复位为内置常量').toBeDefined();
      expect(cf.enabled).toBe(true);              // 停用被复位
      expect(cf.allowed_tools).toBeUndefined();   // 工具范围被复位（恒全选）
      expect(config.servers.find(s => s.name === '自家服务')).toBeDefined();  // 其他服务保留
      expect(config.servers).toHaveLength(3);     // 篡改条目被替换而非并存
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});