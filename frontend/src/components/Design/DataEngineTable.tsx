'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Tag } from 'antd';
import { EditOutlined, CodeOutlined, PlayCircleOutlined, SendOutlined } from '@ant-design/icons';
import { getDataEngines, createDataEngine, updateDataEngine, analyzeMapping, callBehavior, smartAlign, getBehaviors, updateBehavior, DataEngine, TargetApiConfig, Behavior } from '@/api/client';
import { getMCPConfig, listMCPTools, callMCPTool, MCPServerConfig, MCPToolInfo } from '@/api/agent-client';
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
  data_source_name: '', api_name: '', url: '', method: '',
  params: {}, response: {},
};

/**
 * JSON Schema → 平台 params/response 结构（{field: {type, description, required, properties/items}}）。
 * 映射页"自动提取 schema"：inputSchema/outputSchema 直接转，映射弹窗的 flattenFields/flattenFieldTypes 原样消费。
 */
function schemaToParams(schema: Record<string, any> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object') return out;
  const props = schema.properties || {};
  const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];
  for (const [k, v] of Object.entries(props)) {
    out[k] = convertNode(v as Record<string, any>, requiredList.includes(k));
  }
  return out;
}

function convertNode(node: Record<string, any>, required: boolean): Record<string, unknown> {
  const t = node?.type || 'string';
  const out: Record<string, unknown> = { type: t };
  if (required) out.required = true;
  if (node?.description) out.description = node.description;
  if (t === 'object' && node?.properties) {
    out.properties = schemaToParams(node);
  } else if (t === 'array' && node?.items) {
    out.items = node.items.type === 'object' && node.items.properties
      ? { type: 'object', properties: schemaToParams(node.items) }
      : { type: node.items.type || 'string' };
  }
  return out;
}

/** 试调提取：从真实响应样本反推字段结构（值 → type），与 schemaToParams 同形态 */
function inferFromSample(sample: unknown): Record<string, unknown> {
  if (sample === null || sample === undefined || typeof sample !== 'object') return {};
  const src = Array.isArray(sample) ? (sample[0] ?? {}) : sample;
  if (typeof src !== 'object' || src === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    out[k] = inferNode(v);
  }
  return out;
}

