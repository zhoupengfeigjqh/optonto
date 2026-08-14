/**
 * legalCallNames 单元测试 —— 合法调用名集合（子 Agent 白名单）的单一事实源。
 * 验证：主行为恒在、data_supplements 并入 behaviors、related_functions 剔除公共函数后并入 functions、去重。
 */
import { describe, it, expect } from 'vitest';
import { legalCallNames } from './legal-calls.js';
import type { BehaviorMeta } from '../types.js';

describe('legalCallNames', () => {
  it('无规则：behaviors 只含主行为，functions 为空', () => {
    const meta: BehaviorMeta = { params: {}, preRules: [], postRules: [], concepts: [], isWrite: true };
    expect(legalCallNames(meta, 'CreatePurchaseRecord')).toEqual({
      behaviors: ['CreatePurchaseRecord'],
      functions: [],
    });
  });

  it('有规则：data_supplements 并入 behaviors，related_functions 剔除公共函数后并入 functions', () => {
    const meta: BehaviorMeta = {
      params: {},
      preRules: [
        { name: 'V01', description: '', position: '前置', related_behaviors: ['CreatePurchaseRecord'], data_supplements: ['QueryRawMaterials'], related_functions: ['getCurrentDate'] },
      ],
      postRules: [
        { name: 'I02', description: '', position: '后置', related_behaviors: ['CreatePurchaseRecord'], data_supplements: ['QueryRawMaterials', 'QueryInventory'], related_functions: ['calcSafetyStock', 'getCurrentDate'] },
      ],
      concepts: [],
      isWrite: true,
    };
    expect(legalCallNames(meta, 'CreatePurchaseRecord')).toEqual({
      behaviors: ['CreatePurchaseRecord', 'QueryRawMaterials', 'QueryInventory'],
      functions: ['calcSafetyStock'],
    });
  });

  it('主行为在 data_supplements 里重复出现 → 去重', () => {
    const meta: BehaviorMeta = {
      params: {},
      preRules: [{ name: 'V01', description: '', position: '前置', related_behaviors: ['CreatePurchaseRecord'], data_supplements: ['CreatePurchaseRecord'], related_functions: [] }],
      postRules: [],
      concepts: [],
      isWrite: true,
    };
    expect(legalCallNames(meta, 'CreatePurchaseRecord').behaviors).toEqual(['CreatePurchaseRecord']);
  });
});
