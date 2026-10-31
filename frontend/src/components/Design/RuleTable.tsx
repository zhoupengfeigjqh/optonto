'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { getRules, createRule, updateRule, deleteRule, getBehaviors, getFunctions, getCommonFunctions, Rule, Behavior, Function } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';
import { useTablePagination } from '@/lib/table-pagination';
import { resolveOpType } from './behavior-op-type';
import { deriveDataSupplements } from './rule/rule-logic';
import { functionLabel, functionLabelParts } from './rule/function-label';
import RuleDesignModal from './rule/RuleDesignModal';
import {
  designExpression, designSummary, operatorMeta,
  type RuleDesign, type RuleFunctionOption,
} from './rule/rule-design';

interface Props { ontologyId: number; activeTab?: string; }

/** 规则设计弹窗的打开上下文（打开时快照，避免编辑态 setState 异步读到旧值） */
interface DesignTarget {
  name: string;
  title: string;
  /** 规则描述：智能生成的上下文依据 */
  description: string;
  behavior: string;
  position: string;
  functions: RuleFunctionOption[];
  value: RuleDesign | null;
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function RuleTable({ ontologyId, activeTab }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [funcs, setFuncs] = useState<Function[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});
  const { pagination, goToRow } = useTablePagination();

  // 规则设计弹窗（spec 007）：弹窗只改 editData，仍由行尾 ✓ 统一落盘
  const [designOpen, setDesignOpen] = useState(false);
  const [designTarget, setDesignTarget] = useState<DesignTarget | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [ruleList, behList, fnList, commonFnList] = await Promise.all([getRules(ontologyId), getBehaviors(ontologyId), getFunctions(ontologyId), getCommonFunctions()]);
      const allFuncs = [
        ...fnList.map((f: any) => ({ ...f, origin: 'ontology' as const })),
        ...commonFnList.map((f: any) => ({ ...f, related_concepts: [] as string[], type: '', origin: 'common' as const })),
      ];
      setRules(ruleList); setBehaviors(behList); setFuncs(allFuncs);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'rules') load(); }, [ontologyId, activeTab]);

  const isEditing = (record: Rule) => record.name === editingKey;
  const behaviorOptions = behaviors.map(b => ({ label: b.title || b.name, value: b.name }));
  // 关联函数展示口径（2026-09-30 统一）：`中文名-类型`（口径与单测见 rule/function-label.ts）
  const funcLabel = (name: string) => functionLabelParts(funcs.find(x => x.name === name) as any, name);
  const functionOptions = funcs.map(f => ({ label: functionLabel(f as any, f.name), value: f.name }));

  // 编辑态自动推导 data_supplements（关联函数声明的关联概念 → query 行为；用户可手工增减）
  useEffect(() => {
    if (!editingKey) return;
    const derived = deriveDataSupplements({
      behavior: editData.behavior || '',
      relatedFunctions: editData.related_functions || [],
      funcs, behaviors,
    });
    const cur: string[] = editData.data_supplements || [];
    if (cur.length === derived.length && cur.every((v, i) => v === derived[i])) return;
    setEditData(p => ({ ...p, data_supplements: derived }));
  }, [editingKey, editData.behavior, editData.related_functions, editData.data_supplements, funcs, behaviors]);

  const emptyEdit = { name: '', title: '', description: '', position: '', behavior: '', related_functions: [], data_supplements: [], rule_design: null };
  const handleAdd = () => { setEditData({ ...emptyEdit }); setEditingKey('__new__'); goToRow(rules.length); };
  const handleEdit = (r: Rule) => {
    setEditData({ name: r.name, title: r.title || '', description: r.description, position: r.position || '', behavior: r.behavior || '', related_functions: r.related_functions || [], data_supplements: r.data_supplements || [], rule_design: r.rule_design ?? null });
    setEditingKey(r.name);
  };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (record: Rule) => {
    if (!editData.name?.trim()) { message.warning('请输入规则名称'); return; }
    try {
      const data: any = {
        name: editData.name.trim(), title: editData.title?.trim() || '', description: editData.description?.trim() || '',
        position: editData.position || '',
        behavior: editData.behavior || '', related_functions: editData.related_functions || [],
        data_supplements: editData.data_supplements || [],
        rule_design: editData.rule_design ?? null,
      };
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

  /** 打开规则设计弹窗：非编辑态先进入行内编辑态，并把弹窗上下文做快照 */
  const handleOpenDesign = (record: Rule) => {
    const isNewRow = record.name === '__new__';
    const editing = isEditing(record) || (editingKey === '__new__' && isNewRow);
    const relatedFunctions: string[] = (editing ? editData.related_functions : record.related_functions) || [];

    if (!editing) {
      setEditData({
        name: record.name, title: record.title || '', description: record.description || '',
        position: record.position || '', behavior: record.behavior || '',
        related_functions: relatedFunctions, data_supplements: record.data_supplements || [],
        rule_design: record.rule_design ?? null,
      });
      setEditingKey(record.name);
    }

    setDesignTarget({
      name: record.name,
      title: record.title || '',
      description: (editing ? editData.description : record.description) || '',
      behavior: record.behavior || '',
      position: record.position || '',
      functions: funcs
        .filter(f => relatedFunctions.includes(f.name))
        .map(f => ({
          name: f.name,
          title: f.title,
          type: f.type,
          origin: (f as any).origin,
          response: (f as any).response,
        })),
      value: (editing ? (editData.rule_design ?? null) : (record.rule_design ?? null)) as RuleDesign | null,
    });
    setDesignOpen(true);
  };

  const renderCell = (val: any, record: Rule, dataIndex: string, render?: (v: any) => any) => {
    const editing = isEditing(record);
    const isNew = editingKey === '__new__' && record.name === '__new__';
    if (!editing && !isNew) return render ? render(val) : (val || '-');
    if (dataIndex === 'name') return <Input size="small" value={editData.name || ''} onChange={e => setEditData(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'title') return <Input size="small" value={editData.title || ''} onChange={e => setEditData(p => ({...p, title: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'position') return <Select size="small" allowClear placeholder="选择" value={editData.position || undefined} onChange={v => setEditData(p => ({...p, position: v || ''}))} options={[{label:'前置',value:'前置'},{label:'后置',value:'后置'}]} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'description') return <Input size="small" value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />;
    if (dataIndex === 'behavior') return <Select size="small" allowClear placeholder="选择" value={editData.behavior || undefined} onChange={v => setEditData(p => ({...p, behavior: v || ''}))} options={behaviorOptions} style={{width:'100%'}} popupClassName="!bg-dark-card" />;
    if (dataIndex === 'related_functions') {
      return (
        <Select
          size="small"
          mode="multiple"
          placeholder="选择关联函数（VALIDATION 型本体函数为判断函数）"
          value={editData.related_functions || []}
          onChange={v => setEditData(p => ({ ...p, related_functions: v }))}
          options={functionOptions}
          style={{ width: '100%' }}
          popupClassName="!bg-dark-card"
        />
      );
    }
    if (dataIndex === 'data_supplements') {
      // 数据补充：编辑态自动推导（见上方 useEffect），用户可在此手工增减
      const queryBehaviorOptions = behaviors
        .filter(b => resolveOpType(b).type === 'query')
        .map(b => ({ label: b.title || b.name, value: b.name }));
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
          <Tooltip title="重新自动推导（按关联函数声明的关联概念 → query 行为）">
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => setEditData(p => ({ ...p, data_supplements: deriveDataSupplements({
                behavior: p.behavior || '',
                relatedFunctions: p.related_functions || [],
                funcs, behaviors,
              }) }))}
            />
          </Tooltip>
        </div>
      );
    }
    return render ? render(val) : (val || '-');
  };

  const dataSource = rules.map(r => ({ ...r, _key: r.name }));
  if (editingKey === '__new__') dataSource.push({ ...emptyEdit, name: '__new__' } as any);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 90, render: (v: any, r: Rule) => {
      // 未关联任何函数的规则在名称旁加叹号警示：无函数调用痕迹，运行期无法审计
      const editing = isEditing(r) || (editingKey === '__new__' && r.name === '__new__');
      if (editing || (r.related_functions || []).length > 0) return renderCell(v, r, 'name');
      return (
        <Tooltip title="该规则未关联函数，在调用中无法正常审计">
          <span><WarningOutlined style={{ color: '#f59e0b', marginRight: 4 }} />{renderCell(v, r, 'name')}</span>
        </Tooltip>
      );
    }},
    { title: '中文名称', dataIndex: 'title', key: 'title', width: 90, render: (v: any, r: Rule) => renderCell(v, r, 'title', (v2: string) => v2 || '-') },
    { title: '介入位置', dataIndex: 'position', key: 'position', width: 55, render: (v: any, r: Rule) => renderCell(v, r, 'position', (v2: string) => v2 || '-') },
    { title: '描述', dataIndex: 'description', key: 'description', width: 180, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'description') },
    { title: '绑定行为', dataIndex: 'behavior', key: 'behavior', width: 120, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'behavior', (v2: string) => behaviors.find(b => b.name === v2)?.title || v2 || '-') },
    { title: '关联函数', dataIndex: 'related_functions', key: 'related_functions', width: 220, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'related_functions', (list: string[]) => {
      if (!list || list.length === 0) return '-';
      return list.map(name => {
        const { base, typeLabel, isJudge } = funcLabel(name);
        const text = `${base}-${typeLabel}`;
        if (isJudge) {
          return <Tooltip key={name} title="判断函数：运行期返回 data.pass/reason，判断不通过时系统拒绝主行为"><span className="text-cyan-400 mr-1">{text}</span></Tooltip>;
        }
        return <span key={name} className="mr-1">{text}</span>;
      });
    }) },
    { title: '数据补充', dataIndex: 'data_supplements', key: 'data_supplements', width: 140, ellipsis: true, render: (v: any, r: Rule) => renderCell(v, r, 'data_supplements', (list: string[]) => list?.map(name => behaviors.find(b => b.name === name)?.title || name).join(', ') || '-') },
    { title: '规则设计', dataIndex: 'rule_design', key: 'rule_design', width: 118,
      render: (_: any, r: Rule) => {
        const rowEditing = isEditing(r) || (editingKey === '__new__' && r.name === '__new__');
        const design = (rowEditing ? editData.rule_design : r.rule_design) as RuleDesign | null | undefined;
        const summary = designSummary(design);
        const expression = design ? designExpression(design, c => {
          const op = operatorMeta(c.operator);
          const values = (c.values || []).join(', ');
          return `${c.field || '?'} ${op?.label || '?'}${op && op.arity === 0 ? '' : ` ${values}`}`.trim();
        }) : '';
        return (
          <div className="flex items-center gap-1">
            {summary
              ? <Tooltip title={expression}><span className="text-text-primary text-xs">{summary}</span></Tooltip>
              : <span className="text-text-muted text-xs">未设计</span>}
            <Tooltip title="规则设计（点击打开弹窗）">
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleOpenDesign(r)} />
            </Tooltip>
          </div>
        );
      } },
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
      <p className="text-text-muted text-xs mb-3">配置行为执行前后的约束规则（规则绑定唯一行为；约束逻辑由「关联函数」承载，前置规则判断不通过时系统拒绝主行为；数据补充按关联函数声明的关联概念自动推导对应的查询行为，可手工增减；「规则设计」把关联函数的判断组合成可读逻辑）</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={pagination} />
      {designTarget && (
        <RuleDesignModal
          open={designOpen}
          ontologyId={ontologyId}
          ruleName={designTarget.name}
          ruleTitle={designTarget.title}
          ruleDescription={designTarget.description}
          behaviorName={designTarget.behavior}
          behaviorLabel={behaviors.find(b => b.name === designTarget.behavior)?.title || designTarget.behavior}
          position={designTarget.position}
          functions={designTarget.functions}
          value={designTarget.value}
          onCancel={() => setDesignOpen(false)}
          onSave={(design) => {
            setEditData(p => ({ ...p, rule_design: design }));
            setDesignOpen(false);
            message.success('规则设计已更新，点行尾 ✓ 保存到规则');
          }}
        />
      )}
    </div>
  );
}
