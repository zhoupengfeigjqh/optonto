'use client';

import { useEffect, useState, useRef } from 'react';
import { Button, Input, Modal, message, Space, Tag } from 'antd';
import { RobotOutlined, PlayCircleOutlined, UploadOutlined, EyeOutlined } from '@ant-design/icons';
import { getDataEngines, createDataEngine, updateDataEngine, getBehaviors, getDbSchema, uploadDbSchema, generateSQL, callBehavior, DataEngine, Behavior } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

export default function DBMappingTable({ ontologyId, activeTab }: Props) {
  const [engines, setEngines] = useState<DataEngine[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // schema viewer
  const [schemaContent, setSchemaContent] = useState('');
  const [schemaOpen, setSchemaOpen] = useState(false);

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
      // Auto-create data engine for any behavior with behavior_type=SQL that has no engine yet
      for (const beh of behList) {
        if ((beh as any).behavior_type === 'SQL' && !sqlEngines.find(e => e.behavior_name === beh.name)) {
          const newEngine: DataEngine = {
            name: beh.name, behavior_name: beh.name, engine_type: 'SQL',
            target: { data_source_name: '', api_name: '', url: '', method: 'POST', params: {}, response: {} },
            input_mapping: {}, output_mapping: {},
          };
          try {
            const created = await createDataEngine(ontologyId, newEngine);
            sqlEngines.push(created);
          } catch { /* skip if already exists */ }
        }
      }
      setEngines(sqlEngines);
    } catch (e: any) { message.error('加载失败: ' + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'db-mapping') load(); }, [ontologyId, activeTab]);

  const handleUploadSchema = async (file: File) => {
    try {
      const result = await uploadDbSchema(ontologyId, file);
      message.success(result.message || 'Schema 已上传');
    } catch (e: any) { message.error('上传失败: ' + e.message); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleViewSchema = async () => {
    try {
      const result = await getDbSchema(ontologyId);
      setSchemaContent(result.content);
      setSchemaOpen(true);
    } catch (e: any) { message.error('加载失败: ' + e.message); }
  };

  const handleGenerateSQL = async (engine: DataEngine) => {
    try {
      const result = await generateSQL(ontologyId, engine.name);
      const updated = { ...engine, sql: result.sql };
      await updateDataEngine(ontologyId, engine.name, updated);
      setEngines(prev => prev.map(e => e.name === engine.name ? updated : e));
      message.success('SQL 已生成');
    } catch (e: any) { message.error('生成失败: ' + e.message); }
  };

  const handleSQLChange = async (engine: DataEngine, sql: string) => {
    const updated = { ...engine, sql };
    await updateDataEngine(ontologyId, engine.name, updated);
    setEngines(prev => prev.map(e => e.name === engine.name ? updated : e));
  };

  const openConnect = (engine: DataEngine) => {
    setConnectEngine(engine);
    setConnectResult(null);
    const params: Record<string, any> = {};
    const beh = engine; // engine has behavior info
    setConnectParams(params);
    setConnectOpen(true);
  };

  const executeConnect = async () => {
    if (!connectEngine) return;
    setConnectLoading(true);
    try {
      const result = await callBehavior(ontologyId, connectEngine.behavior_name, connectParams);
      setConnectResult(result);
    } catch (e: any) { setConnectResult({ error: e.message }); }
    finally { setConnectLoading(false); }
  };

  const dataSource = engines.map(e => ({ ...e, _key: e.name }));

  const columns = [
    { title: '本体行为', dataIndex: 'behavior_name', key: 'behavior_name', width: 160, render: (v: string) => <span className="text-text-primary">{v}</span> },
    { title: 'SQL', dataIndex: 'sql', key: 'sql', width: 400, render: (v: string, r: DataEngine) => (
      <Input.TextArea size="small" value={v || ''} onChange={e => handleSQLChange(r, e.target.value)} rows={2} className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs" />
    )},
    {
      title: '操作', key: 'actions', width: 140,
      render: (_: any, r: DataEngine) => (
        <Space>
          <Button type="link" size="small" icon={<RobotOutlined />} onClick={() => handleGenerateSQL(r)}>生成</Button>
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
        ) : (
          <p className="text-text-muted text-sm">尚未上传 Schema 文件</p>
        )}
      </Modal>

      {/* ─── Connect Test Modal ───────────────────────────────────────────── */}
      <Modal title={`SQL 测试 - ${connectEngine?.behavior_name || ''}`} open={connectOpen} onCancel={() => { setConnectOpen(false); setConnectResult(null); }} footer={null} width={600}>
        <div className="space-y-4">
          <div>
            <span className="text-text-muted text-xs mb-1 block">SQL</span>
            <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono whitespace-pre-wrap text-yellow-400">{connectEngine?.sql || ''}</pre>
          </div>
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
    </div>
  );
}