function inferNode(v: unknown): Record<string, unknown> {
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  if (Array.isArray(v)) {
    const first = v[0];
    return first && typeof first === 'object'
      ? { type: 'array', items: { type: 'object', properties: inferFromSample(first) } }
      : { type: 'array', items: { type: typeof first === 'number' ? 'number' : 'string' } };
  }
  if (v !== null && typeof v === 'object') return { type: 'object', properties: inferFromSample(v) };
  return { type: 'string' };
}

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

  // MCP 服务/工具选择（文档 §八.1/§八.2：目标接口=下拉选已配置 MCP 服务，接口地址=选该服务下的函数）
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPToolInfo[]>([]);
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false);
  const [selectedServerUrl, setSelectedServerUrl] = useState('');
  const [selectedToolName, setSelectedToolName] = useState('');

  // 试调提取（文档 §九.2 降级链：无 outputSchema → 真实 callTool 一次反推字段）
  const [trialOpen, setTrialOpen] = useState(false);
  const [trialArgs, setTrialArgs] = useState('{}');
  const [trialLoading, setTrialLoading] = useState(false);

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

  // smart align modal
  const [smartAlignOpen, setSmartAlignOpen] = useState(false);
  const [smartAlignBehaviorName, setSmartAlignBehaviorName] = useState('');
  const [smartAlignLoading, setSmartAlignLoading] = useState(false);

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

  const load = async () => {
    setLoading(true);
    try {
      const [eng, beh] = await Promise.all([getDataEngines(ontologyId), getBehaviors(ontologyId)]);
      setEngines(eng); setBehaviors(beh);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'data-engines' || activeTab === 'api-mapping') load(); }, [ontologyId, activeTab]);

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

  const openTargetConfig = async (behaviorName: string) => {
    setCurrentBehavior(behaviorName);
    const de = getEngine(behaviorName);
    const t = de.target || { ...emptyTarget };
    setTargetData({ ...emptyTarget, ...t });
    setTargetParamsStr(JSON.stringify(t.params || {}, null, 2));
    setTargetResponseStr(JSON.stringify(t.response || {}, null, 2));
    setSelectedServerUrl(t.server_url || '');
    setSelectedToolName(t.tool_name || '');
    setMcpTools([]);
    setTargetOpen(true);
    // 已配置的手工（非内置）MCP 服务 = 目标接口下拉数据源（文档 §八.1）
    try {
      const cfg = await getMCPConfig();
      setMcpServers(cfg.servers.filter(s => !s.builtin && s.enabled));
    } catch (e: any) { message.warning('读取 MCP 服务配置失败: ' + e.message); }
    // 回显：已配 server_url 时把工具清单拉回来（含工具名下拉回显）
    if (t.server_url) fetchToolList(t.server_url, t.headers);
  };

  const fetchToolList = async (serverUrl: string, headers?: Record<string, string>) => {
    setMcpToolsLoading(true);
    try {
      const r = await listMCPTools(serverUrl, headers);
      if (r.success) setMcpTools(r.tools);
      else { setMcpTools([]); message.warning('拉取工具清单失败: ' + (r.error || '')); }
    } catch (e: any) { setMcpTools([]); message.warning('拉取工具清单失败: ' + e.message); }
    finally { setMcpToolsLoading(false); }
  };

  /** 选中工具 → schema 自动提取（§八.6）：输入=inputSchema；输出降级链 outputSchema→试调→手工 */
  const handleSelectTool = (toolName: string) => {
    setSelectedToolName(toolName);
    const tool = mcpTools.find(t => t.name === toolName);
    if (!tool) return;
    const server = mcpServers.find(s => s.url === selectedServerUrl);
    setTargetParamsStr(JSON.stringify(schemaToParams(tool.inputSchema), null, 2));
    if (tool.outputSchema) {
      setTargetResponseStr(JSON.stringify(schemaToParams(tool.outputSchema), null, 2));
      message.success('已自动提取输入/输出 schema');
    } else {
      setTargetResponseStr('{}');
      message.info('输入 schema 已提取；该工具未声明输出 schema，请用"试调提取"或手工编辑输出');
    }
    // 数据源/接口名称自动带入（仍可手改）
    setTargetData(p => ({
      ...p,
      data_source_name: p.data_source_name || server?.name || '',
      api_name: toolName,
    }));
  };

  const handleTrial = async () => {
    let args: Record<string, unknown>;
    try { args = JSON.parse(trialArgs || '{}'); } catch { message.warning('样例参数 JSON 格式错误'); return; }
    const server = mcpServers.find(s => s.url === selectedServerUrl);
    setTrialLoading(true);
    try {
      const r = await callMCPTool(selectedServerUrl, selectedToolName, args, server?.headers);
      if (!r.success) { message.error('试调失败: ' + (r.error || '')); return; }
      const inferred = inferFromSample(r.data);
      if (Object.keys(inferred).length === 0) { message.warning('响应不是对象/数组，无法反推字段，请手工编辑输出'); return; }
      setTargetResponseStr(JSON.stringify(inferred, null, 2));
      message.success('试调提取完成，请确认输出结构');
      setTrialOpen(false);
    } catch (e: any) { message.error('试调失败: ' + e.message); }
    finally { setTrialLoading(false); }
  };

  const saveTargetConfig = async () => {
    try {
      const params = JSON.parse(targetParamsStr);
      const response = JSON.parse(targetResponseStr);
      let de = await ensureEngine(currentBehavior);
      const server = mcpServers.find(s => s.url === selectedServerUrl);
      // 引擎唯一形态=MCP（engine_type 字段已删出 schema）：方法选择/URL 录入已删除（文档 §八.3），
      // server_url+tool_name 落盘自包含；headers 快照自服务配置（远程鉴权，运行期 data-engine-mcp 透传）
      const updated: DataEngine = {
        ...de,
        target: {
          ...targetData, params, response,
          url: '', method: '',
          server_url: selectedServerUrl,
          tool_name: selectedToolName,
          headers: server?.headers,
        },
      };
      await updateDataEngine(ontologyId, de.name, updated);
      setEngines(prev => prev.map(e => e.behavior_name === currentBehavior ? updated : e));
      message.success('目标接口已保存');
      setTargetOpen(false);
    } catch (e: any) { message.warning('JSON 格式无效: ' + e.message); }
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

  const dataSource = behaviors.map(b => {
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
      const hasConfig = de.target?.server_url || de.target?.tool_name || de.target?.url || de.target?.api_name || de.target?.data_source_name;
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
          <p className="text-text-muted text-xs mt-0.5">管理 MCP 类型的数据映射，配置目标接口（MCP 服务与工具）和字段映射关系。</p>
        </div>
        <div className="flex items-center gap-2">
        </div>
      </div>

      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Target Config Modal ──────────────────────────────────────────── */}
      <Modal title={`目标接口设置 - ${getBehaviorDisplay(currentBehavior)}`} open={targetOpen} onOk={saveTargetConfig} onCancel={() => setTargetOpen(false)} okText="保存" cancelText="取消" width={700}
        okButtonProps={{ disabled: !selectedServerUrl || !selectedToolName }}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <span className="text-text-muted text-xs">目标 MCP 服务</span>
              <Select
                value={selectedServerUrl || undefined}
                placeholder="选择已配置的 MCP 服务（在 MCP 配置页维护）"
                onChange={v => { setSelectedServerUrl(v); setSelectedToolName(''); setMcpTools([]); const s = mcpServers.find(x => x.url === v); fetchToolList(v, s?.headers); }}
                options={mcpServers.map(s => ({ label: `${s.name}${s.enabled ? '' : '（已停用）'}`, value: s.url }))}
                style={{ width: '100%' }} popupClassName="!bg-dark-card"
              />
            </div>
            <div className="flex-1">
              <span className="text-text-muted text-xs">接口（该服务下的工具）</span>
              <Select
                value={selectedToolName || undefined}
                placeholder={selectedServerUrl ? '选择工具' : '先选择 MCP 服务'}
                loading={mcpToolsLoading}
                disabled={!selectedServerUrl}
                onChange={handleSelectTool}
                options={mcpTools.map(t => ({ label: `${t.name} — ${t.description || ''}`, value: t.name }))}
                style={{ width: '100%' }} popupClassName="!bg-dark-card"
                showSearch optionFilterProp="label"
              />
            </div>
          </div>
          {targetData.url && !targetData.server_url && !selectedServerUrl && (
            <p className="text-yellow-400 text-xs">⚠ 该行为仍是旧 HTTP 直连配置（{targetData.url}），已废弃待迁移：请重新选择 MCP 服务与工具，保存后自动转为 MCP 映射。</p>
          )}
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
          <div className="flex items-center gap-2">
            <span className="text-text-muted text-xs">输入参数 / 输出结构（选中工具自动提取 schema，可手工调整）</span>
            <Button size="small" icon={<CodeOutlined />} onClick={() => setTargetParamsOpen(true)}>编辑输入</Button>
            <Button size="small" icon={<CodeOutlined />} onClick={() => setTargetResponseOpen(true)}>编辑输出</Button>
            <Button size="small" disabled={!selectedToolName} onClick={() => {
              // 用已提取的输入 schema 预填一份样例参数（类型默认值），用户改值后真实试调
              let seed: Record<string, unknown> = {};
              try {
                const p = JSON.parse(targetParamsStr || '{}');
                seed = Object.fromEntries(Object.entries(p).map(([k, v]: [string, any]) =>
                  [k, v?.type === 'integer' || v?.type === 'number' ? 1 : v?.type === 'boolean' ? false : v?.type === 'array' ? [] : v?.type === 'object' ? {} : '']));
              } catch { /* 输入 JSON 暂非法时给空样例 */ }
              setTrialArgs(JSON.stringify(seed, null, 2));
              setTrialOpen(true);
            }}><span style={{ color: '#f59e0b' }}>试调提取</span></Button>
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

        {/* ─── 试调提取 Modal（§九.2 降级链：无 outputSchema → 真实 callTool 反推字段） ─── */}
        <Modal title={`试调提取 - ${selectedToolName}`} open={trialOpen} onOk={handleTrial} onCancel={() => setTrialOpen(false)} okText="发送试调" cancelText="取消" width={700} confirmLoading={trialLoading}>
          <p className="text-text-muted text-xs mb-3">用样例参数真实调用一次该工具，从响应反推输出字段结构（查询类工具适用；写操作工具请手工编辑输出，避免试调产生真实数据）</p>
          <span className="text-text-muted text-xs mb-1 block">样例参数 (JSON)</span>
          <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 260 }}>
            <JsonEditor value={trialArgs} onChange={setTrialArgs} />
          </div>
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
              <code className="text-accent-green text-xs ml-1">
                {connectEngine.target?.server_url
                  ? `MCP  ${connectEngine.target.tool_name} @ ${connectEngine.target.server_url}`
                  : `${connectEngine.target?.method || 'POST'} ${connectEngine.target?.url || '(未配置)'}`}
              </code>
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
            <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 280 }}>
              <JsonEditor value={behaviorParamsStr} onChange={setBehaviorParamsStr} />
            </div>
          </div>
          <div className="flex-1">
            <span className="text-text-muted text-xs mb-1 block">返回结构 (JSON)</span>
            <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 280 }}>
              <JsonEditor value={behaviorResponseStr} onChange={setBehaviorResponseStr} />
            </div>
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
    </div>
  );
}