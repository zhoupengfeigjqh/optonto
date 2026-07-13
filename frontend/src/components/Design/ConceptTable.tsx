'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Tag, Space, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, SettingOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getConcepts, createConcept, updateConcept, deleteConcept, updateAttributes, Concept, Attribute } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

export default function ConceptTable({ ontologyId, activeTab }: Props) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string>('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  // Attribute dialog
  const [attrConcept, setAttrConcept] = useState<Concept | null>(null);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [attrDialogOpen, setAttrDialogOpen] = useState(false);
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrType, setNewAttrType] = useState('string');
  const [newAttrRequired, setNewAttrRequired] = useState(true);
  const [newAttrDisplayName, setNewAttrDisplayName] = useState('');
  const [newAttrExample, setNewAttrExample] = useState('');
  const [newAttrConstraint, setNewAttrConstraint] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const list = await getConcepts(ontologyId);
      setConcepts(list);
    } catch (e: any) { message.error('加载概念失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'concepts') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Concept) => record.name === editingKey;

  const handleAdd = () => {
    const newKey = '__new__';
    setEditData({ name: '', display_name: '', description: '', classification: '' });
    setEditingKey(newKey);
  };

  const handleEdit = (record: Concept) => {
    setEditData({ name: record.name, display_name: record.display_name || '', description: record.description, classification: record.classification || '' });
    setEditingKey(record.name);
  };

  const handleCancel = () => {
    setEditingKey('');
    setEditData({});
  };

  const handleSave = async (record: Concept) => {
    if (!editData.name?.trim()) { message.warning('请输入概念名称'); return; }
    try {
      const data = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '', classification: editData.classification?.trim() || '', attributes: editingKey === '__new__' ? [] : (record.attributes || []) };
      const isNew = editingKey === '__new__';
      if (isNew) {
        // Check duplicate
        if (concepts.some(c => c.name === data.name)) { message.warning('概念名称已存在'); return; }
        await createConcept(ontologyId, data);
        message.success('概念已添加');
      } else {
        await updateConcept(ontologyId, record.name, data);
        message.success('概念已更新');
      }
      setEditingKey('');
      setEditData({});
      await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除概念「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try { await deleteConcept(ontologyId, name); message.success('概念已删除'); await load(); } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const openAttributes = (concept: Concept) => {
    setAttrConcept(concept);
    setAttributes(concept.attributes || []);
    setAttrDialogOpen(true);
  };

  const handleAddAttribute = () => {
    if (!newAttrName.trim()) { message.warning('请输入属性名称'); return; }
    setAttributes([...attributes, { name: newAttrName.trim(), type: newAttrType, required: newAttrRequired, display_name: newAttrDisplayName.trim(), example: newAttrExample.trim(), constraint: newAttrConstraint.trim() }]);
    setNewAttrName(''); setNewAttrType('string'); setNewAttrRequired(true); setNewAttrDisplayName(''); setNewAttrExample(''); setNewAttrConstraint('');
  };

  const handleDeleteAttribute = (idx: number) => setAttributes(attributes.filter((_, i) => i !== idx));

  const handleSaveAttributes = async () => {
    if (!attrConcept) return;
    try { await updateAttributes(ontologyId, attrConcept.name, attributes); message.success('属性已保存'); setAttrDialogOpen(false); await load(); }
    catch (e: any) { message.error(e.message); }
  };

  const renderCell = (val: any, record: Concept, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');

    if (dataIndex === 'name') {
      return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    }
    if (dataIndex === 'display_name') {
      return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    }
    if (dataIndex === 'description') {
      return <Input size="small" value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    }
    if (dataIndex === 'classification') {
      return <Input size="small" value={editData.classification || ''} onChange={e => setEditData(p => ({...p, classification: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="例如：核心实体" />;
    }
    return render ? render(val) : (val || '-');
  };

  // 显示数据：加上新增空行
  const dataSource = concepts.map(c => ({ ...c, _key: c.name }));
  if (editingKey === '__new__') {
    dataSource.push({ name: '__new__', description: '', display_name: '', classification: '', attributes: [] } as any);
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: any, r: Concept) => renderCell(v, r, 'description') },
    { title: '分类', dataIndex: 'classification', key: 'classification', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'classification', (v2: string) => v2 ? <Tag>{v2}</Tag> : '-') },
    { title: '属性数', key: 'attr_count', width: 70,
      render: (_: any, r: Concept) => <Tag color="blue">{r.attributes?.length || 0}</Tag> },
    {
      title: '操作', key: 'actions', width: 210,
      render: (_: any, record: Concept) => {
        const editing = isEditing(record);
        if (editing || (editingKey === '__new__' && record.name === '__new__')) {
          return (
            <Space>
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)}>保存</Button>
              <Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel}>取消</Button>
            </Space>
          );
        }
        return (
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
            <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => openAttributes(record)}>属性</Button>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} />
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">概念管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增概念</Button>
      </div>

      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      <Modal title={`管理属性 - ${attrConcept?.name || ''}`} open={attrDialogOpen} onCancel={() => setAttrDialogOpen(false)} width={850}
        footer={
          <div className="flex justify-start gap-2">
            <Button onClick={() => setAttrDialogOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSaveAttributes}>保存</Button>
          </div>
        }
      >
        <div className="space-y-3">
          {attributes.map((attr, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input value={attr.name} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], name: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="属性名" />
              <Input value={attr.display_name || ''} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], display_name: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="展示名" />
              <select value={attr.type} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], type: e.target.value }; setAttributes(n); }} className="w-24 px-2 py-1 rounded bg-dark-bg border border-dark-border text-text-primary text-sm">
                {['date', 'string', 'int', 'float', 'boolean'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input value={attr.constraint || ''} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], constraint: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="约束" />
              <select value={attr.required !== undefined ? String(attr.required) : 'true'} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], required: e.target.value === 'true' }; setAttributes(n); }} className="w-20 px-2 py-1 rounded bg-dark-bg border border-dark-border text-text-primary text-sm">
                <option value="true">必填</option><option value="false">可选</option>
              </select>
              <Input value={attr.example || ''} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], example: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="示例" />
              <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteAttribute(idx)} />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-dark-border">
            <Input placeholder="属性名" value={newAttrName} onChange={e => setNewAttrName(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />
            <Input placeholder="展示名" value={newAttrDisplayName} onChange={e => setNewAttrDisplayName(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />
            <select value={newAttrType} onChange={e => setNewAttrType(e.target.value)} className="w-24 px-2 py-1 rounded bg-dark-bg border border-dark-border text-text-primary text-sm">
              {['date', 'string', 'int', 'float', 'boolean'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input placeholder="约束" value={newAttrConstraint} onChange={e => setNewAttrConstraint(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />
            <select value={String(newAttrRequired)} onChange={e => setNewAttrRequired(e.target.value === 'true')} className="w-20 px-2 py-1 rounded bg-dark-bg border border-dark-border text-text-primary text-sm">
              <option value="true">必填</option><option value="false">可选</option>
            </select>
            <Input placeholder="示例" value={newAttrExample} onChange={e => setNewAttrExample(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAddAttribute}>添加</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
