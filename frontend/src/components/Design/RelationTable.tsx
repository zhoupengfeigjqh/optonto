'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getRelations, createRelation, updateRelation, deleteRelation, getConcepts, Relation, Concept } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

const CARDINALITY_OPTIONS = [
  { label: '1:1', value: '1:1' }, { label: '1:N', value: '1:N' }, { label: 'N:1', value: 'N:1' }, { label: 'N:M', value: 'N:M' },
];

export default function RelationTable({ ontologyId, activeTab }: Props) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [relList, conList] = await Promise.all([getRelations(ontologyId), getConcepts(ontologyId)]);
      setRelations(relList); setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'relations') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Relation) => record.name === editingKey;
  const conceptOptions = concepts.map(c => ({ label: c.display_name || c.name, value: c.name }));

  // 概念的属性下拉选项（关联概念属性列用）
  const attrOptions = (conceptName?: string) =>
    (concepts.find(c => c.name === conceptName)?.attributes || [])
      .map(a => ({ label: `${a.display_name || a.name}（${a.type}）`, value: a.name }));
  // 属性类型查询（类型一致性校验用）
  const attrType = (conceptName?: string, attrName?: string) =>
    concepts.find(c => c.name === conceptName)?.attributes?.find(a => a.name === attrName)?.type;

  const handleAdd = () => { setEditData({ name: '', display_name: '', source: undefined, target: undefined, cardinality: '1:N', source_attr: undefined, target_attr: undefined, description: '' }); setEditingKey('__new__'); };
  const handleEdit = (r: Relation) => { setEditData({ name: r.name, display_name: r.display_name || '', source: r.source, target: r.target, cardinality: r.cardinality, source_attr: r.source_attr || undefined, target_attr: r.target_attr || undefined, description: r.description }); setEditingKey(r.name); };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Relation) => {
    if (!editData.name?.trim()) { message.warning('请输入关系名称'); return; }
    if (!editData.source) { message.warning('请选择源概念'); return; }
    if (!editData.target) { message.warning('请选择目标概念'); return; }
    if (!editData.source_attr) { message.warning('请选择源概念关联属性'); return; }
    if (!editData.target_attr) { message.warning('请选择目标概念关联属性'); return; }
    // 关联两端属性类型必须一致，否则报警拦截
    const sType = attrType(editData.source, editData.source_attr);
    const tType = attrType(editData.target, editData.target_attr);
    if (sType && tType && sType !== tType) {
      message.warning(`关联属性类型不一致：${editData.source}.${editData.source_attr}（${sType}）≠ ${editData.target}.${editData.target_attr}（${tType}），请重新选择`);
      return;
    }
    try {
      const data = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', source: editData.source, target: editData.target, cardinality: editData.cardinality, source_attr: editData.source_attr, target_attr: editData.target_attr, description: editData.description?.trim() || '' };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (relations.some(r => r.name === data.name)) { message.warning('关系名称已存在'); return; }
        await createRelation(ontologyId, data); message.success('关系已添加');
      } else {
        await updateRelation(ontologyId, record.name, data); message.success('关系已更新');
      }
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除关系「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteRelation(ontologyId, name); message.success('关系已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const renderCell = (val: any, record: Relation, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');

    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'source') return <Select size="small" placeholder="选择" options={conceptOptions} value={editData.source} onChange={v => setEditData(p => ({...p, source: v, source_attr: undefined}))} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'target') return <Select size="small" placeholder="选择" options={conceptOptions} value={editData.target} onChange={v => setEditData(p => ({...p, target: v, target_attr: undefined}))} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'cardinality') return <Select size="small" value={editData.cardinality} onChange={v => setEditData(p => ({...p, cardinality: v}))} options={CARDINALITY_OPTIONS} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'link_attr') {
      return (
        <Space.Compact block>
          <Select size="small" placeholder="源属性" options={attrOptions(editData.source)} value={editData.source_attr} onChange={v => setEditData(p => ({...p, source_attr: v}))} disabled={!editData.source} style={{width:"50%"}} popupClassName="!bg-dark-card" />
          <Select size="small" placeholder="目标属性" options={attrOptions(editData.target)} value={editData.target_attr} onChange={v => setEditData(p => ({...p, target_attr: v}))} disabled={!editData.target} style={{width:"50%"}} popupClassName="!bg-dark-card" />
        </Space.Compact>
      );
    }
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    return render ? render(val) : (val || '-');
  };

  const dataSource = relations.map(r => ({ ...r, _key: r.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', source: '', target: '', cardinality: '1:N', source_attr: '', target_attr: '', description: '' } as any);

  // 展示：源.源属性 = 目标.目标属性（中文展示名，yaml 仍存英文名）
  const linkAttrText = (r: Relation) => {
    if (!r.source_attr || !r.target_attr) return '-';
    const conceptName = (n: string) => concepts.find(c => c.name === n)?.display_name || n;
    const attrName = (cn: string, an: string) => {
      const a = concepts.find(c => c.name === cn)?.attributes?.find(x => x.name === an);
      return a?.display_name || an;
    };
    return `${conceptName(r.source)}.${attrName(r.source, r.source_attr)} = ${conceptName(r.target)}.${attrName(r.target, r.target_attr)}`;
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 100, render: (v: any, r: Relation) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 100, render: (v: any, r: Relation) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '源概念', dataIndex: 'source', key: 'source', width: 100, render: (v: any, r: Relation) => renderCell(v, r, 'source', (v2: string) => concepts.find(c => c.name === v2)?.display_name || v2 || '-') },
    { title: '目标概念', dataIndex: 'target', key: 'target', width: 100, render: (v: any, r: Relation) => renderCell(v, r, 'target', (v2: string) => concepts.find(c => c.name === v2)?.display_name || v2 || '-') },
    { title: '基数', dataIndex: 'cardinality', key: 'cardinality', width: 65, render: (v: any, r: Relation) => renderCell(v, r, 'cardinality', (v2: string) => <span className="text-accent-blue">{v2}</span>) },
    { title: '关联概念属性', dataIndex: 'link_attr', key: 'link_attr', width: 220, ellipsis: true, render: (v: any, r: Relation) => renderCell(v, r, 'link_attr', () => linkAttrText(r)) },
    { title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: any, r: Relation) => renderCell(v, r, 'description') },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: any, record: Relation) => {
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
        <h3 className="text-base font-semibold text-text-primary">关系管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增关系</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">建立概念之间的关联与基数约束</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />
    </div>
  );
}
