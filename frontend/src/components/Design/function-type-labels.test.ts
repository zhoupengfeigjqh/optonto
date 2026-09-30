/**
 * 函数类型展示口径单测：落盘英文码 / 展示中文，下拉 label 与展示标签同源。
 */
import { describe, it, expect } from 'vitest';
import { FUNCTION_TYPE_LABELS, FUNCTION_TYPE_OPTIONS, functionTypeLabel } from './function-type-labels';

describe('function-type-labels — 函数类型展示口径', () => {
  it('5 类英文码与中文标签一一对应（与 prompts.py 阶段5A 口径一致）', () => {
    expect(Object.keys(FUNCTION_TYPE_LABELS)).toEqual([
      'TRANSFORMATION', 'CALCULATION', 'DERIVATION', 'VALIDATION', 'MODEL',
    ]);
    expect(FUNCTION_TYPE_LABELS.CALCULATION).toBe('指标计算');
  });

  it('下拉选项：label 为「中文 (英文码)」，value 为落盘英文码', () => {
    expect(FUNCTION_TYPE_OPTIONS.map(o => o.value)).toEqual(Object.keys(FUNCTION_TYPE_LABELS));
    expect(FUNCTION_TYPE_OPTIONS.find(o => o.value === 'VALIDATION')?.label).toBe('逻辑验证 (VALIDATION)');
  });

  it('展示态：英文码 → 中文（不再出现选了中文、显示英文码的情况）', () => {
    expect(functionTypeLabel('CALCULATION')).toBe('指标计算');
    expect(functionTypeLabel('MODEL')).toBe('机器学习模型');
    expect(functionTypeLabel('TRANSFORMATION')).toBe('格式转换');
  });

  it('边界：空值显示短横线；未知码回退原值（不吞信息）', () => {
    expect(functionTypeLabel('')).toBe('-');
    expect(functionTypeLabel(undefined)).toBe('-');
    expect(functionTypeLabel('UNKNOWN_CODE')).toBe('UNKNOWN_CODE');
  });

  it('属性传递：下拉全部 value 都能反查出中文标签', () => {
    for (const o of FUNCTION_TYPE_OPTIONS) {
      expect(functionTypeLabel(o.value)).toBe(FUNCTION_TYPE_LABELS[o.value]);
      expect(functionTypeLabel(o.value)).not.toBe('-');
    }
  });
});
