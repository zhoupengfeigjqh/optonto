'use client';

/**
 * MCP发布 —— 平台 MCP 服务的发布与管控（数据引擎分组）。
 *
 * 两段结构（语义不同，不可混为一谈）：
 * 1. **固定服务**：平台内置，compose 常驻管理——① 本体查询 MCP 服务（唯一内置对外工具面，只读查询）；
 *    ② 本体函数执行服务（零工具、仅内网）；③ 数据引擎执行服务（行为执行底座、工具面仅内网）；
 *    ④ 业务系统 MCP（业务侧集成边缘，模拟外部业务系统）。四者均可启停，不可新建/删除。
 * 2. **自建发布**：用户在当前本体上勾选函数/行为切片创建的**动态容器**（一个镜像多实例，
 *    宿主端口 8020-8099）。可启动/停止/删除，带访问令牌（对外暴露必须鉴权）。
 *
 * 自建发布**不自带执行实现**：函数转发本体函数执行服务、行为转发数据引擎执行服务，
 * 因此对应执行服务停机时自建发布不可用（卡片上标注依赖）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, InputNumber, Modal, Radio, Select, Tag, message } from 'antd';
import {
  getMcpStatus, startMcp, stopMcp, getMcpTools, getBusinessMcpTools, getCommonFunctionMcpTools,
  createPublished, deletePublished, getPublishMeta, listPublished, startPublished, stopPublished,
  getPublishedClientConfig, McpServiceKey, PublishedService, PublishKind, PublishTransport,
} from '@/api/client';
import { getMCPConfig } from '@/api/agent-client';
import { clickableProps } from '@/utils/a11y';

interface ToolInfo { name: string; description: string; inputSchema?: any }

type CardKey = 'ontologyQuery' | 'commonFunction' | 'functionExecutor' | 'dataEngine' | 'business';

interface CardState {
  checking: boolean;
  running: boolean;
  toggling: boolean;
  tools: ToolInfo[];
  statusText: string;
}

const INIT: CardState = { checking: true, running: false, toggling: false, tools: [], statusText: '' };

/**
 * 固定服务元数据（键名即角色，2026-10-04 语义统一）：
 * - 对外发布工具：只有「本体查询 MCP 服务」与「业务系统 MCP」（业务侧集成边缘）；
 * - 执行底座：本体函数执行服务（零工具）、数据引擎执行服务（工具面仅内网供 Agent 挂载）；
 * - 对外提供"可执行能力"（函数/行为）只有一条路：下方「自建发布」。
 */
const FIXED_SERVICES: {
  key: CardKey; title: string; service: McpServiceKey;
  endpoint: string; exposure: '对外' | '内网'; publishTools: boolean; role: string;
}[] = [
  {
    key: 'ontologyQuery', title: '本体查询 MCP 服务', service: 'ontology-query',
    endpoint: 'http://{host}:8002/mcp', exposure: '对外', publishTools: true,
    role: '回答「本体里有什么」：概念 / 关系 / 函数清单 / 行为清单 / 流程 / 安全配置 / 花名册（只读、无副作用）。',
  },
  {
    key: 'commonFunction', title: '公共函数 MCP 服务', service: 'common-function',
    endpoint: 'http://{host}:8007/mcp', exposure: '对外', publishTools: true,
    role: '平台级通用算力（filterData / aggregateData / dateDiff 等 7 个）：无本体归属、跨场景共享、纯计算。发布与执行一体——本服务内直接执行，无需转发。与本体函数不同：那个有本体归属、对外需按本体切片，故其执行底座不对外。',
  },
  {
    key: 'functionExecutor', title: '本体函数执行服务', service: 'function-executor',
    endpoint: 'Docker 内网 optonto-ontology-function-executor:8006', exposure: '内网', publishTools: false,
    role: '函数执行的唯一实现（本地执行函数代码）。零工具：不提供任何 MCP 工具，只接受 /execute-function 调用。',
  },
  {
    key: 'dataEngine', title: '数据引擎执行服务', service: 'data-engine',
    endpoint: 'Docker 内网 optonto-data-engine-executor:8005', exposure: '内网', publishTools: false,
    role: '本体行为执行的唯一实现（映射翻译 → 下游 MCP）。工具面仅供平台 Agent 内网挂载，不对外提供。',
  },
  {
    key: 'business', title: '业务系统 MCP', service: 'business',
    endpoint: 'http://{host}:8004/mcp', exposure: '对外', publishTools: true,
    role: '业务侧集成边缘：模拟外部业务系统（直连 business-backend）。与其他固定服务同权，可启停。',
  },
];

