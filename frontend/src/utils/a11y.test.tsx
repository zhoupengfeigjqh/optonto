/**
 * 无障碍交互助手单测（章程 IV：键盘导航 + WAI-ARIA）。
 * 覆盖三类条件：属性传递（role/tabIndex/aria）、事件触发（Enter/Space）、边界（其他按键）。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { clickableProps, checkboxProps } from './a11y';

/** 构造最小键盘事件对象（直接调用处理器，避免依赖浏览器行为） */
function keyEvent(key: string): ReactKeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactKeyboardEvent;
}

describe('clickableProps — 可点击元素的键盘与 ARIA 语义', () => {
  it('属性传递：返回 role=button、tabIndex=0 与 aria-label', () => {
    const props = clickableProps(() => {}, '展开详情');
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
    expect(props['aria-label']).toBe('展开详情');
  });

  it('事件触发：Enter 与 Space 触发回调并阻止默认行为', () => {
    const onActivate = vi.fn();
    const props = clickableProps(onActivate);

    const enter = keyEvent('Enter');
    props.onKeyDown(enter);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault).toHaveBeenCalled();

    const space = keyEvent(' ');
    props.onKeyDown(space);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('边界：其他按键不触发回调', () => {
    const onActivate = vi.fn();
    const props = clickableProps(onActivate);
    for (const key of ['Escape', 'a', 'Tab', 'ArrowDown']) {
      props.onKeyDown(keyEvent(key));
    }
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('集成：渲染后可经 role 查询并键盘激活', () => {
    const onActivate = vi.fn();
    render(<span {...clickableProps(onActivate, '收起')}>收起</span>);

    const el = screen.getByRole('button', { name: '收起' });
    expect(el).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('checkboxProps — 自定义复选框语义', () => {
  it('属性传递：role=checkbox 且 aria-checked 跟随状态', () => {
    expect(checkboxProps(true, () => {}, '注册工具 a').role).toBe('checkbox');
    expect(checkboxProps(true, () => {}, '注册工具 a')['aria-checked']).toBe(true);
    expect(checkboxProps(false, () => {}, '注册工具 a')['aria-checked']).toBe(false);
    expect(checkboxProps(false, () => {}, '注册工具 a').tabIndex).toBe(0);
  });

  it('事件触发：点击与键盘均切换，且阻止冒泡（不触发父级选择）', () => {
    const onToggle = vi.fn();
    const props = checkboxProps(false, onToggle);

    const clickEvt = { stopPropagation: vi.fn() };
    props.onClick(clickEvt);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(clickEvt.stopPropagation).toHaveBeenCalled();

    const space = keyEvent(' ');
    props.onKeyDown(space);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(space.stopPropagation).toHaveBeenCalled();
  });

  it('边界：其他按键不切换', () => {
    const onToggle = vi.fn();
    checkboxProps(false, onToggle).onKeyDown(keyEvent('a'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
