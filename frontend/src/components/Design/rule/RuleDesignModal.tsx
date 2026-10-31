'use client';

/**
 * 规则设计弹窗（spec 007）：组间 AND/OR + 若干条件组（组内 AND/OR）+ 两段 30 字结果说明。
 *
 * 交互约定：
 * - 条件函数**只能**从该规则的关联函数中选（关联函数由规则表维护）；
 * - 弹窗只回传草稿，不直接落盘——与 `related_functions` 一致，由行尾 ✓ 统一提交；
 * - 该设计属设计期表达，运行期（agent 规则闸）不消费。
 */

import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Tooltip, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import RuleDesignCondition from './RuleDesignCondition';
import { useRuleDesignGenerate } from './use-rule-design-generate';
import {
  MAX_CONDITIONS_PER_GROUP,
  MAX_GROUPS,
  MAX_MESSAGE_LEN,
  charCount,
  defaultCondition,
  defaultDesign,
  normalizeDesign,
  truncateChars,
  validateDesign,
  type RuleDesign,
  type RuleFunctionOption,
} from './rule-design';

interface Props {
  open: boolean;
  /** 本体 id（智能生成端点需要） */
  ontologyId: number;
  ruleName: string;
  ruleTitle?: string;
  /** 规则描述：智能生成的主要依据 */
  ruleDescription?: string;
  /** 绑定行为英文名（与 `RuleItem.behavior` 同语义，仅用于生成上下文） */
  behaviorName?: string;
  /** 绑定行为中文名（仅用于标题展示） */
  behaviorLabel?: string;
  position?: string;
  /** 该规则的关联函数（条件函数的唯一可选范围；智能生成的上下文 = 全部） */
  functions: RuleFunctionOption[];
  /** 已保存的设计（缺省 = 新建） */
  value?: RuleDesign | null;
  onCancel: () => void;
  onSave: (design: RuleDesign) => void;
}

const cloneDesign = (design: RuleDesign | null | undefined): RuleDesign | null =>
  design ? JSON.parse(JSON.stringify(design)) : null;

