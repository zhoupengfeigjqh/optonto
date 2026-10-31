/**
 * OntologyGateway 契约测试 —— 镜像 specs/contracts/ontology-yaml.md 用例表（O1-O5 / T1-T7）。
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

function mcpEngine(behavior: string, tool: string): any {
  // 引擎唯一形态为 MCP（target.url/method 已于 2026-10-31 从 schema 删除）
  return { behavior_name: behavior, target: { server_url: 'http://x/mcp', tool_name: tool } };
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
    writeOntology({ behaviors: [{ name: 'B1' }], data_engines: [mcpEngine('B1', 'query_a')] });
    writeOverlay('data_engines.yaml', 'data_engines', [mcpEngine('B1', 'query_b')], true);
    expect(loadedEngines()[0].target.tool_name).toBe('query_b');
  });

  it('O2：data_engines.yaml 不存在 → 回退 ontology.yaml 旧段', () => {
    writeOntology({ behaviors: [{ name: 'B1' }], data_engines: [mcpEngine('B1', 'query_b')] });
    expect(loadedEngines()[0].target.tool_name).toBe('query_b');
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
    writeOverlay('data_engines.yaml', 'data_engines', [mcpEngine('B1', 'query_b')], false);
    expect(loadedEngines()).toHaveLength(1);
  });

  it('O5：独立文件映射包裹形态 → 等价接受', () => {
    writeOntology({ behaviors: [{ name: 'B1' }] });
    writeOverlay('data_engines.yaml', 'data_engines', [mcpEngine('B1', 'query_b')], true);
    expect(loadedEngines()).toHaveLength(1);
  });
});

describe('契约 §3 操作类型推导（isWrite）——2026-09-07 起引擎不参与推导，空 op_type 一律判读', () => {
  function isWrite(behavior: any, engines?: any[]): boolean {
    writeOntology({ behaviors: [behavior], ...(engines ? { data_engines: engines } : {}) });
    return gateway.getBehaviorMeta(SC, ON, behavior.name).isWrite;
  }

  it('T1：op_type=command → 判写', () => {
    expect(isWrite({ name: 'B1', op_type: 'command' }, [mcpEngine('B1', 'query_tool')])).toBe(true);
  });

  it('T2：op_type=query 显式 → 判读', () => {
    expect(isWrite({ name: 'B1', op_type: 'query' }, [mcpEngine('B1', 'query_tool')])).toBe(false);
  });

  it('T3：空 op_type + 有引擎 → query（引擎不参与推导）', () => {
    expect(isWrite({ name: 'B1' }, [mcpEngine('B1', 'query_tool')])).toBe(false);
  });

  it('T4：空 op_type + 无引擎 → query', () => {
    expect(isWrite({ name: 'B1' })).toBe(false);
  });
});

describe('契约 §6 字段契约与旧格式迁移（spec 003）', () => {
  it('M1：行为旧 related_concepts 数组 → 标量 concept 参与概念解析', () => {
    writeOntology({
      concepts: [{ name: 'C1', title: '概念一', attributes: [{ name: 'a', type: 'string' }] }],
      behaviors: [{ name: 'B1', related_concepts: ['C1'] }],
    });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').concepts.map(c => c.name)).toEqual(['C1']);
  });

  it('M2：行为新 concept 标量优先，旧数组被忽略', () => {
    writeOntology({
      concepts: [
        { name: 'New', title: '新', attributes: [] },
        { name: 'Old', title: '旧', attributes: [] },
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

describe('spec 005 概念继承（subClassOf）', () => {
  it('I1：子概念继承父属性并按收窄合成（枚举子集 / 范围收窄）', () => {
    writeOntology({
      concepts: [
        {
          name: 'Base',
          attributes: [
            { name: 'status', type: 'string', constraint: { enum: ['a', 'b', 'c'] } },
            { name: 'amount', type: 'number', constraint: { min: 0, max: 100 } },
          ],
        },
        {
          name: 'Child',
          sub_class_of: 'Base',
          attributes: [{ name: 'x', type: 'string' }],
          attribute_restrictions: { status: { enum: ['a', 'b'] }, amount: { max: 10 } },
        },
      ],
      behaviors: [{ name: 'B1', concept: 'Child' }],
    });
    const attrs = gateway.getBehaviorMeta(SC, ON, 'B1').concepts[0].attributes;
    expect(attrs.map(a => a.name)).toEqual(['x', 'status', 'amount']);
    expect(attrs.find(a => a.name === 'status')?.constraint?.enum).toEqual(['a', 'b']);
    expect(attrs.find(a => a.name === 'amount')?.constraint?.max).toBe(10);
  });

  it('I2：多级继承逐层收窄；同名自有声明按继承优先剔除', () => {
    writeOntology({
      concepts: [
        { name: 'Base', attributes: [{ name: 'status', type: 'string', constraint: { enum: ['a', 'b', 'c'] } }] },
        { name: 'Mid', sub_class_of: 'Base', attribute_restrictions: { status: { enum: ['a', 'b'] } } },
        {
          name: 'Leaf',
          sub_class_of: 'Mid',
          attributes: [{ name: 'status', type: 'number', constraint: { min: 1, max: 9 } }],
          attribute_restrictions: { status: { enum: ['a'] } },
        },
      ],
      behaviors: [{ name: 'B1', concept: 'Leaf' }],
    });
    const attrs = gateway.getBehaviorMeta(SC, ON, 'B1').concepts[0].attributes;
    expect(attrs).toHaveLength(1);
    expect(attrs[0].type).toBe('string');
    expect(attrs[0].constraint?.enum).toEqual(['a']);
  });

  it('I3：环 / 悬空父概念不抛错（运行面容错优先）', () => {
    writeOntology({
      concepts: [
        { name: 'A', sub_class_of: 'B', attributes: [{ name: 'a', type: 'string' }] },
        { name: 'B', sub_class_of: 'A', attributes: [{ name: 'b', type: 'string' }] },
        { name: 'Orphan', sub_class_of: 'Ghost', attributes: [{ name: 'o', type: 'string' }] },
      ],
      behaviors: [{ name: 'B1', concept: 'A' }, { name: 'B2', concept: 'Orphan' }],
    });
    expect(() => gateway.getBehaviorMeta(SC, ON, 'B1')).not.toThrow();
    const orphan = gateway.getBehaviorMeta(SC, ON, 'B2').concepts[0].attributes;
    expect(orphan.map(a => a.name)).toEqual(['o']);
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
    writeOntology({ functions: [{ name: 'checkU', type: 'VALIDATION', title: '单位校验' }] });
    expect(gateway.getFunctionInfo(SC, ON, 'checkU')?.type).toBe('VALIDATION');
    expect(gateway.getFunctionInfo(SC, ON, 'getCurrentDate')?.type).toBe('');
  });
});

describe('契约 §6 就绪发布：getReadyBehaviorNames（与 data-engine-mcp 发布判据同源）', () => {
  /** MCP 型引擎（唯一形态）；over 用于构造半成品/已删除类型等异常 */
  const mcpEngine = (behavior: string, over: any = {}): any => ({
    behavior_name: behavior, target: { server_url: 'http://downstream/mcp', tool_name: 't' }, ...over,
  });

  it('R1：只有配好可用引擎的行为才就绪；花名册仍列全部（设计期视角不变）', () => {
    writeOntology({ behaviors: [{ name: 'B1' }, { name: 'B2' }], data_engines: [mcpEngine('B1')] });
    expect(gateway.getBehaviorNames(SC, ON)).toEqual(['B1', 'B2']);
    expect(gateway.getReadyBehaviorNames(SC, ON)).toEqual(['B1']);
  });

  it('R2：半成品引擎（缺 tool_name）不算就绪', () => {
    writeOntology({
      behaviors: [{ name: 'B1' }],
      data_engines: [mcpEngine('B1', { target: { server_url: 'http://x/mcp' } })],
    });
    expect(gateway.getReadyBehaviorNames(SC, ON)).toEqual([]);
  });

  it('R3：engine_type 非 MCP（已删除类型）不算就绪；缺省即 MCP', () => {
    writeOntology({
      behaviors: [{ name: 'B1' }, { name: 'B2' }],
      data_engines: [mcpEngine('B1', { engine_type: 'SQL' }), mcpEngine('B2')],
    });
    expect(gateway.getReadyBehaviorNames(SC, ON)).toEqual(['B2']);
  });

  it('R4：无引擎 / 无 behaviors → 空集（不误报）', () => {
    writeOntology({ behaviors: [{ name: 'B1' }] });
    expect(gateway.getReadyBehaviorNames(SC, ON)).toEqual([]);
    writeOntology({});
    expect(gateway.getReadyBehaviorNames(SC, ON)).toEqual([]);
  });
});

