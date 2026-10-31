'use client';

/**
 * 规则设计的条件行（spec 007）：关联函数 → 返回字段（支持嵌套下钻）→ 运算符 → 取值。
 *
 * 纯展示 + 回调：状态由 `RuleDesignModal` 持有；函数只允许从该规则的关联函数中选择。
 */

import { Button, Input, InputNumber, Select, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { functionLabel } from './function-label';
import {
  defaultCondition,
  defaultValuesFor,
  findFieldOption,
  flattenResponseFields,
  operatorMeta,
  operatorsForType,
  type RuleCondition,
  type RuleFunctionOption,
} from './rule-design';

interface Props {
  condition: RuleCondition;
  /** 该规则的关联函数（唯一可选范围） */
  functions: RuleFunctionOption[];
  /** 行内错误（校验结果） */
  error?: string;
  /** 函数已不在关联函数中（悬空） */
  dangling?: boolean;
  onChange: (next: RuleCondition) => void;
  onRemove: () => void;
}

const INPUT_CLASS = 'bg-dark-bg border-dark-border text-text-primary';

export default function RuleDesignCondition({
  condition, functions, error, dangling, onChange, onRemove,
}: Props) {
  const responseOf = (name: string) => functions.find(f => f.name === name)?.response;
  const fields = flattenResponseFields(responseOf(condition.function));
  const selected = findFieldOption(responseOf(condition.function), condition.field);
  const operators = operatorsForType(selected?.type);
  const meta = operatorMeta(condition.operator);
  const values = condition.values || [];

  const setValues = (next: string[]) => onChange({ ...condition, values: next });

  const handleFunction = (name: string) => {
    onChange(defaultCondition(name, responseOf(name)));
  };

  const handleField = (path: string) => {
    const option = findFieldOption(responseOf(condition.function), path);
    const allowed = operatorsForType(option?.type);
    const nextMeta = allowed[0];
    onChange({
      ...condition,
      field: path,
      operator: nextMeta?.code || '',
      values: defaultValuesFor(nextMeta, option?.type),
    });
  };

  const handleOperator = (code: string) => {
    const nextMeta = operatorMeta(code);
    onChange({
      ...condition,
      operator: (code || '') as RuleCondition['operator'],
      values: defaultValuesFor(nextMeta, selected?.type),
    });
  };

  const valueControl = () => {
    if (!meta || meta.arity === 0) {
      return <span className="text-text-muted text-xs">（无需取值）</span>;
    }
    if (meta.arity === 2) {
      return (
        <div className="flex items-center gap-1">
          <InputNumber
            size="small" style={{ width: '100%' }}
            value={values[0] === '' || values[0] === undefined ? null : Number(values[0])}
            onChange={v => setValues([v == null ? '' : String(v), values[1] || ''])}
          />
          <span className="text-text-muted text-xs">~</span>
          <InputNumber
            size="small" style={{ width: '100%' }}
            value={values[1] === '' || values[1] === undefined ? null : Number(values[1])}
            onChange={v => setValues([values[0] || '', v == null ? '' : String(v)])}
          />
        </div>
      );
    }
    if (meta.arity === -1) {
      return (
        <Select
          size="small" mode="tags" style={{ width: '100%' }}
          placeholder="多个取值，回车或逗号分隔"
          value={values}
          onChange={(v: string[]) => setValues(v)}
          tokenSeparators={[',', '，']}
          popupClassName="!bg-dark-card"
        />
      );
    }
    if (selected?.type === 'boolean') {
      return (
        <Select
          size="small" style={{ width: '100%' }}
          value={values[0] === 'false' ? 'false' : 'true'}
          onChange={(v: string) => setValues([v])}
          options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
          popupClassName="!bg-dark-card"
        />
      );
    }
    if (selected?.type === 'number' || selected?.type === 'integer') {
      return (
        <InputNumber
          size="small" style={{ width: '100%' }}
          value={values[0] === '' || values[0] === undefined ? null : Number(values[0])}
          onChange={v => setValues([v == null ? '' : String(v)])}
        />
      );
    }
    return (
      <Input
        size="small" className={INPUT_CLASS}
        placeholder="填写结果值"
        value={values[0] || ''}
        onChange={e => setValues([e.target.value])}
      />
    );
  };

  const message = error || (dangling ? '函数已不在关联函数中，请重新选择' : '');

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <Select
          size="small" style={{ width: 240 }}
          value={condition.function || undefined}
          placeholder="选择关联函数"
          onChange={handleFunction}
          options={functions.map(f => ({ value: f.name, label: functionLabel(f, f.name) }))}
          popupClassName="!bg-dark-card"
        />
        <Select
          size="small" style={{ width: 220 }}
          value={condition.field || undefined}
          placeholder={fields.length ? '选择返回字段' : '该函数未声明返回结构'}
          onChange={handleField}
          options={fields.map(f => ({
            value: f.path,
            label: `${'　'.repeat(f.depth)}${f.depth ? '└ ' : ''}${f.label}${f.type ? ` (${f.type})` : ''}`,
          }))}
          popupClassName="!bg-dark-card"
        />
        <Select
          size="small" style={{ width: 128 }}
          value={condition.operator || undefined}
          placeholder="运算符"
          onChange={handleOperator}
          options={operators.map(o => ({ value: o.code, label: o.label }))}
          popupClassName="!bg-dark-card"
        />
        <div className="flex-1 min-w-0">{valueControl()}</div>
        <Tooltip title="删除该条件">
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onRemove} />
        </Tooltip>
      </div>
      {message && <div className="text-red-400 text-xs mt-1">{message}</div>}
    </div>
  );
}
