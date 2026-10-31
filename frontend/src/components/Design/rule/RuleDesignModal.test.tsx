/**
 * 规则设计弹窗单测（spec 007 / 008）：默认值、仅关联函数可选、回显、30 字截断、上限、保存回传、空态，
 * 以及智能生成（无需确认 / 覆盖二次确认 / 失败保留原设计 / 生成中禁用保存）。
 *
 * 注意：antd Modal / Select 浮层挂在 document.body（不在 render 容器内），故断言走 document；
 * 两字中文按钮会被 antd 自动插入空格（「取 消」「关 闭」），按正则匹配。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from 'antd';
import RuleDesignModal from './RuleDesignModal';
import type { RuleDesign, RuleFunctionOption } from './rule-design';

const gen = vi.hoisted(() => ({
  generate: vi.fn(),
  state: { loading: false },
}));

vi.mock('./use-rule-design-generate', () => ({
  useRuleDesignGenerate: () => ({ loading: gen.state.loading, generate: gen.generate }),
}));

const FUNCS: RuleFunctionOption[] = [
  {
    name: 'checkUnit',
    title: '校验采购原材料单位一致性',
    type: 'VALIDATION',
    origin: 'ontology',
    response: {
      pass: { type: 'boolean', title: '判断结果' },
      reason: { type: 'string', title: '判断说明' },
    },
  },
  {
    name: 'getCurrentDate',
    title: '当前日期',
    origin: 'common',
    response: { type: 'object', properties: { date: { type: 'string', title: '当前日期' } } },
  },
];

const SUM_FUNCS: RuleFunctionOption[] = [{
  name: 'sum', title: '求和', type: 'CALCULATION', origin: 'ontology',
  response: { amount: { type: 'number', title: '金额' } },
}];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    ontologyId: 1,
    ruleName: 'V01_UnitConsistency_Purchase',
    ruleTitle: '采购-原料存在且单位一致',
    ruleDescription: '创建采购单时，原材料ID必须存在，且单位与原材料定义一致。',
    behaviorName: 'CreatePurchaseRecord',
    behaviorLabel: '创建采购单',
    position: '前置',
    functions: FUNCS,
    value: null,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  render(<RuleDesignModal {...(props as any)} />);
  return props;
}

const saved = (over: Partial<RuleDesign> = {}): RuleDesign => ({
  combine: 'or',
  groups: [{
    combine: 'or',
    conditions: [{ function: 'getCurrentDate', field: 'date', operator: 'not_empty', values: [] }],
  }],
  pass_message: '有日期',
  fail_message: '无日期',
  ...over,
});

const selectionTitles = () =>
  [...document.querySelectorAll('.ant-select-selection-item')].map(n => n.getAttribute('title'));

const generatedResult = (over: Record<string, unknown> = {}) => ({
  rule_design: {
    combine: 'and',
    groups: [{
      combine: 'and',
      conditions: [{ function: 'checkUnit', field: 'pass', operator: 'eq', values: ['true'] }],
    }],
    pass_message: '原材料与单位一致',
    fail_message: '原材料或单位不一致',
  },
  warnings: [],
  dropped_conditions: 0,
  model: 'deepseek-chat',
  elapsed_ms: 100,
  ...over,
});

beforeEach(() => {
  gen.generate.mockReset();
  gen.state.loading = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RuleDesignModal — 默认骨架', () => {
  it('渲染标题与 1 组 1 条默认条件', () => {
    setup();
    expect(screen.getByText('规则设计 · 采购-原料存在且单位一致')).toBeInTheDocument();
    expect(screen.getByText('条件组 1')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-select').length).toBeGreaterThanOrEqual(5);
  });

  it('boolean 字段默认取值为 true', () => {
    setup();
    expect(selectionTitles()).toContain('true');
  });

  it('number 字段默认取值为 0', () => {
    setup({ functions: SUM_FUNCS, ruleName: 'R', ruleTitle: '求和规则' });
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  });

  it('函数下拉只列出该规则的关联函数', async () => {
    setup();
    const selectors = document.querySelectorAll('.ant-select-selector');
    fireEvent.mouseDown(selectors[2]);
    await waitFor(() => {
      const options = [...document.querySelectorAll('.ant-select-item-option-content')].map(n => n.textContent);
      expect(options).toEqual(['校验采购原材料单位一致性-逻辑验证', '当前日期-公共']);
    });
  });
});

describe('RuleDesignModal — 回显与编辑', () => {
  it('已保存设计完整回显', () => {
    setup({ value: saved() });
    expect(screen.getByText('条件组 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('有日期')).toBeInTheDocument();
    expect(screen.getByDisplayValue('无日期')).toBeInTheDocument();
    expect(screen.getAllByText('3/30')).toHaveLength(2);
    expect(selectionTitles().filter(v => v === 'OR')).toHaveLength(2);
  });

  it('结果说明超过 30 字被截断并计数', () => {
    setup();
    const input = screen.getByPlaceholderText(/填写条件成立时的结果说明/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a'.repeat(40) } });
    expect(input.value).toHaveLength(30);
    expect(screen.getByText('30/30')).toBeInTheDocument();
  });

  it('添加条件组后出现第二个组', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /添加条件组/ }));
    expect(screen.getAllByText(/^条件组 \d$/)).toHaveLength(2);
  });

  it('5 组后「添加条件组」禁用', () => {
    const design = saved({
      groups: Array.from({ length: 5 }, () => ({
        combine: 'and' as const,
        conditions: [{ function: 'checkUnit', field: 'pass', operator: 'eq' as const, values: ['true'] }],
      })),
    });
    setup({ value: design });
    expect(screen.getByRole('button', { name: /添加条件组/ })).toBeDisabled();
  });

  it('每组 5 条后「添加条件」禁用', () => {
    const design = saved({
      groups: [{
        combine: 'and',
        conditions: Array.from({ length: 5 }, () => ({
          function: 'checkUnit', field: 'pass', operator: 'eq' as const, values: ['true'],
        })),
      }],
    });
    setup({ value: design });
    // 图标会进 accessible name（"plus 添加条件"），按可见文本精确筛选
    const buttons = [...document.querySelectorAll('button')]
      .filter(b => (b.textContent || '').trim() === '添加条件');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach(btn => expect(btn).toBeDisabled());
  });
});

describe('RuleDesignModal — 保存', () => {
  it('合法设计归一后回传', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: '保存设计' }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith({
      combine: 'and',
      groups: [{
        combine: 'and',
        conditions: [{ function: 'checkUnit', field: 'pass', operator: 'eq', values: ['true'] }],
      }],
      pass_message: '',
      fail_message: '',
    });
  });

  it('悬空函数（不在关联函数中）被拦截且不落盘', () => {
    const props = setup({
      functions: [FUNCS[1]],
      value: saved({
        groups: [{
          combine: 'and',
          conditions: [{ function: 'checkUnit', field: 'pass', operator: 'eq', values: ['true'] }],
        }],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: '保存设计' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByText('函数不在该规则的关联函数中')).toBeInTheDocument();
  });

  it('条件组为空时拦截', () => {
    const props = setup({ value: saved({ groups: [{ combine: 'and', conditions: [] }] }) });
    fireEvent.click(screen.getByRole('button', { name: '保存设计' }));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('取消只回调 onCancel，不回传设计', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });
});

describe('RuleDesignModal — 智能生成（spec 008）', () => {
  it('全新骨架直接生成，上下文带上规则描述与全部关联函数', async () => {
    gen.generate.mockResolvedValue(generatedResult());
    setup();
    fireEvent.click(screen.getByRole('button', { name: /智能生成/ }));

    await waitFor(() => expect(gen.generate).toHaveBeenCalledTimes(1));
    expect(gen.generate.mock.calls[0][0]).toMatchObject({
      rule_name: 'V01_UnitConsistency_Purchase',
      description: '创建采购单时，原材料ID必须存在，且单位与原材料定义一致。',
      behavior: 'CreatePurchaseRecord',
      related_functions: ['checkUnit', 'getCurrentDate'],
    });
  });

  it('生成结果写入表单（可继续编辑）', async () => {
    gen.generate.mockResolvedValue(generatedResult());
    setup();
    fireEvent.click(screen.getByRole('button', { name: /智能生成/ }));
    await waitFor(() => expect(screen.getByDisplayValue('原材料与单位一致')).toBeInTheDocument());
    expect(screen.getByDisplayValue('原材料或单位不一致')).toBeInTheDocument();
  });

  it('已有设计时先二次确认；取消则不发请求', () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(
      () => ({ destroy: vi.fn(), update: vi.fn() }) as any,
    );
    setup({ value: saved() });
    fireEvent.click(screen.getByRole('button', { name: /智能生成/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(gen.generate).not.toHaveBeenCalled();
  });

  it('确认覆盖后生成，原设计被替换', async () => {
    vi.spyOn(Modal, 'confirm').mockImplementation(((config: any) => {
      void config.onOk();
      return { destroy: vi.fn(), update: vi.fn() };
    }) as any);
    gen.generate.mockResolvedValue(generatedResult());
    setup({ value: saved() });
    fireEvent.click(screen.getByRole('button', { name: /智能生成/ }));

    await waitFor(() => expect(screen.getByDisplayValue('原材料与单位一致')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('有日期')).toBeNull();
  });

  it('生成失败时保留原设计', async () => {
    vi.spyOn(Modal, 'confirm').mockImplementation(((config: any) => {
      void config.onOk();
      return { destroy: vi.fn(), update: vi.fn() };
    }) as any);
    gen.generate.mockRejectedValue(new Error('boom'));
    setup();
    // 先手工加一组，制造「已有内容」并留下可断言的现场
    fireEvent.click(screen.getByRole('button', { name: /添加条件组/ }));
    expect(screen.getAllByText(/^条件组 \d$/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /智能生成/ }));
    await waitFor(() => expect(gen.generate).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/^条件组 \d$/)).toHaveLength(2);
  });

  it('生成中禁用「保存设计」', () => {
    gen.state.loading = true;
    setup();
    expect(screen.getByRole('button', { name: '保存设计' })).toBeDisabled();
  });
});

describe('RuleDesignModal — 空态', () => {
  it('无关联函数时给引导且无保存按钮', () => {
    setup({ functions: [], value: null });
    expect(screen.getByText('该规则尚未选择关联函数')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存设计' })).toBeNull();
    expect(screen.queryByRole('button', { name: /智能生成/ })).toBeNull();
    expect(screen.getByRole('button', { name: /关\s*闭/ })).toBeInTheDocument();
  });
});
