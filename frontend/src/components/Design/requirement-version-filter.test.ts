/**
 * 需求汇总版本筛选：纯函数契约测试（章程 III：纯函数同名同目录单测）。
 *
 * 这里穷举的是「规则」而不是 DOM：
 * - 保留值与展示文本不得混用（版本号字面可能就叫「全部」）
 * - 自然降序（v1.10 在 v1.9 之前）、非语义化版本号、大小写不合并
 * - 选项 = 全部 + 真实存在的版本 +「未填写版本」置末，无死选项
 * - 过滤保持原顺序；未知选择返回空（由调用方派生校正）
 * - 选中项失效回落到「全部」
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_VERSIONS,
  UNSET_VERSION,
  ALL_VERSIONS_LABEL,
  UNSET_VERSION_LABEL,
  normalizeVersion,
  versionKeyOf,
  compareVersionDesc,
  buildVersionOptions,
  filterByVersion,
  resolveSelectionAfterChange,
} from './requirement-version-filter';

const item = (version: string | null | undefined, filename = 'doc.md') => ({ version, filename });

describe('保留值与展示文本', () => {
  it('保留值不与中文展示文本混用', () => {
    expect(ALL_VERSIONS).not.toBe(ALL_VERSIONS_LABEL);
    expect(UNSET_VERSION).not.toBe(UNSET_VERSION_LABEL);
    expect(ALL_VERSIONS).not.toBe(UNSET_VERSION);
  });
});

describe('normalizeVersion / versionKeyOf', () => {
  it('去首尾空格', () => {
    expect(normalizeVersion('  v1.0  ')).toBe('v1.0');
  });

  it('空值统一为空串', () => {
    expect(normalizeVersion(null)).toBe('');
    expect(normalizeVersion(undefined)).toBe('');
    expect(normalizeVersion('   ')).toBe('');
  });

  it('不折叠大小写', () => {
    expect(normalizeVersion('V1.0')).toBe('V1.0');
    expect(normalizeVersion('V1.0')).not.toBe(normalizeVersion('v1.0'));
  });

  it('versionKeyOf 与 normalizeVersion 一致', () => {
    expect(versionKeyOf(item(' v1.0 '))).toBe('v1.0');
    expect(versionKeyOf({})).toBe('');
    expect(versionKeyOf(item(null))).toBe('');
  });
});

describe('compareVersionDesc（自然降序）', () => {
  it('v1.10 比 v1.9 新', () => {
    expect(compareVersionDesc('v1.10', 'v1.9')).toBeLessThan(0);
    expect(compareVersionDesc('v1.9', 'v1.10')).toBeGreaterThan(0);
  });

  it('多段版本按数值逐段比较', () => {
    const sorted = ['v1.9', 'v2.0', 'v1.10', 'v1.2'].sort(compareVersionDesc);
    expect(sorted).toEqual(['v2.0', 'v1.10', 'v1.9', 'v1.2']);
  });

  it('前缀更短视为更旧', () => {
    expect(compareVersionDesc('v1.0', 'v1')).toBeLessThan(0);
  });

  it('非语义化版本号也能排出确定顺序', () => {
    const sorted = ['v1.0-beta', '2026-11-20', 'v1.0'].sort(compareVersionDesc);
    expect(sorted).toHaveLength(3);
    // 只要求可排序且幂等，不锁死具体相对次序（日期段与字母段混排）
    expect([...sorted].sort(compareVersionDesc)).toEqual(sorted);
  });

  it('相等返回 0', () => {
    expect(compareVersionDesc('v1.0', 'v1.0')).toBe(0);
  });
});

describe('buildVersionOptions', () => {
  it('无数据时只有「全部」', () => {
    const options = buildVersionOptions([]);
    expect(options).toEqual([{ value: ALL_VERSIONS, label: ALL_VERSIONS_LABEL }]);
  });

  it('单一版本时只有「全部」和该版本（仍出现控件）', () => {
    const options = buildVersionOptions([item('v1.0')]);
    expect(options.map(o => o.value)).toEqual([ALL_VERSIONS, 'v1.0']);
  });

  it('按自然降序排列', () => {
    const options = buildVersionOptions([item('v1.9'), item('v2.0'), item('v1.10')]);
    expect(options.slice(1).map(o => o.label)).toEqual(['v2.0', 'v1.10', 'v1.9']);
  });

  it('去重（含 trim 后相同）', () => {
    const options = buildVersionOptions([item('v1.0'), item(' v1.0 '), item('v2.0')]);
    expect(options.map(o => o.value)).toEqual([ALL_VERSIONS, 'v2.0', 'v1.0']);
  });

  it('大小写不同视为两个版本', () => {
    const options = buildVersionOptions([item('v1.0'), item('V1.0')]);
    expect(options).toHaveLength(3);
  });

  it('未填写版本置末，且仅出现一次', () => {
    const options = buildVersionOptions([item(''), item(null), item(undefined), item('v1.0')]);
    expect(options[options.length - 1]).toEqual({ value: UNSET_VERSION, label: UNSET_VERSION_LABEL });
    expect(options.filter(o => o.value === UNSET_VERSION)).toHaveLength(1);
  });

  it('没有空版本时不出现「未填写版本」', () => {
    expect(buildVersionOptions([item('v1.0')]).some(o => o.value === UNSET_VERSION)).toBe(false);
  });

  it('不出现数据中不存在的版本号（无死选项）', () => {
    const options = buildVersionOptions([item('v1.0'), item('')]);
    expect(options.map(o => o.value)).toEqual([ALL_VERSIONS, 'v1.0', UNSET_VERSION]);
  });

  it('版本号字面等于「全部」时仍作为独立可选项', () => {
    const options = buildVersionOptions([item('全部')]);
    const hit = options.find(o => o.value === '全部');
    expect(hit).toEqual({ value: '全部', label: '全部' });
    // 与哨兵项同 label 但 value 不同，不会互相吞掉
    expect(options.find(o => o.value === ALL_VERSIONS)?.label).toBe(ALL_VERSIONS_LABEL);
  });
});

describe('filterByVersion', () => {
  const items = [item('v1.0', 'a.md'), item('', 'b.md'), item('v2.0', 'c.md'), item('v1.0', 'd.md')];

  it('「全部」返回等长等序的子集', () => {
    const result = filterByVersion(items, ALL_VERSIONS);
    expect(result.map(i => i.filename)).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
  });

  it('按版本过滤并保持原顺序', () => {
    expect(filterByVersion(items, 'v1.0').map(i => i.filename)).toEqual(['a.md', 'd.md']);
  });

  it('「未填写版本」只命中空版本', () => {
    expect(filterByVersion(items, UNSET_VERSION).map(i => i.filename)).toEqual(['b.md']);
  });

  it('未知选择返回空数组（由调用方校正）', () => {
    expect(filterByVersion(items, 'v9.9')).toEqual([]);
  });

  it('不修改入参', () => {
    const snapshot = [...items];
    filterByVersion(items, 'v1.0');
    expect(items).toEqual(snapshot);
  });
});

describe('resolveSelectionAfterChange', () => {
  const options = buildVersionOptions([item('v1.0'), item('')]);

  it('选中项仍存在时原样返回', () => {
    expect(resolveSelectionAfterChange(options, 'v1.0')).toBe('v1.0');
  });

  it('选中项消失时回落到「全部」', () => {
    expect(resolveSelectionAfterChange(options, 'v0.9')).toBe(ALL_VERSIONS);
  });

  it('传入「全部」时恒为「全部」', () => {
    expect(resolveSelectionAfterChange(options, ALL_VERSIONS)).toBe(ALL_VERSIONS);
  });
});

describe('性能口径（SC-003：500 条过滤 < 20ms）', () => {
  it('filterByVersion 在 500 条数据上足够快', () => {
    const many = Array.from({ length: 500 }, (_, i) => item(`v1.${i % 50}`));
    const started = performance.now();
    const result = filterByVersion(many, 'v1.10');
    const elapsed = performance.now() - started;
    expect(result.length).toBe(10);
    expect(elapsed).toBeLessThan(20);
  });
});
