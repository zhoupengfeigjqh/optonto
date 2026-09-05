'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button, Input, Select, Modal, message, Space, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, FileTextOutlined, RobotOutlined, WarningOutlined } from '@ant-design/icons';
import { getRules, createRule, updateRule, deleteRule, getBehaviors, getFunctions, getCommonFunctions, getRuleTemplateTypes, getRuleTemplate, getConcepts, getRelations, generateRule, Rule, Behavior, Function, Concept, Relation } from '@/api/client';
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

// ─── 操作数类型与字面值解析（2026-08-26 定稿：A2 + valueSet + instance 改名） ───
// 操作数类型：value(字面值)/valueSet(字面值集)/instance(实例)/instanceSet(实例集)/function(函数)
// 旧名兼容：concept→instance、set→instanceSet（存量 yaml 打开设计器时映射，保存时写新名，自然迁移）

function normalizeOperandType(t: any): string {
  if (t === 'concept') return 'instance';
  if (t === 'set') return 'instanceSet';
  return t || '';
}

const SET_OPERAND_TYPES = ['instanceSet', 'valueSet'];
const SET_OPERATORS = ['in', 'not in'];

type LiteralParseResult = { ok: true; node: any } | { ok: false; error: string };

/**
 * A2 字面值解析：引号语法输入 → 类型化存储节点 {type:'value', valueType, value?}
 * - string：必须引号包裹（'有效'/"有效"），存储不带引号；'' = 空串
 * - number/integer：裸写数字；boolean：true/false
 * - 空输入 = 空值节点：valueType 与左侧类型一致、value 为 null（左侧类型未知时 valueType 为 null；操作符是否允许由调用方校验）
 * - expectedType 为左侧操作数类型，传 null 表示未知（宁漏勿拦，按输入形态推断）
 */
function parseLiteralInput(rawIn: any, expectedType: string | null): LiteralParseResult {
  const raw = rawIn === undefined || rawIn === null ? '' : String(rawIn).trim();
  if (raw === '') return { ok: true, node: { type: 'value', valueType: expectedType || 'null', value: null } };
  const isQuoted = (q: string) => raw.length >= 2 && raw.startsWith(q) && raw.endsWith(q);
  if (isQuoted("'") || isQuoted('"')) {
    if (expectedType && expectedType !== 'string') {
      return { ok: false, error: `左侧为 ${expectedType} 类型，字面值${expectedType === 'boolean' ? '请写 true/false' : '请直接写数字'}，不要加引号` };
    }
    return { ok: true, node: { type: 'value', valueType: 'string', value: raw.slice(1, -1) } };
  }
  if (raw === 'true' || raw === 'false') {
    if (expectedType && expectedType !== 'boolean') return { ok: false, error: `左侧为 ${expectedType} 类型，但输入的是布尔值 ${raw}` };
    return { ok: true, node: { type: 'value', valueType: 'boolean', value: raw === 'true' } };
  }
  if (/^-?\d+$/.test(raw)) {
    if (expectedType === 'string') return { ok: false, error: `左侧为 string 类型，字面值需用引号包裹，如 '${raw}'` };
    if (expectedType === 'boolean') return { ok: false, error: `左侧为 boolean 类型，字面值请写 true/false` };
    // 左侧为 number 时按 number 存（整数是 number 的子集）；未知时按 integer
    return { ok: true, node: { type: 'value', valueType: expectedType === 'number' ? 'number' : 'integer', value: Number(raw) } };
  }
  if (/^-?\d*\.\d+$/.test(raw)) {
    if (expectedType === 'integer') return { ok: false, error: `左侧为 integer 类型，字面值不能带小数` };
    if (expectedType === 'string') return { ok: false, error: `左侧为 string 类型，字面值需用引号包裹，如 '${raw}'` };
    if (expectedType === 'boolean') return { ok: false, error: `左侧为 boolean 类型，字面值请写 true/false` };
    return { ok: true, node: { type: 'value', valueType: 'number', value: Number(raw) } };
  }
  if (expectedType === 'string') return { ok: false, error: `string 字面值需用引号包裹，如 '${raw}'` };
  if (expectedType) return { ok: false, error: `左侧为 ${expectedType} 类型，无法识别的字面值「${raw}」` };
  // 类型未知：宁漏勿拦，按 string 原文接受
  return { ok: true, node: { type: 'value', valueType: 'string', value: raw } };
}

