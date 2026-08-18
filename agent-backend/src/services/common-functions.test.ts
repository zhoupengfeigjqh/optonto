/**
 * common-functions 单测 —— schemaToDeclaredParams（JSON Schema → 本体函数 params 同形声明）的纯函数测试，
 * 以及 getCommonFunctionParams 对真实 functions.json 的读取测试。
 * 目的：公共函数参数结构校验（方案A 收尾）—— 公共函数 inputSchema 能正确转换为 validateParamStructure 可校验的声明形状。
 */
import { describe, it, expect } from 'vitest';
import { schemaToDeclaredParams, getCommonFunctionParams, getCommonFunctionMeta, getCommonFunctionNames } from './common-functions.js';

describe('schemaToDeclaredParams（JSON Schema → 本体函数 params 同形声明）', () => {
  it('顶层 required:[数组] → 每个参数 required:boolean，type/description 原样保留', () => {
    const declared = schemaToDeclaredParams({
      type: 'object',
      properties: {
        date: { type: 'string', description: '基准日期 yyyy-MM-dd' },
        days: { type: 'integer', description: '加减天数' },
      },
      required: ['date', 'days'],
    });
    expect(declared).toEqual({
      date: { type: 'string', description: '基准日期 yyyy-MM-dd', required: true },
      days: { type: 'integer', description: '加减天数', required: true },
    });
  });

  it('未列入 required 数组的参数 required:false（可选）', () => {
    const declared = schemaToDeclaredParams({
      type: 'object',
      properties: { opt: { type: 'string' }, req: { type: 'number' } },
      required: ['req'],
    });
    expect(declared.opt.required).toBe(false);
    expect(declared.req.required).toBe(true);
  });

  it('属性带 example → 转换结果带 example 字段（公共函数参数示例）', () => {
    const declared = schemaToDeclaredParams({
      type: 'object',
      properties: {
        date: { type: 'string', description: '基准日期', example: '2026-08-01' },
        days: { type: 'integer', example: 7 },
      },
      required: ['date', 'days'],
    });
    expect(declared.date).toMatchObject({ type: 'string', required: true, description: '基准日期', example: '2026-08-01' });
    expect(declared.days).toMatchObject({ type: 'integer', required: true, example: 7 });
  });

  it('array 参数：items 递归为 {type:object, properties, required:[数组]}，外层 required:boolean', () => {
    const declared = schemaToDeclaredParams({
      type: 'object',
      properties: {
        purchaseRecordSet: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              arrivalTime: { type: 'string' },
              arrivalQuantity: { type: 'number' },
            },
            required: ['arrivalTime', 'arrivalQuantity'],
          },
        },
      },
      required: ['purchaseRecordSet'],
    });
    expect(declared.purchaseRecordSet).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          arrivalTime: { type: 'string', required: true },
          arrivalQuantity: { type: 'number', required: true },
        },
        required: ['arrivalTime', 'arrivalQuantity'],
      },
      required: true,
    });
  });

  it('空 properties → 空对象（无参数函数的形状）', () => {
    expect(schemaToDeclaredParams({ type: 'object', properties: {} })).toEqual({});
  });
});

describe('getCommonFunctionParams（真实 functions.json）', () => {
  it('dateAdd → {date, days} 均为必填，类型 string/integer，带 example', () => {
    const params = getCommonFunctionParams('dateAdd')!;
    expect(params).toMatchObject({
      date: { type: 'string', required: true, example: '2026-08-01' },
      days: { type: 'integer', required: true, example: 7 },
    });
  });

  it('无参数函数 getCurrentDate → 空对象（非 null，结构校验对空声明放行）', () => {
    expect(getCommonFunctionParams('getCurrentDate')).toEqual({});
  });

  it('不在 functions.json → null', () => {
    expect(getCommonFunctionParams('notExistFn')).toBeNull();
  });
});

describe('getCommonFunctionMeta（真实 functions.json 展示元信息）', () => {
  it('dateAdd → 返回中文显示名 日期加减 + 描述', () => {
    const meta = getCommonFunctionMeta('dateAdd');
    expect(meta.display_name).toBe('日期加减');
    expect(meta.description).toContain('日期加减指定天数');
  });

  it('不在 functions.json → 空显示名（上层用子任务描述兜底）', () => {
    expect(getCommonFunctionMeta('notExistFn').display_name).toBe('');
  });
});

describe('getCommonFunctionNames', () => {
  it('包含全部已知公共函数', () => {
    for (const n of ['getCurrentDate', 'dateAdd', 'dateDiff', 'getWeekday']) {
      expect(getCommonFunctionNames()).toContain(n);
    }
  });
});
