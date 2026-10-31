'use client';

import { useEffect, useState, useRef, useMemo, memo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { TooltipComponent, TitleComponent } from 'echarts/components';
import { GraphChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import { message, Spin, Empty, Modal, Tag, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getConcepts, getOntologyData, Concept, OntologyData } from '@/api/client';
import { attrLabel, buildOntologyGraph, CATEGORY_LABELS, type GraphNode } from './ontology-graph-model';

echarts.use([TooltipComponent, TitleComponent, GraphChart, CanvasRenderer]);

interface Props {
  ontologyId: number;
}

export default memo(function OntologyGraph({ ontologyId }: Props) {
  const [data, setData] = useState<OntologyData | null>(null);
  // spec 005：/data 返回的是落盘原样（只含自有属性），继承属性走 /concepts 的派生视图
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<GraphNode | null>(null);
  const chartRef = useRef<ReactEChartsCore>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [ontoData, conceptList] = await Promise.all([getOntologyData(ontologyId), getConcepts(ontologyId)]);
      setData(ontoData);
      setConcepts(conceptList);
    } catch (e: any) {
      message.error('加载本体数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ontologyId]);

  useEffect(() => {
    if (!loading && data && chartRef.current) {
      const timer = setTimeout(() => {
        const instance = chartRef.current?.getEchartsInstance();
        instance?.dispatchAction({ type: 'restore' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, data]);

  // 图数据口径见 ontology-graph-model.ts（规则→关联函数连线，函数不再连概念）
  const { nodes, edges, categories } = useMemo(
    () => buildOntologyGraph(data, concepts),
    [data, concepts],
  );

  const getOption = () => {
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
            let html = `<div style="font-size:13px;color:#e2e8f0">`;
            html += `<strong style="font-size:14px">${node.title}</strong>`;
            if (node.title !== node.name) {
              html += `<br/><span style="color:#64748b;font-size:11px">${node.name}</span>`;
            }
            html += `<br/><span style="color:#94a3b8">${CATEGORY_LABELS[node.category] || ''}</span>`;
            if (node.description) {
              html += `<br/><span style="color:#94a3b8">${node.description}</span>`;
            }
            if (node.attributes && node.attributes.length > 0) {
              html += `<br/><br/><span style="color:#64748b">属性：</span>`;
              node.attributes.forEach(a => {
                html += `<br/><span style="color:#94a3b8">  ${attrLabel(a)} (${a.type})</span>`;
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
              formatter: n.title,
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
      <div className="flex items-center justify-end px-4 py-1 shrink-0">
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      </div>
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
        title={`概念详情 - ${selectedConcept?.title || ''}`}
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
                      <Tag color="blue">{attrLabel(attr)}</Tag>
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
                        <Tag color="purple">{r.title || r.name}</Tag>
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
