/**
 * 本体视图模型层单测（章程 III：属性传递 / 边界条件）。
 *
 * 重点覆盖 2026-10-31 的连线口径调整：函数不再与概念连线，改为「规则 → 关联函数」；
 * 同时回归既有连线（行为→概念、规则→行为、概念→概念）与节点属性派生。
 */
import { describe, it, expect } from 'vitest';
import type { Concept, OntologyData } from '@/api/client';
import { buildOntologyGraph, CATEGORIES, attrLabel, type GraphEdge } from './ontology-graph-model';

// ─── 测试夹具 ────────────────────────────────────────────────────────────

const makeData = (over: Partial<OntologyData> = {}): OntologyData =>
  ({
    concepts: [],
    relations: [],
    behaviors: [],
    rules: [],
    processes: [],
    securities: [],
    data_engines: [],
    functions: [],
    ...over,
  } as unknown as OntologyData);

const concept = (name: string, over: Partial<Concept> = {}): Concept =>
  ({ name, description: `${name} 描述`, ...over } as Concept);

const findEdge = (edges: GraphEdge[], source: string, target: string) =>
  edges.find(e => e.source === source && e.target === target);

const fromPrefix = (edges: GraphEdge[], prefix: string) =>
  edges.filter(e => e.source.startsWith(prefix));

// ─── 空态 ────────────────────────────────────────────────────────────────

