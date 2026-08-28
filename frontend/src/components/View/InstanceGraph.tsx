'use client';

/**
 * 实例视图 —— LLM-free 实例关系图。
 *
 * 流程：选概念/行为查询 → 结果表格多选 →【加入视图】→ 按本体关系 BFS 顺查
 * （最多 3 阶，连接键必须在邻居查询行为参数里，否则该方向停止）→ 收敛后一次性渲染。
 * 实例去重合并纯靠 instanceKey 哈希（见 instance-hash.ts），visited 全程保留（累加式）。
 */

import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { TooltipComponent, TitleComponent } from 'echarts/components';
import { GraphChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import { message, Spin, Empty, Select, Button, Table, Input, InputNumber, Tag } from 'antd';
import { SearchOutlined, PlusOutlined, ClearOutlined } from '@ant-design/icons';
import {
  getOntologyData, callBehavior,
  OntologyData, Concept, Behavior, Relation,
} from '@/api/client';
import { instanceKey } from './instance-hash';

echarts.use([TooltipComponent, TitleComponent, GraphChart, CanvasRenderer]);

// ─── 常量 ────────────────────────────────────────────────────────────────

const MAX_DEPTH = 3;          // BFS 最多外扩 3 阶
const MAX_PER_CONCEPT = 50;   // 每概念节点上限
const MAX_TOTAL = 200;        // 全图节点上限

const CONCEPT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

// ─── 类型 ────────────────────────────────────────────────────────────────

interface Instance {
  key: string;
  concept: string;
  row: Record<string, any>;
}

interface GNode {
  id: string;           // instanceKey
  name: string;         // 展示标签
  concept: string;
  row: Record<string, any>;
  category: number;
  symbolSize: number;
}

interface GEdge {
  source: string;
  target: string;
  relation: string;     // 关系名（去重用）
  label?: { show: boolean; formatter: string; color?: string; fontSize?: number };
  lineStyle?: any;
}

interface Props {
  ontologyId: number;
}

// ─── 行提取：向下找第一个"对象数组"（API 信封层级不定） ─────────────────────

function extractRows(payload: any): Record<string, any>[] {
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

// ─── 组件 ────────────────────────────────────────────────────────────────

export default memo(function InstanceGraph({ ontologyId }: Props) {
  const [data, setData] = useState<OntologyData | null>(null);
  const [loading, setLoading] = useState(true);

  // 查询区
  const [conceptName, setConceptName] = useState<string | null>(null);
  const [behaviorName, setBehaviorName] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, any>>({});
  const [querying, setQuerying] = useState(false);
  const [resultRows, setResultRows] = useState<Record<string, any>[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 图（累加式，refs 是 BFS 期间的权威数据，state 触发渲染）
  const nodesRef = useRef<Map<string, GNode>>(new Map());
  const edgesRef = useRef<Map<string, GEdge>>(new Map());
  const queriedRef = useRef<Set<string>>(new Set()); // 已发过的查询（behavior+params），避免重查
  const [graphTick, setGraphTick] = useState(0);     // 图数据版本号
  const [expanding, setExpanding] = useState(false);
  const [skipReasons, setSkipReasons] = useState<string[]>([]);

  const chartRef = useRef<ReactEChartsCore>(null);

  // ─── 数据加载 ────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setData(await getOntologyData(ontologyId));
      } catch (e: any) {
        message.error('加载本体数据失败: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [ontologyId]);

  // ─── 派生结构 ────────────────────────────────────────────────────────

  const conceptMap = useMemo(
    () => new Map((data?.concepts ?? []).map(c => [c.name, c])),
    [data],
  );

  /** 行为权限：securities 全花名册，scope 含 everyone 才放行；disable/白名单（身份未落地）一律拦截 */
  const isPermitted = useCallback((bName: string): boolean => {
    const sec = (data?.securities ?? []).find(s => s.action_name === bName);
    if (!sec) return true; // 花名册外（理论不发生）按默认 everyone
    return (sec.scope ?? []).includes('everyone');
  }, [data]);

  /** 概念 → 查询行为（op_type=query 且非 SQL 引擎）。permittedOnly 区分"无行为"与"无权限"。 */
  const queryBehaviorsOf = useCallback((cName: string, permittedOnly: boolean): Behavior[] => {
    const engines = data?.data_engines ?? [];
    return (data?.behaviors ?? []).filter(b => {
      if (b.op_type !== 'query' || !(b.related_concepts ?? []).includes(cName)) return false;
      const eng = engines.find(e => e.behavior_name === b.name);
      if (eng?.engine_type === 'SQL') return false;
      return permittedOnly ? isPermitted(b.name) : true;
    });
  }, [data, isPermitted]);

  /** 可作为起点的概念：有 ≥1 个可用（有权限）查询行为 */
  const startConcepts = useMemo(
    () => (data?.concepts ?? []).filter(c => queryBehaviorsOf(c.name, true).length > 0),
    [data, queryBehaviorsOf],
  );

  const currentBehavior = useMemo(
    () => (data?.behaviors ?? []).find(b => b.name === behaviorName) ?? null,
    [data, behaviorName],
  );

  // ─── 起始查询 ────────────────────────────────────────────────────────

  const runQuery = async () => {
    if (!behaviorName || !conceptName) return;
    setQuerying(true);
    setResultRows(null);
    setSelectedKeys([]);
    try {
      const params: Record<string, any> = {};
      for (const [k, v] of Object.entries(paramValues)) {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      }
      const resp = await callBehavior(ontologyId, behaviorName, params);
      setResultRows(extractRows(resp));
    } catch (e: any) {
      message.error('查询失败: ' + e.message);
      setResultRows([]);
    } finally {
      setQuerying(false);
    }
  };

  // ─── BFS 顺查 ────────────────────────────────────────────────────────

  const addReason = (reasons: string[], r: string) => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  const expandFrom = async (seeds: Instance[]) => {
    setExpanding(true);
    const reasons: string[] = [];
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const relations = data?.relations ?? [];

    let frontier = seeds;
    try {
      for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
        if (nodes.size >= MAX_TOTAL) {
          addReason(reasons, `全图节点超过 ${MAX_TOTAL}，停止扩展`);
          break;
        }

        // 收集本层查询任务
        interface Task {
          behavior: Behavior; params: Record<string, any>;
          from: Instance; relation: Relation; neighborConcept: string;
          joinAttr: string; joinValue: any; fromIsSource: boolean;
        }
        /** 去重命中的任务：查询别人已发过，但本实例的边仍需补（结果合并后本地匹配） */
        interface DeferredEdge {
          from: Instance; relation: Relation; neighborConcept: string;
          joinAttr: string; joinValue: any; fromIsSource: boolean;
        }
        const tasks: Task[] = [];
        const deferred: DeferredEdge[] = [];
        for (const inst of frontier) {
          for (const rel of relations) {
            // 定方向：实例概念在 source 端 → 查 target；在 target 端 → 查 source
            let value: any, neighborConcept: string, joinAttr: string, fromIsSource: boolean;
            if (rel.source === inst.concept) {
              value = inst.row[rel.source_attr ?? ''];
              neighborConcept = rel.target;
              joinAttr = rel.target_attr ?? '';
              fromIsSource = true;
            } else if (rel.target === inst.concept) {
              value = inst.row[rel.target_attr ?? ''];
              neighborConcept = rel.source;
              joinAttr = rel.source_attr ?? '';
              fromIsSource = false;
            } else {
              continue;
            }
            if (value === undefined || value === null || value === '') continue;

            const relLabel = rel.display_name || rel.name;
            const all = queryBehaviorsOf(neighborConcept, false);
            const usable = queryBehaviorsOf(neighborConcept, true);
            if (all.length === 0) {
              addReason(reasons, `概念「${conceptMap.get(neighborConcept)?.display_name || neighborConcept}」无可用查询行为，未展开`);
              continue;
            }
            if (usable.length === 0) {
              addReason(reasons, `概念「${conceptMap.get(neighborConcept)?.display_name || neighborConcept}」的查询行为无权限，未展开`);
              continue;
            }
            const behavior = usable.find(b => joinAttr in (b.params ?? {}));
            if (!behavior) {
              addReason(reasons, `关系「${relLabel}」：目标查询行为缺少参数 ${joinAttr}，未展开`);
              continue;
            }
            const params = { [joinAttr]: value };
            const dedupeKey = `${behavior.name}|${JSON.stringify(params)}`;
            if (queriedRef.current.has(dedupeKey)) {
              // 查询已发过（或同层双胞胎已登记）→ 不重复发，但边要补
              deferred.push({ from: inst, relation: rel, neighborConcept, joinAttr, joinValue: value, fromIsSource });
              continue;
            }
            queriedRef.current.add(dedupeKey);
            tasks.push({ behavior, params, from: inst, relation: rel, neighborConcept, joinAttr, joinValue: value, fromIsSource });
          }
        }

        /** 建边：一律按关系声明的 source→target 定向，与遍历方向无关 */
        const addEdge = (fromKey: string, fetchedKey: string, rel: Relation, fromIsSource: boolean) => {
          const [s, t] = fromIsSource ? [fromKey, fetchedKey] : [fetchedKey, fromKey];
          const edgeKey = `${s}|${rel.name}|${t}`;
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, {
              source: s, target: t, relation: rel.name,
              label: { show: true, formatter: rel.display_name || rel.name, color: '#c084fc', fontSize: 11 },
              lineStyle: { color: '#8b5cf6', width: 2, curveness: 0.2 },
            });
          }
        };

        // 同层并行
        const results = await Promise.allSettled(
          tasks.map(t => callBehavior(ontologyId, t.behavior.name, t.params)),
        );

        const nextFrontier: Instance[] = [];
        results.forEach((res, i) => {
          const t = tasks[i];
          const relLabel = t.relation.display_name || t.relation.name;
          if (res.status === 'rejected') {
            addReason(reasons, `关系「${relLabel}」查询失败：${res.reason?.message ?? '未知错误'}`);
            return;
          }
          for (const row of extractRows(res.value)) {
            const key = instanceKey(t.neighborConcept, row);
            if (!key) continue; // 空行丢弃
            const conceptCount = [...nodes.values()].filter(n => n.concept === t.neighborConcept).length;
            if (!nodes.has(key) && conceptCount >= MAX_PER_CONCEPT) {
              addReason(reasons, `概念「${conceptMap.get(t.neighborConcept)?.display_name || t.neighborConcept}」节点超过 ${MAX_PER_CONCEPT}，截断`);
              continue;
            }
            if (!nodes.has(key)) {
              nodes.set(key, {
                id: key, concept: t.neighborConcept, row,
                name: nodeLabel(conceptMap.get(t.neighborConcept), row, key),
                category: 0, symbolSize: 42,
              });
              nextFrontier.push({ key, concept: t.neighborConcept, row });
            }
            addEdge(t.from.key, key, t.relation, t.fromIsSource);
          }
        });

        // 延迟补边：去重跳过的任务，在已入图节点（含本轮新增）里按连接键值本地匹配
        for (const d of deferred) {
          for (const n of nodes.values()) {
            if (n.concept !== d.neighborConcept) continue;
            if (String(n.row[d.joinAttr] ?? '') !== String(d.joinValue)) continue;
            addEdge(d.from.key, n.id, d.relation, d.fromIsSource);
          }
        }

        frontier = nextFrontier;
        if (depth === MAX_DEPTH && frontier.length > 0) {
          addReason(reasons, `已到达 ${MAX_DEPTH} 阶边界，未继续展开`);
        }
      }
    } finally {
      setExpanding(false);
      setSkipReasons(prev => {
        const merged = [...prev];
        reasons.forEach(r => addReason(merged, r));
        return merged;
      });
      setGraphTick(t => t + 1);
    }
  };

  /** 加入视图：选中行 → 种子实例（已入图的跳过）→ BFS */
  const addToGraph = async () => {
    if (!conceptName || !resultRows) return;
    const seeds: Instance[] = [];
    for (const row of resultRows) {
      const key = instanceKey(conceptName, row);
      if (!key || !selectedKeys.includes(key)) continue;
      if (!nodesRef.current.has(key)) {
        const inst: GNode = {
          id: key, concept: conceptName, row,
          name: nodeLabel(conceptMap.get(conceptName), row, key),
          category: 0, symbolSize: 42,
        };
        nodesRef.current.set(key, inst);
      }
      seeds.push({ key, concept: conceptName, row });
    }
    if (seeds.length === 0) return;
    setSelectedKeys([]);
    await expandFrom(seeds);
  };

  const clearGraph = () => {
    nodesRef.current.clear();
    edgesRef.current.clear();
    queriedRef.current.clear();
    setSkipReasons([]);
    setGraphTick(t => t + 1);
  };

  // ─── 渲染数据 ────────────────────────────────────────────────────────

  function nodeLabel(concept: Concept | undefined, row: Record<string, any>, key: string): string {
    const attrs = concept?.attributes ?? [];
    // 返回行只覆盖概念声明属性的子集（output_mapping 决定），
    // 按声明顺序取第一个在行里有值的属性：unique 优先，再全部属性，最后回退哈希尾号
    const uniqAttrs = attrs.filter(a => a.constraint?.unique);
    const v = [...uniqAttrs, ...attrs]
      .map(a => row[a.name])
      .find(x => x !== undefined && x !== null && x !== '');
    const short = v !== undefined ? String(v) : key.slice(-8);
    return `${concept?.display_name || concept?.name || ''}:${short}`;
  }

  const buildGraph = useCallback(() => {
    const conceptList = [...new Set([...nodesRef.current.values()].map(n => n.concept))];
    const catIndex = new Map(conceptList.map((c, i) => [c, i]));
    const categories = conceptList.map((c, i) => ({
      name: conceptMap.get(c)?.display_name || c,
      itemStyle: { color: CONCEPT_COLORS[i % CONCEPT_COLORS.length] },
    }));
    const nodes = [...nodesRef.current.values()].map(n => ({
      ...n,
      category: catIndex.get(n.concept) ?? 0,
      label: { show: true, formatter: n.name, color: '#e2e8f0', fontSize: 11 },
    }));
    return { nodes, edges: [...edgesRef.current.values()], categories };
    // graphTick 驱动重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphTick, conceptMap]);

  // option 引用必须稳定：参数输入/行勾选等无关重渲染若生成新 option 对象，
  // ReactEChartsCore 会重新 setOption（notMerge）→ force 布局重启 → 节点跳动。
  // 只有 graphTick（图数据真的变了）才重建。
  const chartOption = useMemo(() => {
    const { nodes, edges, categories } = buildGraph();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildGraph]);

  // ─── 结果表格列 ──────────────────────────────────────────────────────

  const resultColumns = useMemo(() => {
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
  }, [resultRows, conceptName, conceptMap]);

  // ─── 渲染 ────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Spin size="large" /></div>;
  }
  if (!data) {
    return <Empty description={<span className="text-text-muted">本体数据为空</span>} />;
  }

  const nodeCount = nodesRef.current.size;
  const usableBehaviors = conceptName ? queryBehaviorsOf(conceptName, true) : [];

  return (
    <div className="flex flex-col h-full gap-3 p-4">
      {/* ── 查询区 ── */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <Select
          style={{ width: 180 }}
          placeholder="选择概念"
          value={conceptName}
          onChange={v => { setConceptName(v); setBehaviorName(null); setParamValues({}); setResultRows(null); setSelectedKeys([]); }}
          options={startConcepts.map(c => ({ value: c.name, label: c.display_name || c.name }))}
        />
        <Select
          style={{ width: 200 }}
          placeholder="查询行为"
          value={behaviorName}
          disabled={!conceptName}
          onChange={v => { setBehaviorName(v); setParamValues({}); }}
          options={usableBehaviors.map(b => ({ value: b.name, label: b.display_name || b.name }))}
        />
        {currentBehavior && Object.entries(currentBehavior.params ?? {}).map(([pName, spec]: [string, any]) => (
          spec?.type === 'number' ? (
            <InputNumber
              key={pName}
              placeholder={spec?.display_name || pName}
              value={paramValues[pName]}
              onChange={v => setParamValues(prev => ({ ...prev, [pName]: v }))}
              style={{ width: 150 }}
            />
          ) : (
            <Input
              key={pName}
              placeholder={spec?.display_name || pName}
              value={paramValues[pName]}
              onChange={e => setParamValues(prev => ({ ...prev, [pName]: e.target.value }))}
              style={{ width: 150 }}
              allowClear
            />
          )
        ))}
        <Button
          type="primary"
          icon={<SearchOutlined />}
          onClick={runQuery}
          loading={querying}
          disabled={!behaviorName}
        >
          查询
        </Button>        <div className="flex-1" />
        <Button size="small" icon={<ClearOutlined />} onClick={clearGraph} disabled={nodeCount === 0}>
          清空视图
        </Button>
      </div>

      {/* ── 结果表格 ── */}
      {resultRows && (
        <div className="shrink-0">
          <Table
            size="small"
            rowKey={(r: Record<string, any>) => instanceKey(conceptName!, r) ?? JSON.stringify(r)}
            columns={resultColumns}
            dataSource={resultRows}
            pagination={false}
            locale={{ emptyText: '查询结果为空' }}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: keys => setSelectedKeys(keys as string[]),
            }}
            scroll={{ y: 158 }}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={addToGraph}
              disabled={selectedKeys.length === 0 || expanding}
            >
              加入视图（已选 {selectedKeys.length}）
            </Button>
          </div>
        </div>
      )}

      {/* ── 实例图（Spin 包裹会截断高度链，改用绝对定位遮罩） ── */}
      <div className="flex-1 bg-dark-card border border-dark-border rounded-xl overflow-hidden relative" style={{ minHeight: 0 }}>
        {nodeCount === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Empty description={<span className="text-text-muted">查询并选择实例，加入视图后展示实例关系图</span>} />
          </div>
        ) : (
          <ReactEChartsCore
            ref={chartRef}
            echarts={echarts}
            option={chartOption}
            style={{ height: '100%' }}
            notMerge
            lazyUpdate
          />
        )}
        {expanding && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
            style={{ background: 'rgba(17, 17, 24, 0.55)' }}
          >
            <Spin size="large" />
            <span className="text-text-muted text-sm">正在加载关联实例…</span>
          </div>
        )}
      </div>

      {/* ── 未展开原因 ── */}
      {skipReasons.length > 0 && (
        <div className="shrink-0 flex items-center gap-1 flex-wrap">
          <span className="text-text-muted text-xs">未展开：</span>
          {skipReasons.map((r, i) => <Tag key={i} color="orange" className="text-xs">{r}</Tag>)}
        </div>
      )}
    </div>
  );
});
