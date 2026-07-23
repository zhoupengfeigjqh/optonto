'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Tag } from 'antd';
import { EditOutlined, CodeOutlined, PlayCircleOutlined, SendOutlined } from '@ant-design/icons';
import { getDataEngines, createDataEngine, updateDataEngine, analyzeMapping, callBehavior, smartParseTarget, smartAlign, getBehaviors, updateBehavior, getMcpStatus, startMcp, stopMcp, getMcpTools, DataEngine, TargetApiConfig, Behavior } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import JsonEditor from '@/components/JsonEditor';

interface Props { ontologyId: number; activeTab?: string; }

// ─── helpers ─────────────────────────────────────────────────────────────────

function flattenFieldTypes(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      result[path] = v;
    } else if (typeof v === 'object' && v !== null) {
      const t = (v as any).type || 'string';
      result[path] = t;
      if (t === 'object' && (v as any).properties) {
        Object.assign(result, flattenFieldTypes((v as any).properties, path));
      } else if (t === 'array' && (v as any).items) {
        if ((v as any).items.type === 'object' && (v as any).items.properties) {
          Object.assign(result, flattenFieldTypes((v as any).items.properties, path + '[*]'));
        } else {
          result[path + '[*]'] = (v as any).items.type || 'string';
        }
      } else if (t === 'array[object]' && (v as any).items?.properties) {
        Object.assign(result, flattenFieldTypes((v as any).items.properties, path + '[*]'));
      }
    }
  }
  return result;
}

function flattenFields(obj: Record<string, unknown>, prefix = ''): string[] {
  const result: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      result.push(path);
    } else if (typeof v === 'object' && v !== null) {
      const t = (v as any).type || 'string';
      result.push(path);
      if (t === 'object' && (v as any).properties) {
        result.push(...flattenFields((v as any).properties, path));
      } else if (t === 'array' && (v as any).items) {
        if ((v as any).items.type === 'object' && (v as any).items.properties) {
          result.push(...flattenFields((v as any).items.properties, path + '[*]'));
        } else {
          result.push(path + '[*]');
        }
      } else if (t === 'array[object]' && (v as any).items?.properties) {
        result.push(...flattenFields((v as any).items.properties, path + '[*]'));
      }
    }
  }
  return result;
}

const emptyTarget: TargetApiConfig = {
  data_source_name: '', api_name: '', url: '', method: 'POST',
  params: {}, response: {},
};

