/**
 * 规则纯逻辑单测（2026-09-30 随条件树退役精简）：仅覆盖数据补充自动推导。
 */
import { describe, it, expect } from 'vitest';
import { deriveDataSupplements } from './rule-logic';

const funcs = [
  { name: 'checkUnit', related_concepts: ['RawMaterial'] },
  { name: 'getCurrentDate', related_concepts: [] },
];

const behaviors = [
  { name: 'CreatePurchaseRecord', op_type: 'command', concept: 'PurchaseRecord' },
  { name: 'QueryPurchaseRecords', op_type: 'query', concept: 'PurchaseRecord' },
  { name: 'SearchPurchaseRecords', op_type: 'query', concept: 'PurchaseRecord' },
  { name: 'QueryRawMaterials', op_type: 'query', concept: 'RawMaterial' },
];

describe('deriveDataSupplements — 数据补充自动推导', () => {
  it('按关联函数声明的关联概念推导 query 行为', () => {
    const out = deriveDataSupplements({ behavior: 'CreatePurchaseRecord', relatedFunctions: ['checkUnit'], funcs, behaviors });
    expect(out).toEqual(['QueryRawMaterials']);
  });

  it('排除规则自身绑定的行为', () => {
    const out = deriveDataSupplements({
      behavior: 'QueryPurchaseRecords', relatedFunctions: ['f1'],
      funcs: [{ name: 'f1', related_concepts: ['PurchaseRecord'] }], behaviors,
    });
    expect(out).toContain('SearchPurchaseRecords');
    expect(out).not.toContain('QueryPurchaseRecords');
  });

  it('关联函数未声明关联概念时为空数组', () => {
    const out = deriveDataSupplements({ behavior: 'CreatePurchaseRecord', relatedFunctions: ['getCurrentDate'], funcs, behaviors });
    expect(out).toEqual([]);
  });

  it('无关联函数时为空数组', () => {
    expect(deriveDataSupplements({ behavior: '', relatedFunctions: [], funcs, behaviors })).toEqual([]);
  });
});