/** 字面值集解析：`[...]` 语法，元素按 parseLiteralInput 逐个解析，同型（number/integer 混合归一为 number），非空 */
function parseLiteralSetInput(rawIn: any, expectedType: string | null): LiteralParseResult {
  const raw = rawIn === undefined || rawIn === null ? '' : String(rawIn).trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) {
    return { ok: false, error: `字面值集需用方括号包裹，如 ['有效', '无效'] 或 [1, 2, 3]` };
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) return { ok: false, error: '字面值集不能为空集 []' };
  // 按顶层逗号切分（引号内的逗号不切）
  const tokens: string[] = [];
  let cur = ''; let quote = '';
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === ',') { tokens.push(cur); cur = ''; continue; }
    cur += ch;
  }
  tokens.push(cur);
  const values: any[] = [];
  const types = new Set<string>();
  for (const tok of tokens) {
    if (!tok.trim()) return { ok: false, error: '字面值集存在空元素（多余的逗号？）' };
    const r = parseLiteralInput(tok, expectedType);
    if (!r.ok) return r;
    if (r.node.value === null || r.node.value === undefined) return { ok: false, error: '字面值集不允许空元素' };
    types.add(r.node.valueType);
    values.push(r.node.value);
  }
  let elementType = '';
  if (types.size === 1) elementType = [...types][0];
  else if ([...types].every(t => t === 'number' || t === 'integer')) elementType = 'number';
  else return { ok: false, error: `字面值集元素类型不一致（${[...types].join('、')}）` };
  return { ok: true, node: { type: 'valueSet', elementType, value: values } };
}

/** 存储形态 → 编辑框文本：typed 字面值还原引号语法；null 值 → 空框；存量无 valueType 的原文显示 */
function literalNodeToText(node: any): string {
  if (node.valueType === undefined) return node.value !== undefined && node.value !== null ? String(node.value) : '';
  if (node.value === null || node.value === undefined) return '';
  if (node.valueType === 'string') return `'${node.value}'`;
  return String(node.value);
}

function literalSetNodeToText(node: any): string {
  const vals = Array.isArray(node.value) ? node.value : [];
  if (node.elementType === 'string') return `[${vals.map((v: any) => `'${v}'`).join(', ')}]`;
  return `[${vals.join(', ')}]`;
}

/** 存储形态 → 编辑形态：旧类型名映射新名；typed 字面值/字面值集 → 输入框文本 */
function storageToEditing(cfg: any): any {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const clone = JSON.parse(JSON.stringify(cfg));
  const conditions = clone?.if?.conditions;
  if (!Array.isArray(conditions)) return clone;
  for (const c of conditions) {
    for (const side of ['left', 'right'] as const) {
      const op = c?.[side];
      if (!op || typeof op !== 'object') continue;
      // 存量语义修复：in/not in 右侧的 concept 实为集合语义 → instanceSet
      if (side === 'right' && normalizeOperandType(op.type) === 'instance' && SET_OPERATORS.includes(c?.operator)) {
        op.type = 'instanceSet';
      } else {
        op.type = normalizeOperandType(op.type);
      }
      if (op.type === 'value' && 'valueType' in op) { const text = literalNodeToText(op); delete op.valueType; op.value = text; }
      if (op.type === 'valueSet' && 'elementType' in op) { const text = literalSetNodeToText(op); delete op.elementType; op.value = text; }
    }
  }
  return clone;
}

// ─── 共享操作数编辑器（左/右侧共用） ─────────────────────────────────────────

const OPERAND_TYPE_OPTIONS_LEFT = [
  { label: '实例', value: 'instance' },
  { label: '函数', value: 'function' },
];
const OPERAND_TYPE_OPTIONS_RIGHT = [
  { label: '字面值', value: 'value' },
  { label: '字面值集', value: 'valueSet' },
  { label: '实例', value: 'instance' },
  { label: '实例集', value: 'instanceSet' },
  { label: '函数', value: 'function' },
];