/**
 * fail-closed：元数据不可用时按最坏假设处置（2026-10-05 安全收口，agent 环节审查 M7）。
 *
 * 背景：`loadOntologyData` 读不到配置时返回 null，而 `getBehaviorMeta` 曾静默返回
 * `isWrite: false`（= 按读操作处理）——于是**配置读取失败的瞬间，写操作零人工确认直接落库**，
 * 失效方向最危险，且与系统其余 fail-closed 姿态（判断函数缺 pass、按名查不到工具等）不一致。
 *
 * 本组固化修复后的语义：`unavailable` 置位 + `isWrite: true`（兜底双重保险），
 * 由 SubtaskRunner 就地拒绝执行、真实工具零调用。
 */
describe('fail-closed：元数据不可用（unavailable）', () => {
  it('F1：ontology.yaml 缺失 → unavailable + isWrite=true（不再静默按读操作放行）', () => {
    // beforeEach 只建目录、不写 yaml —— 默认即"文件不存在"形态
    const meta = gateway.getBehaviorMeta(SC, ON, 'B1');
    expect(meta.unavailable).toBe(true);
    expect(meta.isWrite).toBe(true);
  });

  it('F2：ontology.yaml 语法错误 → 同为 unavailable（解析失败与文件缺失不可区分，一律最坏假设）', () => {
    writeFileSync(join(ontoDir, 'ontology.yaml'), 'behaviors: [ 坏语法: :', 'utf-8');
    const meta = gateway.getBehaviorMeta(SC, ON, 'B1');
    expect(meta.unavailable).toBe(true);
    expect(meta.isWrite).toBe(true);
  });

  it('F3：行为名不在本体 behaviors[] 内 → unavailable（拿不到 op_type，无法判定写入性质）', () => {
    // 纵深防御：正常路径 PlanGate 行为名校验先拦；这里覆盖"规划确认停留期间本体被改"的时间窗
    writeOntology({ behaviors: [{ name: 'B1', op_type: 'command' }] });
    const meta = gateway.getBehaviorMeta(SC, ON, 'NotExist');
    expect(meta.unavailable).toBe(true);
    expect(meta.isWrite).toBe(true);
  });

  it('F4：unavailable 时 title 兜底为行为名（执行记录不显示成空）', () => {
    expect(gateway.getBehaviorMeta(SC, ON, 'CreatePurchaseRecord').title).toBe('CreatePurchaseRecord');
  });

  it('F5：元数据可用 → 不置 unavailable（防误伤：正常本体行为完全不受影响）', () => {
    writeOntology({ behaviors: [{ name: 'B1', op_type: 'command' }] });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').unavailable).toBeUndefined();
  });

  it('F6：securities 未登记 ≠ 元数据不可用 —— 不置 unavailable，写操作仍强制确认', () => {
    // 两种语义必须分开：「元数据可用但未登记」是正常业务状态（securities 是全花名册，
    // core 保存时保证每个行为恒定一条），走 isWrite 兜底 + everyone 放行；
    // 「元数据读不到」是系统故障，unavailable + 就地拒绝执行。
    writeOntology({ behaviors: [{ name: 'B1', op_type: 'command' }] });
    const meta = gateway.getBehaviorMeta(SC, ON, 'B1');
    expect(meta.unavailable).toBeUndefined();
    expect(meta.security).toBeUndefined();
    expect(meta.isWrite).toBe(true); // 写操作仍强制人工确认，未被"未登记"绕过
  });
});