/** 可勾选项：函数恒可选；行为需已就绪（已完成数据引擎映射，契约 ⑥） */
interface SelectableItem { name: string; label: string; ready: boolean; hint?: string }

const KIND_LABEL: Record<PublishKind, string> = { ontology_function: '本体函数', behavior: '本体行为' };
const TRANSPORT_LABEL: Record<PublishTransport, string> = { sse: 'sse', streamable: 'http-streamable' };
/** 自建发布的执行链路说明（文案与运行时一致，见 published-mcp/server.py） */
const EXEC_NOTE: Record<PublishKind, string> = {
  ontology_function: '由本体函数执行服务在本地执行函数代码（发布门面只转发，不含执行实现）',
  behavior: '由数据引擎执行服务做映射翻译后调下游 MCP（发布门面只转发）',
};

export default function MCPPublish({ ontologyId }: { ontologyId: number }) {
  const [cards, setCards] = useState<Record<CardKey, CardState>>({
    ontologyQuery: { ...INIT }, commonFunction: { ...INIT }, functionExecutor: { ...INIT },
    dataEngine: { ...INIT }, business: { ...INIT },
  });
  const [toolsModal, setToolsModal] = useState<{ title: string; tools: ToolInfo[] } | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [configModal, setConfigModal] = useState<{ title: string; json: string; note?: string } | null>(null);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  // ─── 自建发布（动态容器）───────────────────────────────────────────────
  const [published, setPublished] = useState<PublishedService[]>([]);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [meta, setMeta] = useState<{ host_port_min: number; host_port_max: number } | null>(null);
  const [options, setOptions] = useState<Record<PublishKind, SelectableItem[]>>({ ontology_function: [], behavior: [] });
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [form, setForm] = useState<{
    name: string; kind: PublishKind; items: string[]; host_port: number; transport: PublishTransport;
  }>({ name: '', kind: 'ontology_function', items: [], host_port: 8020, transport: 'streamable' });

  const patch = (key: keyof typeof cards, p: Partial<CardState>) =>
    setCards(prev => ({ ...prev, [key]: { ...prev[key], ...p } }));

  const refresh = useCallback(async (silent = false) => {
    // 重置为检查中，给用户明确的"正在刷新"反馈
    setCards(prev => ({
      ontologyQuery: { ...prev.ontologyQuery, checking: true },
      commonFunction: { ...prev.commonFunction, checking: true },
      functionExecutor: { ...prev.functionExecutor, checking: true },
      dataEngine: { ...prev.dataEngine, checking: true },
      business: { ...prev.business, checking: true },
    }));
    // 本体查询 MCP 服务：唯一内置对外工具面，工具清单经 nginx /mcp/ 拉取
    try {
      const [s, tools] = await Promise.all([getMcpStatus('ontology-query'), getMcpTools()]);
      patch('ontologyQuery', { checking: false, running: s.running, tools, statusText: s.status });
    } catch { patch('ontologyQuery', { checking: false, running: false, tools: [] }); }
    // 公共函数 MCP 服务：第二个内置对外工具面（平台通用算力，发布 + 执行一体）
    try {
      const [s, tools] = await Promise.all([getMcpStatus('common-function'), getCommonFunctionMcpTools()]);
      patch('commonFunction', { checking: false, running: s.running, tools, statusText: s.status });
    } catch { patch('commonFunction', { checking: false, running: false, tools: [] }); }
    // 本体函数执行服务：零工具（transport=none），只看运行态
    try {
      const s = await getMcpStatus('function-executor');
      patch('functionExecutor', { checking: false, running: s.running, statusText: s.status });
    } catch { patch('functionExecutor', { checking: false, running: false }); }
    // 数据引擎执行服务：工具面仅内网（不对外代理），故只读运行态
    try {
      const s = await getMcpStatus('data-engine');
      patch('dataEngine', { checking: false, running: s.running, statusText: s.status });
    } catch { patch('dataEngine', { checking: false, running: false }); }
    // 业务系统 MCP：与其他固定服务同权，可启停（2026-10-04 用户决策）
    try {
      const [s, tools] = await Promise.all([getMcpStatus('business'), getBusinessMcpTools()]);
      patch('business', { checking: false, running: s.running, tools, statusText: s.status });
    } catch { patch('business', { checking: false, running: false, tools: [] }); }
    if (!silent) message.success('状态已刷新');
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  const refreshPublished = useCallback(async () => {
    setLoadingPublished(true);
    try {
      const r = await listPublished();
      setPublished(r.services || []);
    } catch (e: any) {
      message.error('读取自建发布失败: ' + e.message);
    } finally {
      setLoadingPublished(false);
    }
  }, []);

  useEffect(() => { refreshPublished(); }, [refreshPublished]);

  // 打开抽屉时才拉取本体的函数/行为/数据引擎（勾选项与就绪判据都在这里收口）
  useEffect(() => {
    if (!drawerOpen) return;
    (async () => {
      setLoadingOptions(true);
      try {
        const getJson = async (path: string) => {
          const resp = await fetch(path);
          if (!resp.ok) throw new Error((await resp.json().catch(() => null))?.message || resp.statusText);
          return resp.json();
        };
        const [m, fns, bhs, engines] = await Promise.all([
          getPublishMeta(),
          getJson(`/api/ontologies/${ontologyId}/functions`),
          getJson(`/api/ontologies/${ontologyId}/behaviors`),
          getJson(`/api/ontologies/${ontologyId}/data-engines`),
        ]);
        setMeta({ host_port_min: m.host_port_min, host_port_max: m.host_port_max });
        // 就绪判据与运行面同源（契约 ⑥）：存在 target.server_url + target.tool_name 齐备的数据引擎
        const readyBehaviors = new Set(
          (Array.isArray(engines) ? engines : [])
            .filter((e: any) => e?.target?.server_url && e?.target?.tool_name)
            .map((e: any) => e.behavior_name),
        );
        setOptions({
          ontology_function: (Array.isArray(fns) ? fns : []).filter((f: any) => f?.name).map((f: any) => ({
            name: f.name, label: f.display_name ? `${f.display_name}（${f.name}）` : f.name, ready: true,
          })),
          behavior: (Array.isArray(bhs) ? bhs : []).filter((b: any) => b?.name).map((b: any) => ({
            name: b.name, label: b.display_name ? `${b.display_name}（${b.name}）` : b.name,
            ready: readyBehaviors.has(b.name),
            hint: readyBehaviors.has(b.name) ? undefined : '未完成数据引擎映射，未就绪',
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
      setForm({ name: '', kind: 'ontology_function', items: [], host_port: 8020, transport: 'streamable' });
      await refreshPublished();
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
      await refreshPublished();
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
      await refreshPublished();
    } catch (e: any) {
      message.error('删除失败: ' + e.message);
    }
  };

  const showPublishedConfig = async (svc: PublishedService) => {
    try {
      const cfg = await getPublishedClientConfig(svc.name, host);
      const url = cfg.mcpServers[svc.name]?.url || '';
      setConfigModal({
        title: `自建发布「${svc.name}」客户端配置`,
        json: JSON.stringify(cfg, null, 2),
        note: `粘进「MCP配置」即可连接；必须携带 X-MCP-Token 请求头（访问令牌 ${svc.token}）。\n`
          + `执行链路：${EXEC_NOTE[svc.kind]}，故 ${svc.kind === 'ontology_function' ? '本体函数执行服务' : '数据引擎执行服务'}需处于运行状态。`,
      });
      void url;
    } catch (e: any) {
      message.error('生成客户端配置失败: ' + e.message);
    }
  };

  /** 启停固定服务（五个固定服务同权；停机前一律弹影响面确认） */
  const handleToggle = async (key: CardKey, def: typeof FIXED_SERVICES[number]) => {
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
      // 只有对外工具面需要回填工具清单（执行底座的工具面不对外）
      if (r.running && key === 'ontologyQuery') {
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise(r2 => setTimeout(r2, 1000));
          try {
            const tools = await getMcpTools();
            if (tools && tools.length > 0) { patch(key, { tools }); break; }
          } catch { /* retry：等容器就绪 */ }
        }
      } else if (!r.running) {
        patch(key, { tools: [] });
      }
    } catch (e: any) { message.error(e.message); }
    finally { patch(key, { toggling: false }); }
  };  /**
   * 查看配置片段：
   * - 对外工具面（本体查询 / 业务系统）→ 给出可直接粘进「MCP配置」的连接片段；
   * - 执行底座（函数 / 数据引擎）→ **不给对外连接片段**，只说明它是内网执行端点。
   */
  const openConfig = async (def: typeof FIXED_SERVICES[number]) => {
    if (def.key === 'ontologyQuery') {
      setConfigModal({
        title: '本体查询 MCP 服务（对外）',
        json: JSON.stringify({ mcpServers: { 'optonto-ontology-query': { type: 'url', url: `http://${host}:8002/mcp` } } }, null, 2),
        note: '平台唯一内置的对外工具面：只发布本体语义查询（listOnto* 八件套），只读、无副作用。'
          + '本体函数与行为请用下方「自建发布」按本体切片对外提供。',
      });
      return;
    }
    if (def.key === 'commonFunction') {
      setConfigModal({
        title: '公共函数 MCP 服务（对外）',
        json: JSON.stringify({ mcpServers: { 'optonto-common-function': { type: 'url', url: `http://${host}:8007/mcp` } } }, null, 2),
        note: '平台级通用算力：日期处理 / 数据过滤 / 聚合 / 分组共 7 个公共函数，跨本体共享、约定为纯计算（无副作用）。'
          + '与本体函数的区别——那个有本体归属、对外要按本体切片发布；公共函数无归属，连接即用。'
          + '本服务发布与执行一体（调用即在本服务内本地执行，无需转发）。',
      });
      return;
    }
    if (def.key === 'functionExecutor') {
      setConfigModal({
        title: '本体函数执行服务（内网执行端点）',
        json: JSON.stringify({ internal: true, endpoint: 'http://optonto-ontology-function-executor:8006', endpoints: ['POST /execute-function'] }, null, 2),
        note: '零工具服务：不挂 /mcp 与 /sse，外部客户端误连直接 404。'
          + '只执行**本体函数**（执行前做归属一致性校验），调用方是 core 设计器测试与自建发布（函数类）。'
          + '公共函数执行不在这里——已迁至公共函数 MCP 服务（8007 /execute-common-function），该服务发布与执行一体。',
      });
      return;
    }
    if (def.key === 'dataEngine') {
      setConfigModal({
        title: '数据引擎执行服务（内网执行端点）',
        json: JSON.stringify({ internal: true, endpoint: 'http://optonto-data-engine-executor:8005', endpoints: ['POST /call-behavior', 'POST /call-engine'] }, null, 2),
        note: '行为执行的唯一实现（映射翻译 → 下游 MCP）。工具面仅供平台 Agent 内网挂载，不对外提供；'
          + '对外暴露行为请用下方「自建发布」。',
      });
      return;
    }
    try {
      const cfg = await getMCPConfig();
      const entry = cfg.servers.find(s => !s.builtin && s.url.includes('business-mcp'));
      setConfigModal(entry ? {
        title: '业务系统 MCP（对外）',
        json: JSON.stringify(entry, null, 2),
        note: '业务侧集成边缘（非平台内置，外部形态）。以上为「MCP 配置」页中手工维护的条目（含 headers 鉴权）。',
      } : {
        title: '业务系统 MCP（对外）',
        json: JSON.stringify({ name: '业务系统MCP', url: 'http://optonto-business-mcp:8004/mcp', enabled: true }, null, 2),
        note: '尚未在「MCP 配置」页配置该服务。以上为参考条目——请前往 MCP 配置页手工新增（它不是平台内置服务，不会自动注册）。',
      });
    } catch (e: any) { message.error('读取 MCP 配置失败: ' + e.message); }
  };  /** 固定服务卡片（元数据驱动：标题/角色/暴露面/工具面/操作全部来自 FIXED_SERVICES） */
  const renderFixedCard = (def: typeof FIXED_SERVICES[number]) => {
    const card = cards[def.key];
    return (
      <div key={def.key} className="bg-dark-card border border-dark-border rounded-lg p-5 w-96 flex flex-col">
        <div className="flex items-start justify-between mb-3 gap-2">
          <span className="text-text-primary text-sm font-semibold">{def.title}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Tag color={def.publishTools ? 'blue' : 'default'} className="m-0">
              {def.publishTools ? '对外提供工具' : '不对外提供工具'}
            </Tag>
            <Tag color={def.exposure === '对外' ? 'green' : 'default'} className="m-0">{def.exposure}</Tag>
          </div>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <span className={`w-3 h-3 rounded-full ${card.checking ? 'bg-gray-500' : card.running ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-text-primary text-sm">
            {card.checking ? '检查中...' : card.running ? '运行中' : '已停止'}
          </span>
        </div>
        <div className="text-xs text-text-muted space-y-1 mb-4 flex-1">
          <div>端点：<code className="text-yellow-400 break-all">{def.endpoint.replace('{host}', host)}</code></div>
          {def.publishTools ? (
            <div className="flex items-center gap-2">
              <span>可用工具：</span>
              <span className="text-accent-green font-semibold">{card.tools.length}</span>
              {card.tools.length > 0 && (
                <Button type="link" size="small" onClick={() => { setSelectedTool(null); setToolsModal({ title: def.title, tools: card.tools }); }}>
                  查看工具
                </Button>
              )}
            </div>
          ) : (
            <div className="text-text-muted">零工具：不发布任何 MCP 工具，只提供内部执行端点</div>
          )}
          <div className="leading-relaxed">{def.role}</div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => openConfig(def)}>查看配置</Button>
          <Button
            loading={card.toggling}
            danger={card.running}
            style={card.running ? { color: '#fff', background: '#ef4444', borderColor: '#ef4444' } : undefined}
            onClick={() => handleToggle(def.key, def)}
          >
            {card.running ? '停止' : '启动'}
          </Button>
          <Button onClick={() => refresh()}>刷新</Button>
        </div>
      </div>
    );
  };

  /** 自建发布卡片（动态容器）：地址/令牌/依赖一目了然，操作就地完成 */
  const renderPublishedCard = (svc: PublishedService) => (
    <div key={svc.name} className="bg-dark-card border border-dark-border rounded-lg p-5 w-96">
      <div className="flex items-center justify-between mb-3">
        <span className="text-text-primary text-sm font-semibold">{svc.name}</span>
        <Tag color={svc.running ? 'success' : 'default'} className="m-0">
          {svc.running ? '运行中' : svc.status === 'not_found' ? '容器缺失' : '已停止'}
        </Tag>
      </div>
      <div className="text-xs text-text-muted space-y-1 mb-4">
        <div>类型：{KIND_LABEL[svc.kind]}（{svc.tool_count} 个：{svc.items.join('、')}）</div>
        <div>本体：{svc.ontology_name}（ontology_id={svc.ontology_id}）</div>
        <div>
          地址：<code className="text-yellow-400">http://{host}:{svc.host_port}{svc.transport === 'sse' ? '/sse' : '/mcp'}</code>
        </div>
        <div>传输模式：{TRANSPORT_LABEL[svc.transport]}</div>
        <div>访问令牌：<code className="text-accent-green">{svc.token}</code>（须带 X-MCP-Token 头）</div>
        <div className="text-yellow-400/80">
          依赖 {svc.kind === 'ontology_function' ? '本体函数执行服务' : '数据引擎执行服务'} 运行中；工具清单为发布时快照
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => showPublishedConfig(svc)}>查看配置</Button>
        <Button onClick={() => togglePublished(svc)}>{svc.running ? '停止' : '启动'}</Button>
        <Button danger onClick={() => removePublished(svc)}>删除</Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">MCP 发布</h3>
          <p className="text-text-muted text-xs mt-0.5">
            发布 Model Context Protocol 服务端点，供 AI 客户端连接使用。固定服务由平台内置；自建发布按本体切片动态创建容器。
          </p>
        </div>
        <Button type="primary" onClick={() => setDrawerOpen(true)}>+ 新建发布</Button>
      </div>

      <div className="text-xs text-text-muted mb-2">
        固定服务（平台内置，compose 常驻管理）：<span className="text-accent-blue">本体查询 MCP 服务</span>是唯一内置对外工具面；
        两个<span className="text-accent-blue">执行服务</span>只在 Docker 内网可达，不对外提供工具
      </div>
      <div className="flex gap-4 flex-wrap mb-8">
        {FIXED_SERVICES.map(renderFixedCard)}
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted">
          自建发布（动态容器：对外提供执行能力的唯一出口。一个镜像多实例，宿主端口 8020-8099，发布即冻结工具清单）
        </span>
        <Button size="small" loading={loadingPublished} onClick={() => refreshPublished()}>刷新</Button>
      </div>
      {published.length === 0 ? (
        <div className="border border-dark-border rounded-lg py-10 text-center text-text-muted text-sm">
          还没有自建发布。点击「+ 新建发布」，勾选当前本体的函数或行为对外提供。
        </div>
      ) : (
        <div className="flex gap-4 flex-wrap">{published.map(renderPublishedCard)}</div>
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
              options={[
                { value: 'ontology_function', label: '本体函数（本地执行）' },
                { value: 'behavior', label: '本体行为（映射调下游）' },
              ]}
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
              options={options[form.kind].map(o => ({ value: o.name, label: o.label, disabled: !o.ready }))}
              optionRender={opt => {
                const item = options[form.kind].find(o => o.name === opt.value);
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
                options={[
                  { value: 'streamable', label: 'http-streamable（/mcp）' },
                  { value: 'sse', label: 'sse（/sse + /messages/）' },
                ]}
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
      <Modal title={`${toolsModal?.title || ''} 工具列表`} open={!!toolsModal} onCancel={() => { setToolsModal(null); setSelectedTool(null); }} footer={null} width={650}>
        {!toolsModal || toolsModal.tools.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无工具信息</p>
        ) : (
          <div className="max-h-96 overflow-y-auto -mx-6 -mb-4 px-6 pb-4">
            {toolsModal.tools.map(t => {
              const selected = selectedTool === t.name;
              const props = t.inputSchema?.properties || {};
              const required = t.inputSchema?.required || [];
              return (
              <div key={t.name}>
                <div className="py-3 border-b border-dark-border last:border-b-0 cursor-pointer hover:bg-dark-hover -mx-6 px-6" {...clickableProps(() => setSelectedTool(selected ? null : t.name), `${t.name} 工具详情`)}>
                  <div className="text-text-primary text-sm font-medium">{t.name}</div>
                  <div className="text-text-muted text-xs mt-0.5">{t.description}</div>
                  {Object.keys(props).length > 0 && <div className="text-accent-blue text-xs mt-1">{Object.keys(props).length} 个参数 {selected ? '▲' : '▼'}</div>}
                </div>
                {selected && Object.keys(props).length > 0 && (
                  <div className="px-6 py-2 bg-dark-bg border-b border-dark-border space-y-1.5">
                    {Object.entries(props).map(([k, v]: any) => (
                      <div key={k} className="flex items-start gap-2 text-xs">
                        <span className="text-yellow-400 font-mono shrink-0 w-28">{k}</span>
                        <span className="text-text-muted shrink-0">({v.type || 'any'})</span>
                        {required.includes(k) && <span className="text-red-400 shrink-0">*必填</span>}
                        {v.description && <span className="text-text-secondary">— {v.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* ─── Config Modal (每卡独立配置) ──────────────────────────────────── */}
      <Modal title={configModal?.title || 'MCP 发布配置'} open={!!configModal} onCancel={() => setConfigModal(null)} footer={null} width={600}>
        {configModal?.note && <p className="text-text-muted text-xs mb-3">{configModal.note}</p>}
        <div className="relative">
          <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono text-yellow-400 whitespace-pre-wrap overflow-x-auto">{configModal?.json}</pre>
          <Button size="small" className="absolute top-2 right-2" onClick={() => { navigator.clipboard.writeText(configModal?.json || ''); message.success('已复制到剪贴板'); }}>复制</Button>
        </div>
      </Modal>
    </div>
  );
}
