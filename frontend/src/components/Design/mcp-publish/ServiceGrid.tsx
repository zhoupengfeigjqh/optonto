'use client';

/**
 * 服务卡片栅格（MCP 发布页的「固定发布」与「自建发布」两块共用）：**一页最多 6 个**，超出自动分页。
 *
 * 为什么要分页：自建发布是动态容器（同一本体可发布多个），数量无上界——全部铺开会把页面拉长、
 * 也让「固定发布 5 个」被淹没；固定发布同理，将来增多也不用改页面。
 *
 * 页码越界收敛：删除发布或列表变短后，当前页可能超出末页——此时收敛到末页，
 * 而不是显示一张空白页（否则用户会误以为「发布都没了」）。
 */
import { ReactNode, useEffect, useState } from 'react';
import { Pagination } from 'antd';

/** 每页服务卡片数（固定发布当前 5 个，不触发分页；自建发布按其数量分页） */
export const PAGE_SIZE = 6;

interface Props<T> {
  items: T[];
  /** 渲染单张卡片；**key 由调用方在返回元素上给出**（本组件只负责分页与栅格布局） */
  renderItem: (item: T, index: number) => ReactNode;
  /** 空态：列表为空时取代栅格（不渲染分页器） */
  empty?: ReactNode;
}

export function ServiceGrid<T>({ items, renderItem, empty }: Props<T>) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (items.length === 0) return <>{empty}</>;

  const start = (page - 1) * PAGE_SIZE;
  const shown = items.slice(start, start + PAGE_SIZE);

  return (
    <>
      <div className="flex gap-4 flex-wrap">
        {shown.map((item, i) => renderItem(item, start + i))}
      </div>
      {items.length > PAGE_SIZE && (
        <div className="flex justify-end mt-4">
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={items.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      )}
    </>
  );
}
