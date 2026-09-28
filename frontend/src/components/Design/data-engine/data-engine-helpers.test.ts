/**
 * 映射页纯 helper 单测（章程 III：属性传递 / 边界条件）。
 * 覆盖：字段拍平（嵌套 object / array / array[object]）、Schema→params 转换、
 * 响应样本反推结构、空白引擎构建。
 */
import { describe, it, expect } from 'vitest';
import {
  flattenFieldTypes, flattenFields, schemaToParams, inferFromSample, emptyEngine, emptyTarget,
  hasTargetEndpoint, hasTargetSchema, countMappedFields, isTypeMismatch, unmappedTargetFields,
  buildConnectFormValues, coerceConnectParams, seedArgsFromParamSchema,
} from './data-engine-helpers';

describe('flattenFields / flattenFieldTypes — 字段拍平', () => {
  const schema = {
    name: { type: 'string' },
    order: {
      type: 'object',
      properties: { id: { type: 'integer' }, note: { type: 'string' } },
    },
    lines: {
      type: 'array',
      items: { type: 'object', properties: { prod: { type: 'string' } } },
    },
    tags: { type: 'array', items: { type: 'string' } },
    legacy: { type: 'array[object]', items: { properties: { k: { type: 'number' } } } },
  };

  it('属性传递：嵌套 object 递归展开为点路径', () => {
    const fields = flattenFields(schema);
    expect(fields).toContain('order.id');
    expect(fields).toContain('order.note');
  });

  it('属性传递：array[object] 元素字段带 [*] 路径', () => {
    const fields = flattenFields(schema);
    expect(fields).toContain('lines[*].prod');
    expect(fields).toContain('legacy[*].k');
  });

  it('属性传递：标量数组产出 [*] 路径', () => {
    expect(flattenFields(schema)).toContain('tags[*]');
  });

  it('属性传递：flattenFieldTypes 返回 路径→类型 映射（含嵌套）', () => {
    const types = flattenFieldTypes(schema);
    expect(types['name']).toBe('string');
    expect(types['order']).toBe('object');
    expect(types['order.id']).toBe('integer');
    expect(types['tags[*]']).toBe('string');
  });

  it('边界：空对象返回空结果', () => {
    expect(flattenFields({})).toEqual([]);
    expect(flattenFieldTypes({})).toEqual({});
  });

  it('边界：字符串型值（旧形态）直接作为路径', () => {
    expect(flattenFields({ a: 'string', b: 'number' })).toEqual(['a', 'b']);
    expect(flattenFieldTypes({ a: 'string' })).toEqual({ a: 'string' });
  });
});

