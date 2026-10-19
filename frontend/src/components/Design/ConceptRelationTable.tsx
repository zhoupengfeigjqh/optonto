'use client';

/**
 * 概念关系表（类级公理，无基数）：SubClassOf / EquivalentClass / DisjointWith。
 *
 * 口径（2026-10-19）：
 * - SubClassOf 由「概念」页签的父子关系自动同步：整行置灰，不能新增/删除，
 *   仅「关联概念属性」可修改（其余字段只读）；
 * - 用户可新增的只有 EquivalentClass / DisjointWith，二者对称，反向重复由后端拒绝。
 */
import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  getConceptRelations, createConceptRelation, updateConceptRelation, deleteConceptRelation,
  getConcepts, effectiveAttributes, Concept, ConceptRelation, ConceptRelationType,
} from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import { useTablePagination } from '@/lib/table-pagination';

interface Props { ontologyId: number; activeTab?: string; }

const ADDABLE_TYPE_OPTIONS = [
  { label: '等价 (EquivalentClass)', value: 'EquivalentClass' },
  { label: '互斥 (DisjointWith)', value: 'DisjointWith' },
];

const TYPE_LABELS: Record<string, string> = {
  SubClassOf: 'SubClassOf',
  EquivalentClass: 'EquivalentClass',
  DisjointWith: 'DisjointWith',
};

const isSubClass = (r: ConceptRelation) => r.relation_type === 'SubClassOf';

