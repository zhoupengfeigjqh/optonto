'use client';

/**
 * MCP发布 —— 平台 MCP 服务的发布与管控（数据引擎分组）。
 *
 * 两块视图（语义不同，不可混为一谈），右上角切换、**每块一页最多 6 个服务**（见 ServiceGrid）：
 * 1. **固定发布（5 个）**：平台内置，compose 常驻管理——① 本体查询 MCP 服务（内置对外工具面，只读查询）；
 *    ② 公共函数 MCP 服务（平台通用算力，发布 + 执行一体）；③ 本体函数执行服务（零工具、仅内网）；
 *    ④ 数据引擎执行服务（行为执行底座，零工具、仅内网）；⑤ 业务系统 MCP（业务侧集成边缘，模拟外部业务系统）。
 *    五者均可启停，不可新建/删除。声明唯一来源见 `./mcp-publish/catalog.ts`。
 * 2. **自建发布**：用户在当前本体上勾选函数/行为切片创建的**动态容器**（一个镜像多实例，
 *    宿主端口 8020-8099）。可启动/停止/删除，带访问令牌（对外暴露必须鉴权）。
 *
 * 自建发布**不自带执行实现**：函数转发本体函数执行服务、行为转发数据引擎执行服务，
 * 因此对应执行服务停机时自建发布不可用（卡片上标注依赖）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, InputNumber, Modal, Radio, Segmented, Select, message } from 'antd';
import {
  getMcpStatus, startMcp, stopMcp, getMcpTools, getBusinessMcpTools, getCommonFunctionMcpTools,
  createPublished, deletePublished, getPublishMeta, listPublished, startPublished, stopPublished,
  getPublishedClientConfig, getPublishedTools, getFunctions, getBehaviors, getDataEngines,
  ALL_PUBLISH_KINDS, ALL_PUBLISH_TRANSPORTS,
  PublishedService, PublishKind, PublishTransport,
} from '@/api/client';
import { getMCPConfig } from '@/api/agent-client';
import { FixedServiceCard, PublishedServiceCard } from './mcp-publish/cards';
import { ConfigModalView, ToolsModal } from './mcp-publish/PublishModals';
import { ServiceGrid } from './mcp-publish/ServiceGrid';
import {
  CardKey, CardState, EXEC_NOTE, FIXED_SERVICES, FixedServiceDef, INIT,
  KIND_LABEL, SelectableItem, ToolInfo, TRANSPORT_OPTION_LABEL,
} from './mcp-publish/catalog';
import { ConfigModalContent, findServiceEntry, staticServiceConfig } from './mcp-publish/config-snippets';
import { readyBehaviorNames } from './mcp-publish/readiness';

/**
 * 对外工具面的工具清单拉取器 —— 启停后回填用。
 * 两个执行底座是零工具（无协议端点），**刻意不在表内**：没有清单可拉，也不该显示「查看工具」。
 */
const TOOL_FETCHERS: Partial<Record<CardKey, () => Promise<ToolInfo[]>>> = {
  ontologyQuery: getMcpTools,
  commonFunction: getCommonFunctionMcpTools,
  business: getBusinessMcpTools,
};

/** 两块视图（右上角切换）：fixed=固定发布（平台内置）/ published=自建发布（动态容器） */
type PublishView = 'fixed' | 'published';

