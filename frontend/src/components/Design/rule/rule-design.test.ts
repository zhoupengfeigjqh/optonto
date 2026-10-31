/**
 * 规则设计纯函数单测（spec 007）：运算符矩阵、返回字段树、默认值、摘要、校验、归一。
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_CONDITIONS_PER_GROUP,
  MAX_GROUPS,
  MAX_MESSAGE_LEN,
  charCount,
  defaultCondition,
  defaultDesign,
  designExpression,
  designSummary,
  findFieldOption,
  flattenResponseFields,
  normalizeDesign,
  operatorMeta,
  operatorsForType,
  responseProperties,
  truncateChars,
  validateDesign,
  type DesignContext,
  type RuleDesign,
} from './rule-design';

/** 本体函数形态：response 直接是属性映射 */
const RESPONSE = {
  pass: { type: 'boolean', title: '判断结果' },
  reason: { type: 'string', title: '判断说明' },
  amount: { type: 'number', title: '金额' },
  detail: { type: 'object', title: '明细', properties: { qty: { type: 'number' } } },
  items: {
    type: 'array',
    title: '条目',
    items: { type: 'object', properties: { qty: { type: 'number' }, name: { type: 'string' } } },
  },
};

/** 公共函数形态：JSON Schema 包裹 */
const COMMON_RESPONSE = { type: 'object', properties: { date: { type: 'string', title: '当前日期' } } };

const ctx: DesignContext = {
  relatedFunctions: ['checkUnit'],
  responseOf: fn => (fn === 'checkUnit' ? RESPONSE : fn === 'getCurrentDate' ? COMMON_RESPONSE : undefined),
};

const condition = (over: Partial<RuleDesign['groups'][number]['conditions'][number]> = {}) => ({
  function: 'checkUnit', field: 'pass', operator: 'eq' as const, values: ['true'], ...over,
});

const design = (over: Partial<RuleDesign> = {}): RuleDesign => ({
  combine: 'and',
  groups: [{ combine: 'and', conditions: [condition()] }],
  pass_message: '允许创建',
  fail_message: '拒绝创建',
  ...over,
});

describe('返回字段树 — 两种 response 形态同解', () => {
  it('本体函数扁平映射：顶层字段可见', () => {
    expect(flattenResponseFields(RESPONSE).map(f => f.path)).toContain('pass');
  });

  it('公共函数 JSON Schema 包裹：先解包 properties', () => {
    expect(responseProperties(COMMON_RESPONSE)).toEqual(COMMON_RESPONSE.properties);
    expect(flattenResponseFields(COMMON_RESPONSE).map(f => f.path)).toEqual(['date']);
  });

  it('嵌套对象与数组元素层路径', () => {
    const paths = flattenResponseFields(RESPONSE).map(f => f.path);
    expect(paths).toContain('detail.qty');
    expect(paths).toContain('items');
    expect(paths).toContain('items[].qty');
    expect(paths).toContain('items[].name');
  });

  it('数组元素层标记为分组节点，叶子取中文名', () => {
    const fields = flattenResponseFields(RESPONSE);
    expect(fields.find(f => f.path === 'items')?.isGroup).toBe(true);
    expect(fields.find(f => f.path === 'detail.qty')?.label).toBe('qty');
    expect(fields.find(f => f.path === 'pass')?.label).toBe('判断结果');
    expect(fields.find(f => f.path === 'detail.qty')?.depth).toBe(1);
  });

  it('非法 response 降级为空', () => {
    expect(flattenResponseFields(null)).toEqual([]);
    expect(flattenResponseFields(undefined)).toEqual([]);
  });

  it('findFieldOption 命中/未命中', () => {
    expect(findFieldOption(RESPONSE, 'items[].qty')?.type).toBe('number');
    expect(findFieldOption(RESPONSE, 'nope')).toBeUndefined();
    expect(findFieldOption(RESPONSE, '')).toBeUndefined();
  });
});

