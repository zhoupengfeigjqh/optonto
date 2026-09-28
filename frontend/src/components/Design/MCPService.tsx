'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, message } from 'antd';
import {
  getMcpStatus, startMcp, stopMcp, getMcpTools, getDataEngineMcpTools, getBusinessMcpStatus,
  McpServiceKey,
} from '@/api/client';
import { getMCPConfig } from '@/api/agent-client';
import { clickableProps } from '@/utils/a11y';

interface ToolInfo { name: string; description: string; inputSchema?: any }

interface CardState {
  checking: boolean;
  running: boolean;
  toggling: boolean;
  tools: ToolInfo[];
  statusText: string;
}

const INIT: CardState = { checking: true, running: false, toggling: false, tools: [], statusText: '' };

/**
 * MCP 服务三卡面板（架构文档 §十六）：
 * - ontology / data-engine：平台运行时底座，可启停（停止弹确认——中断行为调用/Agent 瘫痪）
 * - business-mcp：业务侧集成边缘，前端只读状态，启停只能 Docker 手动（双层防护的一环）
 */
export default function MCPService() {
  const [cards, setCards] = useState<Record<'ontology' | 'dataEngine' | 'business', CardState>>({
    ontology: { ...INIT }, dataEngine: { ...INIT }, business: { ...INIT },
  });
  const [toolsModal, setToolsModal] = useState<{ title: string; tools: ToolInfo[] } | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [configModal, setConfigModal] = useState<{ title: string; json: string; note?: string } | null>(null);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  const patch = (key: keyof typeof cards, p: Partial<CardState>) =>
    setCards(prev => ({ ...prev, [key]: { ...prev[key], ...p } }));

  const refresh = useCallback(async (silent = false) => {
    // 重置为检查中，给用户明确的"正在刷新"反馈
    setCards(prev => ({
      ontology: { ...prev.ontology, checking: true },
      dataEngine: { ...prev.dataEngine, checking: true },
      business: { ...prev.business, checking: true },
    }));
    // ontology 卡：状态 + 工具
    try {
      const [s, tools] = await Promise.all([getMcpStatus('ontology'), getMcpTools()]);
      patch('ontology', { checking: false, running: s.running, tools, statusText: s.status });
    } catch { patch('ontology', { checking: false, running: false, tools: [] }); }
    // data-engine 卡：状态 + 工具
    try {
      const [s, tools] = await Promise.all([getMcpStatus('data-engine'), getDataEngineMcpTools()]);
      patch('dataEngine', { checking: false, running: s.running, tools, statusText: s.status });
    } catch { patch('dataEngine', { checking: false, running: false, tools: [] }); }
    // business 卡：只读状态
    try {
      const s = await getBusinessMcpStatus();
      patch('business', { checking: false, running: s.running, statusText: s.status });
    } catch { patch('business', { checking: false, running: false }); }
    if (!silent) message.success('状态已刷新');
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  const handleToggle = async (key: 'ontology' | 'dataEngine', service: McpServiceKey, label: string) => {
    const card = cards[key];
    if (card.running) {
      // 停止确认（文档 §十六：中断行为调用 / Agent 基本瘫痪）
      const ok = await new Promise<boolean>(resolve => Modal.confirm({
        title: <span style={{ color: '#fff' }}>停止 {label}？</span>,
        content: <span style={{ color: '#fff' }}>{service === 'data-engine'
          ? '停止后所有本体行为调用将不可用（本体查询/函数不受影响）。确认停止？'
          : '停止后 Agent 将基本瘫痪（本体查询/函数/行为全断）。确认停止？'}</span>,
        okText: '确认停止', okButtonProps: { danger: true }, cancelText: '取消',
        onOk: () => resolve(true), onCancel: () => resolve(false),
      }));
      if (!ok) return;
    }
    patch(key, { toggling: true });
    try {
      const r = card.running ? await stopMcp(service) : await startMcp(service);
      message.success(r.message);
      patch(key, { running: r.running });
      if (r.running) {
        // 等容器就绪后拉工具清单
        const fetchTools = key === 'ontology' ? getMcpTools : getDataEngineMcpTools;
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise(r2 => setTimeout(r2, 1000));
          try {
            const tools = await fetchTools();
            if (tools && tools.length > 0) { patch(key, { tools }); break; }
          } catch { /* retry */ }
        }
      } else {
        patch(key, { tools: [] });
      }
    } catch (e: any) { message.error(e.message); }
    finally { patch(key, { toggling: false }); }
  };

  /** 每张卡独立的查看配置：内置两服务给外部客户端连接片段；business 卡展示 MCP 配置里的手工条目 */
  const openConfig = async (key: 'ontology' | 'dataEngine' | 'business') => {
    if (key === 'ontology') {
      setConfigModal({
        title: '本体MCP 配置',
        json: JSON.stringify({ mcpServers: { 'optonto-ontology': { type: 'url', url: `http://${host}:8002/mcp` } } }, null, 2),
        note: '将以上配置添加到你的 agent 的 MCP 配置中，即可连接本体服务。',
      });
      return;
    }
    if (key === 'dataEngine') {
      setConfigModal({
        title: '数据引擎MCP 配置',
        json: JSON.stringify({ mcpServers: { 'optonto-data-engine': { type: 'url', url: `http://${host}:8005/mcp` } } }, null, 2),
        note: '将以上配置添加到你的 agent 的 MCP 配置中，即可连接数据引擎服务。',
      });
      return;
    }
    // business-mcp：非平台内置，须手工配进 MCP 配置（模拟业务系统）；这里只展示该手工条目
    try {
      const cfg = await getMCPConfig();
      const entry = cfg.servers.find(s => !s.builtin && s.url.includes('business-mcp'));
      setConfigModal(entry ? {
        title: '业务系统MCP 配置',
        json: JSON.stringify(entry, null, 2),
        note: '以上为「MCP 配置」页中手工维护的条目（含 headers 鉴权）。修改请前往 MCP 配置页。',
      } : {
        title: '业务系统MCP 配置',
        json: JSON.stringify({
          name: '业务系统MCP', url: 'http://optonto-business-mcp:8004/mcp', enabled: true,
        }, null, 2),
        note: '尚未在「MCP 配置」页配置该服务。以上为参考条目——请前往 MCP 配置页手工新增（它不是平台内置服务，不会自动注册）。',
      });
    } catch (e: any) { message.error('读取 MCP 配置失败: ' + e.message); }
  };

  const renderCard = (
    key: 'ontology' | 'dataEngine' | 'business',
    title: string, endpoint: string, readonly: boolean,
  ) => {
    const card = cards[key];
    return (
      <div className="bg-dark-card border border-dark-border rounded-lg p-5 w-96">
        <div className="flex items-center justify-between mb-3">
          <span className="text-text-primary text-sm font-semibold">{title}</span>
          {readonly && <span className="text-xs text-text-muted border border-dark-border rounded px-1.5 py-0.5">只读</span>}
        </div>
        <div className="flex items-center gap-3 mb-4">
          <span className={`w-3 h-3 rounded-full ${card.checking ? 'bg-gray-500' : card.running ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-text-primary text-sm">
            {card.checking ? '检查中...' : card.running ? '运行中' : '已停止'}
          </span>
        </div>

        <div className="text-xs text-text-muted space-y-1 mb-5">
          <div>SSE 端点：<code className="text-yellow-400">{endpoint}</code></div>
          {!readonly && (
            <div className="flex items-center gap-2">
              <span>可用工具：</span>
              <span className="text-accent-green font-semibold">{card.tools.length}</span>
              <Button type="link" size="small" onClick={() => { setSelectedTool(null); setToolsModal({ title, tools: card.tools }); }}>
                查看工具
              </Button>
            </div>
          )}
          {readonly && (
            <div className="text-yellow-400/80">业务系统集成边缘：启停请在 Docker 中手动操作（docker start/stop optonto-business-mcp）</div>
          )}
        </div>

        <div className="flex gap-2">
          <Button onClick={() => openConfig(key)}>查看配置</Button>
          {!readonly && key !== 'business' && (
            <Button
              loading={card.toggling}
              danger={card.running}
              style={card.running ? { color: '#fff', background: '#ef4444', borderColor: '#ef4444' } : undefined}
              onClick={() => handleToggle(key, key === 'ontology' ? 'ontology' : 'data-engine', title)}
            >
              {card.running ? '停止' : '启动'}
            </Button>
          )}
          <Button onClick={() => refresh()}>刷新</Button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">MCP 服务</h3>
          <p className="text-text-muted text-xs mt-0.5">管理 Model Context Protocol 服务，供 AI 客户端连接使用。</p>
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        {renderCard('ontology', '本体MCP', `http://${host}:8002/mcp`, false)}
        {renderCard('dataEngine', '数据引擎MCP', `http://${host}:8005/mcp`, false)}
        {renderCard('business', '业务系统MCP', 'Docker 内部网络（不对外发布端口）', true)}
      </div>

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
      <Modal title={configModal?.title || 'MCP 服务配置'} open={!!configModal} onCancel={() => setConfigModal(null)} footer={null} width={600}>
        {configModal?.note && <p className="text-text-muted text-xs mb-3">{configModal.note}</p>}
        <div className="relative">
          <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono text-yellow-400 whitespace-pre-wrap overflow-x-auto">{configModal?.json}</pre>
          <Button size="small" className="absolute top-2 right-2" onClick={() => { navigator.clipboard.writeText(configModal?.json || ''); message.success('已复制到剪贴板'); }}>复制</Button>
        </div>
      </Modal>
    </div>
  );
}