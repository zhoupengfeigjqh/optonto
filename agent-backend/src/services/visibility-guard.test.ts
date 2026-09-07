/**
 * VisibilityGuard 单元测试（可见性管控"配映射即收编"）：
 * - 扫 .data 全本体 data_engines，target 配了 server_url+tool_name 的进隐藏索引（缺省即 MCP；engine_type 已删出 schema）
 * - data_engines.yaml 独立文件优先 / ontology.yaml 旧段回退（与 OntologyGateway 同口径）
 * - URL 规范化（尾斜杠差异不敏感）与 mtime 指纹缓存
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathAccessController } from '../security/path-access-controller.js';
import { VisibilityGuard, normalizeServerUrl } from './visibility-guard.js';

const BIZ = 'http://optonto-business-mcp:8004/sse';

let dir: string;
let guard: VisibilityGuard;

function writeOntology(scenario: string, ontology: string, opts: { separateEngines?: string | null; ontologyYaml?: string }) {
  const d = join(dir, 'onto_market', scenario, ontology);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'ontology.yaml'), opts.ontologyYaml ?? 'metadata: {}\nbehaviors: []\n', 'utf-8');
  if (opts.separateEngines != null) {
    writeFileSync(join(d, 'data_engines.yaml'), opts.separateEngines, 'utf-8');
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vg-'));
  guard = new VisibilityGuard(new PathAccessController(dir, join(dir, 'threads')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('normalizeServerUrl', () => {
  it('去空白与尾斜杠', () => {
    expect(normalizeServerUrl(` ${BIZ}/ `)).toBe(BIZ);
    expect(normalizeServerUrl(BIZ)).toBe(BIZ);
  });
});

describe('getMappedToolIndex', () => {
  it('配了 target 的引擎收进索引（缺省即 MCP）；显式标已删除类型的旧配置不收', () => {
    writeOntology('生产调度', '原材料采购和库存', {
      separateEngines: [
        '- name: 查询库存',
        '  behavior_name: queryInventory',
        `  target: {server_url: "${BIZ}", tool_name: query_inventories}`,
        '- name: 存量带类型',
        '  behavior_name: queryStock',
        '  engine_type: MCP',
        `  target: {server_url: "${BIZ}", tool_name: query_stocks}`,
        '- name: 遗留SQL',
        '  behavior_name: sumInventory',
        '  engine_type: SQL',
        '  sql: SELECT 1',
        '- name: 遗留HTTP',
        '  behavior_name: legacyQuery',
        '  engine_type: HTTP',
        '  target: {url: "http://x/api", method: GET}',
      ].join('\n'),
    });
    const idx = guard.getMappedToolIndex();
    expect(idx.get(BIZ)).toEqual(new Set(['query_inventories', 'query_stocks']));
    expect(idx.size).toBe(1);
  });

  it('ontology.yaml 旧段回退（无独立 data_engines.yaml 时）', () => {
    writeOntology('生产调度', '本体乙', {
      ontologyYaml: [
        'behaviors: []',
        'data_engines:',
        '  - name: e',
        '    behavior_name: b',
        `    target: {server_url: "${BIZ}/", tool_name: query_suppliers}`,
      ].join('\n'),
    });
    // 尾斜杠差异：配置写 ".../sse/"，配置侧是 ".../sse"，规范化后同样命中
    expect(guard.isHidden(BIZ, 'query_suppliers')).toBe(true);
    expect(guard.isHidden(BIZ, 'query_inventories')).toBe(false);
    expect(guard.isHidden('http://other:9000/sse', 'query_suppliers')).toBe(false);
  });

  it('target 缺 server_url/tool_name 的半成品条目不收编', () => {
    writeOntology('s', 'o', {
      separateEngines: '- name: e\n  behavior_name: b\n  target: {tool_name: t}',
    });
    expect(guard.getMappedToolIndex().size).toBe(0);
  });

  it('mtime 指纹缓存：文件不变不重扫，变了自动重读', () => {
    writeOntology('s', 'o', { separateEngines: 'data_engines: []' });
    expect(guard.getMappedToolIndex().size).toBe(0);
    const f = join(dir, 'onto_market', 's', 'o', 'data_engines.yaml');
    writeFileSync(f, [
      '- name: e', '  behavior_name: b',
      `  target: {server_url: "${BIZ}", tool_name: t1}`,
    ].join('\n'));
    utimesSync(f, new Date(), new Date(Date.now() + 5000)); // 保证 mtime 变化
    expect(guard.isHidden(BIZ, 't1')).toBe(true);
  });

  it('onto_market 不存在：空索引不炸', () => {
    const g = new VisibilityGuard(new PathAccessController(join(dir, 'nope'), join(dir, 't')));
    expect(g.getMappedToolIndex().size).toBe(0);
    expect(g.isHidden(BIZ, 'x')).toBe(false);
  });
});
