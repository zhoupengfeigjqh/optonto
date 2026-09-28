'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button, Input, Select, Modal, message, Space, Tooltip, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, FileTextOutlined, RobotOutlined, WarningOutlined } from '@ant-design/icons';
import { getRules, createRule, updateRule, deleteRule, getBehaviors, getFunctions, getCommonFunctions, getRuleTemplateTypes, getRuleTemplate, getConcepts, getRelations, generateRule, Rule, Behavior, Function, Concept, Relation } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import {
  parseLiteralInput, parseLiteralSetInput, storageToEditing,
  normalizeOperandType, SET_OPERAND_TYPES, SET_OPERATORS,
} from './rule/rule-operands';
import { ValidationRuleEditor, InferenceRuleEditor } from './rule/RuleEditors';

interface Props { ontologyId: number; activeTab?: string; }

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

  // 编辑态自动推导 data_supplements（关联行为/函数/规则结构变化时自动预填，用户可手工增减）
  useEffect(() => {
    if (!editingKey) return;
    const mains: string[] = editData.related_behaviors || [];
    const usedConcepts = collectRuleRefs(editData.rule_detail).concepts;
    for (const fname of (editData.related_functions || []) as string[]) {
      const fn = funcs.find(f => f.name === fname);
      for (const c of fn?.related_concepts || []) usedConcepts.add(c);
    }
    if (usedConcepts.size === 0) {
      if ((editData.data_supplements || []).length > 0) {
        setEditData(p => ({ ...p, data_supplements: [] }));
      }
      return;
    }
    const derived = behaviors
      .filter(b => b.op_type === 'query'
        && !mains.includes(b.name)
        && (b.related_concepts || []).some(c => usedConcepts.has(c)))
      .map(b => b.name);
    setEditData(p => ({ ...p, data_supplements: derived }));
  }, [editingKey, editData.related_behaviors, editData.related_functions, editData.rule_detail, behaviors, funcs]);

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
      // 数据补充：编辑态已自动推导（见上方 useEffect），用户可手工增减，此处直接使用最终值
      const data: any = { name: editData.name.trim(), display_name: editData.display_name?.trim() || '', description: editData.description?.trim() || '', rule_type: editData.rule_type || '', position: editData.position || '', related_behaviors: editData.related_behaviors || [], related_functions: editData.related_functions || [], data_supplements: editData.data_supplements || [], rule_detail: normalizeDetail(editData.rule_detail) };
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
      if (conditions.length === 0) {
        // 条件为空 → 清空规则结构
        setEditData(p => ({ ...p, rule_detail: null }));
        message.success('规则结构已清空');
        setRuleDesignModalOpen(false);
        return;
      }
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
    if (dataIndex === 'data_supplements') {
      // 数据补充：编辑态自动推导（见上方 useEffect），用户可在此手工增减
      const queryBehaviorOptions = behaviors
        .filter(b => b.op_type === 'query')
        .map(b => ({ label: b.display_name || b.name, value: b.name }));
      return (
        <div className="flex items-center gap-1">
          <Select
            size="small"
            mode="multiple"
            placeholder="自动推导，可手工增减"
            value={editData.data_supplements || []}
            onChange={v => setEditData(p => ({...p, data_supplements: v}))}
            options={queryBehaviorOptions}
            style={{ width: '100%' }}
            popupClassName="!bg-dark-card"
          />
          <Tooltip title="重新自动推导">
            <Button
              size="small"
              type="text"
              icon={<RobotOutlined />}
              onClick={() => {
                const mains: string[] = editData.related_behaviors || [];
                const usedConcepts = collectRuleRefs(editData.rule_detail).concepts;
                for (const fname of (editData.related_functions || []) as string[]) {
                  const fn = funcs.find(f => f.name === fname);
                  for (const c of fn?.related_concepts || []) usedConcepts.add(c);
                }
                const derived = usedConcepts.size === 0 ? [] : behaviors
                  .filter(b => b.op_type === 'query'
                    && !mains.includes(b.name)
                    && (b.related_concepts || []).some(c => usedConcepts.has(c)))
                  .map(b => b.name);
                setEditData(p => ({...p, data_supplements: derived}));
              }}
            />
          </Tooltip>
        </div>
      );
    }
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
    { title: '中文名称', dataIndex: 'display_name', key: 'display_name', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'display_name', (v2: string) => v2 || '-') },
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
              {!(editData.related_functions || []).length && <span className="text-yellow-500">；当前未选关联函数</span>}
              {!(editData.related_behaviors || []).length && <span className="text-yellow-500">；当前未选关联行为</span>}
            </p>
            <ValidationRuleEditor config={ruleConfig} onChange={setRuleConfig} conceptOptions={designConceptOptions} attributeOptions={attributeOptions} funcOptions={designFuncOptions} operatorOptions={OPERATOR_OPTIONS} funcs={funcs} getOperandType={getOperandType} />
          </>
        ) : ruleTemplate.ruleName === '推理规则' ? (
          <>
            <p className="text-text-muted text-xs mb-3">
              函数选项限定于「关联函数」，实例/实例集限定于「关联行为」的关联概念及其一阶关联概念（沿关联概念属性齐全的关系走一跳）
              {!(editData.related_functions || []).length && <span className="text-yellow-500">；当前未选关联函数</span>}
              {!(editData.related_behaviors || []).length && <span className="text-yellow-500">；当前未选关联行为</span>}
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