describe('schemaToParams — JSON Schema 转平台结构', () => {
  it('属性传递：含 required 标记与 description', () => {
    const out = schemaToParams({
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', description: '甲' }, b: { type: 'integer' } },
    });
    expect(out.a).toEqual({ type: 'string', description: '甲', required: true });
    expect(out.b).toEqual({ type: 'integer' });
  });

  it('属性传递：嵌套 object 与 array[object] 递归转换', () => {
    const out = schemaToParams({
      type: 'object',
      properties: {
        order: { type: 'object', properties: { id: { type: 'integer' } } },
        lines: { type: 'array', items: { type: 'object', properties: { p: { type: 'string' } } } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
    expect((out.order as any).properties.id).toEqual({ type: 'integer' });
    expect((out.lines as any).items).toEqual({ type: 'object', properties: { p: { type: 'string' } } });
    expect((out.tags as any).items).toEqual({ type: 'string' });
  });

  it('边界：null / 无 properties 的 schema 返回空对象', () => {
    expect(schemaToParams(null)).toEqual({});
    expect(schemaToParams(undefined)).toEqual({});
    expect(schemaToParams({ type: 'object' })).toEqual({});
  });

  it('边界：缺 type 的字段按 string 处理，缺 items.type 的元素按 string', () => {
    const out = schemaToParams({ properties: { x: {}, arr: { type: 'array', items: {} } } });
    expect((out.x as any).type).toBe('string');
    expect((out.arr as any).items).toEqual({ type: 'string' });
  });
});

describe('inferFromSample — 响应样本反推结构', () => {
  it('属性传递：数组取首元素，标量按类型映射', () => {
    expect(inferFromSample([{ a: 1, b: 'x', c: true, d: 1.5 }])).toEqual({
      a: { type: 'integer' }, b: { type: 'string' }, c: { type: 'boolean' }, d: { type: 'number' },
    });
  });

  it('属性传递：嵌套对象与对象数组递归', () => {
    expect(inferFromSample({ order: { id: 1 }, lines: [{ p: 'x' }] })).toEqual({
      order: { type: 'object', properties: { id: { type: 'integer' } } },
      lines: { type: 'array', items: { type: 'object', properties: { p: { type: 'string' } } } },
    });
  });

  it('边界：标量数组按首元素类型标注', () => {
    expect(inferFromSample({ tags: [1, 2] })).toEqual({ tags: { type: 'array', items: { type: 'number' } } });
    expect(inferFromSample({ tags: [] })).toEqual({ tags: { type: 'array', items: { type: 'string' } } });
  });

  it('边界：非对象输入（null / 标量 / 空数组）返回空对象', () => {
    expect(inferFromSample(null)).toEqual({});
    expect(inferFromSample(undefined)).toEqual({});
    expect(inferFromSample('text')).toEqual({});
    expect(inferFromSample(42)).toEqual({});
    expect(inferFromSample([])).toEqual({});
  });
});

describe('emptyEngine — 空白引擎', () => {
  it('属性传递：以行为名作引擎名与绑定，映射为空，target 为空白副本', () => {
    const engine = emptyEngine('QueryInventory');
    expect(engine.name).toBe('QueryInventory');
    expect(engine.behavior_name).toBe('QueryInventory');
    expect(engine.input_mapping).toEqual({});
    expect(engine.output_mapping).toEqual({});
    expect(engine.target).toEqual(emptyTarget);
  });

  it('边界：target 为深一层副本，修改互不影响', () => {
    const a = emptyEngine('A');
    a.target.method = 'GET';
    expect(emptyEngine('B').target.method).toBe('');
    expect(emptyTarget.method).toBe('');
  });
});

describe('表格判据 — hasTargetEndpoint / hasTargetSchema / countMappedFields', () => {
  it('属性传递：任一目标标识字段存在即视为已设置', () => {
    for (const field of ['server_url', 'tool_name', 'url', 'api_name', 'data_source_name'] as const) {
      expect(hasTargetEndpoint({ ...emptyTarget, [field]: 'x' })).toBe(true);
    }
    expect(hasTargetEndpoint({ ...emptyTarget })).toBe(false);
  });

  it('边界：target 为 null / undefined 时判定为未设置', () => {
    expect(hasTargetEndpoint(null)).toBe(false);
    expect(hasTargetEndpoint(undefined)).toBe(false);
    expect(hasTargetSchema(null)).toBe(false);
    expect(hasTargetSchema(undefined)).toBe(false);
  });

  it('属性传递：已声明输入或输出结构即视为可对齐', () => {
    expect(hasTargetSchema({ ...emptyTarget, params: { a: { type: 'string' } } })).toBe(true);
    expect(hasTargetSchema({ ...emptyTarget, response: { b: { type: 'string' } } })).toBe(true);
  });

  it('边界：结构为空对象时不可对齐（区别于字段缺失）', () => {
    expect(hasTargetSchema({ ...emptyTarget, params: {}, response: {} })).toBe(false);
  });

  it('属性传递：只统计已填充的映射条目', () => {
    expect(countMappedFields({ a: 'x', b: '', c: 'y' })).toBe(2);
  });

  it('边界：空映射 / undefined 返回 0', () => {
    expect(countMappedFields({})).toBe(0);
    expect(countMappedFields(undefined)).toBe(0);
    expect(countMappedFields(null)).toBe(0);
  });
});

describe('映射校验 — isTypeMismatch / unmappedTargetFields', () => {
  it('属性传递：两侧类型都存在且不同 → 不符', () => {
    expect(isTypeMismatch('string', 'qty', 'integer')).toBe(true);
    expect(isTypeMismatch('string', 'name', 'string')).toBe(false);
  });

  it('边界：未选目标字段、或任一侧缺类型 → 不算不符', () => {
    expect(isTypeMismatch('string', '', 'integer')).toBe(false);
    expect(isTypeMismatch('', 'qty', 'integer')).toBe(false);
    expect(isTypeMismatch('string', 'qty', '')).toBe(false);
  });

  it('属性传递：返回未被映射覆盖的目标字段', () => {
    expect(unmappedTargetFields(['a', 'b', 'c'], { x: 'a', y: 'c' })).toEqual(['b']);
  });

  it('边界：全部覆盖返回空数组；空目标字段返回空数组', () => {
    expect(unmappedTargetFields(['a'], { x: 'a' })).toEqual([]);
    expect(unmappedTargetFields([], { x: 'a' })).toEqual([]);
  });
});

describe('buildConnectFormValues — 连接测试表单初值', () => {
  it('属性传递：必填标记取自目标参数，并按输入映射换名查找', () => {
    const { required } = buildConnectFormValues(
      { 数量: { type: 'integer' } },
      { qty: { type: 'integer', required: true } },
      { 数量: 'qty' },
    );
    expect(required['数量']).toBe(true);
  });

  it('边界：目标参数未声明 required 字段时视为必填（required !== false）', () => {
    const { required } = buildConnectFormValues({ q: 'integer' }, { q: { type: 'integer' } }, {});
    expect(required.q).toBe(true);
  });

  it('边界：目标参数显式 required=false 时为非必填', () => {
    const { required } = buildConnectFormValues({ q: 'integer' }, { q: { required: false } }, {});
    expect(required.q).toBe(false);
  });

  it('属性传递：按类型给出默认值（object→{} / array→[] / boolean→false / 其余空串）', () => {
    const { params } = buildConnectFormValues(
      {
        o: { type: 'object' }, a: { type: 'array' }, ao: { type: 'array[object]' },
        b: { type: 'boolean' }, s: { type: 'string' }, legacy: 'string',
      },
      {}, {},
    );
    expect(params.o).toBe('{}');
    expect(params.a).toBe('[]');
    expect(params.ao).toBe('[]');
    expect(params.b).toBe(false);
    expect(params.s).toBe('');
    expect(params.legacy).toBe('');
  });

  it('边界：标量参数不产出初始值（保持既有行为）', () => {
    const { params } = buildConnectFormValues({ n: 5, flag: true }, {}, {});
    expect('n' in params).toBe(false);
    expect('flag' in params).toBe(false);
  });

  it('边界：空本体参数返回空对象与空必填表', () => {
    expect(buildConnectFormValues({}, {}, {})).toEqual({ params: {}, required: {} });
  });
});

describe('coerceConnectParams — 提交前反序列化', () => {
  it('属性传递：JSON 对象/数组字符串还原为结构', () => {
    expect(coerceConnectParams({ o: '{"a":1}', a: '[1,2]' })).toEqual({ o: { a: 1 }, a: [1, 2] });
  });

  it('边界：JSON 非法时保留原字符串，不丢用户输入', () => {
    expect(coerceConnectParams({ bad: '{oops' })).toEqual({ bad: '{oops' });
  });

  it('边界：非字符串与普通字符串原样透传', () => {
    expect(coerceConnectParams({ n: 1, b: false, s: 'abc' })).toEqual({ n: 1, b: false, s: 'abc' });
  });
});

describe('seedArgsFromParamSchema — 试调样例参数', () => {
  it('属性传递：按类型生成占位值', () => {
    expect(seedArgsFromParamSchema(JSON.stringify({
      i: { type: 'integer' }, n: { type: 'number' }, b: { type: 'boolean' },
      a: { type: 'array' }, o: { type: 'object' }, s: { type: 'string' },
    }))).toEqual({ i: 1, n: 1, b: false, a: [], o: {}, s: '' });
  });

  it('边界：输入 JSON 非法 / 空串 时返回空样例', () => {
    expect(seedArgsFromParamSchema('{oops')).toEqual({});
    expect(seedArgsFromParamSchema('')).toEqual({});
  });
});
