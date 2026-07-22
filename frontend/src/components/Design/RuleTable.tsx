'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button, Input, Select, Modal, message, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons';
import { getRules, createRule, updateRule, deleteRule, getBehaviors, getFunctions, getCommonFunctions, getRuleTemplateTypes, getRuleTemplate, getConcepts, generateRule, Rule, Behavior, Function, Concept } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

// ─── Validation Rule Editor ───────────────────────────────────────────────

function _label(v: any, k: string): string {
  return v?.display_name || v?.description || k;
}

function getReturnFields(funcs: any[], funcName: string | undefined): { label: string; value: string }[] {
  if (!funcName) return [];
  const fn = funcs.find(f => f.name === funcName);
  if (!fn?.response) return [];
  const props = fn.response?.result?.properties || fn.response?.properties || {};
  return Object.entries(props).map(([k, v]: [string, any]) => ({
    label: `${_label(v, k)}（${v?.type || 'any'}）`,
    value: k,
  }));
}

function ValidationRuleEditor({ config, onChange, conceptOptions, attributeOptions, funcOptions, operatorOptions, funcs }: any) {
  const cfg = config || {};
  const left = cfg.left || { type: 'concept' };
  const right = cfg.right || { type: 'value' };

  const setLeft = (patch: any) => onChange({ ...cfg, left: { ...left, ...patch } });
  const setRight = (patch: any) => onChange({ ...cfg, right: { ...right, ...patch } });

  return (
    <div className="space-y-4">
      <p className="text-text-muted text-xs mb-2">配置条件表达式，所有字段均为必填</p>
      <div className="flex items-start gap-3">
        <span className="text-text-primary text-sm w-16 mt-1">左侧</span>
        <div className="flex-1 space-y-2">
          <Select size="small" value={left.type} onChange={v => setLeft({ type: v, concept: undefined, attribute: undefined, function: undefined, returnField: undefined })}
            options={[{ label: '对象', value: 'concept' }, { label: '函数', value: 'function' }]} style={{ width: 120 }} popupClassName="!bg-dark-card" />
          {left.type === 'concept' ? (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="选择概念" value={left.concept} onChange={v => setLeft({ concept: v, attribute: undefined })}
                options={conceptOptions} style={{ width: 180 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="选择属性" value={left.attribute} onChange={v => setLeft({ attribute: v })}
                options={left.concept ? attributeOptions(left.concept) : []} style={{ width: 180 }} popupClassName="!bg-dark-card" />
            </div>
          ) : (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="选择函数" value={left.function} onChange={v => setLeft({ function: v, returnField: undefined })}
                options={funcOptions} style={{ width: 180 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="返回字段" value={left.returnField} onChange={v => setLeft({ returnField: v })}
                options={getReturnFields(funcs, left.function)} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-text-primary text-sm w-16">操作符</span>
        <Select size="small" value={cfg.operator || 'eq'} onChange={v => onChange({ ...cfg, operator: v })}
          options={right.type === 'set' ? operatorOptions.filter((o: any) => o.value === 'in' || o.value === 'not in') : operatorOptions} style={{ width: 180 }} popupClassName="!bg-dark-card" />
      </div>

      <div className="flex items-start gap-3">
        <span className="text-text-primary text-sm w-16 mt-1">右侧</span>
        <div className="flex-1 space-y-2">
          <Select size="small" value={right.type} onChange={v => setRight({ type: v, value: undefined, concept: undefined, attribute: undefined, function: undefined, returnField: undefined })}
            options={[{ label: '字面值', value: 'value' }, { label: '对象', value: 'concept' }, { label: '对象集', value: 'set' }, { label: '函数', value: 'function' }]} style={{ width: 120 }} popupClassName="!bg-dark-card" />
          {right.type === 'value' ? (
            <Input size="small" placeholder="输入字面值" value={right.value || ''} onChange={e => setRight({ value: e.target.value })}
              className="bg-dark-bg border-dark-border" style={{ width: 200 }} />
          ) : right.type === 'function' ? (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="选择函数" value={right.function} onChange={v => setRight({ function: v, returnField: undefined })}
                options={funcOptions} style={{ width: 180 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="返回字段" value={right.returnField} onChange={v => setRight({ returnField: v })}
                options={getReturnFields(funcs, right.function)} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            </div>
          ) : right.type === 'set' ? (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="选择概念" value={right.concept} onChange={v => setRight({ concept: v, attribute: undefined })}
                options={conceptOptions} style={{ width: 180 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="选择属性" value={right.attribute} onChange={v => setRight({ attribute: v })}
                options={right.concept ? attributeOptions(right.concept) : []} style={{ width: 180 }} popupClassName="!bg-dark-card" />
            </div>
          ) : (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="选择概念" value={right.concept} onChange={v => setRight({ concept: v, attribute: undefined })}
                options={conceptOptions} style={{ width: 180 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="选择属性" value={right.attribute} onChange={v => setRight({ attribute: v })}
                options={right.concept ? attributeOptions(right.concept) : []} style={{ width: 180 }} popupClassName="!bg-dark-card" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inference Rule Editor ────────────────────────────────────────────────

function InferenceRuleEditor({ config, onChange, conceptOptions, attributeOptions, funcOptions, operatorOptions, funcs }: any) {
  const cfg = config || {};
  const ifBlock = cfg.if || { logic: 'and', conditions: [{ left: { type: 'concept' }, operator: 'eq', right: { type: 'value' } }] };

  const setIf = (patch: any) => onChange({ ...cfg, if: { ...ifBlock, ...patch } });

  const updateCondition = (idx: number, patch: any) => {
    const conditions = [...(ifBlock.conditions || [])];
    conditions[idx] = { ...conditions[idx], ...patch };
    setIf({ ...ifBlock, conditions });
  };

  const addCondition = () => {
    setIf({ ...ifBlock, conditions: [...(ifBlock.conditions || []), { left: { type: 'concept' }, operator: 'eq', right: { type: 'value' } }] });
  };

  const removeCondition = (idx: number) => {
    setIf({ ...ifBlock, conditions: (ifBlock.conditions || []).filter((_: any, i: number) => i !== idx) });
  };

  const leftRightEditor = (cond: any, idx: number, side: 'left' | 'right', sideLabel: string) => {
    const obj = cond[side] || { type: side === 'left' ? 'concept' : 'value' };
    const rightTypes = [{ label: '字面值', value: 'value' }, { label: '对象', value: 'concept' }, { label: '对象集', value: 'set' }, { label: '函数', value: 'function' }];
    const types = side === 'left' ? [{ label: '对象', value: 'concept' }, { label: '函数', value: 'function' }] : rightTypes;
    return (
      <div className="flex items-start gap-2">
        <span className="text-text-muted text-xs w-12 mt-1">{sideLabel}</span>
        <div className="flex-1 space-y-1">
          <Select size="small" value={obj.type} onChange={v => updateCondition(idx, { [side]: { type: v } })}
            options={types} style={{ width: 120 }} popupClassName="!bg-dark-card" />
          {obj.type === 'concept' ? (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="概念" value={obj.concept} onChange={v => updateCondition(idx, { [side]: { ...obj, concept: v, attribute: undefined } })}
                options={conceptOptions} style={{ width: 150 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="属性" value={obj.attribute} onChange={v => updateCondition(idx, { [side]: { ...obj, attribute: v } })}
                options={obj.concept ? attributeOptions(obj.concept) : []} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            </div>
          ) : obj.type === 'function' ? (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="函数" value={obj.function} onChange={v => updateCondition(idx, { [side]: { ...obj, function: v } })}
                options={funcOptions} style={{ width: 150 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="返回字段" value={obj.returnField} onChange={v => updateCondition(idx, { [side]: { ...obj, returnField: v } })}
                options={getReturnFields(funcs, obj.function)} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            </div>
          ) : obj.type === 'set' ? (
            <div className="flex gap-2">
              <Select size="small" allowClear placeholder="概念" value={obj.concept} onChange={v => updateCondition(idx, { [side]: { ...obj, concept: v, attribute: undefined } })}
                options={conceptOptions} style={{ width: 150 }} popupClassName="!bg-dark-card" />
              <Select size="small" allowClear placeholder="属性" value={obj.attribute} onChange={v => updateCondition(idx, { [side]: { ...obj, attribute: v } })}
                options={obj.concept ? attributeOptions(obj.concept) : []} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            </div>
          ) : (
            <Input size="small" placeholder="字面值" value={obj.value || ''} onChange={e => updateCondition(idx, { [side]: { ...obj, value: e.target.value } })}
              className="bg-dark-bg border-dark-border" style={{ width: 200 }} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-text-muted text-xs mb-2">配置推理条件，所有字段均为必填</p>
      <div>
        <div className="text-text-primary text-sm font-semibold mb-2">IF</div>
        <div className="pl-4 border-l-2 border-accent-blue/30 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-text-muted text-xs">条件逻辑</span>
            <Select size="small" value={ifBlock.logic || 'and'} onChange={v => setIf({ ...ifBlock, logic: v })}
              options={[{ label: '且 (AND)', value: 'and' }, { label: '或 (OR)', value: 'or' }]} style={{ width: 140 }} popupClassName="!bg-dark-card" />
          </div>
          <div className="space-y-2">
            {(ifBlock.conditions || []).map((cond: any, idx: number) => (
              <div key={idx} className="bg-dark-card border border-dark-border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted text-xs">条件 {idx + 1}</span>
                  {(ifBlock.conditions || []).length > 1 && (
                    <Button type="link" size="small" danger onClick={() => removeCondition(idx)}>删除</Button>
                  )}
                </div>
                {leftRightEditor(cond, idx, 'left', '左侧')}
                <div className="flex items-center gap-2">
                  <span className="text-text-muted text-xs w-12">操作符</span>
                  <Select size="small" value={cond.operator || 'eq'} onChange={v => updateCondition(idx, { operator: v })}
                    options={cond.right?.type === 'set' ? operatorOptions.filter((o: any) => o.value === 'in' || o.value === 'not in') : operatorOptions} style={{ width: 140 }} popupClassName="!bg-dark-card" />
                </div>
                {leftRightEditor(cond, idx, 'right', '右侧')}
              </div>
            ))}
          </div>
          <Button size="small" type="dashed" onClick={addCondition} block>+ 添加条件</Button>
        </div>
      </div>

      <div>
        <div className="text-text-primary text-sm font-semibold mb-2">THEN</div>
        <Input.TextArea size="small" rows={2} value={cfg.then || ''} onChange={e => onChange({ ...cfg, then: e.target.value })}
          placeholder="条件为真时的文字描述" className="bg-dark-bg border-dark-border" />
      </div>
      <div>
        <div className="text-text-primary text-sm font-semibold mb-2">ELSE</div>
        <Input.TextArea size="small" rows={2} value={cfg.else || ''} onChange={e => onChange({ ...cfg, else: e.target.value })}
          placeholder="条件为假时的文字描述" className="bg-dark-bg border-dark-border" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function RuleTable({ ontologyId, activeTab }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [funcs, setFuncs] = useState<Function[]>([]);
  const [ruleTypeOptions, setRuleTypeOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [concepts, setConcepts] = useState<Concept[]>([]);

  // rule design modal state
  const [ruleDesignModalOpen, setRuleDesignModalOpen] = useState(false);
  const [ruleTemplate, setRuleTemplate] = useState<any>(null);
  const [ruleConfig, setRuleConfig] = useState<any>(null);
  const [templateLoading, setTemplateLoading] = useState(false);

  // smart generate loading
  const [genLoading, setGenLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ruleList, behList, fnList, types, conList, commonFnList] = await Promise.all([getRules(ontologyId), getBehaviors(ontologyId), getFunctions(ontologyId), getRuleTemplateTypes(), getConcepts(ontologyId), getCommonFunctions()]);
      const allFuncs = [...fnList, ...commonFnList.map((f: any) => ({ ...f, related_attributes: [] as string[] }))];
      setRules(ruleList); setBehaviors(behList); setFuncs(allFuncs);
      setRuleTypeOptions(types.map(t => ({ label: t, value: t })));
      setConcepts(conList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'rules') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Rule) => record.name === editingKey;
  const behaviorOptions = behaviors.map(b => ({ label: b.display_name || b.name, value: b.name }));
  const functionOptions = funcs.map(f => ({ label: f.display_name || f.name, value: f.name }));
  const conceptOptions = useMemo(() => concepts.map(c => ({ label: c.display_name || c.name, value: c.name })), [concepts]);
  const attributeOptions = useMemo(() => (conceptName: string) => {
    const c = concepts.find(c => c.name === conceptName);
    return (c?.attributes || []).map(a => ({ label: `${a.display_name || a.name}（${a.type}）`, value: a.name }));
  }, [concepts]);
  const OPERATOR_OPTIONS = [
    { label: '等于 (eq)', value: 'eq' },
    { label: '不等于 (ne)', value: 'ne' },
    { label: '属于 (in)', value: 'in' },
    { label: '不属于 (not in)', value: 'not in' },
    { label: '模糊匹配 (like)', value: 'like' },
    { label: '小于 (lt)', value: 'lt' },
    { label: '大于 (gt)', value: 'gt' },
    { label: '小于等于 (le)', value: 'le' },
    { label: '大于等于 (ge)', value: 'ge' },
  ];

  const handleAdd = () => { setEditData({ name: '', display_name: '', description: '', rule_type: '', position: '', related_behaviors: [], related_functions: [], rule_detail: null }); setEditingKey('__new__'); };
  const handleEdit = (r: Rule) => { setEditData({ name: r.name, display_name: r.display_name || '', description: r.description, rule_type: r.rule_type || '', position: r.position || '', related_behaviors: r.related_behaviors || [], related_functions: r.related_functions || [], rule_detail: r.rule_detail }); setEditingKey(r.name); };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Rule) => {
    if (!editData.name?.trim()) { message.warning('请输入规则名称'); return; }
    try {
      const data: any = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '', rule_type: editData.rule_type || '', position: editData.position || '', related_behaviors: editData.related_behaviors || [], related_functions: editData.related_functions || [], rule_detail: normalizeDetail(editData.rule_detail) };
      const isNew = editingKey === '__new__';
      if (isNew) {
        if (rules.some(r => r.name === data.name)) { message.warning('规则名称已存在'); return; }
        await createRule(ontologyId, data); message.success('规则已添加');
      } else {
        await updateRule(ontologyId, record.name, data); message.success('规则已更新');
      }
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除规则「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteRule(ontologyId, name); message.success('规则已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  // Normalize undefined/null values to empty string
  const normalizeDetail = (obj: any): any => {
    if (obj === null || obj === undefined) return '';
    if (Array.isArray(obj)) return obj.map(normalizeDetail);
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(obj)) {
        cleaned[k] = normalizeDetail(v);
      }
      return cleaned;
    }
    return obj;
  };

  const openRuleDesign = async () => {
    setRuleConfig(editData.rule_detail ? normalizeDetail(JSON.parse(JSON.stringify(editData.rule_detail))) : null);
    setRuleDesignModalOpen(true);
    if (!editData.rule_type) return;
    setTemplateLoading(true);
    try {
      const template = await getRuleTemplate(editData.rule_type);
      setRuleTemplate(template);
    } catch (e: any) {
      message.error('加载规则模板失败: ' + e.message);
    } finally {
      setTemplateLoading(false);
    }
  };

  const saveRuleDesign = () => {
    // 验证规则配置完整性
    const cfg = ruleConfig || {};
    if (!editData.rule_type) { message.warning('请先选择规则类型'); return; }

    if (editData.rule_type === '验证规则') {
      const left = cfg.left || {};
      if (left.type === 'concept' && (!left.concept || !left.attribute)) {
        message.warning('请完善左侧条件：选择概念和属性'); return;
      }
      if (left.type === 'function' && (!left.function || !left.returnField)) {
        message.warning('请完善左侧条件：选择函数并填写返回字段'); return;
      }
      if (!cfg.operator) { message.warning('请选择操作符'); return; }
      const right = cfg.right || {};
      if (right.type === 'value' && (right.value === undefined || right.value === '')) {
        message.warning('请填写右侧字面值'); return;
      }
      if (right.type === 'concept' && (!right.concept || !right.attribute)) {
        message.warning('请完善右侧条件：选择概念和属性'); return;
      }
      if (right.type === 'function' && (!right.function || !right.returnField)) {
        message.warning('请完善右侧条件：选择函数并填写返回字段'); return;
      }
      if (right.type === 'set' && (!right.concept || !right.attribute)) {
        message.warning('请完善右侧条件：选择概念和属性'); return;
      }
    }

    if (editData.rule_type === '推理规则') {
      const ifBlock = cfg.if || {};
      const conditions = ifBlock.conditions || [];
      if (conditions.length === 0) { message.warning('请至少添加一个条件'); return; }
      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const left = c.left || {};
        if (left.type === 'concept' && (!left.concept || !left.attribute)) {
          message.warning(`条件 ${i+1} 左侧不完整，请选择概念和属性`); return;
        }
        if (left.type === 'function' && (!left.function || !left.returnField)) {
          message.warning(`条件 ${i+1} 左侧不完整，请选择函数并填写返回字段`); return;
        }
        if (!c.operator) { message.warning(`条件 ${i+1} 未选择操作符`); return; }
        const right = c.right || {};
        if (right.type === 'value' && (right.value === undefined || right.value === '')) {
          message.warning(`条件 ${i+1} 右侧字面值为空`); return;
        }
        if ((right.type === 'concept' || right.type === 'set') && (!right.concept || !right.attribute)) {
          message.warning(`条件 ${i+1} 右侧不完整，请选择概念和属性`); return;
        }
        if (right.type === 'function' && (!right.function || !right.returnField)) {
          message.warning(`条件 ${i+1} 右侧不完整，请选择函数并填写返回字段`); return;
        }
      }
    }

    setEditData(p => ({ ...p, rule_detail: normalizeDetail(ruleConfig) }));
    message.success('规则设计已保存到编辑缓存');
    setRuleDesignModalOpen(false);
  };

  const renderCell = (val: any, record: Rule, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');
    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'rule_type') return <Select size="small" allowClear placeholder="选择" value={editData.rule_type || undefined} onChange={v => setEditData(p => ({...p, rule_type: v || ''}))} options={ruleTypeOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'position') return <Select size="small" allowClear placeholder="选择" value={editData.position || undefined} onChange={v => setEditData(p => ({...p, position: v || ''}))} options={[{label:'前置',value:'前置'},{label:'后置',value:'后置'}]} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'related_behaviors') return <Select size="small" mode="multiple" placeholder="选择" value={editData.related_behaviors || []} onChange={v => setEditData(p => ({...p, related_behaviors: v}))} options={behaviorOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'related_functions') return <Select size="small" mode="multiple" placeholder="选择" value={editData.related_functions || []} onChange={v => setEditData(p => ({...p, related_functions: v}))} options={functionOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    return render ? render(val) : (val || '-');
  };

  const dataSource = rules.map(r => ({ ...r, _key: r.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', description: '', rule_type: '', position: '', related_behaviors: [], related_functions: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'name') },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '规则类型', dataIndex: 'rule_type', key: 'rule_type', width: 85, render: (v: any, r: Rule) => renderCell(v, r, 'rule_type', (v2: string) => v2 || '-') },
    { title: '介入位置', dataIndex: 'position', key: 'position', width: 85, render: (v: any, r: Rule) => renderCell(v, r, 'position', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'description') },
    { title: '关联行为', dataIndex: 'related_behaviors', key: 'related_behaviors', width: 160, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_behaviors', (list: string[]) => list?.map(name => behaviors.find(b => b.name === name)?.display_name || name).join(', ') || '-') },
    { title: '关联函数', dataIndex: 'related_functions', key: 'related_functions', width: 160, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_functions', (list: string[]) => list?.map(name => funcs.find(f => f.name === name)?.display_name || name).join(', ') || '-') },
    { title: '规则设计', dataIndex: 'rule_design', key: 'rule_design', width: 75, render: (_: any, r: Rule) => {
      const editing = isEditing(r);
      const isNew = editingKey === '__new__' && r.name === '__new__';
      if (!editing && !isNew) {
        const hasConfig = r.rule_detail && Object.keys(r.rule_detail).length > 0;
        return <span className={`text-xs ${hasConfig ? 'text-green-500' : 'text-text-muted'}`}>{hasConfig ? '已设计' : '未设计'}</span>;
      }
      return <Button type="link" size="small" icon={<FileTextOutlined />} disabled={!editData.rule_type} onClick={openRuleDesign}>设计</Button>;
    }},
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: Rule) => {
        if (editingKey === record.name || (editingKey === '__new__' && record.name === '__new__')) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(record)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return <Space><Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} /><Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} /></Space>;
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">规则管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={editingKey !== ''}>新增规则</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">配置行为执行前后的管控规则</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Rule Design Modal ──────────────────────────────────────────── */}
      <Modal
        title={`规则设计 - ${editData.display_name || editData.name || ''}`}
        open={ruleDesignModalOpen}
        onOk={saveRuleDesign}
        onCancel={() => setRuleDesignModalOpen(false)}
        okText="保存到编辑缓存"
        cancelText="取消"
        width={800}
      >
        <div className="flex justify-end mb-3">
          <Button size="small" icon={<RobotOutlined />} loading={genLoading} onClick={async () => {
            if (!editData.name?.trim()) { message.warning('请先填写规则名称'); return; }
            if (!editData.rule_type) { message.warning('请先选择规则类型'); return; }
            setGenLoading(true);
            try {
              const result = await generateRule(ontologyId, {
                rule_name: editData.name.trim(),
                rule_display_name: editData.display_name?.trim() || '',
                rule_type: editData.rule_type,
                rule_description: editData.description?.trim() || '',
                related_behaviors: editData.related_behaviors || [],
                related_functions: editData.related_functions || [],
              });
              setRuleConfig(result.rule_detail);
              message.success('规则已智能生成，请确认后保存');
            } catch (e: any) { message.error('生成失败: ' + e.message); }
            finally { setGenLoading(false); }
          }}>智能生成</Button>
        </div>
        {!editData.rule_type ? (
          <p className="text-text-muted">请先选择规则类型后再进行规则设计</p>
        ) : templateLoading ? (
          <div className="flex items-center justify-center h-40"><span className="text-text-muted">加载模板中...</span></div>
        ) : !ruleTemplate ? (
          <p className="text-text-muted">未找到规则模板</p>
        ) : ruleTemplate.ruleName === '验证规则' ? (
          <ValidationRuleEditor config={ruleConfig} onChange={setRuleConfig} conceptOptions={conceptOptions} attributeOptions={attributeOptions} funcOptions={functionOptions} operatorOptions={OPERATOR_OPTIONS} funcs={funcs} />
        ) : ruleTemplate.ruleName === '推理规则' ? (
          <InferenceRuleEditor config={ruleConfig} onChange={setRuleConfig} conceptOptions={conceptOptions} attributeOptions={attributeOptions} funcOptions={functionOptions} operatorOptions={OPERATOR_OPTIONS} funcs={funcs} />
        ) : (
          <p className="text-text-muted">不支持的规则模板: {ruleTemplate.ruleName}</p>
        )}
      </Modal>
    </div>
  );
}