describe('运算符矩阵 — 全类型', () => {
  it('未声明类型返回全集', () => {
    expect(operatorsForType('')).toHaveLength(16);
  });

  it('boolean 只保留比较与空值判断', () => {
    expect(operatorsForType('boolean').map(o => o.code)).toEqual(['eq', 'ne', 'empty', 'not_empty']);
  });

  it('number 含大小比较与介于', () => {
    const codes = operatorsForType('number').map(o => o.code);
    expect(codes).toEqual(expect.arrayContaining(['gt', 'gte', 'lt', 'lte', 'between']));
    expect(codes).not.toContain('contains');
  });

  it('string 含包含/正则/属于', () => {
    const codes = operatorsForType('string').map(o => o.code);
    expect(codes).toEqual(expect.arrayContaining(['contains', 'matches', 'in']));
    expect(codes).not.toContain('gt');
  });

  it('元数据查询', () => {
    expect(operatorMeta('between')?.arity).toBe(2);
    expect(operatorMeta('empty')?.arity).toBe(0);
    expect(operatorMeta('in')?.arity).toBe(-1);
    expect(operatorMeta('nope')).toBeUndefined();
  });
});

describe('默认值 — true / 空白 / 0', () => {
  it('boolean → true，number → 0，string → 空白', () => {
    expect(defaultCondition('checkUnit', RESPONSE)).toMatchObject({ field: 'pass', operator: 'eq', values: ['true'] });
    expect(defaultCondition('checkUnit', { amount: { type: 'number' } })).toMatchObject({ field: 'amount', operator: 'eq', values: ['0'] });
    expect(defaultCondition('checkUnit', { reason: { type: 'string' } })).toMatchObject({ field: 'reason', operator: 'eq', values: [''] });
  });

  it('空值运算符默认无取值', () => {
    const c = defaultCondition('checkUnit', { pass: { type: 'boolean' } });
    const c2 = { ...c, operator: 'empty' as const, values: [] };
    expect(c2.values).toEqual([]);
  });

  it('无字段声明时仍给出可编辑骨架', () => {
    expect(defaultCondition('checkUnit', {})).toMatchObject({ function: 'checkUnit', field: '', operator: 'eq', values: [''] });
  });

  it('defaultDesign 为 1 组 1 条', () => {
    const d = defaultDesign('checkUnit', RESPONSE);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0].conditions).toHaveLength(1);
    expect(d.pass_message).toBe('');
  });
});

describe('摘要与表达式', () => {
  it('未设计返回空串', () => {
    expect(designSummary(null)).toBe('');
    expect(designSummary({ ...design(), groups: [] })).toBe('');
  });

  it('摘要按组数/条件数', () => {
    const d = design({
      groups: [
        { combine: 'and', conditions: [condition(), condition()] },
        { combine: 'or', conditions: [condition()] },
      ],
    });
    expect(designSummary(d)).toBe('2组 · 3条件');
  });

  it('表达式用组间/组内组合符', () => {
    const d = design({
      combine: 'or',
      groups: [
        { combine: 'and', conditions: [condition(), condition({ field: 'reason', values: ['单位'] })] },
        { combine: 'or', conditions: [condition()] },
      ],
    });
    const text = designExpression(d, c => `${c.field}=${c.values.join(',')}`);
    expect(text).toBe('(pass=true AND reason=单位) OR (pass=true)');
  });

  it('未设计表达式', () => {
    expect(designExpression(null, c => c.field)).toBe('未设计');
  });
});

