/**
 * PlanConfirmModal 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 覆盖：倒计时文案、子任务数与参数行、必填/选填标记、四种参数值形态的渲染与截断、
 * 高级选项开关、删子任务、依赖选择、确认/拒绝（含重规划）、校验错误展示、参数详情展开。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanConfirmModal from './PlanConfirmModal';
import { selectOption } from '@/test/antd';

const plan = {
  subtasks: [
    {
      seq: 1, behavior: 'QueryInventory', display_name: '查询库存', description: '查当前库存',
      params: {
        原材料编号: { value: 'RM-001', required: true, description: '原材料编号' },
        数量: { value: '', required: false },
        明细行: { value: [{ a: 1 }, { a: 2 }] },
        扩展: { value: { k: 'v', n: 1 } },
        长文本: { value: 'x'.repeat(140) },
      },
    },
    { seq: 2, behavior: 'CreatePurchaseRecord', params: {} },
  ],
};

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    plan,
    countdown: null,
    error: '',
    showAdvanced: false,
    suggestion: '',
    expandedParams: new Set<string>(),
    onToggleAdvanced: vi.fn(),
    onSuggestionChange: vi.fn(),
    onCancel: vi.fn(),
    onReject: vi.fn(),
    onConfirm: vi.fn(),
    onUpdateParam: vi.fn(),
    onDeleteSubtask: vi.fn(),
    onUpdateDeps: vi.fn(),
    onToggleParamExpand: vi.fn(),
    ...overrides,
  };
  render(<PlanConfirmModal {...(props as any)} />);
  return props;
}

describe('PlanConfirmModal — 属性传递', () => {
  it('信息条展示子任务总数', () => {
    setup();
    expect(screen.getByText(/规划已就绪，共 2 个操作/)).toBeInTheDocument();
  });

  it('倒计时为 null 时不显示秒数；有值时显示', () => {
    setup();
    expect(screen.queryByText(/秒后自动取消/)).not.toBeInTheDocument();
  });

  it('倒计时有值时显示剩余秒数', () => {
    setup({ countdown: 42 });
    expect(screen.getByText(/（42 秒后自动取消）/)).toBeInTheDocument();
  });

  it('渲染子任务头：中文名 + 英文名 + 描述', () => {
    setup();
    expect(screen.getByText('查询库存')).toBeInTheDocument();
    expect(screen.getByText('QueryInventory')).toBeInTheDocument();
    expect(screen.getByText(/查当前库存/)).toBeInTheDocument();
  });

  it('参数用 description 作展示名，同时保留键名（两者同值时出现两次）', () => {
    setup();
    expect(screen.getAllByText('原材料编号').length).toBe(2); // 展示名 + 键名
    expect(screen.getAllByText('数量').length).toBe(2);        // 无 description 时键名既是展示名也是键名
  });

  it('必填/选填标记分别渲染', () => {
    setup();
    expect(screen.getAllByText('必填').length).toBe(1);
    expect(screen.getAllByText('选填').length).toBe(4);
  });

  it('四类参数值形态：空值提示、数组摘要、对象摘要、长文本截断', () => {
    setup();
    expect(screen.getByText('（待补充）')).toBeInTheDocument();
    expect(screen.getByText('▶ 数组, 共 2 项')).toBeInTheDocument();
    expect(screen.getByText('▶ 对象, 共 2 个字段')).toBeInTheDocument();
    expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument(); // 140 字符被截断
  });

  it('校验错误非空时展示在弹窗内', () => {
    setup({ error: '子任务 2 依赖的子任务 1 已被删除' });
    expect(screen.getByText('子任务 2 依赖的子任务 1 已被删除')).toBeInTheDocument();
  });

  it('未展开高级选项时展示只读预览提示，且不渲染删除按钮', () => {
    setup();
    expect(screen.getByText(/默认只读预览/)).toBeInTheDocument();
    expect(screen.queryByText('依赖')).not.toBeInTheDocument();
  });

  it('展开高级选项时每个子任务各有依赖选择器与删除按钮', () => {
    setup({ showAdvanced: true });
    // 2 个子任务 → 2 个依赖行
    expect(screen.getAllByText('依赖').length).toBe(2);
    expect(document.querySelectorAll('.anticon-delete').length).toBe(2);
  });
});

describe('PlanConfirmModal — 事件触发', () => {
  it('点击高级选项开关回传 toggle', () => {
    const props = setup();
    // 用 role 限定到按钮：说明文案里也含「高级选项」字样
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }));
    expect(props.onToggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it('点击确认执行回传 onConfirm', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩/关闭触发 onCancel（= 拒绝并退出）', () => {
    const props = setup();
    fireEvent.click(document.querySelector('.ant-modal-close') as HTMLElement);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('删除子任务回传该子任务 seq', () => {
    const props = setup({ showAdvanced: true });
    fireEvent.click(document.querySelectorAll('.anticon-delete')[0].closest('button') as HTMLElement);
    expect(props.onDeleteSubtask).toHaveBeenCalledWith(1);
  });

  it('展开参数详情回传展开键 `${seq}:${paramKey}`', () => {
    const props = setup();
    fireEvent.click(screen.getByText('▶ 数组, 共 2 项'));
    expect(props.onToggleParamExpand).toHaveBeenCalledWith('1:明细行');
  });

  it('已展开的参数再次点击同样回传（由父组件决定收起）', () => {
    const props = setup({ expandedParams: new Set(['1:明细行']) });
    expect(screen.getByText('▼ 数组, 共 2 项')).toBeInTheDocument();
    fireEvent.click(screen.getByText('▼ 数组, 共 2 项'));
    expect(props.onToggleParamExpand).toHaveBeenCalledWith('1:明细行');
  });

  it('展开的高级编辑里，参数值用输入框并回传改动', () => {
    const props = setup({ showAdvanced: true });
    const input = document.querySelector('input.ant-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'RM-009' } });
    expect(props.onUpdateParam).toHaveBeenCalledWith(1, '原材料编号', 'RM-009');
  });

  it('依赖选择器回传所选前置子任务', () => {
    const props = setup({ showAdvanced: true });
    selectOption('子任务 2'); // 子任务 1 的可选项里只有「子任务 2」
    expect(props.onUpdateDeps).toHaveBeenCalledWith(1, [2]);
  });

  it('调整建议输入回传文本', () => {
    const props = setup();
    fireEvent.change(document.querySelector('textarea.ant-input') as HTMLElement, { target: { value: '去掉第 2 个操作' } });
    expect(props.onSuggestionChange).toHaveBeenCalledWith('去掉第 2 个操作');
  });

  it('拒绝菜单选「拒绝并重规划」回传 replan', async () => {
    const props = setup();
    // antd Dropdown 默认 hover 触发（不是 mousedown），菜单渲染在 body 浮层
    fireEvent.mouseEnter(screen.getByRole('button', { name: '拒 绝' }));
    fireEvent.click(await screen.findByText('拒绝并重规划'));
    expect(props.onReject).toHaveBeenCalledWith('replan');
  });

  it('拒绝菜单选「拒绝并退出」回传 exit', async () => {
    const props = setup();
    fireEvent.mouseEnter(screen.getByRole('button', { name: '拒 绝' }));
    fireEvent.click(await screen.findByText('拒绝并退出'));
    expect(props.onReject).toHaveBeenCalledWith('exit');
  });
});

describe('PlanConfirmModal — 边界条件', () => {
  it('plan 为空时子任务数为 0 且不渲染子任务卡片', () => {
    setup({ plan: undefined });
    expect(screen.getByText(/共 0 个操作/)).toBeInTheDocument();
    expect(screen.queryByText('查询库存')).not.toBeInTheDocument();
  });

  it('子任务无参数时不渲染参数行（仅高级模式下有依赖行）', () => {
    setup({ plan: { subtasks: [{ seq: 1, behavior: 'A', params: {} }] } });
    expect(screen.queryByText('必填')).not.toBeInTheDocument();
    expect(screen.queryByText('选填')).not.toBeInTheDocument();
  });

  it('长文本在展开态展示完整内容（不再截断）', () => {
    setup({ expandedParams: new Set(['1:长文本']) });
    expect(screen.getByText(/^x{140}$/)).toBeInTheDocument();
  });

  it('高级模式下数组/对象参数改为输入框，改动回传序列化文本', () => {
    const props = setup({ showAdvanced: true });
    const inputs = Array.from(document.querySelectorAll('input.ant-input')) as HTMLInputElement[];
    // 前 5 个输入框属参数行（原材料编号/数量/明细行/扩展/长文本）
    const arrayInput = inputs.find(i => i.value.includes('[{"a":1}')) as HTMLInputElement;
    expect(arrayInput).toBeTruthy();
    fireEvent.change(arrayInput, { target: { value: '[{"a":9}]' } });
    expect(props.onUpdateParam).toHaveBeenCalledWith(1, '明细行', '[{"a":9}]');
  });

  it('高级模式下对象参数改动同样回传', () => {
    const props = setup({ showAdvanced: true });
    const inputs = Array.from(document.querySelectorAll('input.ant-input')) as HTMLInputElement[];
    const objectInput = inputs.find(i => i.value.includes('"k":"v"')) as HTMLInputElement;
    fireEvent.change(objectInput, { target: { value: '{"k":"v2"}' } });
    expect(props.onUpdateParam).toHaveBeenCalledWith(1, '扩展', '{"k":"v2"}');
  });

  it('高级模式下必填/选填标记消失（改为可编辑行）', () => {
    setup({ showAdvanced: true });
    expect(screen.queryByText('必填')).not.toBeInTheDocument();
  });
});
