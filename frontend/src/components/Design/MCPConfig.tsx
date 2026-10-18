'use client';

import { useEffect, useState } from 'react';
import {
  Button, Input, message, Space, Spin, Switch,
  Table, Tag, Modal,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ApiOutlined,
  CheckOutlined, CloseOutlined, EditOutlined,
  ImportOutlined, ToolOutlined,
} from '@ant-design/icons';
import {
  getMCPConfig, saveMCPConfig, testMCPConnection,
  MCPConfig, MCPServerConfig, MCPToolInfo,
} from '@/api/agent-client';
import { PasteConfigModal } from './mcp-config/PasteConfigModal';
import { ToolsPickerModal } from './mcp-config/ToolsPickerModal';
import {
  formatHeaders, headerSummary, hasTokenHeader, importServerSnippet, isLoopbackUrl, parseHeaders,
} from './mcp-config/server-config';

export default function MCPConfigPanel() {
  const [config, setConfig] = useState<MCPConfig>({ servers: [] });
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string>('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  // 粘贴导入（自建发布的「查看配置」片段，含 X-MCP-Token）
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  // 工具弹窗
  const [modalServer, setModalServer] = useState<MCPServerConfig | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalTools, setModalTools] = useState<MCPToolInfo[]>([]);
  const [selectedToolNames, setSelectedToolNames] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      // MCP 配置全局唯一
      const cfg = await getMCPConfig();
      setConfig(cfg);
    } catch (e: any) {
      message.error('加载 MCP 配置失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 直接保存到后端（全局配置）
  const persistConfig = async (newConfig: MCPConfig) => {
    try {
      await saveMCPConfig(newConfig);
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    }
  };

  const handleAdd = () => {
    setEditData({ name: '', url: '', enabled: true, headersText: '', business_data: false });
    setEditingKey('__new__');
  };

  const handleEdit = (server: MCPServerConfig) => {
    setEditData({
      name: server.name, url: server.url, enabled: server.enabled,
      allowed_tools: server.allowed_tools,
      headersText: formatHeaders(server.headers),
      business_data: server.business_data === true,
    });
    setEditingKey(server.name);
  };

  const handleCancel = () => {
    setEditingKey('');
    setEditData({});
  };

  const handleSaveRow = async () => {
    if (!editData.name?.trim()) { message.warning('请输入服务名称'); return; }
    if (!editData.url?.trim()) { message.warning('请输入 MCP URL'); return; }
    // 请求头是令牌的唯一载体：解析失败必须拦住保存（否则「填了令牌却没生效」最难排查）
    const parsed = parseHeaders(editData.headersText || '');
    if (parsed.error) { message.error(parsed.error); return; }
    const headers = parsed.headers;
    // 显式落盘 true/false（缺省视为否）：只有「是」的服务才进「接口映射」的目标服务下拉
    const businessData = editData.business_data === true;
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
            headers,
            business_data: businessData,
          } as MCPServerConfig,
        ],
      };
    } else {
      newConfig = {
        servers: config.servers.map(s =>
          s.name === editingKey
            // headers 显式赋值：清空编辑框即删掉旧令牌（undefined 在序列化时被丢弃），不会留着旧凭据
            ? {
              ...s, name: editData.name.trim(), url: editData.url.trim(),
              enabled: editData.enabled !== false, allowed_tools: editData.allowed_tools,
              headers, business_data: businessData,
            }
            : s
        ),
      };
    }
    setConfig(newConfig);
    setEditingKey('');
    setEditData({});
    await persistConfig(newConfig);
  };

  /**
   * 导入自建发布「查看配置」片段（解析唯一实现在 server-config.importServerSnippet）。
   * 已存在的同名服务**不覆盖**——那会静默改掉用户已配好的工具范围，改为提示去该行「编辑」。
   */
  const handleImportSnippet = async (text: string) => {
    const { server, error } = importServerSnippet(text);
    if (error || !server) { setPasteError(error || '导入失败'); return; }
    if (config.servers.some(s => s.name === server.name)) {
      setPasteError(`服务「${server.name}」已存在——导入不覆盖已有条目，请直接点该行「编辑」补请求头`);
      return;
    }
    const newConfig: MCPConfig = {
      servers: [...config.servers, { ...server, enabled: true } as MCPServerConfig],
    };
    setConfig(newConfig);
    setPasteOpen(false);
    setPasteError(null);
    await persistConfig(newConfig);
    message.success(`已导入 MCP 服务「${server.name}」${hasTokenHeader(server.headers) ? '（含令牌请求头）' : ''}`);
    // 平台 Agent 在容器内，localhost 指向它自己——外部客户端的地址对 Agent 无效，必须提示
    if (isLoopbackUrl(server.url)) {
      message.warning('该地址是 localhost：外部 AI 客户端可用；本平台 Agent 在容器内连不到自己，请改用「查看配置」里的容器内地址');
    }
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
    if (!server.url) return;
    setModalServer(server);
    setSelectedToolNames(new Set(server.allowed_tools || []));
    setModalLoading(true);
    setModalError(null);
    setModalTools([]);

    try {
      // 必须带 headers：自建发布强制 X-MCP-Token，不带令牌的探针必然 401
      const result = await testMCPConnection(server.url, server.headers);
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

  const handleConfirmTools = async () => {
    if (!modalServer) return;
    const allowed = Array.from(selectedToolNames);
    const newConfig = {
      // 按 name 定位（与编辑/删除/启停同口径）：按 url 匹配会在「同 URL 多条目」时一起改掉
      servers: config.servers.map(s =>
        s.name === modalServer.name
          ? { ...s, allowed_tools: allowed.length > 0 ? allowed : undefined }
          : s
      ),
    };
    setConfig(newConfig);
    setModalServer(null);
    setModalError(null);
    setModalTools([]);
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
          placeholder="http://example.com/mcp"
        />
      );
    }
    if (field === 'headers') {
      return (
        <Input
          size="small"
          value={editData.headersText || ''}
          onChange={e => setEditData(p => ({...p, headersText: e.target.value}))}
          className="bg-dark-bg border-dark-border text-text-primary font-mono"
          placeholder='{"X-MCP-Token":"自建发布令牌"}'
        />
      );
    }
    if (field === 'business_data') {
      return (
        <Switch
          size="small"
          checked={editData.business_data === true}
          checkedChildren="是"
          unCheckedChildren="否"
          onChange={v => setEditData(p => ({...p, business_data: v}))}
        />
      );
    }
    return null;
  };

  // 数据源：加上新增空行
  const dataSource = config.servers.map(s => ({ ...s, _key: s.name }));
  if (editingKey === '__new__') {
    dataSource.push({ name: '__new__', url: '', enabled: true, headersText: '', business_data: false } as any);
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
      width: 300,
      render: (v: string, r: MCPServerConfig) => {
        const cell = renderCell(v, r, 'url');
        if (cell) return cell;
        return <span className="text-text-secondary font-mono text-sm">{v}</span>;
      },
    },
    {
      // 请求头是自建发布令牌的唯一载体：非内置行可编辑；值一律掩码，明文令牌不进列表
      title: '请求头',
      key: 'headers',
      width: 220,
      render: (_: any, r: MCPServerConfig) => {
        const cell = renderCell(null, r, 'headers');
        if (cell) return cell;
        if (!r.headers || Object.keys(r.headers).length === 0) {
          return <span className="text-text-muted text-xs">—</span>;
        }
        return (
          <span className="font-mono text-xs">
            {hasTokenHeader(r.headers) && <Tag color="gold" className="m-0 mr-1">已带令牌</Tag>}
            <span className="text-text-secondary">{headerSummary(r.headers)}</span>
          </span>
        );
      },
    },
    {
      // 是否业务数据：只有「是」的服务才进「接口映射 → 目标接口设置」的目标服务下拉
      title: '业务数据',
      key: 'business_data',
      width: 100,
      render: (_: any, r: MCPServerConfig) => {
        const cell = renderCell(null, r, 'business_data');
        if (cell) return cell;
        if (r.builtin) return <span className="text-text-muted text-xs">—</span>;
        return r.business_data === true
          ? <Tag color="green" className="m-0">是</Tag>
          : <Tag className="m-0">否</Tag>;
      },
    },
    {
      title: '工具',
      key: 'tools',
      width: 80,
      render: (_: any, r: MCPServerConfig) => r.builtin
        ? <Tag color="green">全部工具</Tag>
        : <Button type="link" size="small" icon={<ToolOutlined />} disabled={!r.enabled} onClick={() => handleViewTools(r)}>选择</Button>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_: any, r: MCPServerConfig) => {
        // 内置固定项（本体查询 MCP / 公共函数 MCP）：默认配置，不可编辑/停用/删除，始终启用并注册全部工具
        if (r.builtin) {
          return <Tag>默认配置</Tag>;
        }
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
        <Space>
          <Button
            icon={<ImportOutlined />}
            onClick={() => { setPasteError(null); setPasteOpen(true); }}
          >
            粘贴配置
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增 MCP 服务</Button>
        </Space>
      </div>
      <p className="text-text-muted text-xs mb-3">
        配置 MCP 服务，Agent 将自动发现并注册其工具。
        <span className="text-accent-blue">本体查询 MCP</span> 与 <span className="text-accent-blue">公共函数 MCP</span>
        是内置固定项（默认配置：恒启用、注册全部工具，不可编辑 / 停用 / 删除）。
        自建发布（动态容器）对外强制令牌：点「粘贴配置」导入「查看配置」片段，或在新增/编辑时于
        <span className="text-accent-blue">请求头</span>填
        <code className="text-yellow-400"> {'{"X-MCP-Token":"…"}'}</code>（令牌见 MCP发布 的「查看配置」）。
        <span className="text-accent-blue">业务数据</span>列标记该服务是否提供业务数据，有两处影响：
        <br />① 只有「是」的服务才会出现在「接口映射 → 目标接口设置」的目标服务下拉里
        （本体查询 / 公共函数等非业务数据服务留「否」）；
        <br />② 标「是」的服务，其<span className="text-accent-blue">原始业务接口不会直接给智能体调用</span>——
        必须先在「接口映射」里把它映射成行为并发布，智能体才会执行。
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

      {/* 粘贴配置弹窗（自建发布令牌的快捷导入入口） */}
      <PasteConfigModal
        open={pasteOpen}
        error={pasteError}
        onCancel={() => { setPasteOpen(false); setPasteError(null); }}
        onImport={handleImportSnippet}
      />

      {/* 选择工具弹窗（选择状态在容器，展开态在组件内） */}
      <ToolsPickerModal
        server={modalServer}
        loading={modalLoading}
        error={modalError}
        tools={modalTools}
        selected={selectedToolNames}
        onSelectionChange={setSelectedToolNames}
        onConfirm={handleConfirmTools}
        onClose={() => { setModalServer(null); setModalError(null); setModalTools([]); }}
      />
    </div>
  );
}