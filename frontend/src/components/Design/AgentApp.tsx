'use client';

/**
 * 智能体应用入口：会话列表 + 新建对话 + 进入会话。
 *
 * 会话界面见 `agent/AgentConversation.tsx`；本文件只负责线程的增删查与本体范围选择，
 * 保持「列表页」与「会话页」互不牵连（章程 I：单文件 ≤500 行、职责单一）。
 */
import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Space, Select, Table } from 'antd';
import { PlusOutlined, DeleteOutlined, MessageOutlined } from '@ant-design/icons';
import {
  listAgentThreads, createAgentThread, deleteAgentThread,
  AgentThreadSummary, OntologyScopeSelection,
} from '@/api/agent-client';
import { listAllOntologies, OntologyScopeOption } from '@/api/client';
import AgentConversation from './agent/AgentConversation';

export default function AgentApp({
  scenarioName,
  ontologyName,
}: {
  scenarioName?: string;
  ontologyName?: string;
}) {
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [ontologies, setOntologies] = useState<OntologyScopeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedScope, setSelectedScope] = useState<OntologyScopeSelection[]>([]);

  // 加载线程列表和全量本体列表（本体范围选择器数据源）
  const load = async () => {
    if (!scenarioName || !ontologyName) return;
    setLoading(true);
    try {
      const [threadList, ontologyList] = await Promise.all([
        listAgentThreads(scenarioName, ontologyName),
        listAllOntologies(),
      ]);
      setThreads(threadList);
      setOntologies(ontologyList);
    } catch (e: any) {
      message.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scenarioName, ontologyName]);

  // 新建线程（本体范围默认勾选当前本体，用户可加选/清空；清空 = 通用问答模式）
  const handleNew = async () => {
    if (!scenarioName || !ontologyName) return;
    try {
      const thread = await createAgentThread(
        scenarioName,
        ontologyName,
        newTitle || '新对话',
        selectedScope
      );
      setShowNewDialog(false);
      setNewTitle('');
      setSelectedScope([]);
      setActiveThreadId(thread.id);
    } catch (e: any) {
      message.error('创建失败: ' + e.message);
    }
  };

  // 删除线程
  const handleDelete = (id: string) => {
    if (!scenarioName || !ontologyName) return;
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认删除</span>,
      content: <span style={{ color: '#ef4444' }}>删除后不可恢复，确定要删除吗？</span>,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAgentThread(scenarioName, ontologyName, id);
          message.success('已删除');
          await load();
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  // 进入对话后显示聊天界面
  if (activeThreadId) {
    return (
      <AgentConversation
        threadId={activeThreadId}
        scenarioName={scenarioName || ''}
        ontologyName={ontologyName || ''}
        onBack={() => { setActiveThreadId(null); load(); }}
      />
    );
  }

  const columns = [
    {
      title: '会话标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: AgentThreadSummary) => (
        <span
          className="text-text-primary cursor-pointer hover:text-accent-blue"
          onClick={() => setActiveThreadId(r.id)}
        >
          {v || '未命名对话'}
        </span>
      ),
    },
    {
      title: '消息数',
      dataIndex: 'message_count',
      key: 'message_count',
      width: 100,
      render: (v: number) => <span className="text-text-secondary text-sm">{v}</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 200,
      render: (v: string) => (
        <span className="text-text-secondary text-sm">
          {v ? new Date(v).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, r: AgentThreadSummary) => (
        <Space>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => setActiveThreadId(r.id)}>
            对话
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">智能体应用</h3>
        <div className="flex items-center gap-2">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            // 打开时默认勾选当前页所在本体，用户可加选/清空
            if (scenarioName && ontologyName) {
              setSelectedScope([{ scenario: scenarioName, ontology: ontologyName }]);
            }
            setShowNewDialog(true);
          }}>
            新建对话
          </Button>
        </div>
      </div>
      <p className="text-text-muted text-xs mb-3">
        与 AI Agent 进行对话，查询与执行将限定在对话所选的本体范围内。
      </p>

      <Table
        dataSource={threads}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        className="bg-transparent"
      />

      {/* 新建对话弹窗 */}
      <Modal
        title="新建智能体对话"
        open={showNewDialog}
        onOk={handleNew}
        onCancel={() => {
          setShowNewDialog(false);
          setNewTitle('');
          setSelectedScope([]);
        }}
        okText="创建"
        cancelText="取消"
      >
        <div className="py-3 space-y-4">
          <div>
            <label className="text-text-secondary text-sm block mb-1">对话标题</label>
            <Input
              placeholder="输入对话标题（可选）"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体范围</label>
            <Select
              mode="multiple"
              placeholder="选择本次对话限定的本体（不选 = 通用问答模式）"
              value={selectedScope.map(s => `${s.scenario}/${s.ontology}`)}
              onChange={(keys: string[]) => {
                const sel: OntologyScopeSelection[] = keys.map(k => {
                  const idx = k.indexOf('/');
                  return { scenario: k.slice(0, idx), ontology: k.slice(idx + 1) };
                });
                setSelectedScope(sel);
              }}
              options={ontologies.map(o => ({
                label: `${o.scenario_name} / ${o.ontology_name}`,
                value: `${o.scenario_name}/${o.ontology_name}`,
              }))}
              className="w-full"
              style={{ background: '#1a1a2e' }}
              popupClassName="bg-dark-card"
            />
            <p className="text-text-muted text-xs mt-1">
              本次对话的查询与执行将限定在所选本体内（可跨本体多选）；不选则为通用问答模式，不使用任何业务工具
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
