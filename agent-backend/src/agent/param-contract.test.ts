/**
 * unwrapParamValues 深展开单测 —— 函数子任务直连 MCP 前剥 {type/required/description/value} 包装。
 * 覆盖真实 LLM 波次反馈中继的递归嵌套形态（数组项字段被包成 {value: ...}），
 * 历史教训：只做顶层剥皮会漏掉嵌套包装，函数收到 dict 报 strptime 类型错误（见 tool-subtask-param-unwrap）。
 */
import { describe, it, expect } from 'vitest';
import { unwrapParamValues, validateParamStructure, renderParamStructure } from './param-contract.js';

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

// ─── validateParamStructure · 已填非空值的真实类型校验 ─────────────────
// 规划期（初始 + 波次中继）共用此判定器；空值放行（子 Agent 补 / 中继填），裸标量维持"报缺失"（B 口径）。

describe('validateParamStructure · 值类型校验', () => {
  const DECLARED = {
    date: { type: 'string', required: true },
    days: { type: 'integer', required: true },
    ratio: { type: 'number', required: false },
    tags: { type: 'array', required: false },
    meta: { type: 'object', required: false },
    flag: { type: 'boolean', required: false },
    unit: { type: 'enum', required: false },
    custom: { required: false }, // 未声明 type → 无比对依据
  };

  it('类型全对（含可选参数）→ 无错误', () => {
    expect(validateParamStructure(DECLARED, {
      date: { type: 'string', value: '2026-08-17' },
      days: { type: 'integer', value: 30 },
      ratio: { value: 0.5 },
      tags: { value: ['a'] },
      meta: { value: { k: 1 } },
      flag: { value: true },
      unit: { value: '吨' },
      custom: { value: { arbitrary: ['任意'] } },
    }, 2, 'fn')).toEqual([]);
  });

  it('integer 填入中文字符串 → 拦（dateAdd days="三十" 场景）', () => {
    const errors = validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' },
      days: { type: 'integer', value: '三十' },
    }, 2, 'dateAdd');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('参数 days 声明类型 integer');
    expect(errors[0]).toContain('"三十"');
  });

  it('integer 填入数字字符串 "30" → 拦（严格口径，不认数字字符串）', () => {
    const errors = validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' },
      days: { value: '30' },
    }, 2, 'dateAdd');
    expect(errors.some(e => e.includes('参数 days'))).toBe(true);
  });

  it('integer 填入 30.5（非整数 number）→ 拦', () => {
    const errors = validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' },
      days: { value: 30.5 },
    }, 2, 'dateAdd');
    expect(errors.some(e => e.includes('参数 days'))).toBe(true);
  });

  it('number 接受整数与浮点；boolean/array/object 各认各的', () => {
    expect(validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' }, days: { value: 30 }, ratio: { value: 7 },
    }, 2, 'fn')).toEqual([]);
    // boolean 填 0、array 填对象、object 填数组 → 全拦
    const errors = validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' }, days: { value: 30 },
      flag: { value: 0 }, tags: { value: { 0: 'a' } }, meta: { value: [1] },
    }, 2, 'fn');
    expect(errors.some(e => e.includes('参数 flag'))).toBe(true);
    expect(errors.some(e => e.includes('参数 tags'))).toBe(true);
    expect(errors.some(e => e.includes('参数 meta'))).toBe(true);
  });

  it('空值放行：value 留空不报类型错（等中继/子 Agent 补）', () => {
    const errors = validateParamStructure(DECLARED, {
      date: { type: 'string', value: '' },   // 空值：不报类型错
      days: { type: 'integer', value: '' },  // 空值：不报类型错
    }, 2, 'dateAdd');
    expect(errors).toEqual([]);
  });

  it('裸标量维持 B 口径：必填参数给裸值 → 仍报"缺少必填参数"，不做值类型校验', () => {
    const errors = validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' },
      days: 30,
    }, 2, 'dateAdd');
    expect(errors).toEqual(['子任务2(dateAdd) 缺少必填参数 days']);
  });

  it('未声明 type 的参数填任意值 → 跳过比对', () => {
    expect(validateParamStructure(DECLARED, {
      date: { value: '2026-08-17' }, days: { value: 30 },
      custom: { value: 12345 },
    }, 2, 'fn')).toEqual([]);
  });
});

// ─── validateParamStructure · array/object 递归校验 ─────────────────
// 嵌套结构沿声明的 items/properties 深入比对，错误带路径（填值依据与中继结构参考同源）。

