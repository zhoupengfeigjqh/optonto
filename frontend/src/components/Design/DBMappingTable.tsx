'use client';

import { useEffect, useState, useRef } from 'react';
import { Button, Input, Modal, message, Space, Tag } from 'antd';
import { RobotOutlined, PlayCircleOutlined, UploadOutlined, EyeOutlined, CodeOutlined } from '@ant-design/icons';
import { getDataEngines, createDataEngine, updateDataEngine, getBehaviors, updateBehavior, getDbSchema, uploadDbSchema, generateSQL, callBehavior, DataEngine, Behavior } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import SqlEditor from '@/components/SqlEditor';

interface Props { ontologyId: number; activeTab?: string; }

export default function DBMappingTable({ ontologyId, activeTab }: Props) {
  const [engines, setEngines] = useState<DataEngine[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // schema viewer
  const [schemaContent, setSchemaContent] = useState('');
  const [schemaOpen, setSchemaOpen] = useState(false);

  // behavior edit modal
  const [behaviorEditOpen, setBehaviorEditOpen] = useState(false);
  const [behaviorEditName, setBehaviorEditName] = useState('');
  const [behaviorParamsStr, setBehaviorParamsStr] = useState('{}');
  const [behaviorResponseStr, setBehaviorResponseStr] = useState('{}');
  const [behaviorEditLoading, setBehaviorEditLoading] = useState(false);

  // SQL editor modal
  const [sqlEditorOpen, setSqlEditorOpen] = useState(false);
  const [sqlEditorEngine, setSqlEditorEngine] = useState<DataEngine | null>(null);
  const [sqlEditorText, setSqlEditorText] = useState('');
  const [sqlGenLoading, setSqlGenLoading] = useState(false);

  const openBehaviorEdit = (name: string) => {
    const beh = behaviors.find(b => b.name === name);
    if (!beh) return;
    setBehaviorEditName(name);
    setBehaviorParamsStr(JSON.stringify(beh.params || {}, null, 2));
    setBehaviorResponseStr(JSON.stringify(beh.response || {}, null, 2));
    setBehaviorEditOpen(true);
  };

  const saveBehaviorEdit = async () => {
    let parsedParams: Record<string, unknown> = {};
    let parsedResponse: Record<string, unknown> = {};
    try { parsedParams = JSON.parse(behaviorParamsStr); } catch { message.warning('参数 JSON 格式错误'); return; }
    try { parsedResponse = JSON.parse(behaviorResponseStr); } catch { message.warning('返回结构 JSON 格式错误'); return; }
    setBehaviorEditLoading(true);
    try {
      const beh = behaviors.find(b => b.name === behaviorEditName);
      if (!beh) { message.error('行为不存在'); return; }
      await updateBehavior(ontologyId, behaviorEditName, { ...beh, params: parsedParams, response: parsedResponse });
      message.success('行为参数已更新');
      setBehaviorEditOpen(false);
      await load();
    } catch (e: any) { message.error('保存失败: ' + e.message); }
    finally { setBehaviorEditLoading(false); }
  };

  // connect test
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectEngine, setConnectEngine] = useState<DataEngine | null>(null);
  const [connectParams, setConnectParams] = useState<Record<string, any>>({});
  const [connectResult, setConnectResult] = useState<any>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [engList, behList] = await Promise.all([getDataEngines(ontologyId), getBehaviors(ontologyId)]);
      let sqlEngines = engList.filter((e: DataEngine) => e.engine_type === 'SQL');
      for (const beh of behList) {
        if ((beh as any).behavior_type === 'SQL' && !sqlEngines.find(e => e.behavior_name === beh.name)) {
          const newEngine: DataEngine = {
            name: beh.name, behavior_name: beh.name, engine_type: 'SQL',
            target: { data_source_name: '', api_name: '', url: '', method: 'POST', params: {}, response: {} },
            input_mapping: {}, output_mapping: {},
          };
          try { const created = await createDataEngine(ontologyId, newEngine); sqlEngines.push(created); } catch { }
        }
      }
      setEngines(sqlEngines);
      setBehaviors(behList);
    } catch (e: any) { message.error('加载失败: ' + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'db-mapping') load(); }, [ontologyId, activeTab]);

  const handleUploadSchema = async (file: File) => {
    try { const result = await uploadDbSchema(ontologyId, file); message.success(result.message || 'Schema 已上传'); } catch (e: any) { message.error('上传失败: ' + e.message); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleViewSchema = async () => {
    try { const result = await getDbSchema(ontologyId); setSchemaContent(result.content); setSchemaOpen(true); } catch (e: any) { message.error('加载失败: ' + e.message); }
  };

  const openSqlEditor = (engine: DataEngine) => {
    setSqlEditorEngine(engine);
    setSqlEditorText(engine.sql || '');
    setSqlEditorOpen(true);
  };

  const saveSqlEditor = async () => {
    if (!sqlEditorEngine) return;
    const updated = { ...sqlEditorEngine, sql: sqlEditorText };
    await updateDataEngine(ontologyId, sqlEditorEngine.name, updated);
    setEngines(prev => prev.map(e => e.name === sqlEditorEngine.name ? updated : e));
    setSqlEditorOpen(false);
    message.success('SQL 已保存');
  };

  const handleGenerateSQL = async () => {
    if (!sqlEditorEngine) return;
    // Check schema
    const schema = await getDbSchema(ontologyId);
    if (!schema.exists) { message.warning('请先上传数据库 Schema 文件'); return; }
    // Check behavior has response params
    const beh = behaviors.find(b => b.name === sqlEditorEngine.behavior_name);
    if (!beh || !beh.response || Object.keys(beh.response).length === 0) {
      message.warning('请先配置本体行为的输入参数和返回结构'); return;
    }
    setSqlGenLoading(true);
    try {
      const result = await generateSQL(ontologyId, sqlEditorEngine.name);
      setSqlEditorText(result.sql);
      message.success('SQL 已生成');
    } catch (e: any) { message.error('生成失败: ' + e.message); }
    finally { setSqlGenLoading(false); }
  };

  const openConnect = (engine: DataEngine) => {
    setConnectEngine(engine);
    setConnectResult(null);
    const beh = behaviors.find(b => b.name === engine.behavior_name);
    const params: Record<string, any> = {};
    if (beh?.params) {
      for (const k of Object.keys(beh.params)) {
        params[k] = '';
      }
    }
    setConnectParams(params);
    setConnectOpen(true);
  };

  const executeConnect = async () => {
    if (!connectEngine) return;
    setConnectLoading(true);
    try { const result = await callBehavior(ontologyId, connectEngine.behavior_name, connectParams); setConnectResult(result); }
    catch (e: any) { setConnectResult({ error: e.message }); }
    finally { setConnectLoading(false); }
  };

  const dataSource = engines.map(e => ({ ...e, _key: e.name, _behavior: behaviors.find(b => b.name === e.behavior_name) }));

  const columns = [
    { title: '本体行为', dataIndex: 'behavior_name', key: 'behavior_name', width: 140, render: (v: string, r: any) => {
      const b = r._behavior;
      return <span className="cursor-pointer hover:text-accent-blue transition-colors" onClick={() => openBehaviorEdit(b?.name || v)}>{b?.display_name || v}</span>;
    }},
    { title: 'SQL代码', dataIndex: 'sql', key: 'sql', width: 90, render: (v: string, r: DataEngine) => (
      <div className="cursor-pointer hover:opacity-80" onClick={() => openSqlEditor(r)}>
        <span className={`text-xs ${v?.trim() ? 'text-green-500' : 'text-yellow-400/70'}`}>{v?.trim() ? '已编辑' : '未编辑'}</span>
      </div>
    )},
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: any, r: DataEngine) => (
        <Space>
          <Button type="link" size="small" icon={<PlayCircleOutlined />} onClick={() => openConnect(r)}>测试</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">DB 映射</h3>
        <Space>
          <input type="file" accept=".md" ref={fileInputRef} onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadSchema(f); }} style={{ display: 'none' }} />
          <Button size="small" icon={<EyeOutlined />} onClick={handleViewSchema}>查看Schema</Button>
          <Button size="small" icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>上传Schema</Button>
        </Space>
      </div>
      <p className="text-text-muted text-xs mb-3">管理 SQL 类型的数据映射，通过 LLM 生成 SQL 查询。</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Schema Viewer Modal ──────────────────────────────────────────── */}
      <Modal title="数据库 Schema" open={schemaOpen} onCancel={() => setSchemaOpen(false)} footer={null} width={700}>
        {schemaContent ? (
          <pre className="bg-dark-bg border border-dark-border rounded p-4 text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto text-text-primary">{schemaContent}</pre>
        ) : (<p className="text-text-muted text-sm">尚未上传 Schema 文件</p>)}
      </Modal>

      {/* ─── SQL Editor Modal ──────────────────────────────────────────────── */}
      <Modal
        title={`SQL 编辑 - ${sqlEditorEngine ? (behaviors.find(b => b.name === sqlEditorEngine.behavior_name)?.display_name || sqlEditorEngine.behavior_name) : ''}`}
        open={sqlEditorOpen}
        onOk={saveSqlEditor}
        onCancel={() => setSqlEditorOpen(false)}
        okText="保存"
        cancelText="取消"
        width={800}
        confirmLoading={sqlGenLoading}
      >
        <div className="flex justify-end mb-2">
          <Button size="small" icon={<RobotOutlined />} loading={sqlGenLoading} onClick={handleGenerateSQL}>智能生成</Button>
        </div>
        <div>
          <span className="text-text-muted text-xs mb-1 block">SQL 语句</span>
          <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 250 }}>
            <SqlEditor value={sqlEditorText} onChange={setSqlEditorText} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-text-muted text-xs mb-1 block">输入参数（SQL 占位符变量）</span>
          {sqlEditorEngine ? (
            (() => {
              const beh = behaviors.find(b => b.name === sqlEditorEngine.behavior_name);
              const params = beh?.params || {};
              const keys = Object.keys(params);
              return keys.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {keys.map(k => (
                    <Tag key={k} color="blue">:{k}</Tag>
                  ))}
                </div>
              ) : (
                <p className="text-text-muted text-xs">该行为没有定义输入参数</p>
              );
            })()
          ) : null}
        </div>
      </Modal>

      {/* ─── Connect Test Modal ───────────────────────────────────────────── */}
      <Modal title={`SQL 测试 - ${(() => { const b = behaviors.find(bh => bh.name === connectEngine?.behavior_name); return b?.display_name || connectEngine?.behavior_name || ''; })()}`} open={connectOpen} onCancel={() => { setConnectOpen(false); setConnectResult(null); }} footer={null} width={600}>
        <div className="space-y-4">
          {Object.keys(connectParams).length > 0 && (
            <div>
              <span className="text-text-muted text-xs mb-2 block">输入参数</span>
              <div className="space-y-1.5">
                {Object.entries(connectParams).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-24 text-text-secondary text-xs shrink-0">:{k}</span>
                    <Input size="small" value={v as string} onChange={e => setConnectParams(p => ({...p, [k]: e.target.value}))} className="flex-1 bg-dark-bg border-dark-border text-text-primary" placeholder="输入值" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={executeConnect} loading={connectLoading} block>执行</Button>
          {connectResult && (
            <div>
              <span className="text-text-muted text-xs mb-1 block">执行结果</span>
              <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                {connectResult.error ? <span className="text-red-400">{connectResult.error}</span> : <span className="text-accent-green">{JSON.stringify(connectResult, null, 2)}</span>}
              </pre>
            </div>
          )}
        </div>
      </Modal>

      {/* ─── Behavior Params/Response Edit Modal ────────────────────────── */}
      <Modal title={`编辑行为参数 - ${behaviors.find(b => b.name === behaviorEditName)?.display_name || behaviorEditName}`} open={behaviorEditOpen} onOk={saveBehaviorEdit} onCancel={() => setBehaviorEditOpen(false)} okText="保存" cancelText="取消" width={800} confirmLoading={behaviorEditLoading}>
        <div className="flex gap-3" style={{ minHeight: 320 }}>
          <div className="flex-1">
            <span className="text-text-muted text-xs mb-1 block">输入参数 (JSON)</span>
            <Input.TextArea value={behaviorParamsStr} onChange={e => setBehaviorParamsStr(e.target.value)} rows={16} className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs" />
          </div>
          <div className="flex-1">
            <span className="text-text-muted text-xs mb-1 block">返回结构 (JSON)</span>
            <Input.TextArea value={behaviorResponseStr} onChange={e => setBehaviorResponseStr(e.target.value)} rows={16} className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
