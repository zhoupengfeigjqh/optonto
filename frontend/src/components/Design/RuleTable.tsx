'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getRules, createRule, updateRule, deleteRule, getBehaviors, getFunctions, getRuleTypes, Rule, Behavior, Function } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

export default function RuleTable({ ontologyId, activeTab }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [funcs, setFuncs] = useState<Function[]>([]);
  const [ruleTypes, setRuleTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [ruleList, behList, fnList, types] = await Promise.all([getRules(ontologyId), getBehaviors(ontologyId), getFunctions(ontologyId), getRuleTypes(ontologyId)]);
      setRules(ruleList); setBehaviors(behList); setFuncs(fnList); setRuleTypes(types);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'rules') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Rule) => record.name === editingKey;
  const behaviorOptions = behaviors.map(b => ({ label: b.display_name || b.name, value: b.name }));
  const functionOptions = funcs.map(f => ({ label: f.display_name || f.name, value: f.name }));

  const handleAdd = () => { setEditData({ name: '', display_name: '', description: '', rule_type: '', position: '', related_behaviors: [], related_functions: [] }); setEditingKey('__new__'); };
  const handleEdit = (r: Rule) => { setEditData({ name: r.name, display_name: r.display_name || '', description: r.description, rule_type: r.rule_type || '', position: r.position || '', related_behaviors: r.related_behaviors || [], related_functions: r.related_functions || [] }); setEditingKey(r.name); };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Rule) => {
    if (!editData.name?.trim()) { message.warning('请输入规则名称'); return; }
    try {
      const data: any = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '', rule_type: editData.rule_type || '', position: editData.position || '', related_behaviors: editData.related_behaviors || [], related_functions: editData.related_functions || [] };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (rules.some(r => r.name === data.name)) { message.warning('规则名称已存在'); return; }
        await createRule(ontologyId, data); message.success('规则已添加');
      } else {
        await updateRule(ontologyId, record.name, data); message.success('规则已更新');
      }
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除规则「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteRule(ontologyId, name); message.success('规则已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const renderCell = (val: any, record: Rule, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');
    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'rule_type') return <Select size="small" allowClear placeholder="选择" value={editData.rule_type || undefined} onChange={v => setEditData(p => ({...p, rule_type: v || ''}))} options={ruleTypes.map(t => ({ label: t, value: t }))} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'position') return <Select size="small" allowClear placeholder="选择" value={editData.position || undefined} onChange={v => setEditData(p => ({...p, position: v || ''}))} options={[{label:'前置',value:'前置'},{label:'后置',value:'后置'}]} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'related_behaviors') return <Select size="small" mode="multiple" placeholder="选择" value={editData.related_behaviors || []} onChange={v => setEditData(p => ({...p, related_behaviors: v}))} options={behaviorOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'related_functions') return <Select size="small" mode="multiple" placeholder="选择" value={editData.related_functions || []} onChange={v => setEditData(p => ({...p, related_functions: v}))} options={functionOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    return render ? render(val) : (val || '-');
  };

  const dataSource = rules.map(r => ({ ...r, _key: r.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', description: '', rule_type: '', position: '', related_behaviors: [], related_functions: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '规则类型', dataIndex: 'rule_type', key: 'rule_type', width: 85, render: (v: any, r: Rule) => renderCell(v, r, 'rule_type', (v2: string) => v2 || '-') },
    { title: '介入位置', dataIndex: 'position', key: 'position', width: 85, render: (v: any, r: Rule) => renderCell(v, r, 'position', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'description') },
    { title: '关联行为', dataIndex: 'related_behaviors', key: 'related_behaviors', width: 160, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_behaviors', (list: string[]) => list?.map(name => behaviors.find(b => b.name === name)?.display_name || name).join(', ') || '-') },
    { title: '关联函数', dataIndex: 'related_functions', key: 'related_functions', width: 160, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_functions', (list: string[]) => list?.map(name => funcs.find(f => f.name === name)?.display_name || name).join(', ') || '-') },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: Rule) => {
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
        <h3 className="text-base font-semibold text-text-primary">规则管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增规则</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">配置行为执行前后的管控规则</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />
    </div>
  );
}
