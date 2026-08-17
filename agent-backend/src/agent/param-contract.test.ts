/**
 * unwrapParamValues 深展开单测 —— 函数子任务直连 MCP 前剥 {type/required/description/value} 包装。
 * 覆盖真实 LLM 波次反馈中继的递归嵌套形态（数组项字段被包成 {value: ...}），
 * 历史教训：只做顶层剥皮会漏掉嵌套包装，函数收到 dict 报 strptime 类型错误（见 tool-subtask-param-unwrap）。
 */
import { describe, it, expect } from 'vitest';
import { unwrapParamValues } from './param-contract.js';

describe('unwrapParamValues · 深展开计划期参数包装', () => {
  it('顶层四键包装 {type/required/description/value} → 纯值', () => {
    expect(unwrapParamValues({
      currentDate: { type: 'string', required: true, description: '当前日期', value: '2026-08-15' },
      filterRawMaterialName: { type: 'string', required: true, description: '原料名', value: '钢板' },
    })).toEqual({ currentDate: '2026-08-15', filterRawMaterialName: '钢板' });
  });

  it('单键 {value} 包装也剥离（LLM 中继常省略 type/description）', () => {
    expect(unwrapParamValues({ x: { value: '2026-09-01' } })).toEqual({ x: '2026-09-01' });
  });

  it('递归剥离数组项字段里的嵌套 {value} 包装（真实中继产物）', () => {
    expect(unwrapParamValues({
      purchaseRecordSet: {
        type: 'array', required: true, description: '采购记录集',
        value: [
          { arrivalTime: { value: '2026-09-01' }, rawMaterialName: { value: '钢板' }, arrivalQuantity: 100 },
        ],
      },
    })).toEqual({
      purchaseRecordSet: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: 100 }],
    });
  });

  it('真实业务对象（无 value 键）原样保留，不误剥', () => {
    const business = { purchaseRecordId: 'PO-001', rawMaterialName: '钢板', arrivalQuantity: 100 };
    expect(unwrapParamValues({ purchaseRecordSet: { type: 'array', value: [business] } }))
      .toEqual({ purchaseRecordSet: [business] });
  });

  it('业务对象含 value 字段但混有其它业务键 → 不误剥（不是纯包装）', () => {
    const mixed = { rawMaterialName: '钢板', value: 5 };
    expect(unwrapParamValues({ purchaseRecordSet: { type: 'array', value: [mixed] } }))
      .toEqual({ purchaseRecordSet: [{ rawMaterialName: '钢板', value: 5 }] });
  });

  it('标量值直接透传（无包装）', () => {
    expect(unwrapParamValues({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
  });

  it('空/缺失 params → 空对象', () => {
    expect(unwrapParamValues({})).toEqual({});
    expect(unwrapParamValues(undefined as any)).toEqual({});
  });
});