describe('校验 — 与后端同口径', () => {
  it('合法设计通过', () => {
    expect(validateDesign(design(), ctx).ok).toBe(true);
  });

  it('无组被拦截', () => {
    expect(validateDesign(design({ groups: [] }), ctx).message).toContain('至少添加一个条件组');
    expect(validateDesign(null, ctx).ok).toBe(false);
  });

  it('函数不在关联函数中', () => {
    const v = validateDesign(design({ groups: [{ combine: 'and', conditions: [condition({ function: 'sumRaw' })] }] }), ctx);
    expect(v.ok).toBe(false);
    expect(v.errors.g0c0).toContain('不在该规则的关联函数中');
  });

  it('字段未声明', () => {
    const v = validateDesign(design({ groups: [{ combine: 'and', conditions: [condition({ field: 'ghost' })] }] }), ctx);
    expect(v.errors.g0c0).toContain('未在函数返回结构中声明');
  });

  it('运算符不适配字段类型', () => {
    const v = validateDesign(design({ groups: [{ combine: 'and', conditions: [
      condition({ field: 'amount', operator: 'contains', values: ['1'] }),
    ] }] }), ctx);
    expect(v.errors.g0c0).toContain('不支持');
  });

  it('运算符非法', () => {
    const v = validateDesign(design({ groups: [{ combine: 'and', conditions: [
      condition({ operator: '' as any }),
    ] }] }), ctx);
    expect(v.errors.g0c0).toContain('请选择运算符');
  });

  it('取值个数匹配', () => {
    const wrong = validateDesign(design({ groups: [{ combine: 'and', conditions: [
      condition({ values: ['a', 'b'] }),
    ] }] }), ctx);
    expect(wrong.errors.g0c0).toContain('需要 1 个取值');

    const between = validateDesign(design({ groups: [{ combine: 'and', conditions: [
      condition({ field: 'amount', operator: 'between', values: ['1'] }),
    ] }] }), ctx);
    expect(between.errors.g0c0).toContain('需要 2 个取值');

    const empty = validateDesign(design({ groups: [{ combine: 'and', conditions: [
      condition({ operator: 'empty', values: ['x'] }),
    ] }] }), ctx);
    expect(empty.errors.g0c0).toContain('不接受取值');
  });

  it('空白取值合法（string 默认值）', () => {
    expect(validateDesign(design({ groups: [{ combine: 'and', conditions: [
      condition({ field: 'reason', values: [''] }),
    ] }] }), ctx).ok).toBe(true);
  });

  it('组为空 / 组数 / 条数上限', () => {
    const emptyGroup = validateDesign(design({ groups: [{ combine: 'and', conditions: [] }] }), ctx);
    expect(emptyGroup.errors.g0).toContain('为空');

    const tooManyGroups = design({
      groups: Array.from({ length: MAX_GROUPS + 1 }, () => ({ combine: 'and', conditions: [condition()] })),
    });
    expect(validateDesign(tooManyGroups, ctx).message).toContain(`最多 ${MAX_GROUPS} 个条件组`);

    const tooManyConditions = design({
      groups: [{ combine: 'and', conditions: Array.from({ length: MAX_CONDITIONS_PER_GROUP + 1 }, () => condition()) }],
    });
    expect(validateDesign(tooManyConditions, ctx).message).toContain(`最多 ${MAX_CONDITIONS_PER_GROUP} 条条件`);
  });

  it('结果说明超过 30 字', () => {
    expect(validateDesign(design({ pass_message: '允'.repeat(MAX_MESSAGE_LEN + 1) }), ctx).message).toContain('不能超过');
    expect(validateDesign(design({ fail_message: '拒'.repeat(MAX_MESSAGE_LEN + 1) }), ctx).ok).toBe(false);
  });
});

describe('归一 — 保存前整理', () => {
  it('按运算符裁剪取值', () => {
    const out = normalizeDesign(design({
      groups: [{ combine: 'and', conditions: [
        condition({ values: ['true', 'extra'] }),
        condition({ operator: 'empty', values: ['x'] }),
        condition({ field: 'amount', operator: 'between', values: ['1'] }),
      ] }],
    }));
    const conds = out!.groups[0].conditions;
    expect(conds[0].values).toEqual(['true']);
    expect(conds[1].values).toEqual([]);
    expect(conds[2].values).toEqual(['1', '']);
  });

  it('剔除空组并归一空设计为 null', () => {
    const out = normalizeDesign(design({
      groups: [
        { combine: 'and', conditions: [] },
        { combine: 'or', conditions: [condition()] },
      ],
    }));
    expect(out!.groups).toHaveLength(1);

    expect(normalizeDesign({ combine: 'and', groups: [], pass_message: '  ', fail_message: '' })).toBeNull();
    expect(normalizeDesign(null)).toBeNull();
  });

  it('文案去首尾空白', () => {
    const out = normalizeDesign(design({ pass_message: '  允许  ', fail_message: ' 拒绝 ' }));
    expect(out!.pass_message).toBe('允许');
    expect(out!.fail_message).toBe('拒绝');
  });
});

describe('字数工具', () => {
  it('按码点计数与截断', () => {
    expect(charCount('原材料')).toBe(3);
    expect(charCount(undefined)).toBe(0);
    expect(truncateChars('a'.repeat(40))).toHaveLength(30);
    expect(truncateChars('短')).toBe('短');
  });
});
