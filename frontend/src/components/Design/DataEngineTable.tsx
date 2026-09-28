'use client';

/**
 * API 映射页（本体行为 → MCP 目标接口 → 字段映射）。
 *
 * 本文件只做三件事：加载数据、编排流程（打开哪个弹窗、保存到哪）、渲染表格与弹窗。
 * 拆分后的职责边界（章程 I：组件化与代码质量）：
 * - `data-engine/data-engine-helpers.ts`：纯判据与表单初值（可直接单测）
 * - `data-engine/TargetConfigModal.tsx`：目标接口设置（自持表单状态 + MCP 服务/工具拉取）
 * - `data-engine/MappingModal.tsx`：输入/输出映射（同构弹窗，两处复用）
 * - `data-engine/ConnectTestModal.tsx`：连接测试
 * - `data-engine/BehaviorEditModal.tsx`：行为参数/返回结构编辑
 * - `data-engine/SmartActionModals.tsx`：智能对齐/智能映射的确认与结论
 */
import { useEffect, useState } from 'react';
import { Button, message } from 'antd';
import { EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import {
  getDataEngines, createDataEngine, updateDataEngine, analyzeMapping, callBehavior, smartAlign,
  getBehaviors, updateBehavior, DataEngine, TargetApiConfig, Behavior,
} from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import { clickableProps } from '@/utils/a11y';
import {
  flattenFields, flattenFieldTypes, emptyEngine, emptyTarget,
  hasTargetEndpoint, hasTargetSchema, countMappedFields,
  buildConnectFormValues, coerceConnectParams,
} from './data-engine/data-engine-helpers';
import TargetConfigModal from './data-engine/TargetConfigModal';
import MappingModal from './data-engine/MappingModal';
import ConnectTestModal from './data-engine/ConnectTestModal';
import BehaviorEditModal from './data-engine/BehaviorEditModal';
import { AnalyzeResultModal, SmartActionConfirmModal } from './data-engine/SmartActionModals';

interface Props { ontologyId: number; activeTab?: string; }

// ─── component ───────────────────────────────────────────────────────────────

export default function DataEngineTable({ ontologyId, activeTab }: Props) {
  const [engines, setEngines] = useState<DataEngine[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(false);

  // target config modal
  const [currentBehavior, setCurrentBehavior] = useState('');
  const [targetOpen, setTargetOpen] = useState(false);

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

  /** 弹窗自身负责表单回显与 MCP 服务/工具拉取；父组件只标记「在给哪个行为配」 */
  const openTargetConfig = (behaviorName: string) => {
    setCurrentBehavior(behaviorName);
    setTargetOpen(true);
  };

  const saveTargetConfig = async (target: TargetApiConfig) => {
    try {
      const de = await ensureEngine(currentBehavior);
      const updated: DataEngine = { ...de, target };
      await updateDataEngine(ontologyId, de.name, updated);
      setEngines(prev => prev.map(e => e.behavior_name === currentBehavior ? updated : e));
      message.success('目标接口已保存');
      setTargetOpen(false);
    } catch (e: any) { message.error('保存目标接口失败: ' + e.message); }
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
    // 必填判据取自目标参数结构（经输入映射换名后查找），初值按类型给占位
    const { params, required } = buildConnectFormValues(
      (beh?.params as Record<string, unknown>) || {},
      de.target?.params || {},
      de.input_mapping || {},
    );
    setConnectParams(params);
    setConnectRequired(required);
    setConnectOpen(true);
  };

  const executeConnect = async () => {
    if (!connectEngine) return;
    setConnectLoading(true);
    try {
      // 字符串形态的 JSON 字面量还原为结构后再提交（数字等标量原样透传）
      const result = await callBehavior(ontologyId, connectEngine.behavior_name, coerceConnectParams(connectParams));
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
      return <span className="cursor-pointer hover:text-accent-blue transition-colors" {...clickableProps(() => openBehaviorEdit(b.name), '编辑行为')}>{b.display_name || b.name}</span>;
    }},
    { title: '目标接口设置', key: 'target', width: 100, render: (_: any, r: any) => {
      const de = getEngine(r._behavior.name);
      const hasConfig = hasTargetEndpoint(de.target);
      return <Button size="small" icon={<EditOutlined />} onClick={() => openTargetConfig(r._behavior.name)}>{hasConfig ? '已设置' : '编辑'}</Button>;
    }},
    { title: '输入映射', key: 'input_mapping', width: 80, render: (_: any, r: any) => {
      const de = getEngine(r._behavior.name);
      const count = countMappedFields(de.input_mapping);
      return <Button size="small" icon={<EditOutlined />} onClick={() => openInputMapping(r._behavior.name)}>{count > 0 ? `已映射${count}` : '编辑'}</Button>;
    }},
    { title: '输出映射', key: 'output_mapping', width: 80, render: (_: any, r: any) => {
      const de = getEngine(r._behavior.name);
      const count = countMappedFields(de.output_mapping);
      return <Button size="small" icon={<EditOutlined />} onClick={() => openOutputMapping(r._behavior.name)}>{count > 0 ? `已映射${count}` : '编辑'}</Button>;
    }},
    {
      title: '操作', key: 'actions', width: 220,
      render: (_: any, r: any) => {
        const de = getEngine(r._behavior.name);
        const hasTarget = hasTargetSchema(de.target);
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
      <TargetConfigModal
        open={targetOpen}
        behaviorLabel={getBehaviorDisplay(currentBehavior)}
        initialTarget={getEngine(currentBehavior).target || { ...emptyTarget }}
        onSave={saveTargetConfig}
        onCancel={() => setTargetOpen(false)}
      />

      {/* ─── Input / Output Mapping Modals ────────────────────────────────── */}
      <MappingModal
        open={inputMappingOpen}
        title={`输入映射 - ${getBehaviorDisplay(currentBehavior)}`}
        ontoFields={mappingOntoFields}
        targetFields={mappingTargetFields}
        ontoFieldTypes={ontoFieldTypes}
        targetFieldTypes={targetFieldTypes}
        mapping={inputMapping}
        emptyHint="本体行为未定义输入参数"
        selectPlaceholder="选择目标参数"
        direction="输入"
        onMappingChange={(field, value) => setInputMapping(p => ({ ...p, [field]: value }))}
        onSave={() => saveMapping('input')}
        onCancel={() => setInputMappingOpen(false)}
      />
      <MappingModal
        open={outputMappingOpen}
        title={`输出映射 - ${getBehaviorDisplay(currentBehavior)}`}
        ontoFields={mappingOntoFields}
        targetFields={mappingTargetFields}
        ontoFieldTypes={ontoFieldTypes}
        targetFieldTypes={targetFieldTypes}
        mapping={outputMapping}
        emptyHint="本体行为未定义返回结构"
        selectPlaceholder="选择目标字段"
        direction="输出"
        onMappingChange={(field, value) => setOutputMapping(p => ({ ...p, [field]: value }))}
        onSave={() => saveMapping('output')}
        onCancel={() => setOutputMappingOpen(false)}
      />

      {/* ─── Analyze Result Modal ─────────────────────────────────────────── */}
      <AnalyzeResultModal
        open={analyzeOpen}
        title={`智能映射-${getBehaviorDisplay(smartMappingBehaviorName)}`}
        result={analyzeResult}
        onClose={() => { setAnalyzeOpen(false); setAnalyzeResult(null); }}
      />

      {/* ─── Data Engine Call Modal ───────────────────────────────────────── */}
      <ConnectTestModal
        open={connectOpen}
        engine={connectEngine}
        behaviorLabel={connectEngine ? getBehaviorDisplay(connectEngine.behavior_name) : ''}
        params={connectParams}
        required={connectRequired}
        result={connectResult}
        loading={connectLoading}
        paramLabel={k => getParamDisplay(connectEngine?.behavior_name || '', k)}
        onParamChange={(k, value) => setConnectParams(p => ({ ...p, [k]: value }))}
        onSend={executeConnect}
        onClose={() => { setConnectOpen(false); setConnectResult(null); }}
      />

      {/* ─── Behavior Params/Response Edit Modal ────────────────────────── */}
      <BehaviorEditModal
        open={behaviorEditOpen}
        title={`编辑行为参数 - ${behaviors.find(b => b.name === behaviorEditName)?.display_name || behaviorEditName}`}
        paramsStr={behaviorParamsStr}
        responseStr={behaviorResponseStr}
        loading={behaviorEditLoading}
        onParamsChange={setBehaviorParamsStr}
        onResponseChange={setBehaviorResponseStr}
        onSave={saveBehaviorEdit}
        onCancel={() => setBehaviorEditOpen(false)}
      />

      {/* ─── Smart Mapping Confirm Modal ───────────────────────────────── */}
      <SmartActionConfirmModal
        open={smartMappingOpen}
        title={`智能映射 - ${getBehaviorDisplay(smartMappingBehaviorName)}`}
        okText="确认映射"
        loading={smartMappingLoading}
        onConfirm={handleSmartMappingConfirm}
        onCancel={() => setSmartMappingOpen(false)}
      >
        <p className="text-text-primary text-sm">将本体行为的输入输出字段，与目标系统API接口的字段进行智能匹配。</p>
        <p className="text-text-muted text-xs mt-2">匹配仅建立字段对应关系，不会修改任何字段的名称、类型、描述以及是否必要等。匹配完成后可在输入/输出映射弹窗中手动调整。</p>
      </SmartActionConfirmModal>

      {/* ─── Smart Align Modal ──────────────────────────────────────────── */}
      <SmartActionConfirmModal
        open={smartAlignOpen}
        title={`智能对齐 - ${getBehaviorDisplay(smartAlignBehaviorName)}`}
        okText="确认对齐"
        loading={smartAlignLoading}
        onConfirm={handleSmartAlign}
        onCancel={() => setSmartAlignOpen(false)}
      >
        <p className="text-text-primary text-sm">将本体行为输入和输出，与目标API接口对齐。</p>
        <p className="text-text-muted text-xs mt-2">对齐操作修改修本体行为的数据结构，不会修改结构以外的任何内容。</p>
      </SmartActionConfirmModal>
    </div>
  );
}
