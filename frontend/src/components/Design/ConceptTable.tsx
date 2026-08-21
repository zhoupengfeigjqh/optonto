'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Tag, Space, Table, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, SettingOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getConcepts, createConcept, updateConcept, deleteConcept, updateAttributes, Concept, Attribute, AttributeConstraint } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

const ATTR_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
// 类型-约束矩阵：唯一/枚举仅 string|number|integer；匹配模式仅 string；非空全类型可填
const canUnique = (t: string) => ['string', 'number', 'integer'].includes(t);
const canEnum = canUnique;
const canPattern = (t: string) => t === 'string';

const BOOL_OPTS = [{ value: 'false', label: '否' }, { value: 'true', label: '是' }];

const patternInvalid = (p?: string) => {
  if (!p?.trim()) return false;
  try { new RegExp(p); return false; } catch { return true; }
};

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
    setEditData({ name: '', display_name: '', description: '' });
    setEditingKey(newKey);
  };

  const handleEdit = (record: Concept) => {
    setEditData({ name: record.name, display_name: record.display_name || '', description: record.description });
    setEditingKey(record.name);
  };

  const handleCancel = () => {
    setEditingKey('');
    setEditData({});
  };

  const handleSave = async (record: Concept) => {
    if (!editData.name?.trim()) { message.warning('请输入概念名称'); return; }
    try {
      const data = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '', attributes: editingKey === '__new__' ? [] : (record.attributes || []) };
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

  const updateAttr = (idx: number, patch: Partial<Attribute>) => {
    const n = [...attributes];
    const next: Attribute = { ...n[idx], ...patch };
    if (patch.type !== undefined) {
      // 切换类型：清理不适用的约束项，避免脏数据
      const c: AttributeConstraint = { ...(next.constraint || {}) };
      if (!canUnique(next.type)) { delete c.unique; }
      if (!canEnum(next.type)) { delete c.enum; }
      if (!canPattern(next.type)) { delete c.pattern; }
      next.constraint = Object.keys(c).length ? c : null;
    }
    if (patch.constraint !== undefined) {
      // 唯一 ⇒ 非空联动；取消唯一后非空保持原值但恢复可编辑
      const c: AttributeConstraint = { ...(n[idx].constraint || {}), ...patch.constraint };
      if (c.unique) c.required = true;
      next.constraint = c;
    }
    n[idx] = next;
    setAttributes(n);
  };

  const handleAddAttribute = () => setAttributes([...attributes, { name: '', type: 'string' }]);

  const handleDeleteAttribute = (idx: number) => setAttributes(attributes.filter((_, i) => i !== idx));

  const handleSaveAttributes = async () => {
    if (!attrConcept) return;
    const names = attributes.map(a => a.name.trim());
    if (names.some(n => !n)) { message.warning('属性名不能为空'); return; }
    if (new Set(names).size !== names.length) { message.warning('属性名重复'); return; }
    for (const a of attributes) {
      if (patternInvalid(a.constraint?.pattern)) { message.error(`属性「${a.name}」的匹配模式不是合法正则`); return; }
      if (canEnum(a.type) && a.type !== 'string' && (a.constraint?.enum || []).some(v => isNaN(Number(v)))) {
        message.warning(`属性「${a.name}」的枚举值必须是数字`); return;
      }
    }
    // 收敛 constraint：清不适用项、数字枚举解析、全缺省置 null（不落盘）
    const payload = attributes.map(a => {
      const base = { name: a.name.trim(), type: a.type, display_name: a.display_name?.trim() || '', example: a.example?.trim() || '' };
      const c = a.constraint;
      if (!c) return { ...base, constraint: null };
      const out: AttributeConstraint = {};
      if (canUnique(a.type) && c.unique) out.unique = true;
      if (c.required || out.unique) out.required = true;
      if (canEnum(a.type) && c.enum?.length) {
        out.enum = a.type === 'string' ? c.enum.map(String) : c.enum.map(Number);
      }
      if (canPattern(a.type) && c.pattern?.trim()) out.pattern = c.pattern.trim();
      return { ...base, constraint: Object.keys(out).length ? out : null };
    });
    try { await updateAttributes(ontologyId, attrConcept.name, payload); message.success('属性已保存'); setAttrDialogOpen(false); await load(); }
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
    return render ? render(val) : (val || '-');
  };

  // 显示数据：加上新增空行
  const dataSource = concepts.map(c => ({ ...c, _key: c.name }));
  if (editingKey === '__new__') {
    dataSource.push({ name: '__new__', description: '', display_name: '', attributes: [] } as any);
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: any, r: Concept) => renderCell(v, r, 'description') },
    { title: '属性数', key: 'attr_count', width: 70,
      render: (_: any, r: Concept) => <Tag color="blue">{r.attributes?.length || 0}</Tag> },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: any, record: Concept) => {
        const editing = isEditing(record);
        if (editing || (editingKey === '__new__' && record.name === '__new__')) {
          return (
            <Space>
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} />
              <Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} />
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
      <p className="text-text-muted text-xs mb-3">定义业务中的核心对象及其属性结构</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      <Modal title={`管理属性 - ${attrConcept?.display_name || attrConcept?.name || ''}`} open={attrDialogOpen} onCancel={() => setAttrDialogOpen(false)} width={1200}
        footer={
          <div className="flex justify-start gap-2">
            <Button onClick={() => setAttrDialogOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSaveAttributes}>保存</Button>
          </div>
        }
      >
        <Table
          dataSource={attributes.map((a, i) => ({ ...a, _idx: i }))}
          rowKey="_idx"
          size="small"
          pagination={false}
          scroll={{ x: 1090 }}
          columns={[
            { title: '属性名', width: 130, render: (_: any, r: any) => (
              <Input size="small" value={r.name} onChange={e => updateAttr(r._idx, { name: e.target.value })} placeholder="属性名" className="bg-dark-bg border-dark-border text-text-primary" />
            )},
            { title: '展示名', width: 110, render: (_: any, r: any) => (
              <Input size="small" value={r.display_name || ''} onChange={e => updateAttr(r._idx, { display_name: e.target.value })} placeholder="展示名" className="bg-dark-bg border-dark-border text-text-primary" />
            )},
            { title: '类型', width: 100, render: (_: any, r: any) => (
              <Select size="small" value={r.type} onChange={v => updateAttr(r._idx, { type: v })} style={{ width: '100%' }}
                options={ATTR_TYPES.map(t => ({ value: t, label: t }))} />
            )},
            { title: '是否唯一', width: 80, render: (_: any, r: any) => canUnique(r.type) ? (
              <Select size="small" value={String(r.constraint?.unique ?? false)} style={{ width: '100%' }}
                onChange={v => updateAttr(r._idx, { constraint: { unique: v === 'true' } })} options={BOOL_OPTS} />
            ) : <span className="text-text-muted">-</span> },
            { title: '是否非空', width: 80, render: (_: any, r: any) => (
              <Select size="small" value={String(r.constraint?.required ?? false)} disabled={!!r.constraint?.unique} style={{ width: '100%' }}
                onChange={v => updateAttr(r._idx, { constraint: { required: v === 'true' } })} options={BOOL_OPTS} />
            )},
            { title: '枚举值', width: 170, render: (_: any, r: any) => canEnum(r.type) ? (
              <Select size="small" mode="tags" value={(r.constraint?.enum || []).map(String)} style={{ width: '100%' }}
                open={false} suffixIcon={null} placeholder="回车新增"
                onChange={vals => updateAttr(r._idx, { constraint: { enum: vals } })} />
            ) : <span className="text-text-muted">-</span> },
            { title: '匹配模式', width: 170, render: (_: any, r: any) => canPattern(r.type) ? (
              <Input size="small" value={r.constraint?.pattern || ''} placeholder="^\d{4}-\d{2}-\d{2}$"
                status={patternInvalid(r.constraint?.pattern) ? 'error' : ''}
                onChange={e => updateAttr(r._idx, { constraint: { pattern: e.target.value } })}
                className="bg-dark-bg border-dark-border text-text-primary" />
            ) : <span className="text-text-muted">-</span> },
            { title: '示例', width: 110, render: (_: any, r: any) => (
              <Input size="small" value={r.example || ''} onChange={e => updateAttr(r._idx, { example: e.target.value })} placeholder="示例" className="bg-dark-bg border-dark-border text-text-primary" />
            )},
            { title: '操作', width: 60, render: (_: any, r: any) => (
              <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteAttribute(r._idx)} />
            )},
          ]}
        />
        <div className="pt-3">
          <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddAttribute} block>新增属性</Button>
        </div>
      </Modal>
    </div>
  );
}
