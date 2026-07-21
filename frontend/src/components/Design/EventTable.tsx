'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getEvents, createEvent, updateEvent, deleteEvent, getBehaviors, getConcepts, Event, Behavior, Concept } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

const EVENT_TYPE_OPTIONS = [
  { label: '动作执行', value: '动作执行' },
  { label: '状态变化', value: '状态变化' },
];

export default function EventTable({ ontologyId, activeTab }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [evtList, behList, conList] = await Promise.all([getEvents(ontologyId), getBehaviors(ontologyId), getConcepts(ontologyId)]);
      setEvents(evtList); setBehaviors(behList); setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'events') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Event) => record.name === editingKey;
  const behaviorOptions = behaviors.map(b => ({ label: b.display_name || b.name, value: b.name }));
  const conceptOptions = concepts.map(c => ({ label: c.display_name || c.name, value: c.name }));

  const handleAdd = () => { setEditData({ name: '', display_name: '', event_type: undefined, trigger_condition: '', related_concepts: [], related_behavior: undefined, trigger_behaviors: [] }); setEditingKey('__new__'); };
  const handleEdit = (e: Event) => { setEditData({ name: e.name, display_name: e.display_name || '', event_type: e.event_type || undefined, trigger_condition: e.trigger_condition || '', related_concepts: e.related_concepts || [], related_behavior: e.related_behavior || undefined, trigger_behaviors: e.trigger_behaviors || [] }); setEditingKey(e.name); };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Event) => {
    if (!editData.name?.trim()) { message.warning('请输入事件名称'); return; }
    try {
      const data = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', event_type: editData.event_type || '', trigger_condition: editData.trigger_condition?.trim() || '', related_concepts: editData.related_concepts || [], related_behavior: editData.related_behavior || null, trigger_behaviors: editData.trigger_behaviors || [] };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (events.some(e => e.name === data.name)) { message.warning('事件名称已存在'); return; }
        await createEvent(ontologyId, data); message.success('事件已添加');
      } else {
        await updateEvent(ontologyId, record.name, data); message.success('事件已更新');
      }
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除事件「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteEvent(ontologyId, name); message.success('事件已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const renderCell = (val: any, record: Event, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');
    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'related_behavior') return <Select size="small" allowClear placeholder="选择" value={editData.related_behavior} onChange={v => setEditData(p => ({...p, related_behavior: v}))} options={behaviorOptions} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'trigger_behaviors') return <Select size="small" mode="multiple" placeholder="多选" value={editData.trigger_behaviors || []} onChange={v => setEditData(p => ({...p, trigger_behaviors: v}))} options={behaviorOptions} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'event_type') return <Select size="small" placeholder="选择" value={editData.event_type} onChange={v => setEditData(p => ({...p, event_type: v}))} options={EVENT_TYPE_OPTIONS} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'trigger_condition') return <Input size="small" value={editData.trigger_condition || ''} onChange={e => setEditData(p => ({...p, trigger_condition: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="触发条件" />;
    if (dataIndex === 'related_concepts') return <Select size="small" mode="multiple" placeholder="多选" value={editData.related_concepts || []} onChange={v => setEditData(p => ({...p, related_concepts: v}))} options={conceptOptions} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    return render ? render(val) : (val || '-');
  };

  const dataSource = events.map(e => ({ ...e, _key: e.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', event_type: '', trigger_condition: '', related_concepts: [], related_behavior: null, trigger_behaviors: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 80, render: (v: any, r: Event) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 80, render: (v: any, r: Event) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '事件类型', dataIndex: 'event_type', key: 'event_type', width: 90, render: (v: any, r: Event) => renderCell(v, r, 'event_type', (v2: string) => v2 ? <Tag color="purple">{v2}</Tag> : '-') },
    { title: '触发条件', dataIndex: 'trigger_condition', key: 'trigger_condition', width: 150, ellipsis: true, render: (v: any, r: Event) => renderCell(v, r, 'trigger_condition') },
    { title: '关联概念', dataIndex: 'related_concepts', key: 'related_concepts', width: 150, ellipsis: true, render: (v: any, r: Event) => renderCell(v, r, 'related_concepts', (list: string[]) => list?.map(name => concepts.find(c => c.name === name)?.display_name || name).join(', ') || '-') },
    { title: '关联行为', dataIndex: 'related_behavior', key: 'related_behavior', width: 120, render: (v: any, r: Event) => renderCell(v, r, 'related_behavior', (v2: string|null) => v2 ? behaviors.find(b => b.name === v2)?.display_name || v2 : '-') },
    { title: '后续触发', dataIndex: 'trigger_behaviors', key: 'trigger_behaviors', width: 120, render: (v: any, r: Event) => renderCell(v, r, 'trigger_behaviors', (list: string[]) => list?.map(name => behaviors.find(b => b.name === name)?.display_name || name).join(', ') || '-') },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: Event) => {
        if (editingKey === record.name || (editingKey === '__new__' && record.name === '__new__')) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return <Space><Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} /><Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} /></Space>;
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">事件管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增事件</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">定义行为或状态变化导致的触发事件</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />
    </div>
  );
}
