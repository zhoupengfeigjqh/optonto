/**
 * 本体视图（OntologyGraph）的模型层：常量、节点/边类型与纯函数 `buildOntologyGraph`。
 *
 * 视图组件只负责状态与交互，图数据口径在此收口，便于单独补测。
 *
 * 连线口径（2026-10-31 起）：
 * - 行为 → 关联概念（标量 `behavior.concept`）
 * - 规则 → 绑定行为（标量 `rule.behavior`）
 * - 规则 → 关联函数（`rule.related_functions`，仅本体内函数；公共函数不在本图中，跳过）
 * - 概念 → 概念（`relations`，带关系名标签）
 * - 函数**不再**与概念连线（原 `functions[].related_concepts` 连线已移除）
 */
import { effectiveAttributes } from '@/api/client';
import type { Concept, OntologyData } from '@/api/client';

// ─── 属性展示名：优先中文 title，缺失回退英文属性名 ──────────────────

export const attrLabel = (a: { name: string; title?: string }): string =>
  a.title || a.name;

// ─── 类型 ────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  name: string;
  title: string;
  category: number;
  symbolSize: number;
  itemStyle?: any;
  description?: string;
  attributes?: { name: string; type: string; title?: string }[];
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: { show: boolean; formatter: string; color?: string; fontSize?: number; fontWeight?: string };
  lineStyle?: any;
}

export interface GraphCategory {
  name: string;
  itemStyle: { color: string };
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: GraphCategory[];
}

// ─── 常量 ────────────────────────────────────────────────────────────────

export const CATEGORIES: GraphCategory[] = [
  { name: '概念', itemStyle: { color: '#3b82f6' } },
  { name: '行为', itemStyle: { color: '#10b981' } },
  { name: '规则', itemStyle: { color: '#f59e0b' } },
  { name: '函数', itemStyle: { color: '#a855f7' } },
  { name: '关系', itemStyle: { color: '#8b5cf6' } },
];

export const CATEGORY_LABELS = CATEGORIES.map(c => c.name);

// ─── 纯函数 ──────────────────────────────────────────────────────────────

const getTitle = (item: { name: string; title?: string }): string =>
  item.title || item.name;

export function buildOntologyGraph(data: OntologyData | null, concepts: Concept[]): GraphModel {
  if (!data) return { nodes: [], edges: [], categories: CATEGORIES };

  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];

  // Concept nodes（属性取有效属性：自有 ∪ 继承，spec 005）
  const conceptMap = new Map(concepts.map(c => [c.name, c]));
  data.concepts.forEach(c => {
    nodes.push({
      id: `concept:${c.name}`,
      name: c.name,
      title: getTitle(c),
      category: 0,
      symbolSize: 55,
      description: c.description,
      attributes: effectiveAttributes(conceptMap.get(c.name) || c),
    });
    nodeIds.add(`concept:${c.name}`);
  });

  // 本体函数名集合：规则→函数边跨节引用，先登记（公共函数不在本图内）
  const functionNames = new Set((data.functions || []).map(f => f.name));

  // Behavior nodes
  data.behaviors.forEach(b => {
    nodes.push({
      id: `behavior:${b.name}`,
      name: b.name,
      title: getTitle(b),
      category: 1,
      symbolSize: 40,
      description: b.description,
    });
    nodeIds.add(`behavior:${b.name}`);

    // 行为关联概念唯一（标量）
    if (b.concept) {
      const targetId = `concept:${b.concept}`;
      if (nodeIds.has(targetId)) {
        edges.push({
          source: `behavior:${b.name}`,
          target: targetId,
          lineStyle: { color: '#10b981', width: 1.5, type: 'dashed' as const },
        });
      }
    }
  });

  // Rule nodes
  data.rules.forEach(r => {
    nodes.push({
      id: `rule:${r.name}`,
      name: r.name,
      title: getTitle(r),
      category: 2,
      symbolSize: 35,
      description: r.description,
    });
    nodeIds.add(`rule:${r.name}`);

    // 规则绑定行为唯一（标量）
    if (r.behavior) {
      const targetId = `behavior:${r.behavior}`;
      if (nodeIds.has(targetId)) {
        edges.push({
          source: `rule:${r.name}`,
          target: targetId,
          lineStyle: { color: '#f59e0b', width: 1.5, type: 'dotted' as const },
        });
      }
    }

    // 规则 → 关联函数（仅图内存在的本体函数；重复项去重）
    const linked = new Set<string>();
    (r.related_functions || []).forEach(fnName => {
      if (linked.has(fnName) || !functionNames.has(fnName)) return;
      linked.add(fnName);
      edges.push({
        source: `rule:${r.name}`,
        target: `function:${fnName}`,
        lineStyle: { color: '#a855f7', width: 1.5, type: 'dashed' as const },
      });
    });
  });

  // Function nodes（不与概念连线）
  data.functions?.forEach(f => {
    nodes.push({
      id: `function:${f.name}`,
      name: f.name,
      title: getTitle(f),
      category: 3,
      symbolSize: 40,
      description: f.description,
    });
    nodeIds.add(`function:${f.name}`);
  });

  // Relation edges (between concepts) — with title
  data.relations.forEach(r => {
    const sourceId = `concept:${r.source}`;
    const targetId = `concept:${r.target}`;
    if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
      edges.push({
        source: sourceId,
        target: targetId,
        label: {
          show: true,
          formatter: getTitle(r),
          color: '#c084fc',
          fontSize: 12,
          fontWeight: 'bold',
        },
        lineStyle: {
          color: '#8b5cf6',
          width: 2.5,
          curveness: 0.2,
          type: r.cardinality === 'N:M' ? 'solid' as const : 'dashed' as const,
        },
      });
    }
  });

  return { nodes, edges, categories: CATEGORIES };
}
