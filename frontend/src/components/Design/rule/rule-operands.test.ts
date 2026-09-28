/**
 * 规则操作数纯逻辑单测（章程 III：属性传递 / 边界条件）。
 * 覆盖：字面值引号语法与类型校验、字面值集切分与同型约束、存储↔编辑形态转换与旧类型名迁移。
 */
import { describe, it, expect } from 'vitest';
import {
  parseLiteralInput, parseLiteralSetInput, storageToEditing, normalizeOperandType,
  _label, getReturnFields, literalNodeToText, literalSetNodeToText,
} from './rule-operands';

describe('parseLiteralInput — 字面值解析', () => {
  it('属性传递：引号包裹的字符串去掉引号后按 string 存储', () => {
    expect(parseLiteralInput("'有效'", null)).toEqual({ ok: true, node: { type: 'value', valueType: 'string', value: '有效' } });
    expect(parseLiteralInput('"有效"', null)).toEqual({ ok: true, node: { type: 'value', valueType: 'string', value: '有效' } });
  });

  it('边界：左侧为 number 时字符串必须加引号否则报错', () => {
    const r = parseLiteralInput("'有效'", 'number');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('不要加引号');
  });

  it('属性传递：true/false 解析为布尔节点', () => {
    expect(parseLiteralInput('true', null)).toEqual({ ok: true, node: { type: 'value', valueType: 'boolean', value: true } });
    expect(parseLiteralInput('false', 'boolean')).toEqual({ ok: true, node: { type: 'value', valueType: 'boolean', value: false } });
  });

  it('边界：左侧为 string 时输入布尔值报错', () => {
    expect(parseLiteralInput('true', 'string').ok).toBe(false);
  });

  it('属性传递：整数按 integer 存储，左侧为 number 时按 number 存储', () => {
    expect(parseLiteralInput('42', null)).toEqual({ ok: true, node: { type: 'value', valueType: 'integer', value: 42 } });
    expect(parseLiteralInput('42', 'number')).toEqual({ ok: true, node: { type: 'value', valueType: 'number', value: 42 } });
  });

  it('边界：左侧为 string 时裸写数字报错', () => {
    const r = parseLiteralInput('42', 'string');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('引号包裹');
  });

  it('边界：左侧为 integer 时小数报错；未知类型时小数按 number', () => {
    expect(parseLiteralInput('1.5', 'integer').ok).toBe(false);
    expect(parseLiteralInput('1.5', null)).toEqual({ ok: true, node: { type: 'value', valueType: 'number', value: 1.5 } });
  });

  it('边界：未知类型下裸文本按 string 原文接受（宁漏勿拦）', () => {
    expect(parseLiteralInput('abc', null)).toEqual({ ok: true, node: { type: 'value', valueType: 'string', value: 'abc' } });
  });

  it('边界：已知类型下无法识别的字面值报错', () => {
    expect(parseLiteralInput('abc', 'number').ok).toBe(false);
  });

  it('边界：空输入 = 空值节点，valueType 与左侧一致（未知为 null）', () => {
    expect(parseLiteralInput('', 'string')).toEqual({ ok: true, node: { type: 'value', valueType: 'string', value: null } });
    expect(parseLiteralInput(undefined, null)).toEqual({ ok: true, node: { type: 'value', valueType: 'null', value: null } });
  });
});