export default function ConceptRelationTable({ ontologyId, activeTab }: Props) {
  const [relations, setRelations] = useState<ConceptRelation[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});
  const { pagination, goToRow } = useTablePagination();

  const load = async () => {
    setLoading(true);
    try {
      const [relList, conList] = await Promise.all([getConceptRelations(ontologyId), getConcepts(ontologyId)]);
      setRelations(relList); setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'relations') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: ConceptRelation) => record.name === editingKey;
  const conceptOptions = concepts.map(c => ({ label: c.display_name || c.name, value: c.name }));

  const attrOptions = (conceptName?: string) =>
    effectiveAttributes(concepts.find(c => c.name === conceptName))
      .map(a => ({ label: `${a.display_name || a.name}（${a.type}）`, value: a.name }));
  const attrType = (conceptName?: string, attrName?: string) =>
    effectiveAttributes(concepts.find(c => c.name === conceptName)).find(a => a.name === attrName)?.type;

  const handleAdd = () => {
    setEditData({
      name: '', display_name: '', relation_type: 'EquivalentClass',
      source: undefined, target: undefined,
      source_attr: undefined, target_attr: undefined, description: '',
    });
    setEditingKey('__new__');
    goToRow(relations.length);
  };
  const handleEdit = (r: ConceptRelation) => {
    setEditData({
      name: r.name, display_name: r.display_name || '', relation_type: r.relation_type,
      source: r.source, target: r.target,
      source_attr: r.source_attr || undefined, target_attr: r.target_attr || undefined,
      description: r.description || '',
    });
    setEditingKey(r.name);
  };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const validateSave = (record: ConceptRelation): boolean => {
    const derived = isSubClass(record);
    // SubClassOf 只允许改关联概念属性，其余字段由概念设计派生
    if (!derived) {
      if (!editData.name?.trim()) { message.warning('请输入概念关系名称'); return false; }
      if (editData.relation_type === 'SubClassOf') { message.warning('SubClassOf 由概念设计同步，不能手工新增'); return false; }
    }
    if (!editData.source?.trim() || !editData.target?.trim()) { message.warning('请选择源概念和目标概念'); return false; }
    if (editData.source === editData.target) { message.warning('概念关系不能指向概念自身'); return false; }
    if (!!editData.source_attr !== !!editData.target_attr) {
      message.warning('关联概念属性必须两端同时填写，或同时留空');
      return false;
    }
    // 对称关系：同一概念对（含反向）只允许一条，避免后端 400
    if (!derived) {
      const duplicated = relations.some(r =>
        r.name !== record.name
        && r.relation_type === editData.relation_type
        && ((r.source === editData.source && r.target === editData.target)
          || (r.source === editData.target && r.target === editData.source)));
      if (duplicated) {
        message.warning(`${TYPE_LABELS[editData.relation_type]} 是对称关系，同一概念对已存在（含反向），请勿重复登记`);
        return false;
      }
    }
    if (editData.source_attr && editData.target_attr) {
      const sType = attrType(editData.source, editData.source_attr);
      const tType = attrType(editData.target, editData.target_attr);
      if (sType && tType && sType !== tType) {
        message.warning(`关联属性类型不一致：${editData.source}.${editData.source_attr}（${sType}）≠ ${editData.target}.${editData.target_attr}（${tType}），请重新选择`);
        return false;
      }
    }
    return true;
  };

  const handleSave = async (record: ConceptRelation) => {
    if (!validateSave(record)) return;
    const derived = isSubClass(record);
    const payload: ConceptRelation = {
      // SubClassOf 的名称/端点/类型由后端派生，这里原样回传仅作占位
      name: derived ? record.name : (editData.name || '').trim(),
      display_name: derived ? (record.display_name || '') : (editData.display_name?.trim() || ''),
      relation_type: (derived ? 'SubClassOf' : editData.relation_type) as ConceptRelationType,
      source: editData.source,
      target: editData.target,
      source_attr: editData.source_attr || '',
      target_attr: editData.target_attr || '',
      description: derived ? (record.description || '') : (editData.description?.trim() || ''),
    };
    try {
      if (editingKey === '__new__') {
        if (relations.some(r => r.name === payload.name)) { message.warning('概念关系名称已存在'); return; }
        await createConceptRelation(ontologyId, payload);
        message.success('概念关系已添加');
      } else {
        await updateConceptRelation(ontologyId, record.name, payload);
        message.success(derived ? '关联概念属性已更新' : '概念关系已更新');
      }
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除概念关系「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteConceptRelation(ontologyId, name); message.success('概念关系已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const linkAttrText = (r: ConceptRelation) => {
    if (!r.source_attr || !r.target_attr) return '-';
    const conceptName = (n: string) => concepts.find(c => c.name === n)?.display_name || n;
    const attrName = (cn: string, an: string) => {
      const a = effectiveAttributes(concepts.find(c => c.name === cn)).find(x => x.name === an);
      return a?.display_name || an;
    };
    return `${conceptName(r.source)}.${attrName(r.source, r.source_attr)} = ${conceptName(r.target)}.${attrName(r.target, r.target_attr)}`;
  };

  const renderCell = (val: any, record: ConceptRelation, dataIndex: string, render?: (v: any) => any) => {
    const derived = isSubClass(record);
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';

    // SubClassOf 行仅「关联概念属性」可编辑，其余字段恒只读展示
    if (derived && dataIndex !== 'link_attr') return render ? render(val) : (val || '-');
    if (!editing && !isNew) return render ? render(val) : (val || '-');

    if (dataIndex === 'name') return <Input size="small" placeholder="如 DraftOrderDisjointWithSubmittedOrder" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'source') return <Select size="small" placeholder="选择" options={conceptOptions} value={editData.source} onChange={v => setEditData(p => ({...p, source: v, source_attr: undefined}))} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'target') return <Select size="small" placeholder="选择" options={conceptOptions} value={editData.target} onChange={v => setEditData(p => ({...p, target: v, target_attr: undefined}))} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'relation_type') {
      return <Select size="small" value={editData.relation_type} onChange={v => setEditData(p => ({...p, relation_type: v}))} options={ADDABLE_TYPE_OPTIONS} style={{width:"100%"}} popupClassName="!bg-dark-card" />;
    }
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
  if (editingKey === '__new__') {
    dataSource.push({
      _key: '__new__',
      name: '__new__', display_name: '', relation_type: 'EquivalentClass',
      source: '', target: '', source_attr: '', target_attr: '', description: '',
    } as any);
  }

  const columns = [
    { title: '英文名称', dataIndex: 'name', key: 'name', width: 200, ellipsis: true, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'name') },
    { title: '中文名称', dataIndex: 'display_name', key: 'display_name', width: 120, ellipsis: true, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '源概念', dataIndex: 'source', key: 'source', width: 110, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'source', (v2: string) => concepts.find(c => c.name === v2)?.display_name || v2 || '-') },
    { title: '目标概念', dataIndex: 'target', key: 'target', width: 110, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'target', (v2: string) => concepts.find(c => c.name === v2)?.display_name || v2 || '-') },
    { title: '关系类型', dataIndex: 'relation_type', key: 'relation_type', width: 140, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'relation_type', (v2: string) => TYPE_LABELS[v2] || v2 || '-') },
    { title: '关联概念属性', dataIndex: 'link_attr', key: 'link_attr', width: 220, ellipsis: true, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'link_attr', () => linkAttrText(r)) },
    { title: '描述', dataIndex: 'description', key: 'description', width: 220, ellipsis: true, render: (v: any, r: ConceptRelation) => renderCell(v, r, 'description') },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: any, record: ConceptRelation) => {
        if (isEditing(record) || (editingKey === '__new__' && record.name === '__new__')) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return (
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />}
              title={isSubClass(record) ? 'SubClassOf 由概念设计同步，仅关联概念属性可修改' : '编辑'}
              onClick={() => handleEdit(record)} />
            {!isSubClass(record) && (
              <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} />
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增关系</Button>
      </div>
      <ResizableTable
        dataSource={dataSource}
        columns={columns}
        rowKey="_key"
        loading={loading}
        pagination={pagination}
        rowClassName={(r: any) => (r.relation_type === 'SubClassOf' ? 'opacity-60' : '')}
      />
    </div>
  );
}
