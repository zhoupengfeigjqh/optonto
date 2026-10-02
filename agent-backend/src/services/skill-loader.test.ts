/**
 * SkillLoader.resolveOntologyContext —— 本体身份四元组解析契约。
 *
 * 口径（2026-10-01 统一）：唯一来源 = **ontology.yaml 的 metadata**（与 core
 * repositories/metadata、mcp-shared/data_store 同源）；meta.json 不再作为身份读取来源。
 * metadata 缺失 / 四元组不全 / 与所选场景·本体不一致 → 返回 null（路由层据此 400）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PathAccessController } from '../security/path-access-controller.js';
import { SkillLoader } from './skill-loader.js';

let dir: string;
let loader: SkillLoader;

/** 写一个本体目录：ontology.yaml（身份唯一来源）+ 可选 meta.json（仅注册用，应被忽略） */
function writeOntology(scenario: string, ontology: string, yamlText: string, opts: { meta?: any } = {}) {
  const d = join(dir, 'onto_market', scenario, ontology);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'ontology.yaml'), yamlText, 'utf-8');
  if (opts.meta) writeFileSync(join(d, 'meta.json'), JSON.stringify(opts.meta), 'utf-8');
}

const MD_OK = (scenario: string, ontology: string, sid = 1, oid = 1) => [
  'metadata:',
  `  scenario_name: ${scenario}`,
  `  scenario_id: ${sid}`,
  `  ontology_name: ${ontology}`,
  `  ontology_id: ${oid}`,
  'behaviors: []',
].join('\n') + '\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-loader-'));
  loader = new SkillLoader(new PathAccessController(dir, join(dir, 'threads')));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveOntologyContext · 身份唯一来源 = ontology.yaml.metadata', () => {
  it('metadata 完整 → 返回四元组（即使 meta.json 是旧值）', () => {
    writeOntology('生产调度', '原材料采购和库存', MD_OK('生产调度', '原材料采购和库存', 1, 7),
      { meta: { id: 999, scenario_id: 999, name: '旧名字' } });
    expect(loader.resolveOntologyContext('生产调度', '原材料采购和库存')).toEqual({
      scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 7,
    });
  });

  it('缺 metadata 段 → null', () => {
    writeOntology('s', 'a', 'behaviors: []\n');
    expect(loader.resolveOntologyContext('s', 'a')).toBeNull();
  });

  it('四元组不全（缺 ontology_id / scenario_id）→ null', () => {
    writeOntology('s', 'a', 'metadata:\n  scenario_name: s\n  scenario_id: 1\n  ontology_name: a\n');
    expect(loader.resolveOntologyContext('s', 'a')).toBeNull();
    writeOntology('s', 'b', 'metadata:\n  scenario_name: s\n  scenario_id: 1\n  ontology_name: b\n  ontology_id: 生效中\n');
    expect(loader.resolveOntologyContext('s', 'b')).toBeNull();
  });

  it('metadata 与所选场景/本体不一致 → null（不静默采信任一方）', () => {
    writeOntology('s', 'a', MD_OK('别的场景', 'a'));
    expect(loader.resolveOntologyContext('s', 'a')).toBeNull();
    writeOntology('s', 'b', MD_OK('s', '别的本体'));
    expect(loader.resolveOntologyContext('s', 'b')).toBeNull();
  });

  it('ontology.yaml 不存在 / 内容损坏 → null（不抛错）', () => {
    expect(loader.resolveOntologyContext('s', '缺文件')).toBeNull();
    writeOntology('s', 'bad', 'metadata: [unclosed\n');
    expect(loader.resolveOntologyContext('s', 'bad')).toBeNull();
  });
});
