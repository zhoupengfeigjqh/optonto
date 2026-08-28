/**
 * 子任务字段契约单元测试 —— 声明表即单一事实源。
 * 核心断言：提示词字段表与 submit_plan schema 由同一张表生成，
 * 必填性（schema Optional）与提示词标记从机制上同源，不可能再漂移（guidance 漂移的回归防线）。
 */
import { describe, it, expect } from 'vitest';
import { Kind, OptionalKind } from '@sinclair/typebox';
import { SUBTASK_FIELDS, subtaskFieldsSchema, renderSubtaskFieldTable } from './subtask-contract.js';

describe('子任务字段契约 · 声明表', () => {
  it('12 个字段全量声明，与 SubTask 类型面一致', () => {
    expect(SUBTASK_FIELDS.map(f => f.name)).toEqual([
      'seq', 'behavior', 'function', 'params', 'description', 'guidance',
      'scenario_name', 'scenario_id', 'ontology_name', 'ontology_id',
      'depends_on', 'related_functions',
    ]);
  });

  it('schema 生成：required=false 自动包 Optional，required=true 直出', () => {
    const schema = subtaskFieldsSchema();
    // Optional 字段（含互斥对与 guidance——以 runtime 容忍度为准）
    for (const name of ['behavior', 'function', 'guidance', 'depends_on', 'related_functions']) {
      expect((schema[name] as any)[OptionalKind], `${name} 应为 Optional`).toBe('Optional');
    }
    // 必填字段
    for (const name of ['seq', 'params', 'description', 'scenario_name', 'scenario_id', 'ontology_name', 'ontology_id']) {
      expect((schema[name] as any)[OptionalKind], `${name} 应必填`).toBeUndefined();
      expect((schema[name] as any)[Kind]).toBeDefined();
    }
  });

  it('提示词表生成：12 行，无 marker 覆盖时标记与 required 同源', () => {
    const table = renderSubtaskFieldTable();
    const lines = table.split('\n');
    expect(lines[0]).toBe('| 字段 | 必填 | 说明 |');
    expect(lines).toHaveLength(2 + SUBTASK_FIELDS.length); // 表头 + 分隔 + 数据行
    for (const f of SUBTASK_FIELDS) {
      const row = lines.find(l => l.startsWith(`| ${f.name} |`));
      expect(row, `${f.name} 行缺失`).toBeDefined();
      const expectedMarker = f.marker ?? (f.required ? '✅' : '❌');
      expect(row).toContain(`| ${expectedMarker} |`);
      expect(row).toContain(f.prompt);
    }
  });

  it('guidance 漂移回归：schema Optional ⇒ 提示词必须标 ❌（不允许再出现 ✅/Optional 劈叉）', () => {
    const guidance = SUBTASK_FIELDS.find(f => f.name === 'guidance')!;
    expect(guidance.required).toBe(false);
    expect(guidance.marker).toBeUndefined(); // 无覆盖 → 标记跟随 required = ❌
    const row = renderSubtaskFieldTable().split('\n').find(l => l.startsWith('| guidance |'))!;
    expect(row).toContain('| ❌ |');
  });

  it('互斥对：behavior/function schema 均 Optional，提示词 behavior 标 ✅、function 标 ❌', () => {
    const behavior = SUBTASK_FIELDS.find(f => f.name === 'behavior')!;
    const fn = SUBTASK_FIELDS.find(f => f.name === 'function')!;
    expect(behavior.required).toBe(false);
    expect(fn.required).toBe(false);
    expect(behavior.marker).toBe('✅');
    expect(fn.marker).toBe('❌');
  });
});
