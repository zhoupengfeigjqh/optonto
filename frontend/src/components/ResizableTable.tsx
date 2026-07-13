'use client';

import { useRef, useState, useCallback } from 'react';
import { Table } from 'antd';
import type { TableProps, ColumnsType } from 'antd/es/table';

interface ResizableTableProps<T> extends Omit<TableProps<T>, 'columns'> {
  columns: ColumnsType<T>;
}

const RESIZE_HANDLE_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: 6,
  cursor: 'col-resize',
  zIndex: 2,
};

function ResizeHandle({ onMouseDown, active }: { onMouseDown: (e: React.MouseEvent) => void; active: boolean }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      style={{
        ...RESIZE_HANDLE_STYLE,
        background: active ? '#3b82f6' : 'transparent',
        transition: 'background 0.15s',
      }}
    />
  );
}

const HeaderCell = (props: any) => {
  const { children, onResize, ...rest } = props;
  return (
    <th {...rest} style={{ ...rest.style, position: 'relative' }}>
      {children}
      {onResize && <ResizeHandle onMouseDown={onResize} active={false} />}
    </th>
  );
};

export default function ResizableTable<T extends object>({ columns, ...rest }: ResizableTableProps<T>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{ key: string; startX: number; startW: number; el: HTMLElement | null } | null>(null);
  const [activeCol, setActiveCol] = useState<string | null>(null);

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th');
    if (!th) return;
    const startW = th.getBoundingClientRect().width;
    dragRef.current = { key, startX: e.clientX, startW, el: th };
    setActiveCol(key);

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const diff = ev.clientX - dragRef.current.startX;
      const newW = Math.max(60, dragRef.current.startW + diff);
      setColWidths(prev => ({ ...prev, [key]: newW }));
    };

    const onUp = () => {
      dragRef.current = null;
      setActiveCol(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const mergedColumns = (columns || []).map((col: any) => {
    const key = (col.key || col.dataIndex) as string;
    const width = colWidths[key] || col.width;
    return {
      ...col,
      width,
      onHeaderCell: () => ({
        width,
        onResize: (e: React.MouseEvent) => handleResizeStart(key, e),
      }),
    };
  });

  return (
    <Table
      {...rest}
      columns={mergedColumns}
      components={{
        header: { cell: HeaderCell },
      }}
      size="middle"
      className="bg-transparent"
      style={{ userSelect: activeCol ? 'none' : undefined }}
    />
  );
}
