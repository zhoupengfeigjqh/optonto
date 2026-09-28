/**
 * 实例图模型层单测（章程 III：属性传递 / 边界条件）。
 * 覆盖：API 信封行提取（含空数组回退与环状引用）、节点标签、结果列构建与排序、图表 option 结构。
 */
import { describe, it, expect } from 'vitest';
import type { Concept } from '@/api/client';
import {
  extractRows, nodeLabel, buildResultColumns, buildChartOption,
  MAX_DEPTH, MAX_PER_CONCEPT, MAX_TOTAL, CONCEPT_COLORS,
} from './instance-graph-model';

describe('extractRows — API 信封行提取', () => {
  it('属性传递：直接是对象数组时原样返回', () => {
    expect(extractRows([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('属性传递：多层信封中向下找到第一个对象数组', () => {
    expect(extractRows({ data: { data: [{ a: 1 }, { a: 2 }] } })).toEqual([{ a: 1 }, { a: 2 }]);
    expect(extractRows({ a: { b: { c: [{ x: 1 }] } } })).toEqual([{ x: 1 }]);
  });

  it('边界：找不到对象数组时回退到第一个空数组', () => {
    expect(extractRows({ data: [] })).toEqual([]);
    expect(extractRows({ a: [], b: [] })).toEqual([]);
  });

  it('边界：全是标量 / 数组套数组时返回空数组', () => {
    expect(extractRows({})).toEqual([]);
    expect(extractRows({ x: 1, y: 'a' })).toEqual([]);
    expect(extractRows({ x: [[1, 2]] })).toEqual([]);
  });

  it('边界：环状引用不会死循环', () => {
    const cyc: any = { name: 'root' };
    cyc.self = cyc;
    expect(extractRows(cyc)).toEqual([]);
  });
});

describe('nodeLabel — 节点标签', () => {
  const concept: Concept = { name: 'RawMaterial', display_name: '原材料', description: '', instance_label: 'materialName' };

  it('属性传递：配置 instance_label 时拼接「概念:标签值」', () => {
    expect(nodeLabel(concept, { materialName: '钢板' }, 'k')).toBe('原材料:钢板');
  });

  it('边界：未配置 instance_label 时只显示概念名', () => {
    expect(nodeLabel({ name: 'RawMaterial', description: '' }, { materialName: '钢板' }, 'k')).toBe('RawMaterial');
  });

  it('边界：标签值为空串/缺失时退回概念名，概念缺失时为空串', () => {
    expect(nodeLabel(concept, { materialName: '' }, 'k')).toBe('原材料');
    expect(nodeLabel(concept, {}, 'k')).toBe('原材料');
    expect(nodeLabel(undefined, { a: 1 }, 'k')).toBe('');
  });

  it('边界：展示名优先于技术名', () => {
    expect(nodeLabel({ name: 'RawMaterial', display_name: '原材料', description: '' }, {}, 'k')).toBe('原材料');
  });
});

describe('buildResultColumns — 结果列构建', () => {
  const conceptMap = new Map<string, Concept>([
    ['RawMaterial', {
      name: 'RawMaterial', display_name: '原材料', description: '',
      attributes: [{ name: 'b', type: 'string' }, { name: 'a', type: 'string', display_name: '甲字段' }],
    }],
  ]);

  it('属性传递：按概念属性顺序排序，列名取属性展示名', () => {
    const cols = buildResultColumns([{ a: 1, b: 2 }], 'RawMaterial', conceptMap);
    expect(cols.map(c => c.key)).toEqual(['b', 'a']);
    expect(cols.find(c => c.key === 'a')!.title).toBe('甲字段');
    expect(cols.find(c => c.key === 'b')!.title).toBe('b');
  });

  it('属性传递：render 处理 null 与对象', () => {
    const cols = buildResultColumns([{ a: null, b: { x: 1 } }], 'RawMaterial', conceptMap);
    expect(cols.find(c => c.key === 'a')!.render(null)).toBe('-');
    expect(cols.find(c => c.key === 'b')!.render({ x: 1 })).toBe('{"x":1}');
  });

  it('边界：无数据 / 未选概念时返回空列', () => {
    expect(buildResultColumns(null, 'RawMaterial', conceptMap)).toEqual([]);
    expect(buildResultColumns([], 'RawMaterial', conceptMap)).toEqual([]);
    expect(buildResultColumns([{ a: 1 }], null, conceptMap)).toEqual([]);
  });

  it('边界：列数上限为 8', () => {
    const row: Record<string, any> = {};
    for (let i = 0; i < 12; i++) row[`k${i}`] = i;
    expect(buildResultColumns([row], 'RawMaterial', conceptMap)).toHaveLength(8);
  });
});

describe('buildChartOption — 图表 option 结构', () => {
  it('属性传递：图系列与图例来自入参，工具提示对节点/边返回 HTML', () => {
    const option = buildChartOption(
      {
        nodes: [{ id: 'n1', name: '钢板', concept: 'RawMaterial', row: { a: 1 }, category: 0, symbolSize: 20 }],
        edges: [{ source: 'n1', target: 'n2', relation: 'has' }],
        categories: [{ name: '原材料', itemStyle: { color: '#3b82f6' } }],
      },
      new Map<string, Concept>(),
    );
    expect(option.series[0].type).toBe('graph');
    expect(option.legend.data).toEqual(['原材料']);

    const formatter = option.tooltip.formatter as (p: any) => string;
    const nodeHtml = formatter({ dataType: 'node', data: { concept: 'RawMaterial', row: { a: 1 } } });
    expect(nodeHtml).toContain('a: ');
    expect(nodeHtml).toContain('>1<');
    expect(formatter({ dataType: 'edge', data: { label: { formatter: 'has' } } })).toContain('has');
    expect(formatter({ dataType: 'other' })).toBe('');
  });
});

describe('常量', () => {
  it('BFS 与调色板常量符合预期', () => {
    expect(MAX_DEPTH).toBe(3);
    expect(MAX_PER_CONCEPT).toBe(50);
    expect(MAX_TOTAL).toBe(200);
    expect(CONCEPT_COLORS.length).toBeGreaterThan(0);
  });
});
