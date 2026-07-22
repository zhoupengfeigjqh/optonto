'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getSecurities, createSecurity, updateSecurity, deleteSecurity, getBehaviors, Security, Behavior } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

const AUDIT_OPTIONS = [
  { label: '前置', value: '前置' },
  { label: '后置', value: '后置' },
];

export default function SecurityTable({ ontologyId, activeTab }: Props) {
  const [securities, setSecurities] = useState<Security[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [secList, behList] = await Promise.all([getSecurities(ontologyId), getBehaviors(ontologyId)]);
      setSecurities(secList); setBehaviors(behList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'securities') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Security) => record.action_name === editingKey;

  const handleAdd = () => { setEditData({ action_name: undefined, audit_node: '前置', audit_content: '' }); setEditingKey('__new__'); };
  const handleEdit = (s: Security) => { setEditData({ action_name: s.action_name, audit_node: s.audit_node, audit_content: s.audit_content || '' }); setEditingKey(s.action_name); };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Security) => {
    if (!editData.action_name) { message.warning('请选择行为名称'); return; }
    try {
      const data: Security = { action_name: editData.action_name, audit_node: editData.audit_node || '前置', audit_content: editData.audit_content || '' };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (securities.some(s => s.action_name === data.action_name)) { message.warning('该动作已存在'); return; }
        await createSecurity(ontologyId, data); message.success('安全审核已添加');
      } else {
        await updateSecurity(ontologyId, record.action_name, data); message.success('安全审核已更新');
      }
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (action_name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除安全审核「<strong>{action_name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteSecurity(ontologyId, action_name); message.success('安全审核已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const behaviorOptions = behaviors.map(b => ({ label: b.display_name || b.name, value: b.name }));

  const renderCell = (val: any, record: Security, dataIndex: string) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.action_name === '__new__';
    if (!editing && !isNew) return val || '-';

    if (dataIndex === 'action_name') return <Select size="small" placeholder="选择行为" options={behaviorOptions} value={editData.action_name} onChange={v => setEditData(p => ({...p, action_name: v}))} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'audit_content') return <Input size="small" value={editData.audit_content || ''} onChange={e => setEditData(p => ({...p, audit_content: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'audit_node') return <Select size="small" value={editData.audit_node || '前置'} onChange={v => setEditData(p => ({...p, audit_node: v}))} options={AUDIT_OPTIONS} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    return val || '-';
  };

  const dataSource = securities.map(s => ({ ...s, _key: s.action_name }));
  if (editingKey === '__new__') dataSource.push({ action_name: '__new__', audit_node: '前置', audit_content: '' } as any);

  const columns = [
    { title: '行为名称', dataIndex: 'action_name', key: 'action_name', width: 200, render: (v: any, r: Security) => {
      if (isEditing(r) || (editingKey === '__new__' && r.action_name === '__new__')) return renderCell(v, r, 'action_name');
      return behaviors.find(b => b.name === v)?.display_name || v || '-';
    }},
    { title: '审核内容', dataIndex: 'audit_content', key: 'audit_content', width: 200, ellipsis: true, render: (v: any, r: Security) => renderCell(v, r, 'audit_content') },
    { title: '介入位置', dataIndex: 'audit_node', key: 'audit_node', width: 100, render: (v: any, r: Security) => renderCell(v, r, 'audit_node') },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: any, record: Security) => {
        if (editingKey === record.action_name || (editingKey === '__new__' && record.action_name === '__new__')) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return <Space><Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} /><Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.action_name)} /></Space>;
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">安全审核</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增审核</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">设置关键操作的人工审核节点与内容</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />
    </div>
  );
}
