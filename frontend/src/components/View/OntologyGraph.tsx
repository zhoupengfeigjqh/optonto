'use client';

import { useEffect, useState, useRef, useCallback, memo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { TooltipComponent, TitleComponent } from 'echarts/components';
import { GraphChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import { message, Spin, Empty, Modal, Tag } from 'antd';
import { getOntologyData, OntologyData } from '@/api/client';

echarts.use([TooltipComponent, TitleComponent, GraphChart, CanvasRenderer]);

interface Props {
  ontologyId: number;
}

interface GraphNode {
  id: string;
  name: string;
  displayName: string;
  category: number;
  symbolSize: number;
  itemStyle?: any;
  description?: string;
  attributes?: { name: string; type: string }[];
}

interface GraphEdge {
  source: string;
  target: string;
  label?: { show: boolean; formatter: string; color?: string; fontSize?: number; fontWeight?: string };
  lineStyle?: any;
}

export default memo(function OntologyGraph({ ontologyId }: Props) {
  const [data, setData] = useState<OntologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<GraphNode | null>(null);
  const chartRef = useRef<ReactEChartsCore>(null);

  const load = async () => {
    setLoading(true);
    try {
      const ontoData = await getOntologyData(ontologyId);
      setData(ontoData);
    } catch (e: any) {
      message.error('加载本体数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ontologyId]);

  const getDisplayName = (item: { name: string; display_name?: string }): string =>
    item.display_name || item.name;

  const buildGraph = useCallback(() => {
    if (!data) return { nodes: [], edges: [], categories: [] };

    const categories = [
      { name: '概念', itemStyle: { color: '#3b82f6' } },
      { name: '行为', itemStyle: { color: '#10b981' } },
      { name: '规则', itemStyle: { color: '#f59e0b' } },
      { name: '关系', itemStyle: { color: '#8b5cf6' } },
    ];

    const nodes: GraphNode[] = [];
    const nodeIds = new Set<string>();
    const edges: GraphEdge[] = [];

    // Concept nodes
    data.concepts.forEach(c => {
      nodes.push({
        id: `concept:${c.name}`,
        name: c.name,
        displayName: getDisplayName(c),
        category: 0,
        symbolSize: 55,
        description: c.description,
        attributes: c.attributes,
      });
      nodeIds.add(`concept:${c.name}`);
    });

    // Behavior nodes
    data.behaviors.forEach(b => {
      nodes.push({
        id: `behavior:${b.name}`,
        name: b.name,
        displayName: getDisplayName(b),
        category: 1,
        symbolSize: 40,
        description: b.description,
      });
      nodeIds.add(`behavior:${b.name}`);

      b.related_concepts.forEach(rc => {
        const targetId = `concept:${rc}`;
        if (nodeIds.has(targetId)) {
          edges.push({
            source: `behavior:${b.name}`,
            target: targetId,
            lineStyle: { color: '#10b981', width: 1.5, type: 'dashed' as const },
          });
        }
      });
    });

    // Rule nodes
    data.rules.forEach(r => {
      nodes.push({
        id: `rule:${r.name}`,
        name: r.name,
        displayName: getDisplayName(r),
        category: 2,
        symbolSize: 35,
        description: r.description,
      });
      nodeIds.add(`rule:${r.name}`);

      if (r.related_behaviors && r.related_behaviors.length > 0) {
        r.related_behaviors.forEach((rb: string) => {
          const targetId = `behavior:${rb}`;
          if (nodeIds.has(targetId)) {
            edges.push({
              source: `rule:${r.name}`,
              target: targetId,
              lineStyle: { color: '#f59e0b', width: 1.5, type: 'dotted' as const },
            });
          }
        });
      }

    });

    // Relation edges (between concepts) — with display_name
    data.relations.forEach(r => {
      const sourceId = `concept:${r.source}`;
      const targetId = `concept:${r.target}`;
      if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
        edges.push({
          source: sourceId,
          target: targetId,
          label: {
            show: true,
            formatter: getDisplayName(r),
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

    return { nodes, edges, categories };
  }, [data]);

  const getOption = () => {
    const { nodes, edges, categories } = buildGraph();

    return {
      title: {
        text: '本体视图',
        textStyle: { color: '#e2e8f0', fontSize: 16 },
        top: 10,
        left: 'center',
      },
      tooltip: {
        trigger: 'item' as const,
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const node = params.data as GraphNode;
            const typeLabels = ['概念', '行为', '规则', '关系'];
            let html = `<div style="font-size:13px;color:#e2e8f0">`;
            html += `<strong style="font-size:14px">${node.displayName}</strong>`;
            if (node.displayName !== node.name) {
              html += `<br/><span style="color:#64748b;font-size:11px">${node.name}</span>`;
            }
            html += `<br/><span style="color:#94a3b8">${typeLabels[node.category] || ''}</span>`;
            if (node.description) {
              html += `<br/><span style="color:#94a3b8">${node.description}</span>`;
            }
            if (node.attributes && node.attributes.length > 0) {
              html += `<br/><br/><span style="color:#64748b">属性：</span>`;
              node.attributes.forEach(a => {
                html += `<br/><span style="color:#94a3b8">  ${a.name} (${a.type})</span>`;
              });
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
        top: 35,
      },
      animationDuration: 800,
      animationEasingUpdate: 'quinticInOut' as const,
      series: [
        {
          type: 'graph',
          layout: 'force',
          force: {
            repulsion: 500,
            edgeLength: [150, 300],
            gravity: 0.1,
            friction: 0.1,
          },
          roam: true,
          draggable: true,
          data: nodes.map(n => ({
            ...n,
            label: {
              show: true,
              formatter: n.displayName,
              color: '#e2e8f0',
              fontSize: 12,
              fontWeight: 'bold' as const,
            },
          })),
          edges: edges,
          categories: categories,
          emphasis: {
            focus: 'adjacency' as const,
            lineStyle: { width: 3 },
          },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 10],
          itemStyle: {
            borderColor: '#1e1e2a',
            borderWidth: 2,
          },
        },
      ],
    };
  };

  const onEvents = {
    click: (params: any) => {
      if (params.dataType === 'node') {
        const node = params.data as GraphNode;
        if (node.category === 0) {
          setSelectedConcept(node);
        }
      }
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return <Empty description={<span className="text-text-muted">本体数据为空</span>} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 bg-dark-card border border-dark-border rounded-xl overflow-hidden" style={{ minHeight: 0 }}>
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={getOption()}
          style={{ height: '100%', minHeight: 400 }}
          onEvents={onEvents}
          notMerge
          lazyUpdate
        />
      </div>

      <Modal
        title={`概念详情 - ${selectedConcept?.displayName || ''}`}
        open={!!selectedConcept}
        onCancel={() => setSelectedConcept(null)}
        footer={null}
        width={500}
      >
        {selectedConcept && (
          <div className="space-y-4">
            <div>
              <span className="text-text-muted text-sm">英文名：</span>
              <span className="text-text-primary text-sm ml-2">{selectedConcept.name}</span>
            </div>
            <div>
              <span className="text-text-muted text-sm">描述：</span>
              <p className="text-text-primary mt-1">{selectedConcept.description || '暂无描述'}</p>
            </div>
            <div>
              <span className="text-text-muted text-sm">属性列表：</span>
              {selectedConcept.attributes && selectedConcept.attributes.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {selectedConcept.attributes.map((attr, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Tag color="blue">{attr.name}</Tag>
                      <span className="text-text-secondary text-sm">{attr.type}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-text-muted text-sm mt-1">暂无属性</p>
              )}
            </div>
            <div>
              <span className="text-text-muted text-sm">一阶关系：</span>
              {data ? (
                <div className="mt-2 space-y-1">
                  {data.relations
                    .filter(r => r.source === selectedConcept.name || r.target === selectedConcept.name)
                    .map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Tag color="purple">{r.display_name || r.name}</Tag>
                        <span className="text-text-secondary">
                          {r.source} → {r.target} ({r.cardinality})
                        </span>
                      </div>
                    ))}
                  {data.relations.filter(
                    r => r.source === selectedConcept.name || r.target === selectedConcept.name
                  ).length === 0 && (
                    <p className="text-text-muted text-sm">暂无直接关系</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
});
