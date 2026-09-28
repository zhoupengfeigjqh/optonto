/**
 * 安全确认弹窗纯逻辑单测（章程 III：属性传递 / 边界条件）。
 * 覆盖：参数声明的名称与必填取值、标量参数、空值判定、对象值序列化、无参数；
 *       说明/审核要求区块解析、缺失区块、空内容。
 */
import { describe, it, expect } from 'vitest';
import { buildConfirmRows, parseConfirmContent } from './security-confirm-content';

describe('buildConfirmRows — 参数行构建', () => {
  it('属性传递：对象声明取 description 作为中文名、value 作为值、required 作为必填', () => {
    const rows = buildConfirmRows({
      rawMaterialId: { value: 'RM-001', description: '原材料ID', required: true },
    });
    expect(rows).toEqual([
      { key: 'rawMaterialId', name: '原材料ID', value: 'RM-001', required: true, empty: false },
    ]);
  });

  it('标量参数：中文名回退为 key，值转为字符串，非必填', () => {
    const rows = buildConfirmRows({ count: 42 });
    expect(rows[0]).toEqual({ key: 'count', name: 'count', value: '42', required: false, empty: false });
  });

  it('边界：空串 / null / undefined 标记为待补充', () => {
    const rows = buildConfirmRows({
      a: '', b: null, c: undefined, d: { value: '', description: '空值项' },
    });
    expect(rows.map(r => r.empty)).toEqual([true, true, true, true]);
  });

  it('边界：值本身是对象时序列化为 JSON，不出现 [object Object]', () => {
    const rows = buildConfirmRows({ order: { value: { lines: [1, 2] } } });
    expect(rows[0].value).toBe('{"lines":[1,2]}');
  });

  it('边界：无参数（undefined / 空对象）返回空数组', () => {
    expect(buildConfirmRows(undefined)).toEqual([]);
    expect(buildConfirmRows(null)).toEqual([]);
    expect(buildConfirmRows({})).toEqual([]);
  });

  it('属性传递：对象声明缺少 description 时中文名回退为 key', () => {
    const rows = buildConfirmRows({ unit: { value: '吨' } });
    expect(rows[0].name).toBe('unit');
    expect(rows[0].required).toBe(false);
  });
});

describe('parseConfirmContent — 说明/审核要求解析', () => {
  it('属性传递：解析【说明】与【审核要求】两区块', () => {
    const content = '【说明】创建采购单\n【审核要求】需采购经理确认';
    expect(parseConfirmContent(content)).toEqual({
      description: '创建采购单',
      audit: '需采购经理确认',
    });
  });

  it('边界：只存在其中一个区块时，另一个为空串', () => {
    expect(parseConfirmContent('【说明】仅说明')).toEqual({ description: '仅说明', audit: '' });
    expect(parseConfirmContent('【审核要求】仅审核')).toEqual({ description: '', audit: '仅审核' });
  });

  it('边界：无关行被忽略，前后空白被裁剪', () => {
    const content = '普通文本\n  【说明】   带空格的说明   \n其他内容';
    expect(parseConfirmContent(content).description).toBe('带空格的说明');
  });

  it('边界：空内容返回两个空串', () => {
    expect(parseConfirmContent('')).toEqual({ description: '', audit: '' });
  });
});