describe('parseLiteralSetInput — 字面值集解析', () => {
  it('属性传递：字符串集切分并保持 string 元素类型', () => {
    expect(parseLiteralSetInput("['有效', '无效']", null)).toEqual({
      ok: true, node: { type: 'valueSet', elementType: 'string', value: ['有效', '无效'] },
    });
  });

  it('属性传递：整数集元素类型为 integer', () => {
    expect(parseLiteralSetInput('[1, 2, 3]', null)).toEqual({
      ok: true, node: { type: 'valueSet', elementType: 'integer', value: [1, 2, 3] },
    });
  });

  it('边界：引号内的逗号不切分', () => {
    const r = parseLiteralSetInput("['a,b', 'c']", null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.value).toEqual(['a,b', 'c']);
  });

  it('边界：缺少方括号 / 空集 / 空元素均报错', () => {
    expect(parseLiteralSetInput('a, b', null).ok).toBe(false);
    expect(parseLiteralSetInput('[]', null).ok).toBe(false);
    expect(parseLiteralSetInput("['a', , 'b']", null).ok).toBe(false);
  });

  it('边界：元素类型不一致报错', () => {
    const r = parseLiteralSetInput("['a', 1]", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('类型不一致');
  });
});

describe('storageToEditing — 存储形态转编辑形态', () => {
  it('属性传递：旧类型名 concept/set 迁移为 instance/instanceSet', () => {
    const cfg = { if: { conditions: [{ left: { type: 'concept' }, operator: 'eq', right: { type: 'set' } }] } };
    const out = storageToEditing(cfg);
    expect(out.if.conditions[0].left.type).toBe('instance');
    expect(out.if.conditions[0].right.type).toBe('instanceSet');
  });

  it('边界：in 操作符右侧的 instance 修复为 instanceSet', () => {
    const cfg = { if: { conditions: [{ left: { type: 'instance' }, operator: 'in', right: { type: 'instance' } }] } };
    expect(storageToEditing(cfg).if.conditions[0].right.type).toBe('instanceSet');
  });

  it('属性传递：typed 字面值还原为引号文本并删除 valueType', () => {
    const cfg = { if: { conditions: [{ left: { type: 'value', valueType: 'string', value: '有效' }, operator: 'eq', right: { type: 'value', valueType: 'null', value: null } }] } };
    const out = storageToEditing(cfg);
    expect(out.if.conditions[0].left.value).toBe("'有效'");
    expect('valueType' in out.if.conditions[0].left).toBe(false);
    expect(out.if.conditions[0].right.value).toBe('');
  });

  it('边界：typed 字面值集还原为方括号文本', () => {
    const cfg = { if: { conditions: [{ left: { type: 'valueSet', elementType: 'string', value: ['a', 'b'] } }] } };
    expect(storageToEditing(cfg).if.conditions[0].left.value).toBe("['a', 'b']");
  });

  it('边界：无 conditions 或非对象输入原样返回，不抛错', () => {
    expect(storageToEditing(null)).toBeNull();
    const plain = { then: 'x' };
    expect(storageToEditing(plain)).toEqual(plain);
  });

  it('边界：不修改入参（深拷贝）', () => {
    const cfg = { if: { conditions: [{ left: { type: 'concept' } }] } };
    storageToEditing(cfg);
    expect(cfg.if.conditions[0].left.type).toBe('concept');
  });
});

describe('normalizeOperandType', () => {
  it('旧名映射新名，未知/空值回退空串', () => {
    expect(normalizeOperandType('concept')).toBe('instance');
    expect(normalizeOperandType('set')).toBe('instanceSet');
    expect(normalizeOperandType('value')).toBe('value');
    expect(normalizeOperandType(undefined)).toBe('');
  });
});

describe('_label / getReturnFields — 函数返回字段提取', () => {
  it('属性传递：展示名优先 display_name，其次 description，最后回退 key', () => {
    expect(_label({ display_name: '展示名', description: '描述' }, 'k')).toBe('展示名');
    expect(_label({ description: '描述' }, 'k')).toBe('描述');
    expect(_label(null, 'k')).toBe('k');
  });

  it('边界：未选函数 / 函数无 response 时返回空数组', () => {
    expect(getReturnFields([], undefined)).toEqual([]);
    expect(getReturnFields([{ name: 'f1' }], 'f1')).toEqual([]);
    expect(getReturnFields([{ name: 'f1' }], 'not-exist')).toEqual([]);
  });

  it('属性传递：从 response.result.properties 提取标签（含类型）', () => {
    const funcs = [{ name: 'f1', response: { result: { properties: { qty: { type: 'number', display_name: '数量' } } } } }];
    expect(getReturnFields(funcs, 'f1')).toEqual([{ label: '数量（number）', value: 'qty' }]);
  });

  it('边界：无 result 包装时回退 response.properties，缺少类型显示 any', () => {
    const funcs = [{ name: 'f1', response: { properties: { flag: {} } } }];
    expect(getReturnFields(funcs, 'f1')).toEqual([{ label: 'flag（any）', value: 'flag' }]);
  });
});

describe('literalNodeToText / literalSetNodeToText — 存储转文本', () => {
  it('属性传递：存量无 valueType 的原文显示、字符串加引号、数字原样', () => {
    expect(literalNodeToText({ value: '存量原文' })).toBe('存量原文');
    expect(literalNodeToText({ valueType: 'string', value: 'abc' })).toBe("'abc'");
    expect(literalNodeToText({ valueType: 'integer', value: 42 })).toBe('42');
  });

  it('边界：空值节点显示为空串', () => {
    expect(literalNodeToText({ valueType: 'null', value: null })).toBe('');
    expect(literalNodeToText({ value: null })).toBe('');
  });

  it('属性传递：字面值集按元素类型决定是否加引号', () => {
    expect(literalSetNodeToText({ elementType: 'string', value: ['a', 'b'] })).toBe("['a', 'b']");
    expect(literalSetNodeToText({ elementType: 'integer', value: [1, 2] })).toBe('[1, 2]');
  });

  it('边界：value 非数组时按空集渲染', () => {
    expect(literalSetNodeToText({ elementType: 'integer', value: undefined })).toBe('[]');
  });
});
