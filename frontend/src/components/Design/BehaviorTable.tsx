'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space, Tag, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, CodeOutlined } from '@ant-design/icons';
import { getBehaviors, createBehavior, updateBehavior, deleteBehavior, getConcepts, Behavior, Concept } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

export default function BehaviorTable({ ontologyId, activeTab }: Props) {
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [paramsEditorOpen, setParamsEditorOpen] = useState(false);
  const [paramsError, setParamsError] = useState('');
  const [responseEditorOpen, setResponseEditorOpen] = useState(false);
  const [responseError, setResponseError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [behList, conList] = await Promise.all([getBehaviors(ontologyId), getConcepts(ontologyId)]);
      setBehaviors(behList); setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'behaviors') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Behavior) => record.name === editingKey;
  const isNewRow = (record: Behavior) => editingKey === '__new__' && record.name === '__new__';
  const conceptOptions = concepts.map(c => ({ label: c.display_name || c.name, value: c.name }));

  const handleAdd = () => {
    setEditData({ name: '', display_name: '', description: '', params: '{}', response: '{}', related_concepts: [] });
    setEditingKey('__new__');
  };

  const handleEdit = (b: Behavior) => {
    // Normalize old-format params ({key: "type"}) to new format ({key: {type, required}})
    const rawParams = b.params || {};
    const normParams: Record<string, {type: string; required: boolean; description: string; example: string}> = {};
    for (const [k, v] of Object.entries(rawParams)) {
      if (typeof v === 'string') normParams[k] = { type: v, required: true, description: '', example: '' };
      else if (typeof v === 'object' && v !== null) normParams[k] = { type: (v as any).type || 'string', required: (v as any).required !== false, description: (v as any).description || '', example: (v as any).example || '' };
      else normParams[k] = { type: String(v), required: true, description: '', example: '' };
    }
    setEditData({ name: b.name, display_name: b.display_name || '', description: b.description, params: JSON.stringify(normParams, null, 2) || '{}', response: JSON.stringify(b.response || {}, null, 2) || '{}', related_concepts: b.related_concepts });
    setEditingKey(b.name);
  };

  const handleCancel = () => { setEditingKey(''); setEditData({}); setParamsError(''); setResponseError(''); };
  const openParamsEditor = () => setParamsEditorOpen(true);
  const openResponseEditor = () => setResponseEditorOpen(true);

  const handleSave = async (record: Behavior) => {
    if (!editData.name?.trim()) { message.warning('请输入行为名称'); return; }
    let parsedParams: Record<string, unknown> = {};
    let parsedResponse: Record<string, unknown> = {};
    try { parsedParams = JSON.parse(editData.params || '{}'); setParamsError(''); }
    catch { message.warning('接口参数 JSON 格式错误'); return; }
    try { parsedResponse = JSON.parse(editData.response || '{}'); setResponseError(''); }
    catch { message.warning('返回结构 JSON 格式错误'); return; }

    try {
      const data: Behavior = {
        name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '',
        params: parsedParams, response: parsedResponse, related_concepts: editData.related_concepts || [],
      };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (behaviors.some(b => b.name === data.name)) { message.warning('行为名称已存在'); return; }
        await createBehavior(ontologyId, data); message.success('行为已添加');
      } else {
        await updateBehavior(ontologyId, record.name, data); message.success('行为已更新');
      }
      setEditingKey(''); setEditData({}); setParamsError(''); setResponseError(''); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除行为「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteBehavior(ontologyId, name); message.success('行为已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const renderCell = (val: any, record: Behavior, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record) || isNewRow(record);
    if (!editing) return render ? render(val) : (val || '-');

    const setF = (field: string) => (eOrVal: any) => {
      const v = eOrVal?.target?.value !== undefined ? eOrVal.target.value : eOrVal;
      setEditData((p: any) => ({ ...p, [field]: v }));
    };

    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={setF('name')} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={setF('display_name')} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={setF('description')} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'params') return <Button size="small" icon={<CodeOutlined />} onClick={openParamsEditor}>编辑</Button>;
    if (dataIndex === 'response') return <Button size="small" icon={<CodeOutlined />} onClick={openResponseEditor}>编辑</Button>;
    if (dataIndex === 'related_concepts') return <Select size="small" mode="multiple" placeholder="选" value={editData.related_concepts || []} onChange={setF('related_concepts')} options={conceptOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    return render ? render(val) : (val || '-');
  };

  const dataSource = behaviors.map(b => ({ ...b, _key: b.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', description: '', params: {}, response: {}, related_concepts: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 80, render: (v: any, r: Behavior) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 80, render: (v: any, r: Behavior) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: any, r: Behavior) => renderCell(v, r, 'description') },
    { title: '关联概念', dataIndex: 'related_concepts', key: 'related_concepts', width: 200, ellipsis: true, render: (v: any, r: Behavior) => renderCell(v, r, 'related_concepts', (list: string[]) => list?.map(name => concepts.find(c => c.name === name)?.display_name || name).join(',') || '-') },
    { title: '输入参数', key: 'params', width: 200, ellipsis: true, render: (_: any, r: Behavior) => {
      if (isEditing(r) || isNewRow(r)) return <Button size="small" icon={<CodeOutlined />} onClick={openParamsEditor}>编辑</Button>;
      const raw = r.params || {};
      const items: { name: string; type: string; required: boolean; description: string; example: string }[] = [];
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') items.push({ name: k, type: v, required: true, description: '', example: '' });
        else if (typeof v === 'object' && v !== null) items.push({ name: k, type: (v as any).type || 'string', required: (v as any).required !== false, description: (v as any).description || '', example: (v as any).example || '' });
        else items.push({ name: k, type: String(v), required: true, description: '', example: '' });
      }
      return items.length > 0 ? items.map((p, i) => {
        const tip = [];
        if (p.description) tip.push(`描述: ${p.description}`);
        if (p.example) tip.push(`示例: ${p.example}`);
        const tag = (
          <Tag key={i} color={p.required ? 'blue' : 'default'} className="mb-0.5">{p.name}<span className="text-text-muted ml-1 text-xs">{p.type}</span></Tag>
        );
        return tip.length > 0 ? <Tooltip key={i} title={<div>{tip.map((t, j) => <div key={j}>{t}</div>)}</div>}>{tag}</Tooltip> : tag;
      }) : '-';
    } },
    { title: '返回结构', key: 'response', width: 200, ellipsis: true, render: (_: any, r: Behavior) => {
      if (isEditing(r) || isNewRow(r)) return <Button size="small" icon={<CodeOutlined />} onClick={openResponseEditor}>编辑</Button>;
      const raw = r.response || {};
      const items: { name: string; type: string; required: boolean; description: string; example: string }[] = [];
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') items.push({ name: k, type: v, required: true, description: '', example: '' });
        else if (typeof v === 'object' && v !== null) items.push({ name: k, type: (v as any).type || 'string', required: (v as any).required !== false, description: (v as any).description || '', example: (v as any).example || '' });
        else items.push({ name: k, type: String(v), required: true, description: '', example: '' });
      }
      return items.length > 0 ? items.map((p, i) => {
        const tip = [];
        if (p.description) tip.push(`描述: ${p.description}`);
        if (p.example) tip.push(`示例: ${p.example}`);
        const tag = (
          <Tag key={i} color={p.required ? 'green' : 'default'} className="mb-0.5">{p.name}<span className="text-text-muted ml-1 text-xs">{p.type}</span></Tag>
        );
        return tip.length > 0 ? <Tooltip key={i} title={<div>{tip.map((t, j) => <div key={j}>{t}</div>)}</div>}>{tag}</Tooltip> : tag;
      }) : '-';
    } },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: Behavior) => {
        if (editingKey === record.name || isNewRow(record)) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return <Space><Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} /><Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} /></Space>;
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">行为管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增行为</Button>
      </div>

      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      <Modal title="编辑接口参数" open={paramsEditorOpen} onOk={() => { try { const parsed = JSON.parse(editData.params || '{}');
        for (const [k, v] of Object.entries(parsed)) { if (typeof v === 'object' && v !== null) { if (!('type' in (v as any))) throw new Error(`${k} 缺少 type`); } else if (typeof v !== 'string') throw new Error(`${k} 格式无效`); }
        setParamsError(''); setParamsEditorOpen(false); } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); } }} onCancel={() => setParamsEditorOpen(false)} okText="确认" cancelText="取消" width={600}>
        <Input.TextArea value={editData.params || '{}'} onChange={e => setEditData((p: any) => ({ ...p, params: e.target.value }))} rows={12} className="bg-dark-bg border-dark-border text-text-primary font-mono" />
        {paramsError && <p className="text-red-400 text-xs mt-1">{paramsError}</p>}
      </Modal>

      <Modal title="编辑返回结构" open={responseEditorOpen} onOk={() => { try { const parsed = JSON.parse(editData.response || '{}');
        for (const [k, v] of Object.entries(parsed)) { if (typeof v === 'object' && v !== null) { if (!('type' in (v as any))) throw new Error(`${k} 缺少 type`); } else if (typeof v !== 'string') throw new Error(`${k} 格式无效`); }
        setResponseError(''); setResponseEditorOpen(false); } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); } }} onCancel={() => setResponseEditorOpen(false)} okText="确认" cancelText="取消" width={600}>
        <Input.TextArea value={editData.response || '{}'} onChange={e => setEditData((p: any) => ({ ...p, response: e.target.value }))} rows={12} className="bg-dark-bg border-dark-border text-text-primary font-mono" />
        {responseError && <p className="text-red-400 text-xs mt-1">{responseError}</p>}
      </Modal>
    </div>
  );
}
