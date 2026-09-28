'use client';

/** 规则编辑器子组件（自 RuleTable.tsx 抽取，行为不变）：操作数编辑器 + 条件列表 + 验证/推理规则编辑器。 */
import { Button, Input, Select } from 'antd';
import {
  getReturnFields, normalizeOperandType, SET_OPERAND_TYPES,
  OPERAND_TYPE_OPTIONS_LEFT, OPERAND_TYPE_OPTIONS_RIGHT,
} from './rule-operands';

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
              <Button type="link" size="small" danger onClick={() => removeCondition(idx)}>删除</Button>
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

export function ValidationRuleEditor({ config, onChange, ...rest }: any) {
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

export function InferenceRuleEditor({ config, onChange, ...rest }: any) {
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
