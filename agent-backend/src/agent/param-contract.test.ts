/**
 * param-contract 单测 —— 三部分：
 *  1. unwrapParamValues 深展开：函数子任务直连 MCP 前剥 {type/required/description/value} 包装。
 *     覆盖真实 LLM 波次反馈中继的递归嵌套形态（历史教训：只做顶层剥皮会漏嵌套包装，见 tool-subtask-param-unwrap）。
 *  2. validateParamsAgainstSchema：规划期对 core 编译 inputSchema 的「必填 key 齐全 + 已填值合规」校验
 *     （facade 化后替代 validateParamStructure/validateConstraintValues——类型与 enum/pattern/min/max 一道覆盖）。
 *  3. renderParamStructure：中继提示 / PlanGate nudge 的结构 sketch 渲染。
 */
import { describe, it, expect } from 'vitest';
import { unwrapParamValues, validateParamsAgainstSchema, renderParamStructure } from './param-contract.js';

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

// ─── validateParamsAgainstSchema · 结构（必填 key / 自报 type） ─────────────────
// schema 均按 core 编译产物形态书写（JSON Schema；pattern 已是 ^(?:…)$ 全匹配包装）。

describe('validateParamsAgainstSchema · 结构校验', () => {
  const SCHEMA = {
    type: 'object',
    properties: {
      date: { type: 'string' },
      days: { type: 'integer' },
      note: { type: 'string' },
    },
    required: ['date', 'days'],
  };

  it('必填 key 齐全（包装对象）→ 通过；可选缺失不拦', () => {
    expect(validateParamsAgainstSchema(SCHEMA, {
      date: { type: 'string', value: '' },
      days: { type: 'integer', value: 30 },
    }, 1, 'fn')).toEqual([]);
  });

  it('缺必填 key / 必填给裸标量 → 报"缺少必填参数"', () => {
    expect(validateParamsAgainstSchema(SCHEMA, { days: { type: 'integer', value: 30 } }, 1, 'fn'))
      .toEqual(['子任务1(fn) 缺少必填参数 date']);
    const errors = validateParamsAgainstSchema(SCHEMA, { date: { value: 'x' }, days: 30 }, 1, 'fn');
    expect(errors).toEqual(['子任务1(fn) 缺少必填参数 days']);
  });

  it('必填包装自报 type 与声明不一致 → 报类型应为；可选参数自报 type 不查', () => {
    const errors = validateParamsAgainstSchema(SCHEMA, {
      date: { type: 'string', value: '' },
      days: { type: 'string', value: '' },
      note: { type: 'integer', value: '' }, // 可选：自报 type 不查
    }, 2, 'fn');
    expect(errors).toEqual(['子任务2(fn) 参数 days 类型应为 integer，实际 string']);
  });

  it('ontology_id / scope 键一律跳过（编译 schema 带，规划期不填）', () => {
    const withScope = {
      type: 'object',
      properties: { ontology_id: { type: 'integer' }, scope: { type: 'object' }, date: { type: 'string' } },
      required: ['ontology_id', 'date'],
    };
    expect(validateParamsAgainstSchema(withScope, { date: { value: '2026-08-17' } }, 1, 'fn')).toEqual([]);
  });
});

// ─── validateParamsAgainstSchema · 类型与嵌套递归 ─────────────────