describe('buildOntologyGraph — 空态', () => {
  it('边界：data 为 null 时返回空图且类别常量不变', () => {
    const graph = buildOntologyGraph(null, []);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.categories).toBe(CATEGORIES);
  });

  it('边界：全空的 OntologyData 不产出节点与边', () => {
    const graph = buildOntologyGraph(makeData(), []);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('边界：related_functions 缺省（undefined）时不报错', () => {
    const data = makeData({
      rules: [{ name: 'r1', description: '', behavior: '', related_functions: undefined as any }],
    });
    expect(() => buildOntologyGraph(data, [])).not.toThrow();
  });
});

// ─── 新口径：规则 → 关联函数 ─────────────────────────────────────────────

describe('buildOntologyGraph — 规则 → 关联函数', () => {
  const data = makeData({
    rules: [
      { name: 'r1', description: '', behavior: '', related_functions: ['f1', 'pub_fn', 'f1'] },
      { name: 'r2', description: '', behavior: '', related_functions: ['f2'] },
    ],
    functions: [
      { name: 'f1', description: '', related_concepts: [] },
      { name: 'f2', description: '', related_concepts: [] },
    ],
  });

  it('属性传递：规则关联的本体函数产出 rule→function 边（规则为源，函数为目标）', () => {
    const { edges } = buildOntologyGraph(data, []);
    const edge = findEdge(edges, 'rule:r1', 'function:f1');
    expect(edge).toBeDefined();
    expect(edge?.lineStyle).toMatchObject({ color: '#a855f7', type: 'dashed' });
  });

  it('属性传递：多条规则各自连到自己的关联函数', () => {
    const { edges } = buildOntologyGraph(data, []);
    expect(findEdge(edges, 'rule:r2', 'function:f2')).toBeDefined();
    expect(findEdge(edges, 'rule:r2', 'function:f1')).toBeUndefined();
  });

  it('边界：公共函数不在本体函数清单内 → 不建边（图内无该节点）', () => {
    const { edges, nodes } = buildOntologyGraph(data, []);
    expect(nodes.some(n => n.id === 'function:pub_fn')).toBe(false);
    expect(edges.some(e => e.target === 'function:pub_fn')).toBe(false);
  });

  it('边界：同一函数重复声明只建一条边', () => {
    const { edges } = buildOntologyGraph(data, []);
    expect(fromPrefix(edges, 'rule:r1').filter(e => e.target === 'function:f1')).toHaveLength(1);
  });

  it('边界：函数清单缺省时规则边全部跳过', () => {
    const noFuncs = makeData({
      rules: [{ name: 'r1', description: '', behavior: '', related_functions: ['f1'] }],
    });
    const { edges } = buildOntologyGraph(noFuncs, []);
    expect(edges.some(e => e.source === 'rule:r1')).toBe(false);
  });
});

// ─── 新口径：函数不再连概念 ──────────────────────────────────────────────

describe('buildOntologyGraph — 函数与概念不再连线', () => {
  const data = makeData({
    concepts: [concept('C1'), concept('C2')],
    functions: [{ name: 'f1', description: '', related_concepts: ['C1', 'C2'] }],
  });

  it('属性传递：函数节点保留，类别为「函数」', () => {
    const { nodes } = buildOntologyGraph(data, []);
    const node = nodes.find(n => n.id === 'function:f1');
    expect(node).toBeDefined();
    expect(node?.category).toBe(3);
  });

  it('回归：related_concepts 不再产出函数→概念边，函数无出边', () => {
    const { edges } = buildOntologyGraph(data, []);
    expect(fromPrefix(edges, 'function:')).toHaveLength(0);
    expect(edges.some(e => e.target.startsWith('function:'))).toBe(false);
  });
});

// ─── 既有连线回归 ────────────────────────────────────────────────────────

describe('buildOntologyGraph — 既有连线', () => {
  it('属性传递：行为→关联概念（标量 concept）', () => {
    const data = makeData({
      concepts: [concept('C1')],
      behaviors: [{ name: 'b1', description: '', concept: 'C1' } as any],
    });
    const { edges } = buildOntologyGraph(data, []);
    expect(findEdge(edges, 'behavior:b1', 'concept:C1')?.lineStyle).toMatchObject({ color: '#10b981' });
  });

  it('属性传递：规则→绑定行为（标量 behavior）', () => {
    const data = makeData({
      behaviors: [{ name: 'b1', description: '', concept: '' } as any],
      rules: [{ name: 'r1', description: '', behavior: 'b1', related_functions: [] }],
    });
    const { edges } = buildOntologyGraph(data, []);
    expect(findEdge(edges, 'rule:r1', 'behavior:b1')?.lineStyle).toMatchObject({ color: '#f59e0b' });
  });

  it('属性传递：概念关系边带关系名标签，N:M 用实线', () => {
    const data = makeData({
      concepts: [concept('C1'), concept('C2')],
      relations: [{ name: 'rel1', title: '包含', source: 'C1', target: 'C2', cardinality: 'N:M' } as any],
    });
    const { edges } = buildOntologyGraph(data, []);
    const edge = findEdge(edges, 'concept:C1', 'concept:C2');
    expect(edge?.label?.formatter).toBe('包含');
    expect(edge?.lineStyle).toMatchObject({ type: 'solid' });
  });

  it('边界：关系端点概念不存在时不建边', () => {
    const data = makeData({
      concepts: [concept('C1')],
      relations: [{ name: 'rel1', source: 'C1', target: '缺失概念', cardinality: '1:N' } as any],
    });
    const { edges } = buildOntologyGraph(data, []);
    expect(edges).toHaveLength(0);
  });

  it('边界：行为/规则指向不存在的目标时不建边', () => {
    const data = makeData({
      behaviors: [{ name: 'b1', description: '', concept: '不存在' } as any],
      rules: [{ name: 'r1', description: '', behavior: '不存在', related_functions: [] }],
    });
    expect(buildOntologyGraph(data, []).edges).toHaveLength(0);
  });
});

// ─── 节点属性与标题 ──────────────────────────────────────────────────────

describe('buildOntologyGraph — 节点属性与标题', () => {
  it('属性传递：概念属性取 /concepts 派生视图（自有 ∪ 继承）', () => {
    const data = makeData({
      // /data 落盘原样：只含自有属性
      concepts: [concept('C1', { attributes: [{ name: 'id', type: 'string' }] } as any)],
    });
    const derived: Concept[] = [
      concept('C1', {
        attributes: [{ name: 'id', type: 'string' }] as any,
        inherited_attributes: [{ name: 'createdAt', type: 'string', title: '创建时间' }] as any,
      }),
    ];
    const { nodes } = buildOntologyGraph(data, derived);
    expect(nodes[0].attributes?.map(a => a.name)).toEqual(['id', 'createdAt']);
  });

  it('边界：/concepts 未返回该概念时回退 /data 的自有属性', () => {
    const data = makeData({
      concepts: [concept('C1', { attributes: [{ name: 'id', type: 'string' }] } as any)],
    });
    const { nodes } = buildOntologyGraph(data, []);
    expect(nodes[0].attributes?.map(a => a.name)).toEqual(['id']);
  });

  it('属性传递：有 title 时展示中文名，无 title 回退 name', () => {
    const data = makeData({
      concepts: [concept('C1', { title: '订单' })],
      functions: [{ name: 'f1', description: '', related_concepts: [] }],
    });
    const { nodes } = buildOntologyGraph(data, []);
    expect(nodes.find(n => n.id === 'concept:C1')?.title).toBe('订单');
    expect(nodes.find(n => n.id === 'function:f1')?.title).toBe('f1');
  });

  it('attrLabel：优先 title，缺失回退 name', () => {
    expect(attrLabel({ name: 'id', title: '编号' })).toBe('编号');
    expect(attrLabel({ name: 'id' })).toBe('id');
  });
});
