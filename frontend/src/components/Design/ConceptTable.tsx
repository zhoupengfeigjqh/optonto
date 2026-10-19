'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, message, Tag, Space, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, SettingOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  getConcepts, createConcept, updateConcept, deleteConcept,
  Concept, Attribute, AttributeRestriction, effectiveAttributes,
} from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import ConceptAttributeModal from './ConceptAttributeModal';
import { parentCandidates } from './concept-inheritance';

interface Props { ontologyId: number; activeTab?: string; }

export default function ConceptTable({ ontologyId, activeTab }: Props) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string>('');
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [attrConcept, setAttrConcept] = useState<Concept | null>(null);

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
    setEditData({ name: '', display_name: '', description: '', instance_label: '', terms: [], sub_class_of: undefined });
    setEditingKey('__new__');
  };

  const handleEdit = (record: Concept) => {
    setEditData({
      name: record.name,
      display_name: record.display_name || '',
      description: record.description,
      instance_label: record.instance_label || '',
      terms: record.terms || [],
      sub_class_of: record.sub_class_of || undefined,
    });
    setEditingKey(record.name);
  };

  const handleCancel = () => {
    setEditingKey('');
    setEditData({});
  };

  const doSave = async (
    record: Concept,
    keptAttrs: Attribute[],
    restrictionsPayload: Record<string, AttributeRestriction>,
  ) => {
    const isNew = editingKey === '__new__';
    const data: Concept = {
      name: editData.name.trim(),
      display_name: editData.display_name?.trim() || '',
      description: editData.description?.trim() || '',
      instance_label: editData.instance_label || '',
      terms: editData.terms || [],
      attributes: keptAttrs,
      sub_class_of: editData.sub_class_of || null,
      attribute_restrictions: restrictionsPayload,
    };
    try {
      if (isNew) {
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

  const handleSave = async (record: Concept) => {
    if (!editData.name?.trim()) { message.warning('请输入概念名称'); return; }
    const isNew = editingKey === '__new__';
    const parentName: string | undefined = editData.sub_class_of || undefined;
    const parent = parentName ? concepts.find(c => c.name === parentName) : undefined;
    // 父概念的有效属性 = 子概念可继承的全集（多级继承已由服务端合成）
    const inheritedNames = new Set(effectiveAttributes(parent).map(a => a.name));

    const ownAttrs = isNew ? [] : (record.attributes || []);
    const conflicts = ownAttrs.filter(a => inheritedNames.has(a.name)).map(a => a.name);
    const keptAttrs = ownAttrs.filter(a => !inheritedNames.has(a.name));
    // 换父/清父后，只保留仍然继承得到的属性上的收窄
    const restrictionsPayload: Record<string, AttributeRestriction> = {};
    const existingRestrictions = isNew ? {} : (record.attribute_restrictions || {});
    for (const [name, r] of Object.entries(existingRestrictions)) {
      if (inheritedNames.has(name)) restrictionsPayload[name] = r;
    }

    const submit = () => doSave(record, keptAttrs, restrictionsPayload);
    if (conflicts.length) {
      Modal.confirm({
        title: <span style={{ color: '#facc15' }}>同名属性将直接继承父概念</span>,
        content: (
          <span style={{ color: '#facc15' }}>
            以下自有属性与父概念同名，保存后按父概念定义继承（子概念仅可收窄枚举/范围/匹配模式）：
            <strong style={{ color: '#fde047' }}> {conflicts.join('、')}</strong>
          </span>
        ),
        okText: '确认保存', cancelText: '取消',
        onOk: submit,
      });
      return;
    }
    await submit();
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

  /** 父概念的有效属性（继承行收窄边界：enum 候选、min/max 上下限） */
  const parentAttrs = useMemo(() => {
    const parent = concepts.find(c => c.name === attrConcept?.sub_class_of);
    return effectiveAttributes(parent);
  }, [concepts, attrConcept]);

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
    if (dataIndex === 'sub_class_of') {
      // 父概念：排除自身与全部后代，前端先防环（后端仍强校验）
      const currentName = editingKey === '__new__' ? undefined : editingKey;
      const options = parentCandidates(concepts, currentName).map(c => ({
        value: c.name,
        label: c.display_name ? `${c.display_name}（${c.name}）` : c.name,
      }));
      return (
        <Select size="small" value={editData.sub_class_of || undefined} onChange={v => setEditData(p => ({...p, sub_class_of: v}))}
          style={{ width: '100%' }} placeholder="无（根概念）" allowClear options={options}
          className="bg-dark-bg border-dark-border text-text-primary" />
      );
    }
    if (dataIndex === 'instance_label') {
      const attrOptions = effectiveAttributes(record).map(a => ({ value: a.name, label: a.name }));
      return (
        <Select size="small" value={editData.instance_label || ''} onChange={v => setEditData(p => ({...p, instance_label: v}))} style={{ width: '100%' }}
          placeholder="选择属性" allowClear
          options={attrOptions} className="bg-dark-bg border-dark-border text-text-primary" />
      );
    }
    if (dataIndex === 'terms') {
      // 术语集：回车新增（tags 模式），后端保存时统一去重去空
      return <Select size="small" mode="tags" value={editData.terms || []} onChange={vals => setEditData(p => ({...p, terms: vals}))}
        style={{ width: '100%' }} open={false} suffixIcon={null} placeholder="回车新增术语"
        className="bg-dark-bg border-dark-border text-text-primary" />;
    }
    return render ? render(val) : (val || '-');
  };

  const dataSource = concepts.map(c => ({ ...c, _key: c.name }));
  if (editingKey === '__new__') {
    dataSource.push({ name: '__new__', description: '', display_name: '', instance_label: '', terms: [], attributes: [], sub_class_of: null } as any);
  }

  const columns = [
    { title: '英文名称', dataIndex: 'name', key: 'name', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'name') },
    { title: '中文名称', dataIndex: 'display_name', key: 'display_name', width: 120,
      render: (v: any, r: Concept) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '父概念', dataIndex: 'sub_class_of', key: 'sub_class_of', width: 140,
      render: (v: any, r: Concept) => {
        if (isEditing(r) || (editingKey === '__new__' && r.name === '__new__')) {
          return renderCell(v, r, 'sub_class_of');
        }
        return v
          ? <Tag color="cyan">{concepts.find(c => c.name === v)?.display_name || v}</Tag>
          : <span className="text-text-muted">-</span>;
      } },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: any, r: Concept) => renderCell(v, r, 'description') },
    { title: '实例标签', dataIndex: 'instance_label', key: 'instance_label', width: 130,
      render: (v: any, r: Concept) => {
        if (isEditing(r) || (editingKey === '__new__' && r.name === '__new__')) {
          return renderCell(v, r, 'instance_label');
        }
        return v ? <Tag color="purple">{v}</Tag> : <span className="text-text-muted">-</span>;
      } },
    { title: '术语集', dataIndex: 'terms', key: 'terms', width: 180, render: (v: any, r: Concept) => {
        if (isEditing(r) || (editingKey === '__new__' && r.name === '__new__')) {
          return renderCell(v, r, 'terms');
        }
        const list: string[] = v || [];
        return list.length
          ? <Space size={4} wrap>{list.map(t => <Tag key={t} color="geekblue" style={{ marginInlineEnd: 0 }}>{t}</Tag>)}</Space>
          : <span className="text-text-muted">-</span>;
      } },
    { title: '属性数', key: 'attr_count', width: 90,
      render: (_: any, r: Concept) => {
        const own = r.attributes?.length || 0;
        const inherited = r.inherited_attributes?.length || 0;
        return (
          <Space size={4}>
            <Tag color="blue">{own}</Tag>
            {inherited > 0 && <Tag color="cyan">+{inherited}</Tag>}
          </Space>
        );
      } },
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
            <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => setAttrConcept(record)}>属性</Button>
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
      <p className="text-text-muted text-xs mb-3">定义业务中的核心对象及其属性结构；父概念（subClassOf）的属性自动继承，子概念只能收窄枚举、取值范围与匹配模式</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      <ConceptAttributeModal
        open={!!attrConcept}
        concept={attrConcept}
        parentAttrs={parentAttrs}
        ontologyId={ontologyId}
        onClose={() => setAttrConcept(null)}
        onSaved={load}
      />
    </div>
  );
}