function emptyEngine(behaviorName: string): DataEngine {
  return {
    name: behaviorName,
    display_name: '',
    behavior_name: behaviorName,
    target: { ...emptyTarget },
    input_mapping: {},
    output_mapping: {},
  };
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DataEngineTable({ ontologyId, activeTab }: Props) {
  const [engines, setEngines] = useState<DataEngine[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(false);

  // target config modal
  const [currentBehavior, setCurrentBehavior] = useState('');
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetData, setTargetData] = useState<TargetApiConfig>({ ...emptyTarget });
  const [targetParamsStr, setTargetParamsStr] = useState('{}');
  const [targetResponseStr, setTargetResponseStr] = useState('{}');
  const [targetParamsOpen, setTargetParamsOpen] = useState(false);
  const [targetResponseOpen, setTargetResponseOpen] = useState(false);

  // mapping modals
  const [inputMappingOpen, setInputMappingOpen] = useState(false);
  const [outputMappingOpen, setOutputMappingOpen] = useState(false);
  const [inputMapping, setInputMapping] = useState<Record<string, string>>({});
  const [outputMapping, setOutputMapping] = useState<Record<string, string>>({});
  const [mappingOntoFields, setMappingOntoFields] = useState<string[]>([]);
  const [mappingTargetFields, setMappingTargetFields] = useState<string[]>([]);
  const [ontoFieldTypes, setOntoFieldTypes] = useState<Record<string, string>>({});
  const [targetFieldTypes, setTargetFieldTypes] = useState<Record<string, string>>({});

  // analyze result
  const [analyzeResult, setAnalyzeResult] = useState<any>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  // data engine call
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectEngine, setConnectEngine] = useState<DataEngine | null>(null);
  const [connectParams, setConnectParams] = useState<Record<string, any>>({});
  const [connectRequired, setConnectRequired] = useState<Record<string, boolean>>({});
  const [connectResult, setConnectResult] = useState<any>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  // smart parse modal
  const [smartParseOpen, setSmartParseOpen] = useState(false);
  const [smartParseParamsContent, setSmartParseParamsContent] = useState('');
  const [smartParseResponseContent, setSmartParseResponseContent] = useState('');
  const [smartParseLoading, setSmartParseLoading] = useState(false);

  // smart align modal
  const [smartAlignOpen, setSmartAlignOpen] = useState(false);
  const [smartAlignBehaviorName, setSmartAlignBehaviorName] = useState('');
  const [smartAlignLoading, setSmartAlignLoading] = useState(false);

  // mcp status & control
  const [mcpRunning, setMcpRunning] = useState(false);
  const [mcpChecking, setMcpChecking] = useState(true);
  const [mcpToggling, setMcpToggling] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpTools, setMcpTools] = useState<{ name: string; description: string; inputSchema?: any }[]>([]);
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false);
  const [mcpSelectedTool, setMcpSelectedTool] = useState<string | null>(null);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const mcpConfigJson = JSON.stringify({
    mcpServers: {
      'optonto-api': {
        type: 'url',
        url: `http://${host}:8002/sse`,
      },
    },
  }, null, 2);

  const checkMcpStatus = useCallback(async () => {
    setMcpChecking(true);
    try {
      const s = await getMcpStatus();
      setMcpRunning(s.running);
    } catch { setMcpRunning(false); }
    finally { setMcpChecking(false); }
  }, []);

  useEffect(() => { checkMcpStatus(); }, [checkMcpStatus]);

  const handleMcpToggle = async () => {
    setMcpToggling(true);
    try {
      const r = mcpRunning ? await stopMcp() : await startMcp();
      message.success(r.message);
      setMcpRunning(r.running);
    } catch (e: any) { message.error(e.message); }
    finally { setMcpToggling(false); }
  };

  // smart mapping confirm modal
  const [smartMappingOpen, setSmartMappingOpen] = useState(false);
  const [smartMappingBehaviorName, setSmartMappingBehaviorName] = useState('');
  const [smartMappingLoading, setSmartMappingLoading] = useState(false);

  // behavior params/response edit modal
  const [behaviorEditOpen, setBehaviorEditOpen] = useState(false);
  const [behaviorEditName, setBehaviorEditName] = useState('');
  const [behaviorParamsStr, setBehaviorParamsStr] = useState('{}');
  const [behaviorResponseStr, setBehaviorResponseStr] = useState('{}');
  const [behaviorEditLoading, setBehaviorEditLoading] = useState(false);

  // copy behavior params to target confirm modal
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [eng, beh] = await Promise.all([getDataEngines(ontologyId), getBehaviors(ontologyId)]);
      setEngines(eng); setBehaviors(beh);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'data-engines') load(); }, [ontologyId, activeTab]);

  const getEngine = (behaviorName: string): DataEngine =>
    engines.find(e => e.behavior_name === behaviorName) || emptyEngine(behaviorName);

  // Ensure saved engine exists before operating; create if not
  const ensureEngine = async (behaviorName: string): Promise<DataEngine> => {
    const existing = engines.find(e => e.behavior_name === behaviorName);
    if (existing) return existing;
    const de = emptyEngine(behaviorName);
    await createDataEngine(ontologyId, de);
    setEngines(prev => [...prev, de]);
    return de;
  };

  // ─── target config ───────────────────────────────────────────────────────

  const openTargetConfig = (behaviorName: string) => {
    setCurrentBehavior(behaviorName);
    const de = getEngine(behaviorName);
    const t = de.target || { ...emptyTarget };
    setTargetData({ ...t });
    setTargetParamsStr(JSON.stringify(t.params || {}, null, 2));
    setTargetResponseStr(JSON.stringify(t.response || {}, null, 2));
    setTargetOpen(true);
  };

  const saveTargetConfig = async () => {
    try {
      const params = JSON.parse(targetParamsStr);
      const response = JSON.parse(targetResponseStr);
      let de = await ensureEngine(currentBehavior);
      const updated = { ...de, target: { ...targetData, params, response } };
      await updateDataEngine(ontologyId, de.name, updated);
      setEngines(prev => prev.map(e => e.behavior_name === currentBehavior ? updated : e));
      message.success('目标接口已保存');
      setTargetOpen(false);
    } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); }
  };

  const handleSmartParse = async () => {
    if (!smartParseParamsContent.trim() || !smartParseResponseContent.trim()) {
      message.warning('输入参数和输出结构都必须填写，否则无法解析');
      return;
    }
    setSmartParseLoading(true);
    try {
      const de = await ensureEngine(currentBehavior);
      const result = await smartParseTarget(ontologyId, de.name, smartParseParamsContent, smartParseResponseContent);
      if (result.params && Object.keys(result.params).length > 0) {
        setTargetParamsStr(JSON.stringify(result.params, null, 2));
      }
      if (result.response && Object.keys(result.response).length > 0) {
        setTargetResponseStr(JSON.stringify(result.response, null, 2));
      }
      if (result.api_name) setTargetData(p => ({ ...p, api_name: result.api_name }));
      if (result.data_source_name) setTargetData(p => ({ ...p, data_source_name: result.data_source_name }));
      if (result.method) setTargetData(p => ({ ...p, method: result.method }));
      if (result.url) setTargetData(p => ({ ...p, url: result.url }));
      message.success('智能解析完成，请确认结果');
      setSmartParseOpen(false);
    } catch (e: any) { message.error('智能解析失败: ' + e.message); }
    finally { setSmartParseLoading(false); }
  };

  const handleSmartMappingConfirm = async () => {
    const behaviorName = smartMappingBehaviorName;
    setSmartMappingLoading(true);
    try {
      const de = await ensureEngine(behaviorName);
      const beh = behaviors.find(b => b.name === behaviorName);
      const body = {
        onto_input_fields: flattenFields((beh?.params as Record<string, unknown>) || {}),
        target_input_fields: flattenFields(de.target?.params || {}),
        onto_output_fields: flattenFields((beh?.response as Record<string, unknown>) || {}),
        target_output_fields: flattenFields(de.target?.response || {}),
      };
      const result = await analyzeMapping(ontologyId, de.name, body);
      setAnalyzeResult(result);
      setSmartMappingOpen(false);
      setAnalyzeOpen(true);
      await load();
    } catch (e: any) {
      setAnalyzeResult({ status: 'error', message: e.message, issues: [] });
      setSmartMappingOpen(false);
      setAnalyzeOpen(true);
    } finally {
      setSmartMappingLoading(false);
    }
  };

  const handleSmartAlign = async () => {
    setSmartAlignLoading(true);
    try {
      const de = await ensureEngine(smartAlignBehaviorName);
      await smartAlign(ontologyId, de.name);
      message.success('智能对齐完成，请检查结果');
      setSmartAlignOpen(false);
      await load();
    } catch (e: any) { message.error('智能对齐失败: ' + e.message); }
    finally { setSmartAlignLoading(false); }
  };

  // ─── behavior edit ──────────────────────────────────────────────────────

  const openBehaviorEdit = (behaviorName: string) => {
    const beh = behaviors.find(b => b.name === behaviorName);
    if (!beh) return;
    setBehaviorEditName(behaviorName);
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
      message.success('行为数据已更新');
      setBehaviorEditOpen(false);
      await load();
    } catch (e: any) { message.error('保存失败: ' + e.message); }
    finally { setBehaviorEditLoading(false); }
  };

  // ─── mapping ─────────────────────────────────────────────────────────────

  const openInputMapping = async (behaviorName: string) => {
    setCurrentBehavior(behaviorName);
    const beh = behaviors.find(b => b.name === behaviorName);
    const de = await ensureEngine(behaviorName);
    const ontoParams = (beh?.params as Record<string, unknown>) || {};
    const tgtParams = de.target?.params || {};
    setMappingOntoFields(flattenFields(ontoParams));
    setMappingTargetFields(flattenFields(tgtParams));
    setOntoFieldTypes(flattenFieldTypes(ontoParams));
    setTargetFieldTypes(flattenFieldTypes(tgtParams));
    setInputMapping(de.input_mapping || {});
    setInputMappingOpen(true);
  };

  const openOutputMapping = async (behaviorName: string) => {
    setCurrentBehavior(behaviorName);
    const beh = behaviors.find(b => b.name === behaviorName);
    const de = await ensureEngine(behaviorName);
    const ontoResp = (beh?.response as Record<string, unknown>) || {};
    const tgtResp = de.target?.response || {};
    setMappingOntoFields(flattenFields(ontoResp));
    setMappingTargetFields(flattenFields(tgtResp));
    setOntoFieldTypes(flattenFieldTypes(ontoResp));
    setTargetFieldTypes(flattenFieldTypes(tgtResp));
    setOutputMapping(de.output_mapping || {});
    setOutputMappingOpen(true);
  };

  const saveMapping = async (type: 'input' | 'output') => {
    const de = engines.find(e => e.behavior_name === currentBehavior) || emptyEngine(currentBehavior);
    const updated = { ...de };
    if (type === 'input') { updated.input_mapping = { ...inputMapping }; setInputMappingOpen(false); }
    else { updated.output_mapping = { ...outputMapping }; setOutputMappingOpen(false); }
    // Ensure it exists in backend
    const existing = engines.find(e => e.behavior_name === currentBehavior);
    if (existing) {
      await updateDataEngine(ontologyId, de.name, updated);
    } else {
      await createDataEngine(ontologyId, updated);
    }
    setEngines(prev => {
      const idx = prev.findIndex(e => e.behavior_name === currentBehavior);
      if (idx >= 0) return prev.map((e, i) => i === idx ? updated : e);
      return [...prev, updated];
    });
    message.success('映射已保存');
  };

  const getBehaviorDisplay = (behaviorName: string) => {
    const b = behaviors.find(be => be.name === behaviorName);
    return b ? (b.display_name || b.name) : behaviorName;
  };

  const getParamDisplay = (behaviorName: string, paramKey: string) => {
    const b = behaviors.find(be => be.name === behaviorName);
    if (!b) return paramKey;
    const paramDef = (b.params as Record<string, any>)?.[paramKey];
    if (paramDef && typeof paramDef === 'object' && paramDef.display_name) {
      return paramDef.display_name;
    }
    return paramKey;
  };

  // ─── data engine call ────────────────────────────────────────────────────

  const openConnect = async (behaviorName: string) => {
    const de = await ensureEngine(behaviorName);
    setConnectEngine(de);
    setConnectResult(null);
    const beh = behaviors.find(b => b.name === behaviorName);
    const ontoParams = beh?.params || {};
    const targetParams = de.target?.params || {};
    const mapping = de.input_mapping || {};
    const required: Record<string, boolean> = {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(ontoParams)) {
      const targetKey = mapping[k] || k;
      const targetSpec = targetParams[targetKey];
      if (targetSpec && typeof targetSpec === 'object') {
        required[k] = (targetSpec as any).required !== false;
      }
      if (typeof v === 'string') params[k] = '';
      else if (typeof v === 'object' && v !== null) {
        const t = (v as any).type || 'string';
        if (t === 'object') params[k] = '{}';
        else if (t === 'array' || t === 'array[object]') params[k] = '[]';
        else if (t === 'boolean') params[k] = false;
        else params[k] = '';
      }
    }
    setConnectParams(params);
    setConnectRequired(required);
    setConnectOpen(true);
  };

  const executeConnect = async () => {
    if (!connectEngine) return;
    const parsed: Record<string, any> = {};
    for (const [k, v] of Object.entries(connectParams)) {
      if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
        try { parsed[k] = JSON.parse(v); } catch { parsed[k] = v; }
      } else { parsed[k] = v; }
    }
    setConnectLoading(true);
    try {
      const result = await callBehavior(ontologyId, connectEngine.behavior_name, parsed);
      setConnectResult(result);
    } catch (e: any) { setConnectResult({ error: e.message }); }
    finally { setConnectLoading(false); }
  };

  // ─── render ──────────────────────────────────────────────────────────────

  const dataSource = behaviors.filter(b => !(b as any).behavior_type || (b as any).behavior_type === 'API').map(b => {
    const de = getEngine(b.name);
    return { ...de, _key: b.name, _behavior: b };
  });

  const columns = [
    { title: '本体行为', dataIndex: 'behavior_name', key: 'behavior_name', width: 160, render: (_: any, r: any) => {
      const b = r._behavior as Behavior;
      return <span className="cursor-pointer hover:text-accent-blue transition-colors" onClick={() => openBehaviorEdit(b.name)}>{b.display_name || b.name}</span>;
    }},
    { title: '目标接口设置', key: 'target', width: 100, render: (_: any, r: any) => {
      const de = getEngine(r._behavior.name);
      const hasConfig = de.target?.url || de.target?.api_name || de.target?.data_source_name;
      return <Button size="small" icon={<EditOutlined />} onClick={() => openTargetConfig(r._behavior.name)}>{hasConfig ? '已设置' : '编辑'}</Button>;
    }},
    { title: '输入映射', key: 'input_mapping', width: 80, render: (_: any, r: any) => {
      const de = getEngine(r._behavior.name);
      const count = Object.values(de.input_mapping || {}).filter(v => v).length;
      return <Button size="small" icon={<EditOutlined />} onClick={() => openInputMapping(r._behavior.name)}>{count > 0 ? `已映射${count}` : '编辑'}</Button>;
    }},
    { title: '输出映射', key: 'output_mapping', width: 80, render: (_: any, r: any) => {
      const de = getEngine(r._behavior.name);
      const count = Object.values(de.output_mapping || {}).filter(v => v).length;
      return <Button size="small" icon={<EditOutlined />} onClick={() => openOutputMapping(r._behavior.name)}>{count > 0 ? `已映射${count}` : '编辑'}</Button>;
    }},
    {
      title: '操作', key: 'actions', width: 220,
      render: (_: any, r: any) => {
        const de = getEngine(r._behavior.name);
        const hasTarget = !!(de.target?.params && Object.keys(de.target.params).length > 0) || !!(de.target?.response && Object.keys(de.target.response).length > 0);
        return (
        <div className="flex gap-1 items-center">
          <Button type="link" size="small" disabled={!hasTarget} style={{ color: hasTarget ? undefined : '#64748b' }} onClick={() => { setSmartAlignBehaviorName(r._behavior.name); setSmartAlignOpen(true); }}>智能对齐</Button>
          <Button type="link" size="small" disabled={!hasTarget} style={{ color: hasTarget ? undefined : '#64748b' }} onClick={() => { setSmartMappingBehaviorName(r._behavior.name); setSmartMappingOpen(true); }}>智能映射</Button>
          <Button type="link" size="small" icon={<PlayCircleOutlined />} onClick={() => openConnect(r._behavior.name)}>连接测试</Button>
        </div>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">API映射</h3>
          <p className="text-text-muted text-xs mt-0.5">管理 API 类型的数据映射，配置目标接口和字段映射关系。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs bg-dark-card border border-dark-border rounded px-3 py-1.5 cursor-pointer hover:bg-dark-hover" onClick={async () => { setMcpModalOpen(true); try { const tools = await getMcpTools(host); setMcpTools(tools); } catch { setMcpTools([]); } }} title="点击查看 MCP 配置">
            <span className={`w-2 h-2 rounded-full ${mcpChecking ? 'bg-gray-500' : mcpRunning ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-text-muted">MCP</span>
            <span className={mcpRunning ? 'text-green-400' : 'text-text-muted'}>
              {mcpChecking ? '...' : mcpRunning ? '运行中' : '已停止'}
            </span>
          </div>
          <Button size="small" loading={mcpToggling} onClick={handleMcpToggle}>
            {mcpRunning ? '停止' : '启动'}
          </Button>
          <Button onClick={load} loading={loading} size="small">刷新</Button>
        </div>
      </div>

      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Target Config Modal ──────────────────────────────────────────── */}
      <Modal title={`目标接口设置 - ${getBehaviorDisplay(currentBehavior)}`} open={targetOpen} onOk={saveTargetConfig} onCancel={() => setTargetOpen(false)} okText="保存" cancelText="取消" width={700}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <span className="text-text-muted text-xs">数据源名称</span>
              <Input value={targetData.data_source_name} onChange={e => setTargetData(p => ({...p, data_source_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />
            </div>
            <div className="flex-1">
              <span className="text-text-muted text-xs">接口名称</span>
              <Input value={targetData.api_name} onChange={e => setTargetData(p => ({...p, api_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <span className="text-text-muted text-xs">目标API接口地址</span>
              <Input value={targetData.url} onChange={e => setTargetData(p => ({...p, url: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="https://" />
            </div>
            <div style={{width:100}}>
              <span className="text-text-muted text-xs">方法</span>
              <Select value={targetData.method} onChange={v => setTargetData(p => ({...p, method: v}))} options={[{label:'GET',value:'GET'},{label:'POST',value:'POST'},{label:'PATCH',value:'PATCH'},{label:'DELETE',value:'DELETE'}]} style={{width:'100%'}} popupClassName="!bg-dark-card" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-muted text-xs">输入参数 / 输出结构</span>
            <Button size="small" icon={<CodeOutlined />} onClick={() => setTargetParamsOpen(true)}>编辑输入</Button>
            <Button size="small" icon={<CodeOutlined />} onClick={() => setTargetResponseOpen(true)}>编辑输出</Button>
            <Button size="small" onClick={() => { setSmartParseParamsContent(''); setSmartParseResponseContent(''); setSmartParseOpen(true); }}><span style={{ color: '#f59e0b' }}>智能解析</span></Button>
            <Button size="small" onClick={() => setCopyConfirmOpen(true)}><span style={{ color: '#ef4444' }}>复制本体行为参数</span></Button>
          </div>
        </div>

        <Modal title="编辑输入参数" open={targetParamsOpen} onOk={() => setTargetParamsOpen(false)} onCancel={() => setTargetParamsOpen(false)} okText="确认" cancelText="取消" width={700}>
          <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 350 }}>
            <JsonEditor value={targetParamsStr} onChange={setTargetParamsStr} />
          </div>
        </Modal>
        <Modal title="编辑输出结构" open={targetResponseOpen} onOk={() => setTargetResponseOpen(false)} onCancel={() => setTargetResponseOpen(false)} okText="确认" cancelText="取消" width={700}>
          <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 350 }}>
            <JsonEditor value={targetResponseStr} onChange={setTargetResponseStr} />
          </div>
        </Modal>

        {/* ─── Smart Parse Modal ──────────────────────────────────────────── */}
        <Modal title="智能解析" open={smartParseOpen} onOk={handleSmartParse} onCancel={() => setSmartParseOpen(false)} okText="开始解析" cancelText="取消" width={900} confirmLoading={smartParseLoading}>
          <p className="text-text-muted text-xs mb-3">粘贴目标接口的输入参数和输出结构文档（两栏均需填写），AI 将自动解析为标准格式</p>
          <div className="flex gap-3" style={{ minHeight: 320 }}>
            <div className="flex-1">
              <span className="text-text-muted text-xs mb-1 block">输入参数</span>
              <Input.TextArea
                value={smartParseParamsContent}
                onChange={e => setSmartParseParamsContent(e.target.value)}
                rows={14}
                className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs"
                placeholder={`可复制粘贴需求或接口文档里API请求参数，样例：

字段名  类型  必填  说明  示例
tradeId  String  是  交易ID  "TRD001"
amount  Number  是  交易金额  10000.00
status  String  否  状态  "active"`}
              />
            </div>
            <div className="flex-1">
              <span className="text-text-muted text-xs mb-1 block">输出结构</span>
              <Input.TextArea
                value={smartParseResponseContent}
                onChange={e => setSmartParseResponseContent(e.target.value)}
                rows={14}
                className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs"
                placeholder={`可复制粘贴需求或接口文档里返回结果，样例：

字段名  类型  说明  示例
code  Number  状态码  0
data  Object  返回数据  {"orderId":"ORD001"}
orderId  String  订单ID  "ORD001"
total  Number  订单总价  15000.50`}
              />
            </div>
          </div>
        </Modal>

        {/* ─── Copy Behavior Params Confirm Modal ─────────────────────────── */}
        <Modal
          title="复制本体行为参数"
          open={copyConfirmOpen}
          onOk={() => {
            const beh = behaviors.find(b => b.name === currentBehavior);
            if (beh) {
              setTargetParamsStr(JSON.stringify(beh.params || {}, null, 2));
              setTargetResponseStr(JSON.stringify(beh.response || {}, null, 2));
              message.success('已将本体行为参数复制到目标接口');
            }
            setCopyConfirmOpen(false);
          }}
          onCancel={() => setCopyConfirmOpen(false)}
          okText="确认复制"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          width={500}
        >
          <p className="text-text-primary text-sm">
            ⚠ <span className="text-red-400">注意：</span>将本体行为参数拷贝为目标接API口参数，此时需要用户按照本体参数设计目标API接口（即外部业务系统接口）。
          </p>
          <p className="text-text-muted text-xs mt-3">请问是否复制？</p>
        </Modal>
      </Modal>

      {/* ─── Input Mapping Modal ──────────────────────────────────────────── */}
      <Modal title={`输入映射 - ${getBehaviorDisplay(currentBehavior)}`} open={inputMappingOpen} onOk={() => saveMapping('input')} onCancel={() => setInputMappingOpen(false)} okText="保存" cancelText="取消" width={700}>
        {mappingOntoFields.length === 0 && <p className="text-text-muted text-sm">本体行为未定义输入参数</p>}
        {mappingOntoFields.length > 0 && (
          <div className="flex items-center gap-3 pb-1 border-b border-dark-border mb-1">
            <span className="w-1/2 text-text-muted text-xs font-semibold">本体字段</span>
            <span className="w-1/2 text-text-muted text-xs font-semibold">目标字段</span>
          </div>
        )}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {mappingOntoFields.map(field => {
            const ontoType = ontoFieldTypes[field] || '';
            const targetVal = inputMapping[field] || '';
            const targetType = targetVal ? targetFieldTypes[targetVal] || '' : '';
            const typeMismatch = !!(targetVal && ontoType && targetType && ontoType !== targetType);
            return (
              <div key={field} className="flex items-center gap-3">
                <span className={`w-1/2 text-xs bg-dark-bg rounded px-2 py-1 font-mono ${typeMismatch ? 'text-yellow-400' : 'text-text-secondary'}`}>
                  {field}<span className="text-text-muted ml-1">({ontoType})</span>
                </span>
                <Select size="small" allowClear placeholder="选择目标参数" value={inputMapping[field] || undefined} onChange={v => setInputMapping(p => ({...p, [field]: v || ''}))} options={mappingTargetFields.map(f => ({ label: `${f}(${targetFieldTypes[f] || '?'})`, value: f }))} style={{width:'50%'}} popupClassName="!bg-dark-card" />
              </div>
            );
          })}
        </div>
        {mappingTargetFields.filter(f => !Object.values(inputMapping).includes(f)).length > 0 && (
          <div className="mt-3 pt-2 border-t border-dark-border">
            <span className="text-yellow-400 text-xs font-semibold">⚠ 以下目标字段在本体中没有对应的输入映射：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {mappingTargetFields.filter(f => !Object.values(inputMapping).includes(f)).map(f => (
                <Tag key={f} color="orange">{f}<span className="text-text-muted ml-1 text-xs">({targetFieldTypes[f] || '?'})</span></Tag>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Output Mapping Modal ─────────────────────────────────────────── */}
      <Modal title={`输出映射 - ${getBehaviorDisplay(currentBehavior)}`} open={outputMappingOpen} onOk={() => saveMapping('output')} onCancel={() => setOutputMappingOpen(false)} okText="保存" cancelText="取消" width={700}>
        {mappingOntoFields.length === 0 && <p className="text-text-muted text-sm">本体行为未定义返回结构</p>}
        {mappingOntoFields.length > 0 && (
          <div className="flex items-center gap-3 pb-1 border-b border-dark-border mb-1">
            <span className="w-1/2 text-text-muted text-xs font-semibold">本体字段</span>
            <span className="w-1/2 text-text-muted text-xs font-semibold">目标字段</span>
          </div>
        )}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {mappingOntoFields.map(field => {
            const ontoType = ontoFieldTypes[field] || '';
            const targetVal = outputMapping[field] || '';
            const targetType = targetVal ? targetFieldTypes[targetVal] || '' : '';
            const typeMismatch = !!(targetVal && ontoType && targetType && ontoType !== targetType);
            return (
              <div key={field} className="flex items-center gap-3">
                <span className={`w-1/2 text-xs bg-dark-bg rounded px-2 py-1 font-mono ${typeMismatch ? 'text-yellow-400' : 'text-text-secondary'}`}>
                  {field}<span className="text-text-muted ml-1">({ontoType})</span>
                </span>
                <Select size="small" allowClear placeholder="选择目标字段" value={outputMapping[field] || undefined} onChange={v => setOutputMapping(p => ({...p, [field]: v || ''}))} options={mappingTargetFields.map(f => ({ label: `${f}(${targetFieldTypes[f] || '?'})`, value: f }))} style={{width:'50%'}} popupClassName="!bg-dark-card" />
              </div>
            );
          })}
        </div>
        {mappingTargetFields.filter(f => !Object.values(outputMapping).includes(f)).length > 0 && (
          <div className="mt-3 pt-2 border-t border-dark-border">
            <span className="text-yellow-400 text-xs font-semibold">⚠ 以下目标字段在本体中没有对应的输出映射：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {mappingTargetFields.filter(f => !Object.values(outputMapping).includes(f)).map(f => (
                <Tag key={f} color="orange">{f}<span className="text-text-muted ml-1 text-xs">({targetFieldTypes[f] || '?'})</span></Tag>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Analyze Result Modal ─────────────────────────────────────────── */}
      <Modal title={`智能映射-${getBehaviorDisplay(smartMappingBehaviorName)}`} open={analyzeOpen} onCancel={() => { setAnalyzeOpen(false); setAnalyzeResult(null); }} footer={null} width={600}>
        {analyzeResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-sm">状态：</span>
              <Tag color={analyzeResult.status === 'ok' ? 'green' : analyzeResult.status === 'warning' ? 'orange' : 'red'}>
                {analyzeResult.status === 'ok' ? '可映射' : analyzeResult.status === 'warning' ? '需注意' : '不可映射'}
              </Tag>
            </div>
            <div>
              <span className="text-text-muted text-sm">分析结论：</span>
              <p className="text-text-primary text-sm mt-1">{analyzeResult.message}</p>
            </div>
            {analyzeResult.issues?.length > 0 && (
              <div>
                <span className="text-text-muted text-sm">问题：</span>
                <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                  {analyzeResult.issues.map((issue: string, i: number) => (
                    <li key={i} className={analyzeResult.status === 'error' ? 'text-red-400' : 'text-yellow-400'}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ─── Data Engine Call Modal ───────────────────────────────────────── */}
      <Modal
        title={connectEngine ? `连接测试 - ${getBehaviorDisplay(connectEngine.behavior_name)}` : '连接测试'}
        open={connectOpen} onCancel={() => { setConnectOpen(false); setConnectResult(null); }} width={700} footer={null}
      >
        {connectEngine && (
          <div className="space-y-4">
            <div>
              <span className="text-text-muted text-xs">目标接口：</span>
              <code className="text-accent-green text-xs ml-1">{connectEngine.target?.method || 'POST'} {connectEngine.target?.url || '(未配置)'}</code>
            </div>
            {Object.keys(connectParams).length > 0 && (
              <div>
                <span className="text-text-muted text-xs mb-2 block">请求参数</span>
                <div className="space-y-1.5">
                  {Object.entries(connectParams).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-28 text-text-secondary text-xs shrink-0">{connectRequired[k] && <span className="text-red-400 mr-0.5">*</span>}{getParamDisplay(connectEngine?.behavior_name || '', k)}</span>
                      {typeof v === 'boolean' ? null : typeof v === 'string' && (v.startsWith('{') || v.startsWith('[')) ? (
                        <Input.TextArea size="small" value={v} onChange={e => setConnectParams(p => ({...p, [k]: e.target.value}))} rows={3} className="flex-1 bg-dark-bg border-dark-border text-text-primary font-mono text-xs" />
                      ) : (
                        <Input size="small" value={v as string} onChange={e => setConnectParams(p => ({...p, [k]: e.target.value}))} className="flex-1 bg-dark-bg border-dark-border text-text-primary" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button type="primary" icon={<SendOutlined />} onClick={executeConnect} loading={connectLoading} block>发送请求</Button>

            {connectResult && (
              <div>
                <span className="text-text-muted text-xs mb-1 block">响应结果</span>
                <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {connectResult.error ? (
                    <span className="text-red-400">{connectResult.error}</span>
                  ) : (
                    <span className="text-accent-green">{JSON.stringify(connectResult, null, 2)}</span>
                  )}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
      {/* ─── Behavior Params/Response Edit Modal ────────────────────────── */}
      <Modal
        title={`编辑行为参数 - ${behaviors.find(b => b.name === behaviorEditName)?.display_name || behaviorEditName}`}
        open={behaviorEditOpen}
        onOk={saveBehaviorEdit}
        onCancel={() => setBehaviorEditOpen(false)}
        okText="保存"
        cancelText="取消"
        width={800}
        confirmLoading={behaviorEditLoading}
      >
        <div className="flex gap-3" style={{ minHeight: 320 }}>
          <div className="flex-1">
            <span className="text-text-muted text-xs mb-1 block">输入参数 (JSON)</span>
            <Input.TextArea
              value={behaviorParamsStr}
              onChange={e => setBehaviorParamsStr(e.target.value)}
              rows={16}
              className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs"
            />
          </div>
          <div className="flex-1">
            <span className="text-text-muted text-xs mb-1 block">返回结构 (JSON)</span>
            <Input.TextArea
              value={behaviorResponseStr}
              onChange={e => setBehaviorResponseStr(e.target.value)}
              rows={16}
              className="bg-dark-bg border-dark-border text-text-primary font-mono text-xs"
            />
          </div>
        </div>
      </Modal>

      {/* ─── Smart Mapping Confirm Modal ───────────────────────────────── */}
      <Modal
        title={`智能映射 - ${getBehaviorDisplay(smartMappingBehaviorName)}`}
        open={smartMappingOpen}
        onOk={handleSmartMappingConfirm}
        onCancel={() => setSmartMappingOpen(false)}
        okText="确认映射"
        cancelText="取消"
        width={500}
        confirmLoading={smartMappingLoading}
      >
        <p className="text-text-primary text-sm">将本体行为的输入输出字段，与目标系统API接口的字段进行智能匹配。</p>
        <p className="text-text-muted text-xs mt-2">匹配仅建立字段对应关系，不会修改任何字段的名称、类型、描述以及是否必要等。匹配完成后可在输入/输出映射弹窗中手动调整。</p>
      </Modal>

      {/* ─── Smart Align Modal ──────────────────────────────────────────── */}
      <Modal
        title={`智能对齐 - ${getBehaviorDisplay(smartAlignBehaviorName)}`}
        open={smartAlignOpen}
        onOk={handleSmartAlign}
        onCancel={() => setSmartAlignOpen(false)}
        okText="确认对齐"
        cancelText="取消"
        width={500}
        confirmLoading={smartAlignLoading}
      >
        <p className="text-text-primary text-sm">将本体行为输入和输出，与目标API接口对齐。</p>
        <p className="text-text-muted text-xs mt-2">对齐操作修改修本体行为的数据结构，不会修改结构以外的任何内容。</p>
      </Modal>

      {/* ─── MCP Config Modal ──────────────────────────────────────────── */}
      <Modal
        title="MCP 服务配置"
        open={mcpModalOpen}
        onCancel={() => setMcpModalOpen(false)}
        footer={null}
        width={600}
      >
        <p className="text-text-muted text-xs mb-3">将以下配置添加到你的 agent 的 MCP 配置中，即可连接本体服务。</p>
        <div className="relative">
          <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono text-yellow-400 whitespace-pre-wrap overflow-x-auto">{mcpConfigJson}</pre>
          <Button
            size="small"
            className="absolute top-2 right-2"
            onClick={() => {
              navigator.clipboard.writeText(mcpConfigJson);
              message.success('MCP 配置已复制到剪贴板');
            }}
          >
            复制
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-text-muted text-xs">可用工具：</span>
          <span className="text-accent-green text-sm font-semibold">{mcpTools.length}</span>
          <Button size="small" type="link" onClick={() => setMcpToolsOpen(!mcpToolsOpen)}>
            {mcpToolsOpen ? '收起' : '查看详情'}
          </Button>
        </div>
        {mcpToolsOpen && (
          <div className="mt-2 border border-dark-border rounded max-h-60 overflow-y-auto">
            {mcpTools.map(t => {
              const selected = mcpSelectedTool === t.name;
              const props = t.inputSchema?.properties || {};
              const required = t.inputSchema?.required || [];
              return (
              <div key={t.name}>
                <div className="px-3 py-2 border-b border-dark-border last:border-b-0 hover:bg-dark-hover cursor-pointer" onClick={() => setMcpSelectedTool(selected ? null : t.name)}>
                  <div className="text-text-primary text-xs font-medium">{t.name}</div>
                  <div className="text-text-muted text-xs mt-0.5">{t.description}</div>
                  {Object.keys(props).length > 0 && (
                    <div className="text-accent-blue text-xs mt-1">
                      {Object.keys(props).length} 个参数 {selected ? '▲' : '▼'}
                    </div>
                  )}
                </div>
                {selected && Object.keys(props).length > 0 && (
                  <div className="px-6 py-2 bg-dark-bg border-b border-dark-border space-y-1">
                    {Object.entries(props).map(([k, v]: any) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="text-yellow-400 font-mono">{k}</span>
                        <span className="text-text-muted">({v.type || 'any'})</span>
                        {required.includes(k) && <span className="text-red-400">*必填</span>}
                        {v.description && <span className="text-text-secondary">— {v.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