function OperandEditor({ obj, side, leftValueType, onPatch, conceptOptions, attributeOptions, funcOptions, funcs }: any) {
  const t = obj?.type || (side === 'left' ? 'instance' : 'value');
  const literalPlaceholder =
    leftValueType === 'string' ? `字符串用引号包裹，如 '有效'；留空 = null（空值）` :
    leftValueType === 'number' || leftValueType === 'integer' ? '数字，如 100；留空 = null（空值）' :
    leftValueType === 'boolean' ? 'true / false；留空 = null（空值）' :
    `字面值（字符串请加引号，如 '有效'）；留空 = null（空值）`;
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-muted text-xs w-12 mt-1">{side === 'left' ? '左侧' : '右侧'}</span>
      <div className="flex-1 space-y-1">
        <Select size="small" value={t} onChange={v => onPatch({ type: v })}
          options={side === 'left' ? OPERAND_TYPE_OPTIONS_LEFT : OPERAND_TYPE_OPTIONS_RIGHT} style={{ width: 120 }} popupClassName="!bg-dark-card" />
        {(t === 'instance' || t === 'instanceSet') && (
          <div className="flex gap-2">
            <Select size="small" allowClear placeholder="概念" value={obj?.concept} onChange={v => onPatch({ ...obj, type: t, concept: v, attribute: undefined })}
              options={conceptOptions} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            <Select size="small" allowClear placeholder="属性" value={obj?.attribute} onChange={v => onPatch({ ...obj, type: t, attribute: v })}
              options={obj?.concept ? attributeOptions(obj.concept) : []} style={{ width: 150 }} popupClassName="!bg-dark-card" />
          </div>
        )}
        {t === 'function' && (
          <div className="flex gap-2">
            <Select size="small" allowClear placeholder="函数" value={obj?.function} onChange={v => onPatch({ ...obj, type: t, function: v })}
              options={funcOptions} style={{ width: 150 }} popupClassName="!bg-dark-card" />
            <Select size="small" allowClear placeholder="返回字段" value={obj?.returnField} onChange={v => onPatch({ ...obj, type: t, returnField: v })}
              options={getReturnFields(funcs, obj?.function)} style={{ width: 150 }} popupClassName="!bg-dark-card" />
          </div>
        )}
        {t === 'value' && (
          <Input size="small" placeholder={literalPlaceholder} value={obj?.value ?? ''}
            onChange={e => onPatch({ type: 'value', value: e.target.value })} className="bg-dark-bg border-dark-border" style={{ width: 280 }} />
        )}
        {t === 'valueSet' && (
          <Input size="small" placeholder={`字面值集，如 ['有效', '无效'] 或 [1, 2, 3]`} value={obj?.value ?? ''}
            onChange={e => onPatch({ type: 'valueSet', value: e.target.value })} className="bg-dark-bg border-dark-border" style={{ width: 280 }} />
        )}
      </div>
    </div>
  );
}

// ─── 共享条件列表编辑器（验证/推理规则共用） ─────────────────────────────────

function ConditionList({ ifBlock, setIf, conceptOptions, attributeOptions, funcOptions, operatorOptions, funcs, getOperandType }: any) {
  const conditions = ifBlock.conditions || [];
  const updateCondition = (idx: number, patch: any) => {
    const next = [...conditions];
    next[idx] = { ...next[idx], ...patch };
    setIf({ conditions: next });
  };
  const addCondition = () => setIf({ conditions: [...conditions, { left: { type: 'instance' }, operator: 'eq', right: { type: 'value' } }] });
  const removeCondition = (idx: number) => setIf({ conditions: conditions.filter((_: any, i: number) => i !== idx) });
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-text-muted text-xs">条件逻辑</span>
        <Select size="small" value={ifBlock.logic || 'and'} onChange={v => setIf({ logic: v })}
          options={[{ label: '且 (AND)', value: 'and' }, { label: '或 (OR)', value: 'or' }]} style={{ width: 140 }} popupClassName="!bg-dark-card" />
      </div>
      <div className="space-y-2">
        {conditions.map((cond: any, idx: number) => (
          <div key={idx} className="bg-dark-card border border-dark-border rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-xs">条件 {idx + 1}</span>
              {conditions.length > 1 && (
                <Button type="link" size="small" danger onClick={() => removeCondition(idx)}>删除</Button>
              )}
            </div>
            <OperandEditor obj={cond.left} side="left" onPatch={(p: any) => updateCondition(idx, { left: p })}
              conceptOptions={conceptOptions} attributeOptions={attributeOptions} funcOptions={funcOptions} funcs={funcs} />
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-xs w-12">操作符</span>
              <Select size="small" value={cond.operator || 'eq'} onChange={v => updateCondition(idx, { operator: v })}
                options={SET_OPERAND_TYPES.includes(normalizeOperandType(cond.right?.type)) ? operatorOptions.filter((o: any) => o.value === 'in' || o.value === 'not in') : operatorOptions}
                style={{ width: 140 }} popupClassName="!bg-dark-card" />
            </div>
            <OperandEditor obj={cond.right} side="right" leftValueType={getOperandType(cond.left)} onPatch={(p: any) => updateCondition(idx, { right: p })}
              conceptOptions={conceptOptions} attributeOptions={attributeOptions} funcOptions={funcOptions} funcs={funcs} />
          </div>
        ))}
      </div>
      <Button size="small" type="dashed" onClick={addCondition} block>+ 添加条件</Button>
    </>
  );
}

