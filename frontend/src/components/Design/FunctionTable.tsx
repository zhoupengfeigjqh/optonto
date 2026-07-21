'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Space, Tag, Tooltip, Tree } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, CodeOutlined } from '@ant-design/icons';
import { getFunctions, createFunction, updateFunction, deleteFunction, getConcepts, Function, Concept, Attribute } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import type { DataNode } from 'antd/es/tree';

interface Props { ontologyId: number; activeTab?: string; }

export default function FunctionTable({ ontologyId, activeTab }: Props) {
  const [funcs, setFuncs] = useState<Function[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  // attribute tree modal
  const [treeModalOpen, setTreeModalOpen] = useState(false);
  const [treeCheckedKeys, setTreeCheckedKeys] = useState<string[]>([]);

  // params editor
  const [paramsEditorOpen, setParamsEditorOpen] = useState(false);
  const [paramsError, setParamsError] = useState('');

  // response editor
  const [responseEditorOpen, setResponseEditorOpen] = useState(false);
  const [responseError, setResponseError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [fnList, conList] = await Promise.all([getFunctions(ontologyId), getConcepts(ontologyId)]);
      setFuncs(fnList); setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'functions') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Function) => record.name === editingKey;
  const isNewRow = (record: Function) => editingKey === '__new__' && record.name === '__new__';

  // Build tree data from concepts → attributes
  const buildTreeData = (): DataNode[] => {
    return concepts.map(c => ({
      title: c.display_name || c.name,
      key: c.name,
      selectable: false,
      children: (c.attributes || []).map((a: Attribute) => ({
        title: <span>{a.display_name || a.name} <span className="text-text-muted text-xs">({c.name}.{a.name})</span></span>,
        key: `${c.name}.${a.name}`,
        isLeaf: true,
      })),
    }));
  };

  const treeData = buildTreeData();

  const openTreeModal = () => {
    setTreeCheckedKeys(editData.related_attributes || []);
    setTreeModalOpen(true);
  };

  const confirmTreeSelection = () => {
    setEditData((p: any) => ({ ...p, related_attributes: treeCheckedKeys }));
    setTreeModalOpen(false);
  };

  const handleAdd = () => {
    setEditData({ name: '', display_name: '', description: '', related_attributes: [], params: '{}', response: '{}' });
    setEditingKey('__new__');
  };

  const handleEdit = (g: Function) => {
    setEditData({ name: g.name, display_name: g.display_name || '', description: g.description || '', related_attributes: g.related_attributes || [], params: JSON.stringify(g.params || {}, null, 2), response: JSON.stringify(g.response || {}, null, 2) });
    setEditingKey(g.name);
  };

  const handleCancel = () => { setEditingKey(''); setEditData({}); setParamsError(''); setResponseError(''); };

  const handleSave = async (record: Function) => {
    if (!editData.name?.trim()) { message.warning('请输入函数名称'); return; }
    let parsedParams: Record<string, unknown> = {};
    let parsedResponse: Record<string, unknown> = {};
    try { parsedParams = JSON.parse(editData.params || '{}'); setParamsError(''); }
    catch { message.warning('输入参数 JSON 格式错误'); return; }
    try { parsedResponse = JSON.parse(editData.response || '{}'); setResponseError(''); }
    catch { message.warning('返回结构 JSON 格式错误'); return; }
    try {
      const data: Function = {
        name: editData.name.trim(),
        display_name: editData.display_name?.trim() || '',
        description: editData.description?.trim() || '',
        related_attributes: editData.related_attributes || [],
        params: parsedParams,
        response: parsedResponse,
      };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (funcs.some(g => g.name === data.name)) { message.warning('函数名称已存在'); return; }
        await createFunction(ontologyId, data); message.success('函数已添加');
      } else {
        await updateFunction(ontologyId, record.name, data); message.success('函数已更新');
      }
      setEditingKey(''); setEditData({}); setParamsError(''); setResponseError(''); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除函数「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteFunction(ontologyId, name); message.success('函数已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const renderCell = (val: any, record: Function, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record) || isNewRow(record);
    if (!editing) return render ? render(val) : (val || '-');

    const setF = (field: string) => (eOrVal: any) => {
      const v = eOrVal?.target?.value !== undefined ? eOrVal.target.value : eOrVal;
      setEditData((p: any) => ({ ...p, [field]: v }));
    };

    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={setF('name')} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={setF('display_name')} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={setF('description')} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'related_attributes') {
      const selected = editData.related_attributes || [];
      return (
        <div className="flex items-center gap-1 flex-wrap">
          <Button size="small" onClick={openTreeModal}>选择概念属性</Button>
          {selected.length > 0 && <span className="text-accent-blue text-xs">已选 {selected.length} 项</span>}
        </div>
      );
    }
    if (dataIndex === 'params') return <Button size="small" icon={<CodeOutlined />} onClick={() => setParamsEditorOpen(true)}>编辑</Button>;
    if (dataIndex === 'response') return <Button size="small" icon={<CodeOutlined />} onClick={() => setResponseEditorOpen(true)}>编辑</Button>;
    return render ? render(val) : (val || '-');
  };

  const dataSource = funcs.map(g => ({ ...g, _key: g.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', description: '', related_attributes: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 100, render: (v: any, r: Function) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 120, render: (v: any, r: Function) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '计算逻辑', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: any, r: Function) => renderCell(v, r, 'description') },
    { title: '关联概念属性', dataIndex: 'related_attributes', key: 'related_attributes', width: 300, render: (v: any, r: Function) => {
      if (isEditing(r) || isNewRow(r)) {
        const selected = editData.related_attributes || [];
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <Button size="small" onClick={openTreeModal}>选择概念属性</Button>
            {selected.length > 0 && <span className="text-accent-blue text-xs">已选 {selected.length} 项</span>}
          </div>
        );
      }
      const list: string[] = v || [];
      if (list.length === 0) return '-';
      const MAX_VISIBLE = 4;
      const visible = list.slice(0, MAX_VISIBLE);
      const rest = list.length - MAX_VISIBLE;
      return (
        <div className="flex flex-wrap gap-1 items-center">
          {visible.map((item: string) => {
            const dot = item.lastIndexOf('.');
            const concept = dot > 0 ? item.substring(0, dot) : '';
            const attr = dot > 0 ? item.substring(dot + 1) : item;
            return (
              <Tooltip key={item} title={`${concept}.${attr}`}>
                <Tag color="blue" className="mb-0.5">{attr}<span className="text-text-muted ml-1 text-xs">{concept}</span></Tag>
              </Tooltip>
            );
          })}
          {rest > 0 && <span className="text-accent-blue text-xs cursor-pointer ml-1" onClick={() => openTreeModal()}>+{rest}...</span>}
        </div>
      );
    }},
    { title: '输入参数', key: 'params', width: 200, render: (_: any, r: Function) => {
      if (isEditing(r) || isNewRow(r)) return <Button size="small" icon={<CodeOutlined />} onClick={() => setParamsEditorOpen(true)}>编辑</Button>;
      const raw = r.params || {};
      const items: { name: string; type: string; description: string; example: string }[] = [];
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') items.push({ name: k, type: v, description: '', example: '' });
        else if (typeof v === 'object' && v !== null) items.push({ name: k, type: (v as any).type || 'string', description: (v as any).description || '', example: (v as any).example || '' });
        else items.push({ name: k, type: String(v), description: '', example: '' });
      }
      return items.length > 0 ? items.map((p, i) => {
        const tip = [];
        if (p.description) tip.push(`描述: ${p.description}`);
        if (p.example) tip.push(`示例: ${p.example}`);
        const tag = <Tag key={i} color="blue" className="mb-0.5">{p.name}<span className="text-text-muted ml-1 text-xs">{p.type}</span></Tag>;
        return tip.length > 0 ? <Tooltip key={i} title={<div>{tip.map((t, j) => <div key={j}>{t}</div>)}</div>}>{tag}</Tooltip> : tag;
      }) : '-';
    }},
    { title: '返回结构', key: 'response', width: 200, render: (_: any, r: Function) => {
      if (isEditing(r) || isNewRow(r)) return <Button size="small" icon={<CodeOutlined />} onClick={() => setResponseEditorOpen(true)}>编辑</Button>;
      const raw = r.response || {};
      const items: { name: string; type: string; description: string; example: string }[] = [];
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') items.push({ name: k, type: v, description: '', example: '' });
        else if (typeof v === 'object' && v !== null) items.push({ name: k, type: (v as any).type || 'string', description: (v as any).description || '', example: (v as any).example || '' });
        else items.push({ name: k, type: String(v), description: '', example: '' });
      }
      return items.length > 0 ? items.map((p, i) => {
        const tip = [];
        if (p.description) tip.push(`描述: ${p.description}`);
        if (p.example) tip.push(`示例: ${p.example}`);
        const tag = <Tag key={i} color="green" className="mb-0.5">{p.name}<span className="text-text-muted ml-1 text-xs">{p.type}</span></Tag>;
        return tip.length > 0 ? <Tooltip key={i} title={<div>{tip.map((t, j) => <div key={j}>{t}</div>)}</div>}>{tag}</Tooltip> : tag;
      }) : '-';
    }},
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: Function) => {
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
        <h3 className="text-base font-semibold text-text-primary">函数管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增函数</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">定义可复用的属性计算函数以及输入输出</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Attribute Tree Selection Modal ───────────────────────────── */}
      <Modal
        title={`选择关联概念属性 - ${editData.display_name || editData.name || ''}`}
        open={treeModalOpen}
        onOk={confirmTreeSelection}
        onCancel={() => setTreeModalOpen(false)}
        okText="确认"
        cancelText="取消"
        width={640}
      >
        <div className="mb-3">
          <span className="text-text-muted text-xs">勾选需要关联的属性，格式为 概念名.属性名</span>
        </div>
        <div className="border border-dark-border rounded max-h-96 overflow-y-auto p-2">
          {treeData.length === 0 ? (
            <p className="text-text-muted text-sm p-4">暂无概念数据</p>
          ) : (
            <Tree
              checkable
              defaultExpandAll
              treeData={treeData}
              checkedKeys={treeCheckedKeys}
              onCheck={(checked) => setTreeCheckedKeys(checked as string[])}
              className="bg-transparent text-text-primary"
            />
          )}
        </div>
        {treeCheckedKeys.length > 0 && (
          <div className="mt-3 pt-2 border-t border-dark-border">
            <span className="text-text-muted text-xs mb-1 block">已选 ({treeCheckedKeys.length})：</span>
            <div className="flex flex-wrap gap-1">
              {treeCheckedKeys.map(k => <Tag key={k}>{k}</Tag>)}
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Params Editor Modal ───────────────────────────────────── */}
      <Modal title="编辑输入参数" open={paramsEditorOpen} onOk={() => { try { JSON.parse(editData.params || '{}'); setParamsError(''); setParamsEditorOpen(false); } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); } }} onCancel={() => setParamsEditorOpen(false)} okText="确认" cancelText="取消" width={600}>
        <Input.TextArea value={editData.params || '{}'} onChange={e => setEditData((p: any) => ({ ...p, params: e.target.value }))} rows={12} className="bg-dark-bg border-dark-border text-text-primary font-mono" />
        {paramsError && <p className="text-red-400 text-xs mt-1">{paramsError}</p>}
      </Modal>

      {/* ─── Response Editor Modal ─────────────────────────────────── */}
      <Modal title="编辑返回结构" open={responseEditorOpen} onOk={() => { try { JSON.parse(editData.response || '{}'); setResponseError(''); setResponseEditorOpen(false); } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); } }} onCancel={() => setResponseEditorOpen(false)} okText="确认" cancelText="取消" width={600}>
        <Input.TextArea value={editData.response || '{}'} onChange={e => setEditData((p: any) => ({ ...p, response: e.target.value }))} rows={12} className="bg-dark-bg border-dark-border text-text-primary font-mono" />
        {responseError && <p className="text-red-400 text-xs mt-1">{responseError}</p>}
      </Modal>
    </div>
  );
}
