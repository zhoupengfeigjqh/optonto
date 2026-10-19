'use client';

/**
 * 本体明细各表的统一分页口径：每页固定 5 行，超出才出现分页器。
 *
 * 仅用 antd 的非受控分页会带来一个副作用：新增行在列表末尾，若当前停在第一页，
 * 新增内容落在后续页而“看不见”。因此这里保持受控 current，并在新增后调用
 * `goToRow(新增行下标)` 跳到该行所在页。
 */
import { useCallback, useMemo, useState } from 'react';
import type { TablePaginationConfig } from 'antd';

/** 本体明细每页行数 */
export const TABLE_PAGE_SIZE = 5;

export function useTablePagination(pageSize: number = TABLE_PAGE_SIZE) {
  const [current, setCurrent] = useState(1);

  const pagination = useMemo<TablePaginationConfig>(() => ({
    current,
    pageSize,
    showSizeChanger: false,
    hideOnSinglePage: true,
    onChange: (page: number) => setCurrent(page),
  }), [current, pageSize]);

  /** 跳到某行（0-based）所在页；新增行下标传当前列表长度即可 */
  const goToRow = useCallback((rowIndex: number) => {
    setCurrent(Math.floor(Math.max(0, rowIndex) / pageSize) + 1);
  }, [pageSize]);

  return { pagination, goToRow };
}
