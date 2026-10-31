/**
 * 概念表操作列测（章程 III / IV：渲染顺序、图标按钮的可访问名、事件触发）。
 *
 * 2026-10-31 调整：操作列顺序固定为「属性 → 编辑 → 删除」，编辑按钮只留笔头图标，
 * 可访问名改由 aria-label/title 承载（读屏与悬浮提示不退化）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  getConcepts: vi.fn(),
  createConcept: vi.fn(),
  updateConcept: vi.fn(),
  deleteConcept: vi.fn(),
  updateAttributes: vi.fn(),
  effectiveAttributes: (c?: any) => [...(c?.attributes || []), ...(c?.inherited_attributes || [])],
}));

import ConceptTable from './ConceptTable';
import * as api from '@/api/client';

const concepts = [
  {
    name: 'PurchaseOrder',
    title: '采购订单',
    description: '订单主体',
    attributes: [{ name: 'poId', type: 'string' }],
  },
];

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;
const actionButtons = () => within(rowOf('采购订单')).getAllByRole('button');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getConcepts).mockResolvedValue(concepts as any);
});

describe('ConceptTable — 操作列', () => {
  it('属性传递：操作列顺序为 属性 → 编辑 → 删除', async () => {
    render(<ConceptTable ontologyId={1} activeTab="concepts" />);
    await waitFor(() => expect(api.getConcepts).toHaveBeenCalledWith(1));
    await screen.findByText('采购订单');

    const btns = actionButtons();
    expect(btns).toHaveLength(3);
    expect(btns[0].textContent).toContain('属性');
    expect(btns[1].getAttribute('aria-label')).toBe('编辑');
    expect(btns[2].getAttribute('aria-label')).toBe('删除');
  });

  it('边界：编辑按钮只保留笔头图标，不含「编辑」文字', async () => {
    render(<ConceptTable ontologyId={1} activeTab="concepts" />);
    await screen.findByText('采购订单');

    const editBtn = actionButtons()[1];
    expect(editBtn.textContent).toBe('');
    expect(editBtn.querySelector('svg')).toBeTruthy();
  });

  it('事件触发：点击笔头进入行内编辑（出现输入框与确认/取消按钮）', async () => {
    render(<ConceptTable ontologyId={1} activeTab="concepts" />);
    await screen.findByText('采购订单');

    const row = rowOf('采购订单');
    fireEvent.click(within(row).getAllByRole('button')[1]);

    expect(row.querySelectorAll('input').length).toBeGreaterThan(0);
    expect(within(row).queryByRole('button', { name: '编辑' })).toBeNull();
  });

  it('事件触发：点击属性按钮打开属性弹窗（不影响行内编辑态）', async () => {
    render(<ConceptTable ontologyId={1} activeTab="concepts" />);
    await screen.findByText('采购订单');

    fireEvent.click(actionButtons()[0]);

    // 弹窗打开后出现属性表的列头
    expect((await screen.findAllByText('是否唯一')).length).toBeGreaterThan(0);
  });

  it('事件触发：点击删除按钮弹出二次确认', async () => {
    render(<ConceptTable ontologyId={1} activeTab="concepts" />);
    await screen.findByText('采购订单');

    fireEvent.click(actionButtons()[2]);

    expect((await screen.findAllByText('确认删除')).length).toBeGreaterThan(0);
    expect(api.deleteConcept).not.toHaveBeenCalled();
  });
});
