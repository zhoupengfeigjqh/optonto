'use client';

import { useEffect, useState } from 'react';
import {
  Button, Input, message, Space, Spin, Switch,
  Table, Tag, Modal,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ApiOutlined,
  CheckOutlined, CloseOutlined, EditOutlined,
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
  const [editingKey, setEditingKey] = useState<string>('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  // 工具弹窗
  const [modalServer, setModalServer] = useState<MCPServerConfig | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalTools, setModalTools] = useState<MCPToolInfo[]>([]);
  const [mcpSelectedTool, setMcpSelectedTool] = useState<string | null>(null);
  const [selectedToolNames, setSelectedToolNames] = useState<Set<string>>(new Set());

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

  // 直接保存到后端
  const persistConfig = async (newConfig: MCPConfig) => {
    if (!scenarioName || !ontologyName) return;
    try {
      await saveMCPConfig(scenarioName, ontologyName, newConfig);
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    }
  };

  const handleAdd = () => {
    setEditData({ name: '', url: '', enabled: true });
    setEditingKey('__new__');
  };

  const handleEdit = (server: MCPServerConfig) => {
    setEditData({ name: server.name, url: server.url, enabled: server.enabled, allowed_tools: server.allowed_tools });
    setEditingKey(server.name);
  };

  const handleCancel = () => {
    setEditingKey('');
    setEditData({});
  };

  const handleSaveRow = async () => {
    if (!editData.name?.trim()) { message.warning('请输入服务名称'); return; }
    if (!editData.url?.trim()) { message.warning('请输入 MCP URL'); return; }
    const isNew = editingKey === '__new__';
    let newConfig: MCPConfig;
    if (isNew) {
      if (config.servers.some(s => s.name === editData.name.trim())) {
        message.warning('服务名称已存在'); return;
      }
      newConfig = {
        servers: [
          ...config.servers,
          {
            name: editData.name.trim(),
            url: editData.url.trim(),
            enabled: editData.enabled !== false,
            allowed_tools: editData.allowed_tools,
          },
        ],
      };
    } else {
      newConfig = {
        servers: config.servers.map(s =>
          s.name === editingKey
            ? { ...s, name: editData.name.trim(), url: editData.url.trim(), enabled: editData.enabled !== false, allowed_tools: editData.allowed_tools }
            : s
        ),
      };
    }
    setConfig(newConfig);
    setEditingKey('');
    setEditData({});
    await persistConfig(newConfig);
  };

  const handleDelete = (server: MCPServerConfig) => {
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认删除</span>,
      content: <span style={{ color: '#ef4444' }}>删除 MCP 服务「<strong>{server.name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        const newConfig = { servers: config.servers.filter(s => s.name !== server.name) };
        setConfig(newConfig);
        await persistConfig(newConfig);
      },
    });
  };

  const handleViewTools = async (server: MCPServerConfig) => {
    if (!scenarioName || !ontologyName || !server.url) return;
    setModalServer(server);
    setSelectedToolNames(new Set(server.allowed_tools || []));
    setModalLoading(true);
    setModalError(null);
    setModalTools([]);

    try {
      const result = await testMCPConnection(scenarioName, ontologyName, server.url);
      if (result.success) {
        const tools = result.tools || [];
        setModalTools(tools);
        // 没有设置 allowed_tools 时默认全选
        if (!server.allowed_tools || server.allowed_tools.length === 0) {
          setSelectedToolNames(new Set(tools.map(t => t.name)));
        }
      } else {
        setModalError(result.error || '连接失败');
      }
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setModalLoading(false);
    }
  };

  const toggleTool = (name: string) => {
    setSelectedToolNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleConfirmTools = async () => {
    if (!modalServer) return;
    const allowed = Array.from(selectedToolNames);
    const newConfig = {
      servers: config.servers.map(s =>
        s.url === modalServer.url
          ? { ...s, allowed_tools: allowed.length > 0 ? allowed : undefined }
          : s
      ),
    };
    setConfig(newConfig);
    setModalServer(null);
    setModalError(null);
    setModalTools([]);
    setMcpSelectedTool(null);
    await persistConfig(newConfig);
    message.success(allowed.length > 0 ? `已选择 ${allowed.length} 个工具` : '将注册全部工具');
  };

  const renderCell = (val: any, server: MCPServerConfig, field: string) => {
    const editing = editingKey === server.name || (editingKey === '__new__' && server.name === '__new__');
    if (!editing) return null;

    if (field === 'name') {
      return (
        <Input
          size="small"
          value={editData.name || ''}
          onChange={e => setEditData(p => ({...p, name: e.target.value}))}
          className="bg-dark-bg border-dark-border text-text-primary"
          placeholder="服务名称"
        />
      );
    }
    if (field === 'url') {
      return (
        <Input
          size="small"
          value={editData.url || ''}
          onChange={e => setEditData(p => ({...p, url: e.target.value}))}
          className="bg-dark-bg border-dark-border text-text-primary font-mono"
          placeholder="http://example.com/sse"
        />
      );
    }
    return null;
  };

  // 数据源：加上新增空行
  const dataSource = config.servers.map(s => ({ ...s, _key: s.name }));
  if (editingKey === '__new__') {
    dataSource.push({ name: '__new__', url: '', enabled: true } as any);
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      render: (v: string, r: MCPServerConfig) => {
        const cell = renderCell(v, r, 'name');
        if (cell) return cell;
        return <span className="text-text-primary">{v}</span>;
      },
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      width: 320,
      render: (v: string, r: MCPServerConfig) => {
        const cell = renderCell(v, r, 'url');
        if (cell) return cell;
        return <span className="text-text-secondary font-mono text-sm">{v}</span>;
      },
    },
    {
      title: '工具',
      key: 'tools',
      width: 80,
      render: (_: any, r: MCPServerConfig) => (
        <Button type="link" size="small" icon={<ToolOutlined />} onClick={() => handleViewTools(r)}>选择</Button>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_: any, r: MCPServerConfig) => {
        const editing = editingKey === r.name || (editingKey === '__new__' && r.name === '__new__');
        if (editing) {
          return (
            <Space>
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={handleSaveRow} />
              <Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} />
            </Space>
          );
        }
        if (r.name === '__new__') return null;
        return (
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
            <Switch
              checked={r.enabled}
              onChange={v => {
                const newConfig = { servers: config.servers.map(s => s.name === r.name ? { ...s, enabled: v } : s) };
                setConfig(newConfig);
                persistConfig(newConfig);
              }}
              size="small"
            />
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
          </Space>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增 MCP 服务</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">
        配置 MCP 服务，Agent 将自动发现并注册其工具。
      </p>

      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="_key"
        pagination={false}
        size="small"
        className="bg-transparent"
        locale={{ emptyText: (
          <div className="flex flex-col items-center justify-center h-24 text-text-muted">
            <ApiOutlined style={{ fontSize: 24, marginBottom: 8 }} />
            <p className="text-sm">暂无 MCP 服务配置</p>
          </div>
        )}}
      />

      {/* 选择工具弹窗 */}
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
              <Button type="primary" onClick={handleConfirmTools}>确认</Button>
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
