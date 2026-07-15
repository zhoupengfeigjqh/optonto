'use client';

import { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Switch, Select, Modal, message, Tag, Space, Descriptions } from 'antd';
import { PlayCircleOutlined, SendOutlined, ApiOutlined } from '@ant-design/icons';
import { getBehaviors, testBehaviorAPI, Behavior } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

interface ParamField {
  name: string;
  type: string;
  required: boolean;
  value: any;
}

export default function APITestTable({ ontologyId, activeTab }: Props) {
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(false);

  // Test modal
  const [testBehavior, setTestBehavior] = useState<Behavior | null>(null);
  const [testParams, setTestParams] = useState<ParamField[]>([]);
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await getBehaviors(ontologyId);
      setBehaviors(list.filter(b => b.url?.trim()));
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'api-test') load(); }, [ontologyId, activeTab]);

  const openTest = (b: Behavior) => {
    setTestBehavior(b);
    setTestResult(null);
    const raw = b.params || {};
    const fields: ParamField[] = [];
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        fields.push({ name: k, type: v, required: true, value: '' });
      } else if (typeof v === 'object' && v !== null) {
        const t = (v as any).type || 'string';
        const req = (v as any).required !== false;
        let def: any = '';
        if (t === 'object') def = '{}';
        else if (t === 'array' || t === 'array[object]') def = '[]';
        else if (t === 'boolean') def = false;
        fields.push({ name: k, type: t, required: req, value: def });
      }
    }
    setTestParams(fields);
  };

  const setParamValue = (idx: number, val: any) => {
    const n = [...testParams];
    n[idx] = { ...n[idx], value: val };
    setTestParams(n);
  };

  const buildRequestPreview = () => {
    if (!testBehavior) return '';
    const method = testBehavior.method || 'POST';
    const url = testBehavior.url || '';
    if (method === 'GET') {
      const qs = testParams
        .filter(p => p.value !== '' && p.value !== null && p.value !== undefined)
        .map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
        .join('&');
      return qs ? `${url}?${qs}` : url;
    }
    const body: Record<string, any> = {};
    testParams.forEach(p => {
      if (p.value !== '' && p.value !== null && p.value !== undefined) {
        if ((p.type === 'object' || p.type === 'array' || p.type === 'array[object]') && typeof p.value === 'string') {
          try { body[p.name] = JSON.parse(p.value); } catch { body[p.name] = p.value; }
        } else {
          body[p.name] = p.value;
        }
      }
    });
    return JSON.stringify(body, null, 2);
  };

  const executeTest = async () => {
    if (!testBehavior) return;
    // Validate required
    const missing = testParams.filter(p => p.required && (p.value === '' || p.value === null || p.value === undefined));
    if (missing.length > 0) {
      message.warning(`请填写必填参数: ${missing.map(p => p.name).join(', ')}`);
      return;
    }
    const params: Record<string, any> = {};
    testParams.forEach(p => {
      if (p.value !== '' && p.value !== null && p.value !== undefined) {
        if ((p.type === 'object' || p.type === 'array' || p.type === 'array[object]') && typeof p.value === 'string') {
          try { params[p.name] = JSON.parse(p.value); } catch { params[p.name] = p.value; }
        } else {
          params[p.name] = p.value;
        }
      }
    });
    setTestLoading(true);
    try {
      const result = await testBehaviorAPI(ontologyId, testBehavior.name, params);
      setTestResult(result);
    } catch (e: any) { setTestResult({ error: e.message }); }
    finally { setTestLoading(false); }
  };

  const renderParamInput = (p: ParamField, idx: number) => {
    if (p.type === 'boolean') {
      return <Switch checked={p.value} onChange={v => setParamValue(idx, v)} />;
    }
    if (p.type === 'object' || p.type === 'array' || p.type === 'array[object]') {
      return <Input.TextArea size="small" value={p.value || ''} onChange={e => setParamValue(idx, e.target.value)} rows={3} className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs" placeholder={p.required ? '必填' : '可选'} />;
    }
    if (p.type === 'int' || p.type === 'integer' || p.type === 'float') {
      return <InputNumber size="small" value={p.value || undefined} onChange={v => setParamValue(idx, v)} className="w-full bg-dark-bg border-dark-border text-text-primary" placeholder={p.required ? '必填' : '可选'} />;
    }
    return <Input size="small" value={p.value || ''} onChange={e => setParamValue(idx, e.target.value)} className="bg-dark-bg border-dark-border text-text-primary" placeholder={p.required ? '必填' : '可选'} />;
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 100 },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 100, render: (v: string) => v || '-' },
    { title: 'API接口', dataIndex: 'url', key: 'url', width: 200, ellipsis: true, render: (v: string) => <code className="text-accent-green text-xs">{v}</code> },
    { title: '方法', dataIndex: 'method', key: 'method', width: 65, render: (v: string) => <Tag color={v === 'GET' ? 'green' : 'blue'}>{v || 'POST'}</Tag> },
    { title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: string) => v || '-' },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: Behavior) => (
        <Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={() => openTest(record)}>测试</Button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">API单元测试</h3>
        <Button onClick={load} loading={loading} size="small">刷新</Button>
      </div>

      <ResizableTable dataSource={behaviors.map(b => ({ ...b, _key: b.name }))} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      <Modal
        title={testBehavior ? (
          <div className="flex items-center gap-2">
            <ApiOutlined />
            <span>{testBehavior.display_name || testBehavior.name}</span>
            <Tag color={testBehavior.method === 'GET' ? 'green' : 'blue'} className="ml-1">{testBehavior.method || 'POST'}</Tag>
            <code className="text-accent-green text-xs ml-1">{testBehavior.url}</code>
          </div>
        ) : 'API测试'}
        open={!!testBehavior}
        onCancel={() => { setTestBehavior(null); setTestResult(null); }}
        width={750}
        footer={null}
      >
        {testBehavior && (
          <div className="space-y-4">
            {/* Parameter form */}
            {testParams.length > 0 && (
              <div>
                <span className="text-text-muted text-xs mb-2 block">
                  {testBehavior.method === 'GET' ? '查询参数 (Query String)' : '请求参数 (Request Body)'}
                </span>
                <div className="space-y-1.5">
                  {testParams.map((p, idx) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <span className="w-28 text-text-secondary text-xs shrink-0">{p.name}</span>
                      <Tag className="w-12 text-center shrink-0" color="default">{p.type}</Tag>
                      <Tag className="w-10 text-center shrink-0" color={p.required ? 'red' : 'default'}>{p.required ? '必填' : '可选'}</Tag>
                      <div className="flex-1">{renderParamInput(p, idx)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            <div>
              <span className="text-text-muted text-xs mb-1 block">
                {testBehavior.method === 'GET' ? '请求 URL 预览' : '请求 Body 预览'}
              </span>
              <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs text-text-primary font-mono whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                {buildRequestPreview() || '(空)'}
              </pre>
            </div>

            {/* Execute button */}
            <Button type="primary" icon={<SendOutlined />} onClick={executeTest} loading={testLoading} block>
              发送请求
            </Button>

            {/* Response */}
            {testResult && (
              <div>
                <span className="text-text-muted text-xs mb-1 block">响应结果</span>
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
        )}
      </Modal>
    </div>
  );
}
