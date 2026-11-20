/**
 * 引用存量本体的纯逻辑单测（章程 III：抽出的核心模块必须同时补测并纳入覆盖率门禁）。
 *
 * 锁住四条不可回归的约定：
 * 1. select value 与提交载荷互逆（名称含 `/`、空格、分隔符时不串味）；
 * 2. 当前对话所属本体不出现、不可引用项置灰且带原因；
 * 3. 「原本体已不存在」按 `场景 id / 本体 id` 判定（跨场景同 id 不误判）；
 * 4. 冲突按类型分组，差异为空时不产出空行。
 */
import { describe, it, expect } from 'vitest';
import type { OntologyRefCandidate, RefConflict } from '@/api/ontology-refs';
import {
  REF_EMPTY_TEXT, REF_HINT_TEXT, clampSelection, conflictKindLabel, formatSnapshotTime,
  groupConflicts, missingRefIds, parseRefKey, refIdentityKey, refKeyOf, sanitizeRefName,
  toRefInputs, toSelectOptions,
} from './conversation-ontology-refs';

const candidate = (over: Partial<OntologyRefCandidate> = {}): OntologyRefCandidate => ({
  ontology_id: '12',
  scenario_id: '3',
  scenario_name: '订单场景',
  ontology_name: '货品BOM及工艺',
  description: 'BOM 与工艺路线',
  deployed_version: 'v1.2',
  counts: { concepts: 6, functions: 4, behaviors: 11 },
  referenceable: true,
  skip_reason: null,
  ...over,
});

describe('refKeyOf / parseRefKey', () => {
  it('is reversible for names with slash and spaces', () => {
    const ref = { scenario_name: '库存/仓储', ontology_name: 'ABC 模型' };
    expect(parseRefKey(refKeyOf(ref))).toEqual(ref);
  });

  it('folds the separator and control characters in names', () => {
    // 与后端 _clean 同口径：控制字符与连续空白都折叠为单个空格
    expect(sanitizeRefName('A\u0000B\r\nC')).toBe('A B C');
    expect(sanitizeRefName('  A   B  ')).toBe('A B');
    const ref = { scenario_name: 'A\u0000B', ontology_name: 'C\nD' };
    const key = refKeyOf(ref);
    expect(key.split('\u0000')).toHaveLength(2);
    expect(parseRefKey(key)).toEqual({ scenario_name: 'A B', ontology_name: 'C D' });
  });

  it('parses keys without separator defensively', () => {
    expect(parseRefKey('only')).toEqual({ scenario_name: 'only', ontology_name: '' });
  });

  it('toRefInputs maps values back to payload', () => {
    const values = [refKeyOf({ scenario_name: 's1', ontology_name: 'o1' })];
    expect(toRefInputs(values)).toEqual([{ scenario_name: 's1', ontology_name: 'o1' }]);
  });
});

describe('toSelectOptions', () => {
  it('uses「场景 - 本体」as label and carries the second-line data', () => {
    const [option] = toSelectOptions([candidate()]);
    expect(option.label).toBe('订单场景 - 货品BOM及工艺');
    expect(option.description).toBe('BOM 与工艺路线');
    expect(option.deployed_version).toBe('v1.2');
    expect(option.counts).toEqual({ concepts: 6, functions: 4, behaviors: 11 });
    expect(option.disabled).toBe(false);
    expect(option.reason).toBeUndefined();
  });

  it('excludes the current ontology', () => {
    const options = toSelectOptions(
      [candidate(), candidate({ ontology_id: '13', ontology_name: '订单排程' })],
      { scenario_name: '订单场景', ontology_name: '订单排程' },
    );
    expect(options.map(o => o.label)).toEqual(['订单场景 - 货品BOM及工艺']);
  });

  it('marks unreferenceable options disabled with reason', () => {
    const [option] = toSelectOptions([
      candidate({ referenceable: false, skip_reason: '暂无可提取内容' }),
    ]);
    expect(option.disabled).toBe(true);
    expect(option.reason).toBe('暂无可提取内容');
  });

  it('deduplicates identical scenario+ontology', () => {
    expect(toSelectOptions([candidate(), candidate()])).toHaveLength(1);
  });

  it('exposes empty / hint copy', () => {
    expect(REF_EMPTY_TEXT).toContain('没有可引用');
    expect(REF_HINT_TEXT).toContain('同名概念属性');
  });
});

describe('formatSnapshotTime', () => {
  it('formats to local YYYY-MM-DD HH:mm', () => {
    const iso = new Date(2026, 10, 20, 14, 5).toISOString();
    expect(formatSnapshotTime(iso)).toBe('2026-11-20 14:05');
  });

  it('returns dash for empty or invalid input', () => {
    expect(formatSnapshotTime('')).toBe('-');
    expect(formatSnapshotTime('not-a-date')).toBe('-');
  });
});

describe('missingRefIds', () => {
  it('matches by scenario id + ontology id', () => {
    const keys = new Set([refIdentityKey({ scenario_id: '3', ontology_id: '12' })]);
    const missing = missingRefIds([{ scenario_id: '3', ontology_id: '12' }], keys);
    expect(missing.size).toBe(0);
  });

  it('does not confuse same ontology id across scenarios', () => {
    const keys = new Set([refIdentityKey({ scenario_id: '3', ontology_id: '12' })]);
    const missing = missingRefIds([{ scenario_id: '4', ontology_id: '12' }], keys);
    expect(missing.size).toBe(1);
  });
});

describe('conflicts', () => {
  const conflicts: RefConflict[] = [
    {
      kind: 'cross_category_duplicate',
      name: 'Inventory',
      category: ['concept', 'function'],
      participants: [],
      differences: [],
    },
    {
      kind: 'concept_attribute_mismatch',
      name: 'Order',
      participants: [],
      differences: ['amount：number ≠ string', ''],
    },
  ];

  it('labels both kinds', () => {
    expect(conflictKindLabel('concept_attribute_mismatch')).toBe('同名概念属性不一致');
    expect(conflictKindLabel('cross_category_duplicate')).toBe('同一名称跨类目使用');
  });

  it('groups by kind in fixed order and drops empty diff lines', () => {
    const groups = groupConflicts(conflicts);
    expect(groups.map(g => g.title)).toEqual(['同名概念属性不一致', '同一名称跨类目使用']);
    expect(groups[0].items[0]).toEqual({ name: 'Order', lines: ['amount：number ≠ string'] });
    expect(groups[1].items[0].lines).toEqual([]);
  });
});

describe('clampSelection', () => {
  it('keeps selection when within limit', () => {
    expect(clampSelection(['a', 'b'], 5)).toEqual({ values: ['a', 'b'], truncated: false });
  });

  it('truncates and reports when over limit', () => {
    expect(clampSelection(['a', 'b', 'c'], 2)).toEqual({ values: ['a', 'b'], truncated: true });
  });

  it('does not clamp when limit is non-positive', () => {
    expect(clampSelection(['a'], 0)).toEqual({ values: ['a'], truncated: false });
  });
});