// ─── Validation Rule Editor ───────────────────────────────────────────────

function ValidationRuleEditor({ config, onChange, ...rest }: any) {
  const cfg = config || {};
  const ifBlock = cfg.if || { logic: 'and', conditions: [{ left: { type: 'instance' }, operator: 'eq', right: { type: 'value' } }] };
  const setIf = (patch: any) => onChange({ ...cfg, if: { ...ifBlock, ...patch } });
  return (
    <div className="space-y-4">
      <p className="text-text-muted text-xs mb-2">配置验证条件，支持 AND/OR 多条件组合；字面值按左侧类型校验（字符串需引号包裹，留空 = null 仅"等于/不等于"可用）</p>
      <ConditionList ifBlock={ifBlock} setIf={setIf} {...rest} />
    </div>
  );
}

// ─── Inference Rule Editor ────────────────────────────────────────────────

function InferenceRuleEditor({ config, onChange, ...rest }: any) {
  const cfg = config || {};
  const ifBlock = cfg.if || { logic: 'and', conditions: [{ left: { type: 'instance' }, operator: 'eq', right: { type: 'value' } }] };
  const setIf = (patch: any) => onChange({ ...cfg, if: { ...ifBlock, ...patch } });
  return (
    <div className="space-y-4">
      <p className="text-text-muted text-xs mb-2">配置推理条件；字面值按左侧类型校验（字符串需引号包裹，留空 = null 仅"等于/不等于"可用）</p>
      <div>
        <div className="text-text-primary text-sm font-semibold mb-2">IF</div>
        <div className="pl-4 border-l-2 border-accent-blue/30 space-y-3">
          <ConditionList ifBlock={ifBlock} setIf={setIf} {...rest} />
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
  const [relations, setRelations] = useState<Relation[]>([]);

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
      const [ruleList, behList, fnList, types, conList, commonFnList, relList] = await Promise.all([getRules(ontologyId), getBehaviors(ontologyId), getFunctions(ontologyId), getRuleTemplateTypes(), getConcepts(ontologyId), getCommonFunctions(), getRelations(ontologyId)]);
      const allFuncs = [...fnList, ...commonFnList.map((f: any) => ({ ...f, related_concepts: [] as string[] }))];
      setRules(ruleList); setBehaviors(behList); setFuncs(allFuncs);
      setRuleTypeOptions([...types.map(t => ({ label: t, value: t })), { label: '其他规则', value: '其他规则' }]);
      setConcepts(conList); setRelations(relList);
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

  const handleAdd = () => { setEditData({ name: '', display_name: '', description: '', rule_type: '', position: '', related_behaviors: [], related_functions: [], data_supplements: [], rule_detail: null }); setEditingKey('__new__'); };
  const handleEdit = (r: Rule) => { setEditData({ name: r.name, display_name: r.display_name || '', description: r.description, rule_type: r.rule_type || '', position: r.position || '', related_behaviors: r.related_behaviors || [], related_functions: r.related_functions || [], data_supplements: (r as any).data_supplements || [], rule_detail: r.rule_detail }); setEditingKey(r.name); };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Rule) => {
    if (!editData.name?.trim()) { message.warning('请输入规则名称'); return; }
    try {
      // 数据补充自动推导（2026-09-05 v4：规则结构引用概念 ∪ 关联函数的关联概念，不再跑图导航）：
      // 收集 rule_detail 里引用到的概念，以及每个关联函数（本体函数）声明的关联概念
      // （函数的输入数据由这些概念的 query 行为供给，关联了函数就要能取到它要算的数；
      // 公共函数无关联概念，天然不贡献）→ 取关联这些概念的 query 行为（只读接口）→
      // 剔除规则自身关联行为（主行为结果已在手，不做自己的补充）。
      const deriveSupplements = (): string[] => {
        const mains: string[] = editData.related_behaviors || [];
        const usedConcepts = collectRuleRefs(editData.rule_detail).concepts;
        for (const fname of (editData.related_functions || []) as string[]) {
          const fn = funcs.find(f => f.name === fname);
          for (const c of fn?.related_concepts || []) usedConcepts.add(c);
        }
        if (usedConcepts.size === 0) return [];
        return behaviors
          .filter(b => b.op_type === 'query'
            && !mains.includes(b.name)
            && (b.related_concepts || []).some(c => usedConcepts.has(c)))
          .map(b => b.name);
      };
      const derivedSupplements = deriveSupplements();

      const data: any = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '', rule_type: editData.rule_type || '', position: editData.position || '', related_behaviors: editData.related_behaviors || [], related_functions: editData.related_functions || [], data_supplements: derivedSupplements, rule_detail: normalizeDetail(editData.rule_detail) };
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
  // 例外：字面值/字面值集节点的 value 允许为 null（空值语义），必须原样保留不被洗成空串
  const normalizeDetail = (obj: any): any => {
    if (obj === null || obj === undefined) return '';
    if (Array.isArray(obj)) return obj.map(normalizeDetail);
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'value' && ['value', 'valueSet'].includes((obj as any).type)) {
          if (v !== undefined) cleaned[k] = v;
          continue;
        }
        cleaned[k] = normalizeDetail(v);
      }
      return cleaned;
    }
    return obj;
  };

  // 规则结构（rule_detail 树）实际引用的 函数/概念 收集——
  // saveRuleDesign 的陈旧引用警告、handleSave 的数据补充推导共用同一份，保证口径一致。
  const collectRuleRefs = (cfg: any): { funcs: Set<string>; concepts: Set<string> } => {
    const funcs = new Set<string>();
    const concepts = new Set<string>();
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.function === 'string' && node.function) funcs.add(node.function);
      if (typeof node.concept === 'string' && node.concept) concepts.add(node.concept);
      for (const v of Object.values(node)) walk(v);
    };
    walk(cfg);
    return { funcs, concepts };
  };

  // 规则设计器选项收窄（2026-08-25 拍板v2）：函数限定于规则「关联函数」；
  // 实例/实例集的概念 = 规则「关联行为」的关联概念（种子）∪ 种子沿关系图的一阶邻居
  // （仅走 source_attr/target_attr 两端都填了关联字段的边）——设计时引用的，运行时必然已挂载/可回溯。
  const designFuncOptions = functionOptions.filter(o => (editData.related_functions || []).includes(o.value));
  const designSeedConcepts = new Set(
    behaviors.filter(b => (editData.related_behaviors || []).includes(b.name))
      .flatMap(b => b.related_concepts || [])
  );
  const designConceptNameSet = new Set(designSeedConcepts);
  for (const r of relations) {
    if (!r.source_attr || !r.target_attr) continue; // 无 join 键的边不参与导航
    if (designSeedConcepts.has(r.source)) designConceptNameSet.add(r.target);
    if (designSeedConcepts.has(r.target)) designConceptNameSet.add(r.source);
  }
  const designConceptOptions = conceptOptions.filter(o => designConceptNameSet.has(o.value));

  // 操作数的值类型：instance/instanceSet 查概念属性类型；function 查返回字段类型；未知返回 null（宁漏勿拦）
  const getOperandType = (op: any): string | null => {
    if (!op || typeof op !== 'object') return null;
    const t = normalizeOperandType(op.type);
    if (t === 'instance' || t === 'instanceSet') {
      const c = concepts.find(c => c.name === op.concept);
      const attr = (c?.attributes || []).find((a: any) => a.name === op.attribute);
      return attr?.type || null;
    }
    if (t === 'function') {
      const fn = funcs.find(f => f.name === op.function);
      const resp: any = fn?.response;
      const props: any = resp?.result?.properties || resp?.properties || {};
      return op.returnField ? (props[op.returnField]?.type || null) : null;
    }
    return null;
  };

  /**
   * 编辑形态 → 存储形态：逐条件校验并转换字面值/字面值集。
   * 返回 { ok:true, cfg } 或 { ok:false, error }（error 已含条件序号）。
   * 校验矩阵：instanceSet/valueSet 只能配 in/not in；in/not in 右侧只能是集合类型。
   */
  const buildStorageConditions = (conditions: any[]): { ok: true; conditions: any[] } | { ok: false; error: string } => {
    const out: any[] = [];
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      const left = c.left || {};
      const leftType = normalizeOperandType(left.type);
      if (leftType === 'instance' && (!left.concept || !left.attribute)) {
        return { ok: false, error: `条件 ${i + 1} 左侧不完整，请选择概念和属性` };
      }
      if (leftType === 'function' && (!left.function || !left.returnField)) {
        return { ok: false, error: `条件 ${i + 1} 左侧不完整，请选择函数并填写返回字段` };
      }
      if (!c.operator) return { ok: false, error: `条件 ${i + 1} 未选择操作符` };
      const right = c.right || {};
      const rightType = normalizeOperandType(right.type);
      // 操作符 ↔ 右侧类型矩阵
      if (SET_OPERAND_TYPES.includes(rightType) && !SET_OPERATORS.includes(c.operator)) {
        return { ok: false, error: `条件 ${i + 1}：右侧为${rightType === 'instanceSet' ? '实例集' : '字面值集'}，操作符只能用"属于/不属于"` };
      }
      if (SET_OPERATORS.includes(c.operator) && !SET_OPERAND_TYPES.includes(rightType)) {
        return { ok: false, error: `条件 ${i + 1}："属于/不属于"的右侧必须是实例集或字面值集` };
      }
      let rightOut: any;
      if (rightType === 'value') {
        const r = parseLiteralInput(right.value, getOperandType(left));
        if (!r.ok) return { ok: false, error: `条件 ${i + 1} 右侧：${r.error}` };
        // 空值（value 为 null）仅 eq/ne 放行（判空语义）；其他操作符对空值比较基本是笔误
        if (r.node.value === null && c.operator !== 'eq' && c.operator !== 'ne') {
          return { ok: false, error: `条件 ${i + 1} 右侧字面值为空（仅"等于/不等于"允许空值，用于判空）` };
        }
        rightOut = r.node;
      } else if (rightType === 'valueSet') {
        const r = parseLiteralSetInput(right.value, getOperandType(left));
        if (!r.ok) return { ok: false, error: `条件 ${i + 1} 右侧：${r.error}` };
        rightOut = r.node;
      } else if (rightType === 'instance' || rightType === 'instanceSet') {
        if (!right.concept || !right.attribute) {
          return { ok: false, error: `条件 ${i + 1} 右侧不完整，请选择概念和属性` };
        }
        rightOut = { ...right, type: rightType };
      } else if (rightType === 'function') {
        if (!right.function || !right.returnField) {
          return { ok: false, error: `条件 ${i + 1} 右侧不完整，请选择函数并填写返回字段` };
        }
        rightOut = { ...right, type: rightType };
      } else {
        return { ok: false, error: `条件 ${i + 1} 右侧类型无效` };
      }
      out.push({ ...c, left: { ...left, type: leftType }, right: rightOut });
    }
    return { ok: true, conditions: out };
  };

  const openRuleDesign = async () => {
    if (!editData.rule_type || editData.rule_type === '其他规则') return;
    setRuleConfig(editData.rule_detail ? storageToEditing(normalizeDetail(JSON.parse(JSON.stringify(editData.rule_detail)))) : null);
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

    if (editData.rule_type === '验证规则' || editData.rule_type === '推理规则') {
      const conditions = cfg.if?.conditions || [];
      if (conditions.length === 0) { message.warning('请至少添加一个条件'); return; }
      // 编辑形态 → 存储形态：字面值按左侧类型解析，操作符↔右侧类型矩阵校验
      const built = buildStorageConditions(conditions);
      if (!built.ok) { message.warning(built.error); return; }
      const storageCfg = { ...cfg, if: { ...(cfg.if || {}), conditions: built.conditions } };

      // 存量兼容：已设计的引用可能超出收窄后的选项集——保留并警告，不静默清掉
      const { funcs: usedFuncs, concepts: usedConcepts } = collectRuleRefs(storageCfg);
      const badFuncs = [...usedFuncs].filter(f => !(editData.related_functions || []).includes(f));
      const badConcepts = [...usedConcepts].filter(c => !designConceptNameSet.has(c));
      if (badFuncs.length > 0 || badConcepts.length > 0) {
        message.warning(`以下引用不在关联声明内，运行时可能无法求值（建议调整）：${badFuncs.length ? `函数[${badFuncs.join('、')}]` : ''}${badFuncs.length && badConcepts.length ? '；' : ''}${badConcepts.length ? `概念[${badConcepts.join('、')}]` : ''}`);
      }

      setEditData(p => ({ ...p, rule_detail: normalizeDetail(storageCfg) }));
      message.success('规则结构已保存到编辑缓存');
      setRuleDesignModalOpen(false);
      return;
    }

    setEditData(p => ({ ...p, rule_detail: normalizeDetail(ruleConfig) }));
    message.success('规则结构已保存到编辑缓存');
    setRuleDesignModalOpen(false);
  };

  const renderCell = (val: any, record: Rule, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');
    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'display_name') return <Input size="small" value={editData.display_name || ''} onChange={e => setEditData(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'rule_type') return <Select size="small" allowClear placeholder="选择" value={editData.rule_type || undefined} onChange={v => { const isNormal = v === '其他规则'; setEditData(p => ({...p, rule_type: v || '', rule_detail: isNormal ? null : p.rule_detail })); }} options={ruleTypeOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'position') return <Select size="small" allowClear placeholder="选择" value={editData.position || undefined} onChange={v => setEditData(p => ({...p, position: v || ''}))} options={[{label:'前置',value:'前置'},{label:'后置',value:'后置'}]} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'related_behaviors') return <Select size="small" mode="multiple" placeholder="选择" value={editData.related_behaviors || []} onChange={v => setEditData(p => ({...p, related_behaviors: v}))} options={behaviorOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'related_functions') return <Select size="small" mode="multiple" placeholder="选择" value={editData.related_functions || []} onChange={v => setEditData(p => ({...p, related_functions: v}))} options={functionOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    // 数据补充：保存时按规则结构引用概念 ∪ 关联函数的关联概念自动推导（见 handleSave），列只读展示
    return render ? render(val) : (val || '-');
  };

  const dataSource = rules.map(r => ({ ...r, _key: r.name }));
  if (editingKey === '__new__') dataSource.push({ name: '__new__', display_name: '', description: '', rule_type: '', position: '', related_behaviors: [], related_functions: [], data_supplements: [] } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 90, render: (v: any, r: Rule) => {
      // 未关联函数的规则在名称旁加叹号警示：规则无函数调用痕迹，运行期无法审计（与 prompts.py 阶段6B 要求2 口径一致）
      const editing = isEditing(r) || (editingKey === '__new__' && r.name === '__new__');
      if (editing || (r.related_functions || []).length > 0) return renderCell(v, r, 'name');
      return (
        <Tooltip title="该规则未关联函数，在调用中无法正常审计">
          <span><WarningOutlined style={{ color: '#f59e0b', marginRight: 4 }} />{renderCell(v, r, 'name')}</span>
        </Tooltip>
      );
    }},
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
    { title: '规则类型', dataIndex: 'rule_type', key: 'rule_type', width: 75, render: (v: any, r: Rule) => renderCell(v, r, 'rule_type', (v2: string) => v2 || '-') },
    { title: '介入位置', dataIndex: 'position', key: 'position', width: 50, render: (v: any, r: Rule) => renderCell(v, r, 'position', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', width: 160, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'description') },
    { title: '关联行为', dataIndex: 'related_behaviors', key: 'related_behaviors', width: 120, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_behaviors', (list: string[]) => list?.map(name => behaviors.find(b => b.name === name)?.display_name || name).join(', ') || '-') },
    { title: '关联函数', dataIndex: 'related_functions', key: 'related_functions', width: 120, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_functions', (list: string[]) => list?.map(name => funcs.find(f => f.name === name)?.display_name || name).join(', ') || '-') },
    { title: '数据补充', dataIndex: 'data_supplements', key: 'data_supplements', width: 120, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'data_supplements', (list: string[]) => list?.map(name => behaviors.find(b => b.name === name)?.display_name || name).join(', ') || '-') },
    { title: '规则结构', dataIndex: 'rule_design', key: 'rule_design', width: 75, render: (_: any, r: Rule) => {
      const editing = isEditing(r);
      const isNew = editingKey === '__new__' && r.name === '__new__';
      const rt = editing ? editData.rule_type : r.rule_type;
      const isNormal = rt === '其他规则';
      if (!editing && !isNew) {
        if (isNormal) return <span className="text-text-muted text-xs">-</span>;
        const hasConfig = r.rule_detail && Object.keys(r.rule_detail).length > 0;
        return <span className={`text-xs ${hasConfig ? 'text-green-500' : 'text-text-muted'}`}>{hasConfig ? '已设计' : '未设计'}</span>;
      }
      if (isNormal) return <span className="text-text-muted text-xs">-</span>;
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
      <p className="text-text-muted text-xs mb-3">配置行为执行前后的约束规则（验证规则和推理规则可以进行精细的规则结构设计，其他规则则侧重于语义上的自由表达，无结构设计。数据补充是指完成该规则校验还需要的额外数据查询）</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      {/* ─── Rule Design Modal ──────────────────────────────────────────── */}
      <Modal
        title={`规则结构 - ${editData.display_name || editData.name || ''}`}
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
              setRuleConfig(storageToEditing(result.rule_detail));
              message.success('规则已智能生成，请确认后保存');
            } catch (e: any) { message.error('生成失败: ' + e.message); }
            finally { setGenLoading(false); }
          }}>智能生成</Button>
        </div>
        {!editData.rule_type ? (
          <p className="text-text-muted">请先选择规则类型后再进行规则结构</p>
        ) : templateLoading ? (
          <div className="flex items-center justify-center h-40"><span className="text-text-muted">加载模板中...</span></div>
        ) : !ruleTemplate ? (
          <p className="text-text-muted">未找到规则模板</p>
        ) : ruleTemplate.ruleName === '验证规则' ? (
          <>
            <p className="text-text-muted text-xs mb-3">
              函数选项限定于「关联函数」，实例/实例集限定于「关联行为」的关联概念及其一阶关联概念（沿关联概念属性齐全的关系走一跳）
              {!(editData.related_functions || []).length && <span className="text-yellow-500">；当前未选关联函数，函数不可选，请先在表格中填写</span>}
              {!(editData.related_behaviors || []).length && <span className="text-yellow-500">；当前未选关联行为，实例/实例集不可选，请先在表格中填写</span>}
            </p>
            <ValidationRuleEditor config={ruleConfig} onChange={setRuleConfig} conceptOptions={designConceptOptions} attributeOptions={attributeOptions} funcOptions={designFuncOptions} operatorOptions={OPERATOR_OPTIONS} funcs={funcs} getOperandType={getOperandType} />
          </>
        ) : ruleTemplate.ruleName === '推理规则' ? (
          <>
            <p className="text-text-muted text-xs mb-3">
              函数选项限定于「关联函数」，实例/实例集限定于「关联行为」的关联概念及其一阶关联概念（沿关联概念属性齐全的关系走一跳）
              {!(editData.related_functions || []).length && <span className="text-yellow-500">；当前未选关联函数，函数不可选，请先在表格中填写</span>}
              {!(editData.related_behaviors || []).length && <span className="text-yellow-500">；当前未选关联行为，实例/实例集不可选，请先在表格中填写</span>}
            </p>
            <InferenceRuleEditor config={ruleConfig} onChange={setRuleConfig} conceptOptions={designConceptOptions} attributeOptions={attributeOptions} funcOptions={designFuncOptions} operatorOptions={OPERATOR_OPTIONS} funcs={funcs} getOperandType={getOperandType} />
          </>
        ) : (
          <p className="text-text-muted">不支持的规则模板: {ruleTemplate.ruleName}</p>
        )}
      </Modal>
    </div>
  );
}