describe('validateParamsAgainstSchema · 值类型校验', () => {
  const SCHEMA = {
    type: 'object',
    properties: {
      date: { type: 'string' },
      days: { type: 'integer' },
      ratio: { type: 'number' },
      flag: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      custom: {}, // 无 type → Unknown，无比对依据
    },
    required: ['date', 'days'],
  };

  it('类型全对（含可选参数）→ 无错误', () => {
    expect(validateParamsAgainstSchema(SCHEMA, {
      date: { value: '2026-08-17' }, days: { value: 30 },
      ratio: { value: 0.5 }, tags: { value: ['a'] }, flag: { value: true },
      custom: { value: { arbitrary: ['任意'] } },
    }, 2, 'fn')).toEqual([]);
  });

  it('integer 填入中文字符串 → 拦（dateAdd days="三十" 场景）', () => {
    const errors = validateParamsAgainstSchema(SCHEMA, {
      date: { value: '2026-08-17' }, days: { type: 'integer', value: '三十' },
    }, 2, 'dateAdd');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('参数 days 声明类型 integer');
    expect(errors[0]).toContain('"三十"');
  });

  it('integer 填入数字字符串 "30" / 非整数 30.5 → 拦（严格口径）', () => {
    for (const v of ['30', 30.5]) {
      const errors = validateParamsAgainstSchema(SCHEMA, { date: { value: 'x' }, days: { value: v } }, 2, 'fn');
      expect(errors.some(e => e.includes('参数 days'))).toBe(true);
    }
  });

  it('空值放行：value 留空不报类型错（等中继/子 Agent 补）；空数组同样放行', () => {
    expect(validateParamsAgainstSchema(SCHEMA, {
      date: { type: 'string', value: '' }, days: { type: 'integer', value: '' }, tags: { value: [] },
    }, 2, 'fn')).toEqual([]);
  });

  it('number 接受整数与浮点；boolean/array 错型各拦各的', () => {
    expect(validateParamsAgainstSchema(SCHEMA, {
      date: { value: 'x' }, days: { value: 30 }, ratio: { value: 7 },
    }, 2, 'fn')).toEqual([]);
    const errors = validateParamsAgainstSchema(SCHEMA, {
      date: { value: 'x' }, days: { value: 30 }, flag: { value: 0 }, tags: { value: { 0: 'a' } },
    }, 2, 'fn');
    expect(errors.some(e => e.includes('参数 flag'))).toBe(true);
    expect(errors.some(e => e.includes('参数 tags'))).toBe(true);
  });
});

describe('validateParamsAgainstSchema · 嵌套递归校验', () => {
  // 真实案例：sumRawNotArrivalQty 的 purchaseRecordSet（array 套 object）的编译 schema 形态
  const NESTED = {
    type: 'object',
    properties: {
      purchaseRecordSet: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            arrivalTime: { type: 'string', minLength: 1 },
            rawMaterialName: { type: 'string', minLength: 1 },
            arrivalQuantity: { type: 'number' },
          },
          required: ['arrivalTime', 'rawMaterialName', 'arrivalQuantity'],
        },
      },
      detail: {
        type: 'object',
        properties: { weight: { type: 'number' }, note: { type: 'string' } },
        required: ['weight'],
      },
      plainArr: { type: 'array' },  // 无 items：只查"是数组"
      plainObj: { type: 'object' }, // 无 properties：只查"是对象"
    },
    required: ['purchaseRecordSet'],
  };

  it('数组项结构全对 → 通过', () => {
    expect(validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: 100 }] },
    }, 2, 'sumRawNotArrivalQty')).toEqual([]);
  });

  it('数组项内字段类型错 → 拦截并报路径 purchaseRecordSet[0].arrivalQuantity', () => {
    const errors = validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: '一百' }] },
    }, 2, 'sumRawNotArrivalQty');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('purchaseRecordSet[0].arrivalQuantity');
    expect(errors[0]).toContain('声明类型 number');
    expect(errors[0]).toContain('"一百"');
  });

  it('数组项缺必填字段 → 报"缺少必填字段"且不重复报该字段的类型错', () => {
    const errors = validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板' }] },
    }, 2, 'fn');
    expect(errors).toEqual(['子任务2(fn) 参数 purchaseRecordSet[0].arrivalQuantity 缺少必填字段']);
  });

  it('数组项必填字段填空串 → minLength 拦（空串=缺失语义编进 schema）', () => {
    const errors = validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '', rawMaterialName: '钢板', arrivalQuantity: 1 }] },
    }, 2, 'fn');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('purchaseRecordSet[0].arrivalTime');
    expect(errors[0]).toContain('不能为空');
  });

  it('数组项字段的嵌套 {value} 包装（真实中继产物）→ 剥包装后比对，不误报', () => {
    expect(validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: { value: '2026-09-01' }, rawMaterialName: '钢板', arrivalQuantity: 100 }] },
    }, 2, 'fn')).toEqual([]);
  });

  it('object 参数：字段类型错带路径；声明外多出的字段放行', () => {
    const errors = validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: { value: [{ arrivalTime: '2026-09-01', rawMaterialName: '钢板', arrivalQuantity: 1 }] },
      detail: { value: { weight: '很重', extraField: '声明外字段不报错' } },
    }, 2, 'fn');
    expect(errors).toEqual(['子任务2(fn) 参数 detail.weight 声明类型 number，实际填入值 "很重"（string），请按声明类型修正']);
  });

  it('无 items/properties 声明的 array/object：只查顶层形态', () => {
    const ok = { value: [{ arrivalTime: 't', rawMaterialName: 'n', arrivalQuantity: 1 }] };
    expect(validateParamsAgainstSchema(NESTED, {
      purchaseRecordSet: ok,
      plainArr: { value: [1, '混', { 啥: '都行' }] }, plainObj: { value: { any: 1 } },
    }, 2, 'fn')).toEqual([]);
    expect(validateParamsAgainstSchema(NESTED, { purchaseRecordSet: ok, plainArr: { value: '不是数组' } }, 2, 'fn'))
      .toEqual(['子任务2(fn) 参数 plainArr 声明类型 array，实际填入值 "不是数组"（string），请按声明类型修正']);
  });
});

