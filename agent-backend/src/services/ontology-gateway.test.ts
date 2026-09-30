/**
 * OntologyGateway 契约测试 —— 镜像 docs/contracts/ontology-yaml.md 用例表（O1-O5 / T1-T7）。
 * 与 core-backend/tests/test_ontology_files_contract.py 是同一组用例的双端镜像：
 * 改读取规则必须先改契约文档，再同步两侧用例。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dump } from 'js-yaml';
import { OntologyGateway } from './ontology-gateway.js';
import { PathAccessController } from '../security/path-access-controller.js';

const SC = 'SC';
const ON = 'ON';

let root: string;
let ontoDir: string;
let gateway: OntologyGateway;

/** 写 ontology.yaml；concepts/behaviors/functions/rules/engines/securities 任意组合 */
function writeOntology(opts: { behaviors?: any[]; concepts?: any[]; functions?: any[]; rules?: any[]; data_engines?: any[]; securities?: any[] }): void {
  const doc: any = {};
  if (opts.behaviors) doc.behaviors = opts.behaviors;
  if (opts.concepts) doc.concepts = opts.concepts;
  if (opts.functions) doc.functions = opts.functions;
  if (opts.rules) doc.rules = opts.rules;
  if (opts.data_engines) doc.data_engines = opts.data_engines;
  if (opts.securities) doc.securities = opts.securities;
  writeFileSync(join(ontoDir, 'ontology.yaml'), dump(doc), 'utf-8');
}

/** 写独立文件；wrap=true 用映射包裹形态，false 用裸列表形态（契约 §2 形态容忍） */
function writeOverlay(filename: string, key: string, items: any[], wrap: boolean): void {
  writeFileSync(join(ontoDir, filename), dump(wrap ? { [key]: items } : items), 'utf-8');
}

function httpEngine(behavior: string, method: string): any {
  return { behavior_name: behavior, target: { method, url: 'http://x' } };
}

