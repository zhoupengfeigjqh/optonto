/**
 * YAML 顶层节切分/组装单测（章程 III）。
 * 覆盖三类条件：属性传递（返回结构与键名）、事件触发（无）、边界（无顶层键/仅注释/嵌套键/往返一致）。
 */
import { describe, it, expect } from 'vitest';
import { splitDoc, assemble, ALL, KEY_LABELS } from './yaml-segments';

const DOC = `# 头部注释
metadata:
  name: 测试

concepts:
  - name: A
relations:
  - name: r1
`;

describe('splitDoc — 顶层节切分', () => {
  it('属性传递：header 收纳首个顶层键之前的内容，segs 按顶层键切分', () => {
    const doc = splitDoc(DOC);
    expect(doc.header).toBe('# 头部注释');
    expect(doc.segs.map(s => s.key)).toEqual(['metadata', 'concepts', 'relations']);
  });

  it('每段文本完整保留（含其缩进子内容）', () => {
    const doc = splitDoc(DOC);
    const concepts = doc.segs.find(s => s.key === 'concepts')!;
    expect(concepts.text).toBe('concepts:\n  - name: A');
  });

  it('边界：嵌套键（有缩进）不产生新段', () => {
    const doc = splitDoc(DOC);
    expect(doc.segs.map(s => s.key)).not.toContain('name');
  });

  it('边界：无顶层键时全部归入 header 且 segs 为空', () => {
    const doc = splitDoc('# 只有注释\n# 再来一行');
    expect(doc.segs).toEqual([]);
    expect(doc.header).toBe('# 只有注释\n# 再来一行');
  });

  it('边界：空内容不抛错', () => {
    expect(splitDoc('')).toEqual({ header: '', segs: [] });
  });
});

describe('assemble — 段组装', () => {
  it('往返一致：assemble(splitDoc(x)) 还原原文', () => {
    expect(assemble(splitDoc(DOC))).toBe(DOC);
  });

  it('属性传递：空 header 被过滤，不产生多余首行', () => {
    const doc = splitDoc('metadata:\n  name: A\n');
    expect(assemble(doc)).toBe('metadata:\n  name: A\n');
  });

  it('边界：仅有 header 的文档原样返回', () => {
    expect(assemble({ header: '# 注释', segs: [] })).toBe('# 注释');
  });
});

describe('常量', () => {
  it('ALL 为全量哨兵值，KEY_LABELS 覆盖九个顶层节', () => {
    expect(ALL).toBe('__all__');
    expect(Object.keys(KEY_LABELS)).toHaveLength(9);
    expect(KEY_LABELS.behaviors).toBe('行为');
  });
});
