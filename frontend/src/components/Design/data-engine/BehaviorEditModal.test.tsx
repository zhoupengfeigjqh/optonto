/**
 * BehaviorEditModal 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * JsonEditor 替换为 textarea 探针：本组件的职责是「双栏布局 + 把两侧文本回传/保存」，
 * CodeMirror 自身的编辑行为不属于本组件职责（且在 jsdom 下无意义）。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/JsonEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea data-testid="json-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import BehaviorEditModal from './BehaviorEditModal';

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    title: '编辑行为参数 - 查询库存',
    paramsStr: '{"a":1}',
    responseStr: '{"b":2}',
    loading: false,
    onParamsChange: vi.fn(),
    onResponseChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<BehaviorEditModal {...(props as any)} />);
  return props;
}

describe('BehaviorEditModal — 属性传递', () => {
  it('渲染标题与两栏编辑器初值', () => {
    setup();
    expect(screen.getByText('编辑行为参数 - 查询库存')).toBeInTheDocument();
    expect(screen.getByText('输入参数 (JSON)')).toBeInTheDocument();
    expect(screen.getByText('返回结构 (JSON)')).toBeInTheDocument();
    const editors = screen.getAllByTestId('json-editor') as HTMLTextAreaElement[];
    expect(editors[0].value).toBe('{"a":1}');
    expect(editors[1].value).toBe('{"b":2}');
  });

  it('loading 时确认按钮进入加载态', () => {
    setup({ loading: true });
    expect(document.querySelector('.ant-btn-loading')).toBeTruthy();
  });
});

describe('BehaviorEditModal — 事件触发', () => {
  it('两栏编辑分别回传对应回调（不串栏）', () => {
    const props = setup();
    const editors = screen.getAllByTestId('json-editor') as HTMLTextAreaElement[];
    fireEvent.change(editors[0], { target: { value: '{"a":9}' } });
    expect(props.onParamsChange).toHaveBeenCalledWith('{"a":9}');
    expect(props.onResponseChange).not.toHaveBeenCalled();
    fireEvent.change(editors[1], { target: { value: '{"b":9}' } });
    expect(props.onResponseChange).toHaveBeenCalledWith('{"b":9}');
  });

  it('保存 / 取消触发对应回调', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('BehaviorEditModal — 边界条件', () => {
  it('文本为空串时正常渲染（不抛错）', () => {
    setup({ paramsStr: '', responseStr: '' });
    const editors = screen.getAllByTestId('json-editor') as HTMLTextAreaElement[];
    expect(editors[0].value).toBe('');
    expect(editors[1].value).toBe('');
  });
});