export default function MCPPublish({ ontologyId }: { ontologyId: number }) {
  const [cards, setCards] = useState<Record<CardKey, CardState>>({
    ontologyQuery: { ...INIT }, commonFunction: { ...INIT }, functionExecutor: { ...INIT },
    dataEngine: { ...INIT }, business: { ...INIT },
  });
  const [toolsModal, setToolsModal] = useState<{ title: string; tools: ToolInfo[]; note?: string } | null>(null);
  /** 当前视图（右上角切换按钮）：两块互斥展示，各自独立分页（切走再切回从第 1 页开始） */
  const [view, setView] = useState<PublishView>('fixed');
  const [configModal, setConfigModal] = useState<ConfigModalContent | null>(null);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  // ─── 自建发布（动态容器）───────────────────────────────────────────────
  const [published, setPublished] = useState<PublishedService[]>([]);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** `/meta` 下发的可选值与约束（kinds/transports 为运行时事实源；端口段用于表单预校验） */
  const [meta, setMeta] = useState<{
    kinds: PublishKind[]; transports: PublishTransport[]; host_port_min: number; host_port_max: number;
  } | null>(null);
  const [options, setOptions] = useState<Record<PublishKind, SelectableItem[]>>({ ontology_function: [], behavior: [] });
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [form, setForm] = useState<{
    name: string; kind: PublishKind; items: string[]; host_port: number; transport: PublishTransport;
  }>({ name: '', kind: ALL_PUBLISH_KINDS[0], items: [], host_port: 8020, transport: ALL_PUBLISH_TRANSPORTS[0] });

  const patch = (key: CardKey, p: Partial<CardState>) =>
    setCards(prev => ({ ...prev, [key]: { ...prev[key], ...p } }));

  /** 当前发布类型的可勾选项；若后端下发了本端未登记的 kind，退回空列表而不是读 `undefined` 崩掉 */
  const itemsOfKind: SelectableItem[] = options[form.kind] ?? [];

  const refresh = useCallback(async (silent = false) => {
    // 重置为检查中，给用户明确的"正在刷新"反馈
    setCards(prev => ({
      ontologyQuery: { ...prev.ontologyQuery, checking: true },
      commonFunction: { ...prev.commonFunction, checking: true },
      functionExecutor: { ...prev.functionExecutor, checking: true },
      dataEngine: { ...prev.dataEngine, checking: true },
      business: { ...prev.business, checking: true },
    }));
    // 本体查询 MCP 服务：内置对外工具面，工具清单经 nginx /mcp/ 拉取
    try {
      const [s, tools] = await Promise.all([getMcpStatus('ontology-query'), getMcpTools()]);
      patch('ontologyQuery', { checking: false, running: s.running, tools });
    } catch { patch('ontologyQuery', { checking: false, running: false, tools: [] }); }
    // 公共函数 MCP 服务：第二个内置对外工具面（平台通用算力，发布 + 执行一体）
    try {
      const [s, tools] = await Promise.all([getMcpStatus('common-function'), getCommonFunctionMcpTools()]);
      patch('commonFunction', { checking: false, running: s.running, tools });
    } catch { patch('commonFunction', { checking: false, running: false, tools: [] }); }
    // 本体函数执行服务：零工具（transport=none），只看运行态
    try {
      const s = await getMcpStatus('function-executor');
      patch('functionExecutor', { checking: false, running: s.running });
    } catch { patch('functionExecutor', { checking: false, running: false }); }
    // 数据引擎执行服务：同样零工具（2026-10-19 方案 B，不挂 /mcp），只看运行态
    try {
      const s = await getMcpStatus('data-engine');
      patch('dataEngine', { checking: false, running: s.running });
    } catch { patch('dataEngine', { checking: false, running: false }); }
    // 业务系统 MCP：与其他固定服务同权，可启停（2026-10-04 用户决策）
    try {
      const [s, tools] = await Promise.all([getMcpStatus('business'), getBusinessMcpTools()]);
      patch('business', { checking: false, running: s.running, tools });
    } catch { patch('business', { checking: false, running: false, tools: [] }); }
    if (!silent) message.success('状态已刷新');
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  /** 「固定发布」区块刷新中：任一张卡片仍在检查中——区块右上角刷新按钮的 loading（与自建发布同构） */
  const fixedRefreshing = FIXED_SERVICES.some(def => cards[def.key].checking);

  /**
   * 读取自建发布列表。``silent`` = 不弹「状态已刷新」——首次加载与增删启停后的自动回读都传 true
   * （那些动作自己已有提示，再弹一次就是重复），只有用户点区块右上角「刷新」才提示。
   */
  const refreshPublished = useCallback(async (silent = false) => {
    setLoadingPublished(true);
    try {
      const r = await listPublished();
      setPublished(r.services || []);
      if (!silent) message.success('状态已刷新');
    } catch (e: any) {
      message.error('读取自建发布失败: ' + e.message);
    } finally {
      setLoadingPublished(false);
    }
  }, []);

  useEffect(() => { refreshPublished(true); }, [refreshPublished]);

  // 打开抽屉时才拉取本体的函数/行为/数据引擎（勾选项与就绪判据都在这里收口）
  useEffect(() => {
    if (!drawerOpen) return;
    (async () => {
      setLoadingOptions(true);
      try {
        const [m, fns, bhs, engines] = await Promise.all([
          getPublishMeta(),
          getFunctions(ontologyId),
          getBehaviors(ontologyId),
          getDataEngines(ontologyId),
        ]);
        setMeta({
          kinds: m.kinds?.length ? m.kinds : ALL_PUBLISH_KINDS,
          transports: m.transports?.length ? m.transports : ALL_PUBLISH_TRANSPORTS,
          host_port_min: m.host_port_min,
          host_port_max: m.host_port_max,
        });
        // 后端清单可能收窄（例如某类发布暂不支持）：把当前选择收敛到合法值，避免提交被 400 拒绝
        setForm(f => ({
          ...f,
          kind: m.kinds?.includes(f.kind) ? f.kind : (m.kinds?.[0] ?? f.kind),
          transport: m.transports?.includes(f.transport) ? f.transport : (m.transports?.[0] ?? f.transport),
        }));
        // 就绪判据与运行面同源（契约 ⑥）：唯一实现在 ./mcp-publish/readiness，对齐后端 is_engine_ready
        const ready = readyBehaviorNames(engines);
        setOptions({
          ontology_function: fns.filter(f => f?.name).map(f => ({
            name: f.name, label: f.display_name ? `${f.display_name}（${f.name}）` : f.name, ready: true,
          })),
          behavior: bhs.filter(b => b?.name).map(b => ({
            name: b.name, label: b.display_name ? `${b.display_name}（${b.name}）` : b.name,
            ready: ready.has(b.name),
            hint: ready.has(b.name) ? undefined : '未完成数据引擎映射，未就绪',
          })),
        });
      } catch (e: any) {
        message.error('读取本体清单失败: ' + e.message);
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, [drawerOpen, ontologyId]);

  const submitPublish = async () => {
    if (!form.name.trim()) { message.warning('请填写 MCP 服务名'); return; }
    if (form.items.length === 0) { message.warning(`请至少勾选一个${KIND_LABEL[form.kind]}`); return; }
    setCreating(true);
    try {
      const created = await createPublished({
        ontology_id: ontologyId,
        name: form.name.trim(),
        kind: form.kind,
        items: form.items,
        host_port: form.host_port,
        transport: form.transport,
      });
      message.success(`发布「${created.name}」已创建并启动（${created.tool_count} 个工具）`);
      setDrawerOpen(false);
      setForm({
        name: '',
        kind: ALL_PUBLISH_KINDS[0],
        items: [],
        host_port: meta?.host_port_min ?? 8020,
        transport: ALL_PUBLISH_TRANSPORTS[0],
      });
      await refreshPublished(true);
    } catch (e: any) {
      message.error('创建发布失败: ' + e.message);
    } finally {
      setCreating(false);
    }
  };

  const togglePublished = async (svc: PublishedService) => {
    try {
      const r = svc.running ? await stopPublished(svc.name) : await startPublished(svc.name);
      message.success(`${svc.name} 已${r.running ? '启动' : '停止'}`);
      await refreshPublished(true);
    } catch (e: any) {
      message.error(`${svc.name} 操作失败: ${e.message}`);
    }
  };

  const removePublished = async (svc: PublishedService) => {
    const ok = await new Promise<boolean>(resolve => Modal.confirm({
      title: <span style={{ color: '#fff' }}>删除发布「{svc.name}」？</span>,
      content: (
        <span style={{ color: '#fff' }}>
          将停止并删除其容器（{svc.container_name}）并清除发布记录，该操作不可撤销。
        </span>
      ),
      okText: '确认删除', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: () => resolve(true), onCancel: () => resolve(false),
    }));
    if (!ok) return;
    try {
      const r = await deletePublished(svc.name);
      message.success(r.message);
      await refreshPublished(true);
    } catch (e: any) {
      message.error('删除失败: ' + e.message);
    }
  };

  const showPublishedConfig = async (svc: PublishedService) => {
    try {
      const cfg = await getPublishedClientConfig(svc.name, host);
      // 同一发布有两种地址（用途不同）：第一段给平台外的 AI 客户端；第二段给本平台 Agent
      // （它在容器里，localhost 指向它自己 —— 必须走容器名 + 容器内端口）。
      const inner = cfg.internal_mcpServers;
      setConfigModal({
        title: `自建发布「${svc.name}」客户端配置`,
        json: JSON.stringify({ mcpServers: cfg.mcpServers }, null, 2),
        note: `第一段给平台外的 AI 客户端（Claude / Cursor 等）：宿主地址 + X-MCP-Token 请求头（令牌 ${svc.token}）。\n`
          + '在本平台内使用时，复制第二段（容器内地址），到「MCP 配置」页点「粘贴配置」导入即可。\n'
          + `执行链路：${EXEC_NOTE[svc.kind]}，故 ${svc.kind === 'ontology_function' ? '本体函数执行服务' : '数据引擎执行服务'}需处于运行状态。`,
        extra: inner ? [{
          label: '本平台 Agent（容器内地址，粘进「MCP 配置」）',
          json: JSON.stringify({ mcpServers: inner }, null, 2),
        }] : undefined,
      });
    } catch (e: any) {
      message.error('生成客户端配置失败: ' + e.message);
    }
  };

  /**
   * 查看配置片段：全部走静态两段生成（与自建发布同构）。
   *
   * 业务系统是唯一**非内置**的对外服务，需要去「MCP 配置」页取它登记的请求头（若配了鉴权）；
   * 读配置失败或未登记都**不阻断**——片段照给（无 headers），只在说明里提示，绝不整条回显内部条目。
   */
  const openConfig = async (def: FixedServiceDef) => {
    if (def.key !== 'business') {
      setConfigModal(staticServiceConfig(def, host));
      return;
    }
    try {
      const cfg = await getMCPConfig();
      const entry = findServiceEntry(def, cfg.servers);
      // 空对象也按“没配请求头”处理：片段里不出现 `headers: {}`（客户端会当成要发一个空头集合）
      const headers = entry?.headers && Object.keys(entry.headers).length > 0 ? entry.headers : undefined;
      setConfigModal(staticServiceConfig(def, host, { headers, registered: !!entry }));
    } catch (e: any) {
      setConfigModal(staticServiceConfig(def, host, { configError: e.message }));
    }
  };

  /**
   * 查看自建发布的工具清单：数据来自**发布时冻结的快照**（core 读注册表，不探测容器）。
   *
   * 失败时只 toast 原因、**不打开空清单**——"找不到"显示成"0 个工具"会让用户以为发布没问题；
   * 真正的空快照（0 条）才走弹窗空态。
   */
  const showPublishedTools = async (svc: PublishedService) => {
    try {
      const r = await getPublishedTools(svc.name);
      setToolsModal({
        title: `自建发布「${svc.name}」`,
        tools: r.tools,
        note: '工具清单为发布时快照，修改本体后需重新发布才会更新（停机也可查看）。',
      });
    } catch (e: any) {
      message.error(`读取「${svc.name}」工具清单失败: ${e.message}`);
    }
  };

  /** 启停固定服务（五个固定服务同权；停机前一律弹影响面确认） */
  const handleToggle = async (def: FixedServiceDef) => {
    const key = def.key;
    const card = cards[key];
    if (card.running) {
      const impact = key === 'ontologyQuery'
        ? '停止后 Agent 的本体探索与全部函数执行（设计器测试、自建发布-函数）都会中断。'
        : key === 'commonFunction'
          ? '停止后 filterData / aggregateData / dateDiff 等公共函数不可用——引用它们的规则会被判「关联函数未执行」而阻断行为。'
          : key === 'functionExecutor'
          ? '停止后所有函数类自建发布与设计器函数测试都会失败（本体查询不受影响）。'
          : key === 'dataEngine'
            ? '停止后所有本体行为调用与行为类自建发布都会失败（本体查询、函数不受影响）。'
            : '停止后所有映射到业务系统的行为调用都会失败（本体查询、函数不受影响）；下游是模拟业务系统，恢复后请确认数据。';
      const ok = await new Promise<boolean>(resolve => Modal.confirm({
        title: <span style={{ color: '#fff' }}>停止 {def.title}？</span>,
        content: <span style={{ color: '#fff' }}>{impact}确认停止？</span>,
        okText: '确认停止', okButtonProps: { danger: true }, cancelText: '取消',
        onOk: () => resolve(true), onCancel: () => resolve(false),
      }));
      if (!ok) return;
    }
    patch(key, { toggling: true });
    try {
      const r = card.running
        ? await stopMcp(def.service)
        : await startMcp(def.service);
      message.success(r.message);
      patch(key, { running: r.running });
      // 三个对外工具面启动后都要回填清单（执行底座零工具，不在 TOOL_FETCHERS 里）
      const fetchTools = TOOL_FETCHERS[key];
      if (r.running && fetchTools) {
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise(r2 => setTimeout(r2, 1000));
          try {
            const tools = await fetchTools();
            if (tools && tools.length > 0) { patch(key, { tools }); break; }
          } catch { /* retry：等容器就绪 */ }
        }
      } else if (!r.running) {
        patch(key, { tools: [] });
      }
    } catch (e: any) { message.error(e.message); }
    finally { patch(key, { toggling: false }); }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-text-primary">MCP 发布</h3>
          <p className="text-text-muted text-xs mt-0.5">
            分「固定发布」（平台内置）与「自建发布」
            （按本体切片动态创建容器）两块，右上角可来回切换。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Segmented
            value={view}
            onChange={v => setView(v as PublishView)}
            options={[
              { label: `固定发布（${FIXED_SERVICES.length}）`, value: 'fixed' },
              { label: `自建发布（${published.length}）`, value: 'published' },
            ]}
          />
          {view === 'published' && (
            <Button type="primary" onClick={() => setDrawerOpen(true)}>+ 新建发布</Button>
          )}
        </div>
      </div>

      {view === 'fixed' ? (
        <section aria-label="固定发布">
          <div className="flex items-center justify-between gap-4 mb-2">
            <span className="text-xs text-text-muted">
              固定发布为平台内置常驻（不可新建/删除）：<span className="text-accent-blue">本体查询 MCP 服务</span>与
              <span className="text-accent-blue">公共函数 MCP 服务</span>是两个内置对外工具面；
              两个<span className="text-accent-blue">执行服务</span>零工具、只在 Docker 内网可达；
              对外服务的「查看配置」给出宿主与容器内两段
            </span>
            <Button size="small" loading={fixedRefreshing} onClick={() => refresh()}>刷新</Button>
          </div>
          <ServiceGrid
            key="fixed"
            items={FIXED_SERVICES}
            renderItem={def => (
              <FixedServiceCard
                key={def.key}
                def={def}
                card={cards[def.key]}
                host={host}
                onOpenConfig={openConfig}
                onToggle={handleToggle}
                onShowTools={d => setToolsModal({ title: d.title, tools: cards[d.key].tools })}
              />
            )}
          />
        </section>
      ) : (
        <section aria-label="自建发布">
          <div className="flex items-center justify-between gap-4 mb-2">
            <span className="text-xs text-text-muted">
              自建发布为动态容器（一个镜像多实例，宿主端口 8020-8099，可启停/删除）：按本体切片对外提供函数或行为；
              发布即冻结工具清单，可随时查看快照（与固定发布的卡片结构一致）
            </span>
            <Button size="small" loading={loadingPublished} onClick={() => refreshPublished()}>刷新</Button>
          </div>
          <ServiceGrid
            key="published"
            items={published}
            renderItem={svc => (
              <PublishedServiceCard
                key={svc.name}
                svc={svc}
                host={host}
                checking={loadingPublished}
                onShowConfig={showPublishedConfig}
                onToggle={togglePublished}
                onRemove={removePublished}
                onShowTools={showPublishedTools}
              />
            )}
            empty={(
              <div className="border border-dark-border rounded-lg py-10 text-center text-text-muted text-sm">
                还没有自建发布。点击「+ 新建发布」，勾选当前本体的函数或行为对外提供。
              </div>
            )}
          />
        </section>
      )}

      {/* ─── 新建发布 ──────────────────────────────────────────────────── */}
      <Modal
        title="新建 MCP 发布"
        open={drawerOpen}
        onCancel={() => setDrawerOpen(false)}
        onOk={submitPublish}
        okText="创建并启动"
        cancelText="取消"
        confirmLoading={creating}
        width={640}
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="text-xs text-text-muted mb-1">MCP 服务名（字母/数字/下划线/连字符，最长 32 字符）</div>
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="例如 order-query"
            />
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">发布类型（决定执行走哪条链路）</div>
            <Radio.Group
              value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value as PublishKind, items: [] })}
              optionType="button"
              buttonStyle="solid"
              // 选项来自后端 `/meta`（运行时事实源）：后端新增/收窄发布类型时前端无需改代码
              options={(meta?.kinds ?? ALL_PUBLISH_KINDS).map(k => ({
                value: k,
                label: (KIND_LABEL as Record<string, string | undefined>)[k] ?? k,
              }))}
            />
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">
              勾选{KIND_LABEL[form.kind]}（可多选）
              {form.kind === 'behavior' ? '——未完成数据引擎映射的行为不可发布' : ''}
            </div>
            <Select
              mode="multiple"
              className="w-full"
              value={form.items}
              onChange={v => setForm({ ...form, items: v })}
              loading={loadingOptions}
              placeholder={loadingOptions ? '加载本体清单中...' : `选择要发布的${KIND_LABEL[form.kind]}`}
              optionFilterProp="label"
              options={itemsOfKind.map(o => ({ value: o.name, label: o.label, disabled: !o.ready }))}
              optionRender={opt => {
                const item = itemsOfKind.find(o => o.name === opt.value);
                return (
                  <div className="flex items-center justify-between gap-3">
                    <span>{item?.label}</span>
                    {item?.hint && <span className="text-xs text-text-muted">{item.hint}</span>}
                  </div>
                );
              }}
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="text-xs text-text-muted mb-1">
                宿主端口（{meta?.host_port_min ?? 8020}-{meta?.host_port_max ?? 8099}，需未被占用）
              </div>
              <InputNumber
                className="w-full"
                min={meta?.host_port_min ?? 8020}
                max={meta?.host_port_max ?? 8099}
                value={form.host_port}
                onChange={v => setForm({ ...form, host_port: Number(v) || 8020 })}
              />
            </div>
            <div className="flex-1">
              <div className="text-xs text-text-muted mb-1">传输模式</div>
              <Select
                className="w-full"
                value={form.transport}
                onChange={v => setForm({ ...form, transport: v as PublishTransport })}
                // 同上：选项以后端 `/meta` 为准，文案与端点形态的对应收在 catalog 里
                options={(meta?.transports ?? ALL_PUBLISH_TRANSPORTS).map(t => ({
                  value: t,
                  label: (TRANSPORT_OPTION_LABEL as Record<string, string | undefined>)[t] ?? t,
                }))}
              />
            </div>
          </div>
          <div className="text-xs text-text-muted leading-relaxed border-t border-dark-border pt-3">
            创建将启动一个专属容器（零挂载、令牌鉴权、降权运行），访问地址
            <code className="text-yellow-400"> http://{host}:{form.host_port}{form.transport === 'sse' ? '/sse' : '/mcp'}</code>。
            执行链路：{EXEC_NOTE[form.kind]}。工具清单为发布时快照，改动本体后需重新发布才会生效。
          </div>
        </div>
      </Modal>

      {/* ─── Tools Modal (工具列表) ──────────────────────────────────── */}
      <ToolsModal data={toolsModal} onClose={() => setToolsModal(null)} />

      {/* ─── Config Modal (每卡独立配置) ──────────────────────────────────── */}
      <ConfigModalView data={configModal} onClose={() => setConfigModal(null)} />
    </div>
  );
}
