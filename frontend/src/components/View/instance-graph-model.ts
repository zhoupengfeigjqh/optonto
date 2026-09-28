/**
 * 实例关系图的模型层（自 InstanceGraph.tsx 抽取，行为不变）。
 *
 * 只放纯数据与纯函数：常量、节点/边类型、API 信封行提取、节点标签、
 * 结果表格列构建、ECharts option 构建。视图组件仅负责状态与交互，
 * 便于对「行提取」「option 构建」等逻辑单独补测。
 */
import type { Concept } from '@/api/client';

// ─── 常量 ────────────────────────────────────────────────────────────────

export const MAX_DEPTH = 3;          // BFS 最多外扩 3 阶
export const MAX_PER_CONCEPT = 50;   // 每概念节点上限
export const MAX_TOTAL = 200;        // 全图节点上限

export const CONCEPT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

// ─── 类型 ────────────────────────────────────────────────────────────────

export interface Instance {
  key: string;
  concept: string;
  row: Record<string, any>;
}

export interface GNode {
  id: string;           // instanceKey
  name: string;         // 展示标签
  concept: string;
  row: Record<string, any>;
  category: number;
  symbolSize: number;
}

export interface GEdge {
  source: string;
  target: string;
  relation: string;     // 关系名（去重用）
  label?: { show: boolean; formatter: string; color?: string; fontSize?: number };
  lineStyle?: any;
}

/** 图数据（BFS 收敛后一次性构建） */
export interface GraphData {
  nodes: any[];
  edges: any[];
  categories: { name: string; itemStyle: { color: string } }[];
}

/** 结果表格列（宽接口：供 antd Table 直接消费） */
export interface ResultColumn {
  title: string;
  dataIndex: string;
  key: string;
  ellipsis: boolean;
  render: (v: any) => string;
}

// ─── 行提取：向下找第一个"对象数组"（API 信封层级不定） ─────────────────────

export function extractRows(payload: any): Record<string, any>[] {
  const seen = new Set<any>();
  const queue: any[] = [payload];
  let emptyArr: any[] | null = null;
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      if (cur.length > 0 && cur.every(i => i && typeof i === 'object' && !Array.isArray(i))) {
        return cur as Record<string, any>[];
      }
      if (cur.length === 0 && !emptyArr) emptyArr = cur;
      continue;
    }
    for (const v of Object.values(cur)) queue.push(v);
  }
  return (emptyArr as Record<string, any>[]) ?? [];
}

// ─── 节点标签 ────────────────────────────────────────────────────────────

export function nodeLabel(concept: Concept | undefined, row: Record<string, any>, _key: string): string {
  const instanceLabelField = concept?.instance_label;
  const prefix = concept?.display_name || concept?.name || '';
  // 使用 instance_label 指定的属性作为节点标签
  if (instanceLabelField && row[instanceLabelField] !== undefined && row[instanceLabelField] !== null && row[instanceLabelField] !== '') {
    return `${prefix}:${String(row[instanceLabelField])}`;
  }
  // 未设置 instance_label 时仅显示概念名，不附加属性值
  return prefix;
}

// ─── 结果表格列 ──────────────────────────────────────────────────────────

/** 结果列：按概念属性顺序排序并截取前 8 列，列名取属性展示名 */
export function buildResultColumns(
  resultRows: Record<string, any>[] | null,
  conceptName: string | null,
  conceptMap: Map<string, Concept>,
): ResultColumn[] {
  if (!resultRows || resultRows.length === 0 || !conceptName) return [];
  const concept = conceptMap.get(conceptName);
  const attrOrder = (concept?.attributes ?? []).map(a => a.name);
  const keys = [...new Set(resultRows.flatMap(r => Object.keys(r)))];
  keys.sort((a, b) => {
    const ia = attrOrder.indexOf(a), ib = attrOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return keys.slice(0, 8).map(k => ({
    title: concept?.attributes?.find(a => a.name === k)?.display_name || k,
    dataIndex: k,
    key: k,
    ellipsis: true,
    render: (v: any) => (v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)),
  }));
}

// ─── ECharts option ──────────────────────────────────────────────────────

/**
 * 构建力导向图 option。
 * 引用稳定性由调用方（useMemo 依赖图数据版本号）负责：无关重渲染不得生成新 option，
 * 否则 ReactEChartsCore 会以 notMerge 重新 setOption 导致 force 布局重启、节点跳动。
 */
export function buildChartOption(graph: GraphData, conceptMap: Map<string, Concept>) {
  const { nodes, edges, categories } = graph;
  return {
    tooltip: {
      trigger: 'item' as const,
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          const node = params.data as GNode;
          const concept = conceptMap.get(node.concept);
          const attrLabel = (k: string) =>
            concept?.attributes?.find(a => a.name === k)?.display_name || k;
          let html = `<div style="font-size:13px;color:#e2e8f0;max-width:320px">`;
          html += `<strong style="font-size:14px">${concept?.display_name || node.concept}</strong>`;
          html += `<br/><span style="color:#64748b;font-size:11px">${node.concept}</span>`;
          for (const [k, v] of Object.entries(node.row)) {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            html += `<br/><span style="color:#94a3b8">${attrLabel(k)}: </span><span style="color:#e2e8f0">${val}</span>`;
          }
          html += '</div>';
          return html;
        }
        if (params.dataType === 'edge') {
          return `<div style="font-size:13px;color:#c084fc;font-weight:bold">${params.data.label?.formatter || ''}</div>`;
        }
        return '';
      },
      backgroundColor: 'rgba(17, 17, 24, 0.95)',
      borderColor: '#1e1e2a',
      textStyle: { color: '#e2e8f0' },
    },
    legend: {
      data: categories.map(c => c.name),
      textStyle: { color: '#94a3b8' },
      top: 10,
    },
    animationDuration: 800,
    series: [
      {
        type: 'graph',
        layout: 'force',
        force: { repulsion: 400, edgeLength: [120, 220], gravity: 0.1, friction: 0.1 },
        roam: true,
        draggable: true,
        data: nodes,
        edges: edges,
        categories: categories,
        emphasis: { focus: 'adjacency' as const, lineStyle: { width: 3 } },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        itemStyle: { borderColor: '#1e1e2a', borderWidth: 2 },
      },
    ],
  };
}