// ─── validateParamsAgainstSchema · 约束（enum/pattern/min/max 编译进 schema 后的统一校验） ─────────────────

describe('validateParamsAgainstSchema · 约束校验', () => {
  const CONSTRAINED = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['有效', '无效'] },
      orderDate: { type: 'string', pattern: '^(?:\\d{4}-\\d{2}-\\d{2})$' },
      level: { type: 'integer', enum: [1, 2, 3] },
      qty: { type: 'integer', minimum: 1, maximum: 999 },
      ratio: { type: 'number', minimum: 0 },
    },
    required: [],
  };

  it('值全部合规 → 无错误', () => {
    expect(validateParamsAgainstSchema(CONSTRAINED, {
      status: { value: '有效' }, orderDate: { value: '2026-08-24' },
      level: { value: 2 }, qty: { value: 500 }, ratio: { value: 0.5 },
    }, 1, 'B')).toEqual([]);
  });

  it('枚举违例（字符串/数字枚举严格比对）→ 报不在枚举值内，并列合法清单', () => {
    const errors = validateParamsAgainstSchema(CONSTRAINED, {
      status: { value: '未知' }, level: { value: 9 },
    }, 1, 'B');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('不在枚举值 [有效 / 无效] 内');
    expect(errors[1]).toContain('不在枚举值 [1 / 2 / 3] 内');
  });

  it('模式不匹配 → 报不匹配模式（编译 schema 已全匹配包装，部分命中也拦）', () => {
    const errors = validateParamsAgainstSchema(CONSTRAINED, { orderDate: { value: '2026-8-4' } }, 2, 'B');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('不匹配模式');
    expect(validateParamsAgainstSchema(CONSTRAINED, { orderDate: { value: 'x2026-08-24' } }, 2, 'B')).toHaveLength(1);
  });

  it('取值范围：低于 min / 高于 max 均拦，报错带范围文本；范围内与无范围声明不拦', () => {
    const low = validateParamsAgainstSchema(CONSTRAINED, { qty: { value: 0 } }, 1, 'B');
    expect(low).toHaveLength(1);
    expect(low[0]).toContain('低于最小值 1（取值范围 1 ~ 999）');
    const high = validateParamsAgainstSchema(CONSTRAINED, { qty: { value: 1000 } }, 1, 'B');
    expect(high[0]).toContain('高于最大值 999（取值范围 1 ~ 999）');
    expect(validateParamsAgainstSchema(CONSTRAINED, { qty: { value: 999 }, ratio: { value: 99999 } }, 1, 'B')).toEqual([]);
  });

  it('嵌套数组项字段约束递归校验，错误带路径 recordSet[1].orderDate', () => {
    const nested = {
      type: 'object',
      properties: {
        recordSet: {
          type: 'array',
          items: { type: 'object', properties: { orderDate: { type: 'string', pattern: '^(?:\\d{4})$' } } },
        },
      },
      required: [],
    };
    const errors = validateParamsAgainstSchema(nested, {
      recordSet: { value: [{ orderDate: { value: '2026' } }, { orderDate: { value: '26' } }] },
    }, 3, 'B');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('recordSet[1].orderDate');
    expect(errors[0]).toContain('不匹配模式');
  });

  it('空值放行（缺值由子 Agent/中继负责，非约束校验职责）', () => {
    expect(validateParamsAgainstSchema(CONSTRAINED, {
      status: { value: '' }, orderDate: {}, qty: { value: '' },
    }, 1, 'B')).toEqual([]);
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
