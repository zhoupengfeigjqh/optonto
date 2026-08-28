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

/** 写 ontology.yaml；behaviors/engines/securities 任意组合 */
function writeOntology(opts: { behaviors: any[]; data_engines?: any[]; securities?: any[] }): void {
  const doc: any = { behaviors: opts.behaviors };
  if (opts.data_engines) doc.data_engines = opts.data_engines;
  if (opts.securities) doc.securities = opts.securities;
  writeFileSync(join(ontoDir, 'ontology.yaml'), dump(doc), 'utf-8');
}

/** 写独立文件；wrap=true 用映射包裹形态，false 用裸列表形态（契约 §2 形态容忍） */
function writeOverlay(filename: string, key: string, items: any[], wrap: boolean): void {
  writeFileSync(join(ontoDir, filename), dump(wrap ? { [key]: items } : items), 'utf-8');
}

function httpEngine(behavior: string, method: string): any {
  return { behavior_name: behavior, engine_type: 'HTTP', target: { method, url: 'http://x' } };
}
function sqlEngine(behavior: string): any {
  return { behavior_name: behavior, engine_type: 'SQL', target: { method: 'POST', sql: 'select 1' } };
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
  it('O1：data_engines.yaml 存在 → 覆盖 ontology.yaml 旧段（POST 压过 GET → 判写）', () => {
    writeOntology({ behaviors: [{ name: 'B1' }], data_engines: [httpEngine('B1', 'GET')] });
    writeOverlay('data_engines.yaml', 'data_engines', [httpEngine('B1', 'POST')], true);
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').isWrite).toBe(true);
  });

  it('O2：data_engines.yaml 不存在 → 回退 ontology.yaml 旧段', () => {
    writeOntology({ behaviors: [{ name: 'B1' }], data_engines: [httpEngine('B1', 'POST')] });
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').isWrite).toBe(true);
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
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').isWrite).toBe(true);
  });

  it('O5：独立文件映射包裹形态 → 等价接受', () => {
    writeOntology({ behaviors: [{ name: 'B1' }] });
    writeOverlay('data_engines.yaml', 'data_engines', [httpEngine('B1', 'POST')], true);
    expect(gateway.getBehaviorMeta(SC, ON, 'B1').isWrite).toBe(true);
  });
});

describe('契约 §3 操作类型推导（isWrite）', () => {
  function isWrite(behavior: any, engines?: any[]): boolean {
    writeOntology({ behaviors: [behavior], ...(engines ? { data_engines: engines } : {}) });
    return gateway.getBehaviorMeta(SC, ON, behavior.name).isWrite;
  }

  it('T1：op_type=command 显式优先（SQL 引擎也判写）', () => {
    expect(isWrite({ name: 'B1', op_type: 'command' }, [sqlEngine('B1')])).toBe(true);
  });

  it('T2：op_type=query 显式优先（POST 引擎也判读）', () => {
    expect(isWrite({ name: 'B1', op_type: 'query' }, [httpEngine('B1', 'POST')])).toBe(false);
  });

  it('T3：空 op_type + HTTP POST → command', () => {
    expect(isWrite({ name: 'B1' }, [httpEngine('B1', 'POST')])).toBe(true);
  });

  it('T4：空 op_type + HTTP GET → query', () => {
    expect(isWrite({ name: 'B1' }, [httpEngine('B1', 'GET')])).toBe(false);
  });

  it('T5：空 op_type + SQL 引擎（即使 method=POST）→ query', () => {
    expect(isWrite({ name: 'B1' }, [sqlEngine('B1')])).toBe(false);
  });

  it('T6：空 op_type + 无引擎 → query', () => {
    expect(isWrite({ name: 'B1' })).toBe(false);
  });

  it('T7：method 小写 post → command（大小写不敏感）', () => {
    expect(isWrite({ name: 'B1' }, [httpEngine('B1', 'post')])).toBe(true);
  });
});
