/**
 * ResizableTable 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 * 覆盖：列与数据渲染、表头拖拽改宽、拖拽结束恢复、空列不抛错。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResizableTable from './ResizableTable';

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name', width: 120 },
  // 故意省略 key：覆盖 key → dataIndex 的回退分支
  { title: '数量', dataIndex: 'qty', width: 80 },
];

const data = [{ key: '1', name: '高强度钢板', qty: 35 }];

function renderTable(cols: any[] = columns, rows: any[] = data) {
  return render(
    <ResizableTable columns={cols} dataSource={rows} rowKey="key" pagination={false} />,
  );
}

/** 表头拖拽手柄：cursor 为 col-resize 的 div */
function findHandle(container: HTMLElement): HTMLElement | undefined {
  return Array.from(container.querySelectorAll('div')).find(
    el => (el as HTMLElement).style.cursor === 'col-resize',
  ) as HTMLElement | undefined;
}

describe('ResizableTable', () => {
  it('属性传递：渲染列标题与行数据', () => {
    renderTable();
    expect(screen.getByText('名称')).toBeInTheDocument();
    expect(screen.getByText('数量')).toBeInTheDocument();
    expect(screen.getByText('高强度钢板')).toBeInTheDocument();
    expect(screen.getByText('35')).toBeInTheDocument();
  });

  it('事件触发：按下手柄进入拖拽态，移动改宽，抬起恢复', () => {
    const { container } = renderTable();
    const handle = findHandle(container);
    expect(handle).toBeTruthy();
    expect(handle!.style.background).toBe('transparent');

    fireEvent.mouseDown(handle!, { clientX: 100 });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    // 拖拽中：手柄高亮（active 分支）
    const activeHandle = findHandle(container);
    expect(activeHandle!.style.background).toBe('rgb(59, 130, 246)');

    fireEvent.mouseMove(document, { clientX: 160 });
    fireEvent.mouseUp(document);

    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    // 抬起后高亮撤销
    expect(findHandle(container)!.style.background).toBe('transparent');
  });

  it('边界：列与数据均为空时正常渲染不抛错', () => {
    const { container } = renderTable([], []);
    expect(container.querySelector('.ant-table')).toBeTruthy();
    expect(findHandle(container)).toBeUndefined();
  });
});
