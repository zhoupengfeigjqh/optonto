'use client';

import { useEffect, useState } from 'react';
import { Button, Table, Modal, message, Tag, Space } from 'antd';
import { EyeOutlined, DeleteOutlined, MessageOutlined } from '@ant-design/icons';
import { listRequirements, deleteRequirementFile, RequirementItem } from '@/api/client';
import RequirementViewer from './RequirementViewer';

interface Props { ontologyId: number; activeTab?: string; scenarioName?: string; ontologyName?: string; }

export default function RequirementConfirm({ ontologyId: _oid, activeTab, scenarioName, ontologyName }: Props) {
  const [items, setItems] = useState<RequirementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<{ threadId: string; filename: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listRequirements();
      setItems(list.filter(i => i.scenario_name === scenarioName && i.ontology_name === ontologyName));
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'requirement-confirm') load(); }, [activeTab, scenarioName, ontologyName]);

  const handleDelete = (threadId: string, filename: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try { await deleteRequirementFile(threadId, filename); message.success('已删除'); await load(); }
        catch (e: any) { message.error(e.message); }
      },
    });
  };

  if (viewing) {
    return <RequirementViewer threadId={viewing.threadId} filename={viewing.filename} onBack={() => { setViewing(null); load(); }} />;
  }

  const columns = [
    { title: '需求文件名', dataIndex: 'req_name', key: 'req_name', render: (v: string, r: RequirementItem) => (
      <span className="text-text-primary">{v}</span>
    )},
    { title: '会话名称', dataIndex: 'thread_title', key: 'thread_title', width: 200, render: (v: string, r: RequirementItem) => (
      <a className="text-accent-blue hover:underline cursor-pointer" onClick={() => window.location.href = `/design/${_oid}?thread=${r.thread_id}`}>
        <MessageOutlined className="mr-1" />{v || '未命名'}
      </a>
    )},
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '本体输出', dataIndex: 'has_ontology', key: 'has_ontology', width: 100,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '已输出' : '未输出'}</Tag> },
    {
      title: '操作', key: 'actions', width: 140,
      render: (_: any, r: RequirementItem) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewing({ threadId: r.thread_id, filename: r.filename })}>查看</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.thread_id, r.filename)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">需求确认</h3>
        <Button onClick={load} loading={loading} size="small">刷新</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">查看和管理所有已导出的需求文档。点击「查看」进入文档详情，可进行修改和智能生成本体。输出的本体文件，可通过点击任务栏「本体文件」进行浏览。</p>
      <Table
        dataSource={items}
        columns={columns}
        rowKey={(r) => `${r.thread_id}_${r.filename}`}
        loading={loading}
        locale={{ emptyText: '暂无导出的需求文档，请先在对话中导出文档' }}
        pagination={false}
        className="bg-transparent"
      />
    </div>
  );
}
