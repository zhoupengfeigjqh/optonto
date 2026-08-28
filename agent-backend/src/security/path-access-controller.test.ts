/**
 * PathAccessController 单元测试 —— 收窄后的签名即测试面（真实 fs 临时目录）。
 * 覆盖：技能/线程路径解析、路径穿越拒绝、线程全局平铺语义（不收 scenario/ontology）、
 * 技能文件存在性校验。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathAccessController, ForbiddenError } from './path-access-controller.js';

let root: string;
let dataDir: string;
let threadsDir: string;
let pac: PathAccessController;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pac-test-'));
  dataDir = join(root, 'data');
  threadsDir = join(root, 'threads');
  // 技能文件：data/onto_market/生产调度/原材料采购和库存/skills/采购技能/SKILL.md
  const skillDir = join(dataDir, 'onto_market', '生产调度', '原材料采购和库存', 'skills', '采购技能');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# 采购技能');
  pac = new PathAccessController(dataDir, threadsDir);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveReadPath（技能文件，只读）', () => {
  it('合法四元组 → 解析到 SKILL.md 真实路径', () => {
    const p = pac.resolveReadPath('生产调度', '原材料采购和库存', '采购技能', 'SKILL.md');
    expect(p).toBe(join(dataDir, 'onto_market', '生产调度', '原材料采购和库存', 'skills', '采购技能', 'SKILL.md'));
  });

  it('路径穿越组件（.. / 斜杠）→ ForbiddenError', () => {
    expect(() => pac.resolveReadPath('..', '原材料采购和库存', '采购技能')).toThrow(ForbiddenError);
    expect(() => pac.resolveReadPath('生产调度', '../..', '采购技能')).toThrow(ForbiddenError);
    expect(() => pac.resolveReadPath('生产调度', '原材料采购和库存', 'a/b')).toThrow(ForbiddenError);
    expect(() => pac.resolveReadPath('生产调度', '原材料采购和库存', 'a\\b')).toThrow(ForbiddenError);
  });

  it('技能文件不存在 → ForbiddenError（存在性校验）', () => {
    expect(() => pac.resolveReadPath('生产调度', '原材料采购和库存', '不存在技能')).toThrow(ForbiddenError);
  });
});

describe('线程路径（全局平铺，不收 scenario/ontology）', () => {
  it('resolveWritePath(threadId) → {threadsDir}/agent/{threadId}', () => {
    expect(pac.resolveWritePath('t-1')).toBe(join(threadsDir, 'agent', 't-1'));
    expect(pac.resolveWritePath('t-1', '.data.json')).toBe(join(threadsDir, 'agent', 't-1', '.data.json'));
  });

  it('resolveWritePath 拒绝路径穿越 threadId', () => {
    expect(() => pac.resolveWritePath('..')).toThrow(ForbiddenError);
    expect(() => pac.resolveWritePath('a/b')).toThrow(ForbiddenError);
  });

  it('resolveThreadReadPath(threadId) → 平铺目录下 .data.json', () => {
    expect(pac.resolveThreadReadPath('t-9')).toBe(join(threadsDir, 'agent', 't-9', '.data.json'));
  });

  it('listThreadDirs() → 平铺根目录（无场景/本体参数）', () => {
    expect(pac.listThreadDirs()).toBe(join(threadsDir, 'agent'));
  });
});