describe('validateParamStructure · 嵌套递归校验', () => {
  // 真实案例：sumRawNotArrivalQty 的 purchaseRecordSet（array 套 object）
  const NESTED = {
    purchaseRecordSet: {
      type: 'array', required: true,
      items: {
        type: 'object',
        properties: {
          arrivalTime: { type: 'string', required: true },
          rawMaterialName: { type: 'string', required: true },
          arrivalQuantity: { type: 'number', required: true },
        },
      },
    },
    detail: {
      type: 'object', required: false,
      properties: {
        weight: { type: 'number', required: true },
        note: { type: 'string', required: false },
      },
    },
    tags: { type: 'array', required: false, items: { type: 'string' } }, // 标量项数组
    plainArr: { type: 'array', required: false },                        // 无 items：只查"是数组"
    plainObj: { type: 'object', required: false },                       // 无 properties：只查"是对象"
  };

  it('数组项结构全对 → 通过', () => {
    expect(validateParamStructure(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: 100 }] },
    }, 2, 'sumRawNotArrivalQty')).toEqual([]);
  });

  it('数组项内字段类型错 → 拦截并报路径 purchaseRecordSet[0].arrivalQuantity', () => {
    const errors = validateParamStructure(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: '一百' }] },
    }, 2, 'sumRawNotArrivalQty');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('purchaseRecordSet[0].arrivalQuantity');
    expect(errors[0]).toContain('声明类型 number');
    expect(errors[0]).toContain('"一百"');
  });

  it('数组项缺必填字段 → 报"缺少必填字段"且不重复报该字段的类型错', () => {
    const errors = validateParamStructure(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板' }] },
    }, 2, 'fn');
    expect(errors).toEqual(['子任务2(fn) 参数 purchaseRecordSet[0].arrivalQuantity 缺少必填字段']);
  });

  it('数组项字段的嵌套 {value} 包装（真实中继产物）→ 剥包装后比对，不误报', () => {
    expect(validateParamStructure(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: { value: '2026-09-01' }, rawMaterialName: '钢板', arrivalQuantity: 100 }] },
    }, 2, 'fn')).toEqual([]);
  });

  it('object 参数：字段类型错带路径；声明外多出的字段放行', () => {
    const errors = validateParamStructure(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: 1 }] },
      detail: { value: { weight: '很重', extraField: '声明外字段不报错' } },
    }, 2, 'fn');
    expect(errors).toEqual(['子任务2(fn) 参数 detail.weight 声明类型 number，实际填入值 "很重"（string），请按声明类型修正']);
  });

  it('标量项数组：逐项查标量类型', () => {
    const ok = { value: [{ arrivalTime: 't', rawMaterialName: 'n', arrivalQuantity: 1 }] };
    expect(validateParamStructure(NESTED, { purchaseRecordSet: ok, tags: { value: ['a', 'b'] } }, 2, 'fn')).toEqual([]);
    const errors = validateParamStructure(NESTED, { purchaseRecordSet: ok, tags: { value: ['a', 1] } }, 2, 'fn');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('tags[1]');
  });

  it('无 items/properties 声明的 array/object：只查顶层形态', () => {
    const ok = { value: [{ arrivalTime: 't', rawMaterialName: 'n', arrivalQuantity: 1 }] };
    expect(validateParamStructure(NESTED, {
      purchaseRecordSet: ok,
      plainArr: { value: [1, '混', { 啥: '都行' }] }, plainObj: { value: { any: 1 } },
    }, 2, 'fn')).toEqual([]);
    expect(validateParamStructure(NESTED, { purchaseRecordSet: ok, plainArr: { value: '不是数组' } }, 2, 'fn'))
      .toEqual(['子任务2(fn) 参数 plainArr 声明类型 array，实际填入值 "不是数组"（string），请按声明类型修正']);
  });

  it('空数组 [] 视为空值 → 整体放行（等中继/子 Agent 补）', () => {
    expect(validateParamStructure(NESTED, { purchaseRecordSet: { value: [] } }, 2, 'fn')).toEqual([]);
  });
});

// ─── renderParamStructure · 中继结构 sketch 渲染 ─────────────────────

describe('renderParamStructure', () => {
  it('array 套 object：展开数组项结构，含必填/描述/示例', () => {
    const lines = renderParamStructure('purchaseRecordSet', {
      type: 'array', required: true, description: '采购记录集',
      items: { type: 'object', properties: {
        arrivalTime: { type: 'string', required: true, description: '到位时间', example: '2026-09-01' },
        rawMaterialName: { type: 'string', required: true },
        arrivalQuantity: { type: 'number', required: true },
      } },
    }, { filled: false });
    expect(lines).toEqual([
      'purchaseRecordSet: array（必填） — 采购记录集，当前未填，数组项结构：',
      '  · arrivalTime: string（必填） — 到位时间，示例 2026-09-01',
      '  · rawMaterialName: string（必填）',
      '  · arrivalQuantity: number（必填）',
    ]);
  });

  it('object 参数：展开字段结构；已填状态标注', () => {
    const lines = renderParamStructure('detail', {
      type: 'object', required: false,
      properties: { weight: { type: 'number', required: true } },
    }, { filled: true });
    expect(lines).toEqual([
      'detail: object，已填，字段结构：',
      '  · weight: number（必填）',
    ]);
  });

  it('无内部声明的 array：单行不展开', () => {
    expect(renderParamStructure('tags', { type: 'array', required: false }))
      .toEqual(['tags: array']);
  });
});