export default function RuleDesignModal({
  open, ontologyId, ruleName, ruleTitle, ruleDescription, behaviorName, behaviorLabel,
  position, functions, value, onCancel, onSave,
}: Props) {
  const [design, setDesign] = useState<RuleDesign | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** 本轮弹窗内是否改动过（含生成结果）：决定「智能生成」是否需要二次确认覆盖 */
  const [dirty, setDirty] = useState(false);
  const { loading: generating, generate } = useRuleDesignGenerate(ontologyId);

  const mutate = (updater: (prev: RuleDesign | null) => RuleDesign | null) => {
    setDesign(updater);
    setDirty(true);
  };

  // 打开时按「已保存设计」或「默认设计（1 组 1 条）」初始化；关闭期间的父级变化不覆写草稿
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDirty(false);
    setDesign(
      functions.length
        ? (cloneDesign(value) || defaultDesign(functions[0].name, functions[0].response))
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const responseOf = (name: string) => functions.find(f => f.name === name)?.response;

  const patchGroup = (gi: number, updater: (group: RuleDesign['groups'][number]) => RuleDesign['groups'][number]) => {
    mutate(prev => {
      if (!prev) return prev;
      const groups = prev.groups.map((g, i) => (i === gi ? updater(g) : g));
      return { ...prev, groups };
    });
  };

  const addGroup = () => {
    mutate(prev => {
      if (!prev || prev.groups.length >= MAX_GROUPS) return prev;
      return {
        ...prev,
        groups: [...prev.groups, { combine: 'and', conditions: [defaultCondition(functions[0].name, functions[0].response)] }],
      };
    });
  };

  const removeGroup = (gi: number) => {
    setErrors({});
    mutate(prev => {
      if (!prev) return prev;
      const groups = prev.groups.filter((_, i) => i !== gi);
      if (groups.length) return { ...prev, groups };
      // 至少保留一组（删空后给回骨架，避免弹窗变成空态）
      return { ...prev, groups: [{ combine: 'and', conditions: [defaultCondition(functions[0].name, functions[0].response)] }] };
    });
  };

  const addCondition = (gi: number) => {
    patchGroup(gi, g => (g.conditions.length >= MAX_CONDITIONS_PER_GROUP
      ? g
      : { ...g, conditions: [...g.conditions, defaultCondition(functions[0].name, functions[0].response)] }));
  };

  const removeCondition = (gi: number, ci: number) => {
    setErrors({});
    patchGroup(gi, g => ({ ...g, conditions: g.conditions.filter((_, i) => i !== ci) }));
  };

  const setCondition = (gi: number, ci: number, next: RuleDesign['groups'][number]['conditions'][number]) => {
    patchGroup(gi, g => ({ ...g, conditions: g.conditions.map((c, i) => (i === ci ? next : c)) }));
  };

  const handleSave = () => {
    if (!design) return;
    const ctx = { relatedFunctions: functions.map(f => f.name), responseOf };
    const verdict = validateDesign(design, ctx);
    setErrors(verdict.errors);
    if (!verdict.ok) {
      message.warning(verdict.message);
      return;
    }
    const normalized = normalizeDesign(design);
    if (!normalized) {
      message.warning('请至少配置一条条件');
      return;
    }
    onSave(normalized);
  };

  /** 智能生成（spec 008）：上下文 = 规则描述 + 全部关联函数；已有设计时二次确认覆盖 */
  const handleGenerate = () => {
    const applyGenerated = async () => {
      try {
        const result = await generate({
          rule_name: ruleName,
          title: ruleTitle || '',
          description: ruleDescription || '',
          position: position || '',
          behavior: behaviorName || '',
          related_functions: functions.map(f => f.name),
        });
        const next = normalizeDesign(result.rule_design);
        if (!next) {
          message.warning('生成结果为空，请重试');
          return;
        }
        mutate(() => next);
        setErrors({});
        if (result.warnings?.length) {
          message.info(`已自动修正 ${result.warnings.length} 处：${result.warnings.slice(0, 2).join('；')}`);
        } else {
          message.success('已生成规则设计草稿，请确认后保存');
        }
      } catch (e: any) {
        // 失败保留原设计，不清空
        message.error(e?.message || '生成失败，请重试');
      }
    };

    // 有已保存设计，或用户本轮已改过 → 覆盖前二次确认；全新空骨架直接生成
    const hasDesign = dirty || !!value;
    if (!hasDesign) {
      void applyGenerated();
      return;
    }
    Modal.confirm({
      title: '覆盖当前设计？',
      content: '智能生成将覆盖现有条件组合与结果说明。',
      okText: '覆盖生成',
      cancelText: '取消',
      onOk: applyGenerated,
    });
  };

  const emptyState = (
    <div className="py-8 text-center">
      <div className="text-text-primary text-sm mb-2">该规则尚未选择关联函数</div>
      <div className="text-text-muted text-xs">
        规则设计只能从本规则的「关联函数」中选择函数。请先在表格中为该规则选择关联函数，再回来设计条件。
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width={880}
      maskClosable={false}
      destroyOnClose
      title={(
        <div>
          <div className="text-text-primary">规则设计 · {ruleTitle || ruleName}</div>
          <div className="text-text-muted text-xs font-normal mt-1">
            {ruleName}
            {behaviorLabel ? ` · ${behaviorLabel}` : ''}
            {position ? ` · ${position}` : ''}
          </div>
        </div>
      )}
      footer={functions.length ? [
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button key="save" type="primary" disabled={generating} onClick={handleSave}>保存设计</Button>,
      ] : [
        <Button key="close" onClick={onCancel}>关闭</Button>,
      ]}
    >
      {!functions.length && emptyState}

      {functions.length > 0 && design && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-text-muted text-xs">关联函数</span>
            {functions.map(f => (
              <span key={f.name} className="px-2 py-0.5 rounded bg-[#1e293b] border border-dark-border text-xs text-text-primary">
                {f.title || f.name}
              </span>
            ))}
            <span className="text-text-muted text-xs">（需增减请回到表格修改关联函数）</span>
            <span className="flex-1" />
            <Tooltip title="根据规则描述与全部关联函数的返回字段，生成条件组合与结果说明（草稿，可修改）">
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={generating}
                onClick={handleGenerate}
              >
                智能生成
              </Button>
            </Tooltip>
          </div>

          <div className="border border-dark-border rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-text-primary text-sm">条件组合</span>
              <span className="flex items-center gap-1">
                <span className="text-text-muted text-xs">组间</span>
                <Select
                  size="small" style={{ width: 80 }}
                  value={design.combine || 'and'}
                  onChange={v => setDesign(prev => (prev ? { ...prev, combine: v } : prev))}
                  options={[{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }]}
                  popupClassName="!bg-dark-card"
                />
              </span>
            </div>

            {design.groups.map((group, gi) => (
              <div key={gi} className="border border-dark-border rounded-md p-2 mb-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-text-muted text-xs">条件组 {gi + 1}</span>
                  <span className="text-text-muted text-xs">组内</span>
                  <Select
                    size="small" style={{ width: 80 }}
                    value={group.combine || 'and'}
                    onChange={v => patchGroup(gi, g => ({ ...g, combine: v }))}
                    options={[{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }]}
                    popupClassName="!bg-dark-card"
                  />
                  <span className="flex-1" />
                  <Tooltip title="删除该条件组">
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeGroup(gi)} />
                  </Tooltip>
                </div>

                {group.conditions.map((cond, ci) => (
                  <RuleDesignCondition
                    key={ci}
                    condition={cond}
                    functions={functions}
                    error={errors[`g${gi}c${ci}`]}
                    dangling={!functions.some(f => f.name === cond.function)}
                    onChange={next => setCondition(gi, ci, next)}
                    onRemove={() => removeCondition(gi, ci)}
                  />
                ))}

                {errors[`g${gi}`] && <div className="text-red-400 text-xs mb-2">{errors[`g${gi}`]}</div>}

                <Tooltip title={group.conditions.length >= MAX_CONDITIONS_PER_GROUP ? `每组最多 ${MAX_CONDITIONS_PER_GROUP} 条条件` : ''}>
                  <Button
                    size="small" type="text" icon={<PlusOutlined />}
                    disabled={group.conditions.length >= MAX_CONDITIONS_PER_GROUP}
                    onClick={() => addCondition(gi)}
                  >
                    添加条件
                  </Button>
                </Tooltip>
              </div>
            ))}

            <Tooltip title={design.groups.length >= MAX_GROUPS ? `最多 ${MAX_GROUPS} 个条件组` : ''}>
              <Button size="small" icon={<PlusOutlined />} disabled={design.groups.length >= MAX_GROUPS} onClick={addGroup}>
                添加条件组
              </Button>
            </Tooltip>
          </div>

          <div className="border border-dark-border rounded-lg p-3">
            <div className="text-text-primary text-sm mb-2">判断结果</div>
            <div className="flex items-start gap-2 mb-2">
              <span className="text-text-muted text-xs w-16 pt-1.5">条件成立</span>
              <Input
                className="bg-dark-bg border-dark-border text-text-primary"
                placeholder={`填写条件成立时的结果说明（${MAX_MESSAGE_LEN} 字以内）`}
                value={design.pass_message}
                onChange={e => mutate(prev => (prev ? { ...prev, pass_message: truncateChars(e.target.value) } : prev))}
              />
              <span className="text-text-muted text-xs w-12 text-right pt-1.5">
                {charCount(design.pass_message)}/{MAX_MESSAGE_LEN}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-text-muted text-xs w-16 pt-1.5">条件不成立</span>
              <Input
                className="bg-dark-bg border-dark-border text-text-primary"
                placeholder={`填写条件不成立时的结果说明（${MAX_MESSAGE_LEN} 字以内）`}
                value={design.fail_message}
                onChange={e => mutate(prev => (prev ? { ...prev, fail_message: truncateChars(e.target.value) } : prev))}
              />
              <span className="text-text-muted text-xs w-12 text-right pt-1.5">
                {charCount(design.fail_message)}/{MAX_MESSAGE_LEN}
              </span>
            </div>
          </div>

          <div className="text-text-muted text-xs mt-3">
            ⓘ 条件中的函数必须来自本规则的「关联函数」；该设计仅作为设计期说明，不参与运行期判定。
          </div>
        </div>
      )}
    </Modal>
  );
}
