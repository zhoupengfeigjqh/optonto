/**
 * 关联函数展示口径单测：`中文名-类型`（公共 → 公共；本体 → 预设类型中文；未标注 → 未分类）。
 */
import { describe, it, expect } from 'vitest';
import { functionLabel, functionLabelParts } from './function-label';

describe('functionLabel — 关联函数展示口径', () => {
  it('本体函数显示「中文名-预设类型」', () => {
    expect(functionLabel({ name: 'checkRawMaterialUnit', display_name: '校验采购原材料单位一致性', type: 'VALIDATION' }, 'checkRawMaterialUnit'))
      .toBe('校验采购原材料单位一致性-逻辑验证');
    expect(functionLabel({ name: 'sumRawNotArrivalQty', display_name: '原材料未到位数', type: 'CALCULATION' }, 'sumRawNotArrivalQty'))
      .toBe('原材料未到位数-指标计算');
  });

  it('公共函数类型恒为「公共」', () => {
    expect(functionLabel({ name: 'getCurrentDate', display_name: '当前日期', _source: 'common' }, 'getCurrentDate'))
      .toBe('当前日期-公共');
  });

  it('公共函数即便带 type 也不按本体类型展示', () => {
    expect(functionLabelParts({ name: 'f', display_name: '示例', type: 'VALIDATION', _source: 'common' }, 'f').typeLabel).toBe('公共');
  });

  it('display_name 缺失时回退函数名', () => {
    expect(functionLabel({ name: 'inferPurchasePurpose', type: 'CALCULATION' }, 'inferPurchasePurpose'))
      .toBe('inferPurchasePurpose-指标计算');
  });

  it('本体函数未标注类型回退「未分类」（不产出空类型尾巴）', () => {
    expect(functionLabel({ name: 'f', display_name: '无类型函数' }, 'f')).toBe('无类型函数-未分类');
    expect(functionLabel(undefined, 'unknown')).toBe('unknown-未分类');
  });

  it('判断函数标记：仅本体且 type=VALIDATION', () => {
    expect(functionLabelParts({ name: 'a', type: 'VALIDATION' }, 'a').isJudge).toBe(true);
    expect(functionLabelParts({ name: 'b', type: 'CALCULATION' }, 'b').isJudge).toBe(false);
    expect(functionLabelParts({ name: 'c', type: 'VALIDATION', _source: 'common' }, 'c').isJudge).toBe(false);
  });
});
