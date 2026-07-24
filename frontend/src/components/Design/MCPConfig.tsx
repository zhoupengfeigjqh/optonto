'use client';

import { useEffect, useState } from 'react';
import {
  Button, Card, Input, message, Space, Spin, Switch,
  Table, Tag, Modal, Collapse,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ApiOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  getMCPConfig, saveMCPConfig, testMCPConnection,
  MCPConfig, MCPServerConfig, MCPToolInfo,
} from '@/api/agent-client';

export default function MCPConfigPanel({
  scenarioName,
  ontologyName,
}: {
  scenarioName?: string;
  ontologyName?: string;
}) {
  const [config, setConfig] = useState<MCPConfig>({ servers: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 测试状态
  const [testingUrl, setTestingUrl] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, {
    loading: boolean;
    tools?: MCPToolInfo[];
    error?: string;
  }>>({});

  // 工具弹窗
  const [modalServer, setModalServer] = useState<MCPServerConfig | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalTools, setModalTools] = useState<MCPToolInfo[]>([]);
  const [mcpSelectedTool, setMcpSelectedTool] = useState<string | null>(null);
  const [selectedToolNames, setSelectedToolNames] = useState<Set<string>>(new Set());

  // 加载配置
  const load = async () => {
    if (!scenarioName || !ontologyName) return;
    setLoading(true);
    try {
      const cfg = await getMCPConfig(scenarioName, ontologyName);
      setConfig(cfg);
    } catch (e: any) {
      message.error('加载 MCP 配置失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scenarioName, ontologyName]);

  // 保存配置
  const handleSave = async () => {
    if (!scenarioName || !ontologyName) return;
    setSaving(true);
    try {
      await saveMCPConfig(scenarioName, ontologyName, config);
      message.success('配置已保存');
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // 添加服务器
  const handleAdd = () => {
    setConfig(prev => ({
      servers: [
        ...prev.servers,
        { name: '', url: 'http://optonto-mcp:8002/sse', enabled: true },
      ],
    }));
  };

  // 删除服务器（弹出确认）
  const handleRemove = (idx: number, server: MCPServerConfig) => {
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认删除</span>,
      content: <span style={{ color: '#ef4444' }}>删除 MCP 服务「<strong>{server.name || '未命名'}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        setConfig(prev => ({
          servers: prev.servers.filter((_, i) => i !== idx),
        }));
        message.success('已删除');
      },
    });
  };

  // 更新服务器字段
  const updateServer = (idx: number, field: keyof MCPServerConfig, value: any) => {
    setConfig(prev => ({
      servers: prev.servers.map((s, i) =>
        i === idx ? { ...s, [field]: value } : s
      ),
    }));
  };

  // 查看工具（弹窗）
  const handleViewTools = async (server: MCPServerConfig) => {
    if (!scenarioName || !ontologyName || !server.url) return;

    setModalServer(server);
    // 从现有配置加载已选工具
    setSelectedToolNames(new Set(server.allowed_tools || []));
    setModalLoading(true);
    setModalError(null);
    setModalTools([]);

    try {
      const result = await testMCPConnection(scenarioName, ontologyName, server.url);
      if (result.success) {
        setModalTools(result.tools || []);
      } else {
        setModalError(result.error || '连接失败');
      }
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setModalLoading(false);
    }
  };

  // 切换选中工具
  const toggleTool = (name: string) => {
    setSelectedToolNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // 保存工具选择
  const handleConfirmTools = () => {
    if (!modalServer || !scenarioName || !ontologyName) return;
    const idx = config.servers.findIndex(s => s.url === modalServer.url);
    if (idx === -1) return;
    const allowed = Array.from(selectedToolNames);
    updateServer(idx, 'allowed_tools', allowed.length > 0 ? allowed : undefined);
    setModalServer(null);
    setModalError(null);
    setModalTools([]);
    setMcpSelectedTool(null);
    message.success(allowed.length > 0 ? `已选择 ${allowed.length} 个工具` : '将注册全部工具');
  };

  const columns = [
    {
      title: '工具名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (v: string) => (
        <span className="font-mono text-sm text-accent-blue">{v}</span>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => (
        <span className="text-text-secondary text-sm">{v || '-'}</span>
      ),
    },
    {
      title: '参数',
      key: 'params',
      width: 300,
      render: (_: any, r: MCPToolInfo) => {
        const props = r.inputSchema?.properties || {};
        const names = Object.keys(props);
        return (
          <div className="flex flex-wrap gap-1">
            {names.length === 0 ? (
              <span className="text-text-muted text-xs">无参数</span>
            ) : (
              names.map(k => (
                <Tag key={k} color="blue" className="text-xs">
                  {k}{props[k]?.type ? `: ${props[k].type}` : ''}
                </Tag>
              ))
            )}
          </div>
        );
      },
    },
  ];

  if (loading) {
    return <div className="flex items-center justify-center h-32"><Spin /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">MCP 配置</h3>
        <Space>
          <Button icon={<PlusOutlined />} onClick={handleAdd}>添加 MCP 服务</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>保存配置</Button>
        </Space>
      </div>
      <p className="text-text-muted text-xs mb-3">
        配置 MCP (Model Context Protocol) 服务，Agent 将自动发现并注册其工具。连接后可查看工具名称、参数等信息。
      </p>

      {config.servers.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-text-muted">
          <ApiOutlined style={{ fontSize: 32, marginBottom: 8 }} />
          <p className="text-sm">暂无 MCP 服务配置</p>
          <p className="text-xs mt-1">点击「添加 MCP 服务」开始配置</p>
        </div>
      )}

      <div className="space-y-3">
        {config.servers.map((server, idx) => (
          <Card
            key={idx}
            size="small"
            className="bg-dark-card border-dark-border"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-text-secondary text-xs block mb-1">名称</label>
                  <Input
                    size="small"
                    placeholder="MCP 服务名称"
                    value={server.name}
                    onChange={e => updateServer(idx, 'name', e.target.value)}
                    className="bg-dark-bg border-dark-border text-text-primary"
                  />
                </div>
                <div className="flex-[2]">
                  <label className="text-text-secondary text-xs block mb-1">URL</label>
                  <Input
                    size="small"
                    placeholder="http://optonto-mcp:8002/sse"
                    value={server.url}
                    onChange={e => updateServer(idx, 'url', e.target.value)}
                    className="bg-dark-bg border-dark-border text-text-primary font-mono"
                  />
                </div>
                <div className="pt-4" title="关闭后，对话时 Agent 不会连接此 MCP 服务">
                  <Switch
                    checked={server.enabled}
                    onChange={v => updateServer(idx, 'enabled', v)}
                    size="small"
                  />
                </div>
                <div className="pt-4">
                  <Button
                    size="small"
                    icon={<ToolOutlined />}
                    onClick={() => handleViewTools(server)}
                  >
                    选择工具
                  </Button>
                </div>
                <div className="pt-4">
                  <Button
                    type="link"
                    size="small"
                    icon={<DeleteOutlined />}
                    danger
                    onClick={() => handleRemove(idx, server)}
                  />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 查看工具弹窗 — 与数据引擎 MCP 服务风格一致 */}
      <Modal
        title={`MCP 工具列表 - ${modalServer?.name || ''}`}
        open={!!modalServer}
        onCancel={() => { setModalServer(null); setModalError(null); setModalTools([]); setMcpSelectedTool(null); }}
        footer={
          !modalLoading && !modalError && modalTools.length > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-xs">
                {selectedToolNames.size === 0
                  ? '当前未选择任何工具，将注册全部工具'
                  : `已选择 ${selectedToolNames.size}/${modalTools.length} 个工具，仅注册选中的工具`}
              </span>
              <Button type="primary" onClick={handleConfirmTools}>
                确认
              </Button>
            </div>
          ) : null
        }
        width={650}
      >
        {modalLoading ? (
          <p className="text-text-muted text-sm py-8 text-center">正在连接 MCP 服务...</p>
        ) : modalError ? (
          <p className="text-red-400 text-sm py-4">连接失败: {modalError}</p>
        ) : modalTools.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无工具信息</p>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Button size="small" onClick={() => setSelectedToolNames(new Set(modalTools.map(t => t.name)))}>全选</Button>
              <Button size="small" onClick={() => setSelectedToolNames(new Set())}>取消全选</Button>
              <span className="text-text-muted text-xs ml-2">勾选需要注册给 Agent 的工具，不勾选则注册全部</span>
            </div>
            <div className="max-h-96 overflow-y-auto -mx-6 -mb-4 px-6 pb-4">
              {modalTools.map(t => {
                const selected = mcpSelectedTool === t.name;
                const props = t.inputSchema?.properties || {};
                const required = t.inputSchema?.required || [];
                const checked = selectedToolNames.has(t.name);
                return (
                <div key={t.name}>
                  <div className="py-3 border-b border-dark-border last:border-b-0 cursor-pointer hover:bg-dark-hover -mx-6 px-6 flex items-start gap-3" onClick={() => setMcpSelectedTool(selected ? null : t.name)}>
                    <div className="pt-0.5" onClick={e => { e.stopPropagation(); toggleTool(t.name); }}>
                      <div className={`w-4 h-4 rounded border ${checked ? 'bg-accent-blue border-accent-blue' : 'bg-white border-gray-300'} flex items-center justify-center transition-colors`}>
                        {checked && <span className="text-white text-xs leading-none">✓</span>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-text-primary text-sm font-medium">{t.name}</div>
                      <div className="text-text-muted text-xs mt-0.5">{t.description}</div>
                      {Object.keys(props).length > 0 && <div className="text-accent-blue text-xs mt-1">{Object.keys(props).length} 个参数 {selected ? '▲' : '▼'}</div>}
                    </div>
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
          </div>
        )}
      </Modal>
    </div>
  );
}
