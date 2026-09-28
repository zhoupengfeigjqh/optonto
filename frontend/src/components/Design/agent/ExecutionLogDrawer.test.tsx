/**
 * ExecutionLogDrawer 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 分组规则本身在 execution-log.test.ts 已覆盖；这里验证**渲染与交互**：
 * 空态、顶层条目、子任务组的标题/状态标记/步数、折叠后再展开、关闭。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExecutionLogDrawer from './ExecutionLogDrawer';
import type { LogEntry } from './execution-log';

const top = (name: string): LogEntry => ({ time: '10:00:00', type: 'tool_call', name, status: 'done' });
const child = (seq: number, type: string, name = 'QueryInventory'): LogEntry =>
  ({ time: '10:00:01', type, name, status: type === 'subtask_done' ? 'done' : 'running', source: 'child', seq });

const subtaskGroup = [
  { ...child(1, 'subtask_start'), displayName: '查库存' },
  child(1, 'tool_call'),
  child(1, 'security'),
  child(1, 'subtask_done'),
];

function setup(entries: LogEntry[], collapsed: Set<number> = new Set()) {
  const props = { open: true, entries, collapsed, onToggleSubtask: vi.fn(), onClose: vi.fn() };
  render(<ExecutionLogDrawer {...props} />);
  return props;
}

describe('ExecutionLogDrawer — 属性传递', () => {
  it('顶层条目直接渲染为条目卡片', () => {
    setup([top('父Agent 思考')]);
    expect(screen.getByText(/父Agent 思考|tool_call/)).toBeInTheDocument();
  });

  it('子任务组标题含序号与显示名，并标注完成态与步数', () => {
    setup(subtaskGroup);
    expect(screen.getByText('子任务 1: 查库存')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
    // 步数 = 剔除 start/done/input 后的动作数（tool_call + security）
    expect(screen.getByText('2 步')).toBeInTheDocument();
  });

  it('失败态标题显示 ✗ 并标红背景（状态取首个 subtask_done）', () => {
    setup([
      { ...child(1, 'subtask_start'), displayName: '查库存' },
      { ...child(1, 'subtask_done'), status: 'failed' },
    ]);
    expect(screen.getByText('✗')).toBeInTheDocument();
    expect(screen.getByText('子任务 1: 查库存').closest('div')!.className).toContain('bg-red-500/10');
  });
});

describe('ExecutionLogDrawer — 事件触发', () => {
  it('点击子任务组标题回传该组 seq（用于折叠/展开）', () => {
    const props = setup(subtaskGroup);
    fireEvent.click(screen.getByText('子任务 1: 查库存'));
    expect(props.onToggleSubtask).toHaveBeenCalledWith(1);
  });

  it('关闭抽屉触发 onClose', () => {
    const props = setup([top('x')]);
    const closeBtn = document.querySelector('.ant-drawer-close') as HTMLElement;
    fireEvent.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ExecutionLogDrawer — 边界条件', () => {
  it('无记录时显示空态文案', () => {
    setup([]);
    expect(screen.getByText('暂无执行记录')).toBeInTheDocument();
  });

  it('已折叠的子任务组不渲染步骤明细', () => {
    setup(subtaskGroup, new Set([1]));
    expect(screen.getByText('▶')).toBeInTheDocument();
    expect(screen.queryByText('2 步')).toBeInTheDocument(); // 步数仍在标题上
    // 折叠时明细容器不存在
    expect(document.querySelector('.bg-dark-bg\\/40')).toBeNull();
  });

  it('展开状态渲染步骤明细容器', () => {
    setup(subtaskGroup);
    expect(document.querySelector('.bg-dark-bg\\/40')).toBeTruthy();
  });

  it('source=child 但 seq 缺失的条目按顶层处理（不产生子任务组）', () => {
    setup([{ ...child(1, 'tool_call'), seq: undefined }]);
    expect(screen.queryByText(/^子任务 1/)).not.toBeInTheDocument();
  });
});
