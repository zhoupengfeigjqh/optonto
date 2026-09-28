/**
 * SmartActionModals 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 覆盖分析结论弹窗的状态映射（ok/warning/其他 → 可映射/需注意/不可映射 + 颜色）、
 * 结论与问题清单渲染、无结果空态；以及确认弹窗的文案、确认/取消与 loading。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalyzeResultModal, SmartActionConfirmModal } from './SmartActionModals';

function setupAnalyze(overrides: Record<string, unknown> = {}) {
  const props = { open: true, title: '智能映射-查询库存', result: null, onClose: vi.fn(), ...overrides };
  render(<AnalyzeResultModal {...(props as any)} />);
  return props;
}

describe('AnalyzeResultModal — 属性传递', () => {
  it('渲染标题、状态标签、分析结论与问题清单', () => {
    setupAnalyze({ result: { status: 'warning', message: '两个字段类型不一致', issues: ['数量 类型不符', '缺少映射'] } });
    expect(screen.getByText('智能映射-查询库存')).toBeInTheDocument();
    expect(screen.getByText('需注意')).toBeInTheDocument();
    expect(screen.getByText('两个字段类型不一致')).toBeInTheDocument();
    expect(screen.getByText('数量 类型不符')).toBeInTheDocument();
    expect(screen.getByText('缺少映射')).toBeInTheDocument();
  });

  it('状态 ok → 可映射', () => {
    setupAnalyze({ result: { status: 'ok', message: 'ok', issues: [] } });
    expect(screen.getByText('可映射')).toBeInTheDocument();
  });

  it('状态为 error → 不可映射，且问题行用错误色', () => {
    setupAnalyze({ result: { status: 'error', message: '无法映射', issues: ['类型完全不兼容'] } });
    expect(screen.getByText('不可映射')).toBeInTheDocument();
    expect(screen.getByText('类型完全不兼容').className).toContain('text-red-400');
  });

  it('状态未知时按不可映射处理（不渲染 undefined）', () => {
    setupAnalyze({ result: { status: 'unknown', message: 'm', issues: [] } });
    expect(screen.getByText('不可映射')).toBeInTheDocument();
  });

  it('无 issues 时不渲染问题区块', () => {
    setupAnalyze({ result: { status: 'ok', message: 'm' } });
    expect(screen.queryByText('问题：')).not.toBeInTheDocument();
  });
});

describe('AnalyzeResultModal — 事件触发与边界', () => {
  it('result 为 null 时只渲染空壳（不抛错）', () => {
    setupAnalyze();
    expect(screen.getByText('智能映射-查询库存')).toBeInTheDocument();
    expect(screen.queryByText('状态：')).not.toBeInTheDocument();
  });

  it('关闭触发 onClose', () => {
    const props = setupAnalyze({ result: { status: 'ok', message: 'm' } });
    fireEvent.click(document.querySelector('.ant-modal-close') as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('footer 为 null（无确认按钮，只读结论）', () => {
    setupAnalyze({ result: { status: 'ok', message: 'm' } });
    expect(screen.queryByRole('button', { name: /确 定|OK/ })).not.toBeInTheDocument();
  });
});

function setupConfirm(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true, title: '智能对齐 - 查询库存', okText: '确认对齐', loading: false,
    onConfirm: vi.fn(), onCancel: vi.fn(), children: <p>将本体行为与目标接口对齐</p>,
    ...overrides,
  };
  render(<SmartActionConfirmModal {...(props as any)} />);
  return props;
}

describe('SmartActionConfirmModal', () => {
  it('属性传递：渲染标题、说明文案与自定义确认按钮文案', () => {
    setupConfirm();
    expect(screen.getByText('智能对齐 - 查询库存')).toBeInTheDocument();
    expect(screen.getByText('将本体行为与目标接口对齐')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认对齐' })).toBeInTheDocument();
  });

  it('事件触发：确认 / 取消分别回传', () => {
    const props = setupConfirm();
    fireEvent.click(screen.getByRole('button', { name: '确认对齐' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('边界：loading 时确认按钮进入加载态', () => {
    setupConfirm({ loading: true });
    expect(document.querySelector('.ant-btn-loading')).toBeTruthy();
  });
});
