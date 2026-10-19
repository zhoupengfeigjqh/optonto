/**
 * 概念继承（spec 005）前端纯函数单测：
 * 父概念候选防环、收窄规范化（与父等价即丢弃）、收窄预校验（只删不增 / 不超父 / 合法正则）。
 */
import { describe, it, expect } from 'vitest';
import type { Attribute, Concept } from '@/api/client';
import {
  descendantNames, parentCandidates, normalizeRestriction, validateRestriction, sameEnum,
} from './concept-inheritance';

const base: Attribute = {
  name: 'status',
  type: 'string',
  constraint: { enum: ['草稿', '审批中', '已通过'], pattern: '^[A-Z]+$' },
};

const amount: Attribute = { name: 'amount', type: 'number', constraint: { min: 0, max: 100 } };

const concepts: Concept[] = [
  { name: '单据', description: '' },
  { name: '采购单', description: '', sub_class_of: '单据' },
  { name: '紧急采购单', description: '', sub_class_of: '采购单' },
  { name: '无关', description: '' },
];

describe('父概念候选（防环）', () => {
  it('后代包含多级子概念', () => {
    expect(descendantNames(concepts, '单据')).toEqual(new Set(['采购单', '紧急采购单']));
  });

  it('候选排除自身与全部后代', () => {
    const names = parentCandidates(concepts, '单据').map(c => c.name);
    expect(names).toEqual(['无关']);
  });

  it('新建时（无当前名）不排除任何概念', () => {
    expect(parentCandidates(concepts, undefined)).toHaveLength(4);
  });
});

describe('收窄规范化', () => {
  it('与父枚举等价 → 不落盘', () => {
    expect(normalizeRestriction(base, { enum: ['草稿', '审批中', '已通过'] })).toBeUndefined();
  });

  it('真子集 → 保留', () => {
    expect(normalizeRestriction(base, { enum: ['草稿', '审批中'] })).toEqual({ enum: ['草稿', '审批中'] });
  });

  it('范围与父等价 → 不落盘；收窄 → 保留', () => {
    expect(normalizeRestriction(amount, { min: 0, max: 100 })).toBeUndefined();
    expect(normalizeRestriction(amount, { max: 10 })).toEqual({ max: 10 });
  });

  it('pattern 空串是显式清除，不能当作“等价”丢弃', () => {
    expect(normalizeRestriction(base, { pattern: '' })).toEqual({ pattern: '' });
    expect(normalizeRestriction(base, { pattern: '^[A-Z]+$' })).toBeUndefined();
  });

  it('sameEnum 容忍数字/字符串形态差异', () => {
    expect(sameEnum([1, 2], ['1', '2'])).toBe(true);
  });
});

describe('收窄预校验', () => {
  it('枚举只能删不能增', () => {
    expect(validateRestriction(base, { enum: ['草稿', '新增'] })).toContain('不能新增');
  });

  it('枚举不能删空', () => {
    expect(validateRestriction(base, { enum: [] })).toContain('不能为空');
  });

  it('范围不能超父', () => {
    expect(validateRestriction(amount, { max: 101 })).toContain('不能大于');
    expect(validateRestriction(amount, { min: -1 })).toContain('不能小于');
  });

  it('范围自身 min > max 被拦截', () => {
    expect(validateRestriction(amount, { min: 50, max: 10 })).toContain('最小值不能大于最大值');
  });

  it('模式必须合法，且允许任意调整', () => {
    expect(validateRestriction(base, { pattern: '([' })).toContain('不是合法正则');
    expect(validateRestriction(base, { pattern: '.+' })).toBeNull();
  });
});
