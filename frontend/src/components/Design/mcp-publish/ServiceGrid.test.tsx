/**
 * ServiceGrid 单测：一页最多 6 个（不超出不渲染分页器）、翻页渲染剩余项、
 * 列表变短后页码越界收敛、空态。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceGrid, PAGE_SIZE } from './ServiceGrid';

const items = (n: number) => Array.from({ length: n }, (_, i) => `svc-${i + 1}`);
const renderItem = (i: string) => <span key={i}>{i}</span>;

describe('ServiceGrid', () => {
  it(`一页最多 ${PAGE_SIZE} 个：未超出时不渲染分页器`, () => {
    const { container } = render(<ServiceGrid items={items(5)} renderItem={renderItem} />);
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(screen.getByText('svc-5')).toBeTruthy();
  });

  it('超出 6 个时只渲染前 6 个并出现分页器，翻到第 2 页渲染剩余项', () => {
    const { container } = render(<ServiceGrid items={items(7)} renderItem={renderItem} />);
    expect(container.querySelector('.ant-pagination')).toBeTruthy();
    expect(screen.getByText('svc-6')).toBeTruthy();
    expect(screen.queryByText('svc-7')).toBeNull();

    fireEvent.click(screen.getByTitle('2'));
    expect(screen.getByText('svc-7')).toBeTruthy();
    expect(screen.queryByText('svc-1')).toBeNull();
  });

  it('列表变短（删除发布）后页码越界自动收敛到末页，不显示空白页', () => {
    const { rerender } = render(<ServiceGrid items={items(7)} renderItem={renderItem} />);
    fireEvent.click(screen.getByTitle('2'));
    expect(screen.getByText('svc-7')).toBeTruthy();

    rerender(<ServiceGrid items={items(6)} renderItem={renderItem} />);
    expect(screen.getByText('svc-1')).toBeTruthy();
    expect(screen.queryByText('svc-7')).toBeNull();
  });

  it('空列表渲染空态，不渲染栅格', () => {
    const { container } = render(
      <ServiceGrid items={[]} renderItem={renderItem} empty={<span>暂无服务</span>} />,
    );
    expect(screen.getByText('暂无服务')).toBeTruthy();
    expect(container.querySelector('.ant-pagination')).toBeNull();
  });
});
