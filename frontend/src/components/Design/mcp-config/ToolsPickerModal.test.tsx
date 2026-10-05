/**
 * 「MCP 工具列表」弹窗单测：加载/错误/空态、勾选与全选回传、展开参数、确认回调。
 *
 * 选择状态由容器持有，故这里只断言「回传的集合对不对」与「局部展开态」。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolsPickerModal } from './ToolsPickerModal';

const server = { name: '业务系统', url: 'http://biz:8004/mcp', enabled: true } as any;

const tools = [
  {
    name: 'query_inventories', description: '查询库存',
    inputSchema: { type: 'object', required: ['rawMaterialId'], properties: { rawMaterialId: { type: 'string', description: '原材料ID' } } },
  },
  { name: 'query_suppliers', description: '查询供应商', inputSchema: { type: 'object', properties: {} } },
] as any;

const setup = (over: Record<string, unknown> = {}) => {
  const onSelectionChange = vi.fn();
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ToolsPickerModal
      server={server} loading={false} error={null} tools={tools} selected={new Set<string>()}
      onSelectionChange={onSelectionChange} onConfirm={onConfirm} onClose={onClose}
      {...(over as any)}
    />,
  );
  return { onSelectionChange, onConfirm, onClose };
};

describe('ToolsPickerModal', () => {
  it('列出工具并显示选择统计；勾选单个工具回传新集合', () => {
    const { onSelectionChange } = setup();
    expect(screen.getByText(/MCP 工具列表 - 业务系统/)).toBeTruthy();
    expect(screen.getByText('query_inventories')).toBeTruthy();
    expect(screen.getByText(/当前未选择任何工具，将注册全部工具/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('注册工具 query_inventories'));
    expect(Array.from(onSelectionChange.mock.calls[0][0])).toEqual(['query_inventories']);
  });

  it('全选 / 取消全选回传全量集合与空集', () => {
    const { onSelectionChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^全\s*选$/ }));
    expect(Array.from(onSelectionChange.mock.calls[0][0])).toEqual(['query_inventories', 'query_suppliers']);

    fireEvent.click(screen.getByRole('button', { name: /取消全选/ }));
    expect(Array.from(onSelectionChange.mock.calls[1][0])).toEqual([]);
  });

  it('已选工具时统计改为「已选择 n/N」', () => {
    setup({ selected: new Set(['query_suppliers']) });
    expect(screen.getByText(/已选择 1\/2 个工具，仅注册选中的工具/)).toBeTruthy();
    expect(screen.getByLabelText('注册工具 query_suppliers')).toHaveAttribute('aria-checked', 'true');
  });

  it('展开工具详情显示参数（含必填标记），再点收起', () => {
    setup();
    fireEvent.click(screen.getByLabelText('query_inventories 工具详情'));
    expect(screen.getByText('rawMaterialId')).toBeTruthy();
    expect(screen.getByText('*必填')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('query_inventories 工具详情'));
    expect(screen.queryByText('rawMaterialId')).toBeNull();
  });

  it('确认 / 关闭（右上角 ×）分别触发 onConfirm / onClose', () => {
    const { onConfirm, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^确\s*认$/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // 关闭走弹窗右上角 ×（自定义 footer 里没有「取消」按钮）
    fireEvent.click(document.querySelector('.ant-modal-close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('加载中 / 连接失败 / 无工具三种状态各自渲染，且不显示确认按钮', () => {
    const { unmount } = render(
      <ToolsPickerModal server={server} loading error={null} tools={[]} selected={new Set()}
        onSelectionChange={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('正在连接 MCP 服务...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /确\s*认/ })).toBeNull();
    unmount();

    const { unmount: unmount2 } = render(
      <ToolsPickerModal server={server} loading={false} error="缺少或无效的访问令牌" tools={[]} selected={new Set()}
        onSelectionChange={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/连接失败: 缺少或无效的访问令牌/)).toBeTruthy();
    unmount2();

    render(
      <ToolsPickerModal server={server} loading={false} error={null} tools={[]} selected={new Set()}
        onSelectionChange={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('暂无工具信息')).toBeTruthy();
  });

  it('server 为 null 即关闭（不渲染工具内容）', () => {
    render(
      <ToolsPickerModal server={null} loading={false} error={null} tools={tools} selected={new Set()}
        onSelectionChange={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByText('query_inventories')).toBeNull();
  });
});
