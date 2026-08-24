'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Select, Space, Tag, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, CodeOutlined, PlayCircleOutlined, SendOutlined, RobotOutlined } from '@ant-design/icons';
import { getFunctions, createFunction, updateFunction, deleteFunction, getConcepts, getFunctionCode, saveFunctionCode, generateFunctionCode, executeFunction, getCommonFunctions, Function, Concept } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import PythonEditor from '@/components/PythonEditor';
import JsonEditor from '@/components/JsonEditor';

interface Props { ontologyId: number; activeTab?: string; }

export default function FunctionTable({ ontologyId, activeTab }: Props) {
  const [funcs, setFuncs] = useState<Function[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  // params editor
  const [paramsEditorOpen, setParamsEditorOpen] = useState(false);
  const [responseEditorOpen, setResponseEditorOpen] = useState(false);

  // code editor modal
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [codeStr, setCodeStr] = useState('');
  const [generating, setGenerating] = useState(false);

  // test modal
  const [testOpen, setTestOpen] = useState(false);
  const [testParams, setTestParams] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [fnList, conList, commonFnList] = await Promise.all([getFunctions(ontologyId), getConcepts(ontologyId), getCommonFunctions()]);
      const merged = [
        ...fnList.map((f: any) => ({ ...f, _source: 'ontology' })),
        ...commonFnList.map((f: any) => ({ ...f, related_concepts: [] as string[], params: f.inputSchema?.properties || {}, _source: 'common' })),
      ];
      setFuncs(merged); setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'functions') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Function) => record.name === editingKey;
  const isNewRow = (record: Function) => editingKey === '__new__' && record.name === '__new__';

  const conceptOptions = concepts.map(c => ({ label: c.display_name || c.name, value: c.name }));

  const handleAdd = () => {
    setEditData({ name: '', display_name: '', description: '', related_concepts: [], params: '{}', response: '{}', code_file: '' });
    setEditingKey('__new__');
  };

  const handleEdit = (g: Function) => {
    setEditData({ name: g.name, display_name: g.display_name || '', description: g.description || '', related_concepts: g.related_concepts || [], params: JSON.stringify(g.params || {}, null, 2), response: JSON.stringify(g.response || {}, null, 2), code_file: g.code_file || '' });
    setEditingKey(g.name);
  };

  const openCodeEditor = async () => {
    setCodeStr('');
    setCodeEditorOpen(true);
    if (editData.code_file) {
      try {
        const result = await getFunctionCode(ontologyId, editData.name);
        setCodeStr(result.content);
      } catch (e: any) { /* file may not exist yet */ }
    }
  };

  const handleGenerateCode = async () => {
    setGenerating(true);
    try {
      const result = await generateFunctionCode(ontologyId, editData.name);
      setCodeStr(result.code);
      setEditData((p: any) => ({ ...p, code_file: result.code_file }));
      message.success('代码已生成并保存到文件');
    } catch (e: any) { message.error('生成失败: ' + e.message); }
    finally { setGenerating(false); }
  };

  const saveCodeEditor = async () => {
    try {
      const result = await saveFunctionCode(ontologyId, editData.name, codeStr);
      setEditData((p: any) => ({ ...p, code_file: result.code_file }));
      setCodeEditorOpen(false);
      message.success('代码已保存');
    } catch (e: any) { message.error('保存失败: ' + e.message); }
  };

  // Extract example values from params schema for auto-fill
  const extractExample = (spec: any): any => {
    if (!spec || typeof spec !== 'object') return '';
    if (spec.example !== undefined) return spec.example;
    const t = spec.type || 'string';
    if (t === 'object' && spec.properties) {
      const obj: Record<string, any> = {};
      for (const [k, v] of Object.entries(spec.properties)) {
        obj[k] = extractExample(v);
      }
      return obj;
    }
    if (t === 'array') {
      if (spec.items?.type === 'object' && spec.items?.properties) {
        const item: Record<string, any> = {};
        for (const [k, v] of Object.entries(spec.items.properties)) {
          item[k] = extractExample(v);
        }
        return [item];
      }
      return [];
    }
    if (t === 'number' || t === 'boolean') return '';
    return '';
  };

  const openTestModal = () => {
    const params: Record<string, any> = {};
    const raw = JSON.parse(editData.params || '{}');
    for (const [k, v] of Object.entries(raw)) {
      params[k] = extractExample(v);
    }
    setTestParams(params);
    setTestResult(null);
    setTestOpen(true);
  };

  const handleTestExecute = async () => {
    setTestLoading(true);
    try {
      // Parse JSON strings back to actual objects/arrays
      const parsed: Record<string, any> = {};
      for (const [k, v] of Object.entries(testParams)) {
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
          try { parsed[k] = JSON.parse(v); } catch { parsed[k] = v; }
        } else {
          parsed[k] = v;
        }
      }
      const result = await executeFunction(ontologyId, editData.name, parsed);
      setTestResult(result.result);
    } catch (e: any) { setTestResult({ error: e.message }); }
    finally { setTestLoading(false); }
  };

  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Function) => {
    if (!editData.name?.trim()) { message.warning('请输入函数名称'); return; }
    let parsedParams: Record<string, unknown> = {};
    let parsedResponse: Record<string, unknown> = {};
    try { parsedParams = JSON.parse(editData.params || '{}'); }
    catch { message.warning('输入参数 JSON 格式错误'); return; }
    try { parsedResponse = JSON.parse(editData.response || '{}'); }
    catch { message.warning('返回结构 JSON 格式错误'); return; }
    try {
      const data: Function = {
        name: editData.name.trim(),
        display_name: editData.display_name?.trim() || '',
        description: editData.description?.trim() || '',
        related_concepts: editData.related_concepts || [],
        params: parsedParams,
        response: parsedResponse,
        code_file: editData.code_file || '',
      };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (funcs.some(g => g.name === data.name)) { message.warning('函数名称已存在'); return; }
        await createFunction(ontologyId, data); message.success('函数已添加');
      } else {
        await updateFunction(ontologyId, record.name, data); message.success('函数已更新');
      }
      setEditingKey(''); setEditData({}); await load();
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
    if (dataIndex === 'related_concepts') return <Select size="small" mode="multiple" placeholder="选" value={editData.related_concepts || []} onChange={setF('related_concepts')} options={conceptOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'params') return <Button size="small" icon={<CodeOutlined />} onClick={() => setParamsEditorOpen(true)}>编辑</Button>;
    if (dataIndex === 'response') return <Button size="small" icon={<CodeOutlined />} onClick={() => setResponseEditorOpen(true)}>编辑</Button>;
    if (dataIndex === 'code') return <Button size="small" icon={<CodeOutlined />} onClick={openCodeEditor}>编辑</Button>;
    return render ? render(val) : (val || '-');
  };

  const dataSource = funcs.map(g => ({ ...g, _key: g.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', description: '', related_concepts: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 100, render: (v: any, r: Function) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 120, render: (v: any, r: Function) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '计算逻辑', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: any, r: Function) => renderCell(v, r, 'description') },
    { title: '关联概念', dataIndex: 'related_concepts', key: 'related_concepts', width: 200, ellipsis: true, render: (v: any, r: Function) => renderCell(v, r, 'related_concepts', (list: string[]) => list?.map(name => concepts.find(c => c.name === name)?.display_name || name).join(',') || '-') },
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
    { title: '函数代码', dataIndex: 'code_file', key: 'code_file', width: 85, render: (v: any, r: any) => {
      if (isEditing(r) || isNewRow(r)) return renderCell(v, r, 'code');
      const hasCode = r._source === 'common' ? true : (r.code_file && r.code_file.length > 0);
      return <span className={`text-xs ${hasCode ? 'text-green-500' : 'text-text-muted'}`}>{hasCode ? '已编写' : '未编写'}</span>;
    }},
    { title: '来源', dataIndex: '_source', key: '_source', width: 55, render: (v: string) => (
      <span className={`text-xs ${v === 'common' ? 'text-accent-blue' : 'text-text-muted'}`}>{v === 'common' ? '公共' : '本体'}</span>
    )},
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: any, record: any) => {
        const isCommon = record._source === 'common';
        if (editingKey === record.name || isNewRow(record)) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return (
          <Space>
            {!isCommon && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />}
            {!isCommon && <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} />}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">函数管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增函数</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">定义可复用的属性计算函数（根据现有接口的输出做一些简单的计算或统计，不用单独开发新接口）</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Params Editor Modal ───────────────────────────────────── */}
      <Modal title="编辑输入参数" open={paramsEditorOpen} onOk={() => { try { JSON.parse(editData.params || '{}'); setParamsEditorOpen(false); } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); } }} onCancel={() => setParamsEditorOpen(false)} okText="确认" cancelText="取消" width={700}>
        <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 350 }}>
          <JsonEditor value={editData.params || '{}'} onChange={v => setEditData((p: any) => ({ ...p, params: v }))} />
        </div>
      </Modal>

      {/* ─── Response Editor Modal ─────────────────────────────────── */}
      <Modal title="编辑返回结构" open={responseEditorOpen} onOk={() => { try { JSON.parse(editData.response || '{}'); setResponseEditorOpen(false); } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); } }} onCancel={() => setResponseEditorOpen(false)} okText="确认" cancelText="取消" width={700}>
        <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 350 }}>
          <JsonEditor value={editData.response || '{}'} onChange={v => setEditData((p: any) => ({ ...p, response: v }))} />
        </div>
      </Modal>

      {/* ─── Code Editor Modal ─────────────────────────────────────── */}
      <Modal
        title={`函数代码编辑 - ${editData.display_name || editData.name || ''}`}
        open={codeEditorOpen}
        onOk={saveCodeEditor}
        onCancel={() => setCodeEditorOpen(false)}
        okText="保存"
        cancelText="取消"
        width={800}
      >
        <div className="flex justify-end mb-2 gap-2">
          <Button size="small" icon={<RobotOutlined />} loading={generating} onClick={handleGenerateCode}>智能生成</Button>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={openTestModal} disabled={!codeStr.trim()}>测试运行</Button>
        </div>
        <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 400 }}>
          <PythonEditor value={codeStr} onChange={setCodeStr} />
        </div>
      </Modal>

      {/* ─── Test Modal ────────────────────────────────────────────── */}
      <Modal
        title={`函数测试 - ${editData.display_name || editData.name || ''}`}
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        footer={null}
        width={700}
      >
        <div className="space-y-4">
          <div>
            <span className="text-text-muted text-xs mb-2 block">输入参数</span>
            {Object.keys(testParams).length === 0 ? (
              <p className="text-text-muted text-sm">该函数无需输入参数</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(testParams).map(([k, v]) => {
                  const isComplex = typeof v === 'object' || (typeof v === 'string' && (v.startsWith('{') || v.startsWith('[')));
                  const displayVal = typeof v === 'object' ? JSON.stringify(v, null, 2) : v as string;
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-28 text-text-secondary text-xs shrink-0">{k}</span>
                      {isComplex ? (
                        <Input.TextArea size="small" value={displayVal} onChange={e => setTestParams(p => ({...p, [k]: e.target.value}))} rows={4} className="flex-1 bg-dark-bg border-dark-border text-text-primary font-mono text-xs" />
                      ) : (
                        <Input size="small" value={displayVal} onChange={e => setTestParams(p => ({...p, [k]: e.target.value}))} className="flex-1 bg-dark-bg border-dark-border text-text-primary" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button type="primary" icon={<SendOutlined />} onClick={handleTestExecute} loading={testLoading} block>执行</Button>

          {testResult && (
            <div>
              <span className="text-text-muted text-xs mb-1 block">执行结果</span>
              <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                {testResult.error ? (
                  <span className="text-red-400">{testResult.error}</span>
                ) : (
                  <span className="text-accent-green">{JSON.stringify(testResult, null, 2)}</span>
                )}
              </pre>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
