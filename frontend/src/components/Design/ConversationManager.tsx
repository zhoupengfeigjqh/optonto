'use client';

import { useEffect, useState } from 'react';
import { Button, Table, Modal, message, Space, Tag, Input, Spin } from 'antd';
import { PlusOutlined, DeleteOutlined, MessageOutlined, EditOutlined } from '@ant-design/icons';
import { getThreads, createThread, deleteThread, updateThread, ThreadSummary } from '@/api/client';
import ConversationChat from './ConversationChat';

interface Props { activeTab?: string; initialThreadId?: string | null; scenarioName?: string; ontologyName?: string; }

export default function ConversationManager({ activeTab, initialThreadId, scenarioName, ontologyName }: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scenarioName) params.set('scenario', scenarioName);
      if (ontologyName) params.set('ontology', ontologyName);
      const list = await getThreads(params.toString());
      setThreads(list);
    } catch (e: any) { message.error('加载对话列表失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'requirements') load(); }, [activeTab, scenarioName, ontologyName]);

  // Auto-open thread from query param
  useEffect(() => {
    if (initialThreadId) setActiveThreadId(initialThreadId);
  }, [initialThreadId]);

  const handleNew = () => {
    setNewVersion('');
    setShowVersionModal(true);
  };

  const handleConfirmNew = async () => {
    if (!newVersion.trim()) { message.warning('请输入版本号'); return; }
    setShowVersionModal(false);
    setCreating(true);
    try {
      const thread = await createThread('新对话', scenarioName || '', ontologyName || '', newVersion.trim());
      setActiveThreadId(thread.id);
    } catch (e: any) { message.error('创建失败: ' + e.message); } finally { setCreating(false); }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try { await deleteThread(id); message.success('已删除'); await load(); } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const handleRename = async (id: string) => {
    if (!editValue.trim()) { setEditingTitle(null); return; }
    try {
      await updateThread(id, { title: editValue.trim() });
      message.success('已重命名');
      setEditingTitle(null);
      await load();
    } catch (e: any) { message.error(e.message); }
  };

  if (activeThreadId) {
    return <ConversationChat threadId={activeThreadId} onBack={() => { setActiveThreadId(null); load(); }} scenarioName={scenarioName} ontologyName={ontologyName} />;
  }

  const columns = [
    {
      title: '会话标题', dataIndex: 'title', key: 'title',
      render: (v: string, r: ThreadSummary) => {
        if (editingTitle === r.id) {
          return <Input size="small" value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => handleRename(r.id)} onPressEnter={() => handleRename(r.id)}
            className="bg-dark-bg border-dark-border text-text-primary" autoFocus />;
        }
        return (
          <span className="text-text-primary cursor-pointer hover:text-accent-blue"
            onClick={() => setActiveThreadId(r.id)}>
            {v || '未命名对话'}
          </span>
        );
      },
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '最后更新', dataIndex: 'updated_at', key: 'updated_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 180,
      render: (v: string) => <Tag color={v === 'documented' ? 'green' : 'blue'}>{v === 'documented' ? '已生成文档' : '探索中'}</Tag> },
    {
      title: '操作', key: 'actions', width: 180,
      render: (_: any, r: ThreadSummary) => (
        <Space>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => setActiveThreadId(r.id)}>对话</Button>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditingTitle(r.id); setEditValue(r.title); }} />
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">对话管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>新建对话</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">管理和查看所有需求探索对话。点击「对话」或「会话标题」进入聊天，点击「新建对话」开始新的探索。通过对话探索，你可以对需求进行智能评估验证，并生成需求文档</p>
      <Table
        dataSource={threads}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        className="bg-transparent"
      />

      {/* Version input modal for new conversation */}
      <Modal
        title="新建对话"
        open={showVersionModal}
        onOk={handleConfirmNew}
        onCancel={() => setShowVersionModal(false)}
        okText="确认创建"
        cancelText="取消"
      >
        <div className="py-3">
          <label className="text-text-secondary text-sm block mb-2">版本号</label>
          <Input
            placeholder="例如：v1.0"
            value={newVersion}
            onChange={e => setNewVersion(e.target.value)}
            onPressEnter={handleConfirmNew}
            className="bg-dark-bg border-dark-border text-text-primary"
            autoFocus
          />
          <p className="text-text-muted text-xs mt-2">请输入本对话的版本号，该版本号将在导出需求时自动填入且不可修改</p>
        </div>
      </Modal>

      {/* Creating modal */}
      <Modal
        title="创建对话"
        open={creating}
        footer={null}
        closable={false}
        centered
        width={300}
      >
        <div className="flex flex-col items-center py-6 gap-3">
          <Spin size="large" />
          <p className="text-text-secondary text-sm">正在创建对话...</p>
        </div>
      </Modal>
    </div>
  );
}