/** 观测 data_engines overlay 结果：直读私有加载方法的缓存数据（引擎字段不再驱动 isWrite） */
function loadedEngines(): any[] {
  return ((gateway as any).loadOntologyData(SC, ON)?.data_engines) || [];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gateway-contract-'));
  ontoDir = join(root, 'data', 'onto_market', SC, ON);
  mkdirSync(ontoDir, { recursive: true });
  gateway = new OntologyGateway(new PathAccessController(join(root, 'data'), join(root, 'threads')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('契约 §2 Overlay 回退', () => {
  it('O1：data_engines.yaml 存在 → 覆盖 ontology.yaml 旧段', () => {
    writeOntology({ behaviors: [{ name: 'B1' }], data_engines: [httpEngine('B1', 'GET')] });
    writeOverlay('data_engines.yaml', 'data_engines', [httpEngine('B1', 'POST')], true);
    expect(loadedEngines()[0].target.method).toBe('POST');
  });

  it('O2：data_engines.yaml 不存在 → 回退 ontology.yaml 旧段', () => {
    writeOntology({ behaviors: [{ name: 'B1' }], data_engines: [httpEngine('B1', 'POST')] });
    expect(loadedEngines()[0].target.method).toBe('POST');
  });

  it('O3：securities.yaml 存在 → 覆盖旧段（everyone 压过 disable）', () => {
    writeOntology({
      behaviors: [{ name: 'B1' }],
      securities: [{ action_name: 'B1', scope: ['disable'], confirm: true, confirm_content: '' }],
    });
    writeOverlay('securities.yaml', 'securities',
      [{ action_name: 'B1', scope: ['everyone'], confirm: true, confirm_content: '' }], true);
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').security?.scope).toEqual(['everyone']);
  });

  it('O4：独立文件裸列表形态 → 等价接受', () => {
    writeOntology({ behaviors: [{ name: 'B1' }] });
    writeOverlay('data_engines.yaml', 'data_engines', [httpEngine('B1', 'POST')], false);
    expect(loadedEngines()).toHaveLength(1);
  });

  it('O5：独立文件映射包裹形态 → 等价接受', () => {
    writeOntology({ behaviors: [{ name: 'B1' }] });
    writeOverlay('data_engines.yaml', 'data_engines', [httpEngine('B1', 'POST')], true);
    expect(loadedEngines()).toHaveLength(1);
  });
});

describe('契约 §3 操作类型推导（isWrite）——2026-09-07 起引擎不参与推导，空 op_type 一律判读', () => {
  function isWrite(behavior: any, engines?: any[]): boolean {
    writeOntology({ behaviors: [behavior], ...(engines ? { data_engines: engines } : {}) });
    return gateway.getBehaviorMeta(SC, ON, behavior.name).isWrite;
  }

  it('T1：op_type=command → 判写', () => {
    expect(isWrite({ name: 'B1', op_type: 'command' }, [httpEngine('B1', 'GET')])).toBe(true);
  });

  it('T2：op_type=query 显式 → 判读', () => {
    expect(isWrite({ name: 'B1', op_type: 'query' }, [httpEngine('B1', 'POST')])).toBe(false);
  });

  it('T3：空 op_type + 有引擎 → query（引擎不参与推导）', () => {
    expect(isWrite({ name: 'B1' }, [httpEngine('B1', 'POST')])).toBe(false);
  });

  it('T4：空 op_type + 无引擎 → query', () => {
    expect(isWrite({ name: 'B1' })).toBe(false);
  });
});

describe('契约 §6 字段契约与旧格式迁移（spec 003）', () => {
  it('M1：行为旧 related_concepts 数组 → 标量 concept 参与概念解析', () => {
    writeOntology({
      concepts: [{ name: 'C1', display_name: '概念一', attributes: [{ name: 'a', type: 'string' }] }],
      behaviors: [{ name: 'B1', related_concepts: ['C1'] }],
    });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').concepts.map(c => c.name)).toEqual(['C1']);
  });

  it('M2：行为新 concept 标量优先，旧数组被忽略', () => {
    writeOntology({
      concepts: [
        { name: 'New', display_name: '新', attributes: [] },
        { name: 'Old', display_name: '旧', attributes: [] },
      ],
      behaviors: [{ name: 'B1', concept: 'New', related_concepts: ['Old'] }],
    });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').concepts.map(c => c.name)).toEqual(['New']);
  });

  it('M3：规则旧 related_behaviors 数组 → 标量 behavior，前置规则正确挂载', () => {
    writeOntology({
      behaviors: [{ name: 'B1', op_type: 'command', concept: 'C1' }],
      rules: [{ name: 'R1', position: '前置', related_behaviors: ['B1'], related_functions: [] }],
    });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').preRules.map(r => r.name)).toEqual(['R1']);
  });

  it('M4：规则新 behavior 标量 → 后置规则按行为精确挂载，不串行为', () => {
    writeOntology({
      behaviors: [{ name: 'B1', concept: 'C1' }, { name: 'B2', concept: 'C1' }],
      rules: [
        { name: 'R1', position: '后置', behavior: 'B1' },
        { name: 'R2', position: '后置', behavior: 'B2' },
      ],
    });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').postRules.map(r => r.name)).toEqual(['R1']);
    expect(gateway.getBehaviorMeta(SC, ON, 'B2').postRules.map(r => r.name)).toEqual(['R2']);
  });

  it('M5：无任何新字段的历史快照仍可加载（新字段取缺省）', () => {
    writeOntology({
      behaviors: [{ name: 'B1', related_concepts: ['C1'] }],
      rules: [{ name: 'R1', related_behaviors: ['B1'] }],
    });
    const meta = gateway.getBehaviorMeta(SC, ON, 'B1');
    expect(meta.preRules.map(r => r.name)).toEqual(['R1']);
    expect(meta.isWrite).toBe(false);
  });

  it('M6：旧 check_functions（已取消的独立判断字段）读时并入 related_functions', () => {
    writeOntology({
      behaviors: [{ name: 'B1', op_type: 'command', concept: 'C1' }],
      functions: [{ name: 'checkU', type: 'VALIDATION' }],
      rules: [{ name: 'R1', position: '前置', behavior: 'B1', check_functions: ['checkU'] }],
    });
    const rule = gateway.getBehaviorMeta(SC, ON, 'B1').preRules[0];
    expect(rule.related_functions).toEqual(['checkU']);
    expect(rule.judge_functions).toEqual(['checkU']);
  });
});

describe('契约 §7 判断函数解析（口径 B：类型即角色）', () => {
  const functions = [
    { name: 'checkU', type: 'VALIDATION' },
    { name: 'calcQ', type: 'CALCULATION' },
    { name: 'getCurrentDate' }, // 本体无此声明 → 视为公共函数（无类型）
  ];

  it('J1：本体且 type=VALIDATION 的关联函数入 judge_functions；CALCULATION 与公共函数不入', () => {
    writeOntology({
      behaviors: [{ name: 'B1', op_type: 'command', concept: 'C1' }],
      functions,
      rules: [{ name: 'R1', position: '前置', behavior: 'B1', related_functions: ['checkU', 'calcQ', 'getCurrentDate'] }],
    });
    const rule = gateway.getBehaviorMeta(SC, ON, 'B1').preRules[0];
    expect(rule.related_functions).toEqual(['checkU', 'calcQ', 'getCurrentDate']);
    expect(rule.judge_functions).toEqual(['checkU']);
  });

  it('J2：无 VALIDATION 型关联函数 → judge_functions 为空（纯留痕规则）', () => {
    writeOntology({
      behaviors: [{ name: 'B1' }],
      functions: [{ name: 'calcQ', type: 'CALCULATION' }],
      rules: [{ name: 'R1', position: '后置', behavior: 'B1', related_functions: ['calcQ'] }],
    });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').postRules[0].judge_functions).toEqual([]);
  });

  it('J3：getFunctionInfo 返回本体函数 type；公共函数 type 恒空串（不可能成为判断函数）', () => {
    writeOntology({ functions: [{ name: 'checkU', type: 'VALIDATION', display_name: '单位校验' }] });
    expect(gateway.getFunctionInfo(SC, ON, 'checkU')?.type).toBe('VALIDATION');
    expect(gateway.getFunctionInfo(SC, ON, 'getCurrentDate')?.type).toBe('');
  });
});
