'use client';

import { useEffect, useState } from 'react';
import { Button, Table, Modal, message, Tag, Space, Tooltip } from 'antd';
import { EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { listRequirements, deleteRequirementFile, RequirementItem } from '@/api/client';
import RequirementViewer from './RequirementViewer';

interface Props { ontologyId: number; activeTab?: string; scenarioName?: string; ontologyName?: string; }

export default function RequirementSummary({ ontologyId: _oid, activeTab, scenarioName, ontologyName }: Props) {
  const [items, setItems] = useState<RequirementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<{ threadId: string; filename: string; scenarioName?: string; ontologyName?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listRequirements(scenarioName, ontologyName);
      setItems(list);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'requirement-summary') load(); }, [activeTab, scenarioName, ontologyName]);

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
    return <RequirementViewer threadId={viewing.threadId} filename={viewing.filename} onBack={() => { setViewing(null); load(); }} scenarioName={viewing.scenarioName} ontologyName={viewing.ontologyName} />;
  }

  const columns = [
    { title: '本体名', dataIndex: 'onto_name', key: 'onto_name', render: (v: string) => (
      <span className="text-text-primary">{v}</span>
    )},
    { title: '内容', dataIndex: 'content_name', key: 'content_name', render: (v: string) => (
      <span className="text-text-primary">{v}</span>
    )},
    { title: '版本', dataIndex: 'version', key: 'version', width: 90, render: (v: string) => (
      <span className="text-text-primary">{v || '-'}</span>
    )},
    { title: '会话名称', dataIndex: 'thread_title', key: 'thread_title', width: 200, render: (v: string) => (
      <span className="text-text-primary">{v || '未命名'}</span>
    )},
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '本体生成', dataIndex: 'has_ontology', key: 'has_ontology', width: 110,
      render: (v: boolean, r: RequirementItem) => (
        <Tooltip title={v ? `关联本体文件：${r.ontology_file || '-'}` : '未找到同名本体文件，也未找到 source_file 指向本文档的本体文件'}>
          <Tag color={v ? 'green' : 'default'} style={{ cursor: 'help' }}>{v ? '已生成' : '未生成'}</Tag>
        </Tooltip>
      ) },
    {
      title: '操作', key: 'actions', width: 140,
      render: (_: any, r: RequirementItem) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewing({ threadId: r.thread_id, filename: r.filename, scenarioName: r.scenario_name, ontologyName: r.ontology_name })}>查看</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.thread_id, r.filename)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-4">需求汇总</h3>
      <p className="text-text-muted text-xs mb-3">查看和管理所有已导出的需求文档。点击「查看」进入文档详情，可进行修改和智能生成本体。输出的本体文件，可在「本体部署」中按版本合并部署。</p>
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
