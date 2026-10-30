'use client';

/**
 * 执行记录单条条目卡片（自 AgentApp.tsx 抽取）。
 *
 * 2026-10-05（章程 IV 无障碍整改）：详情展开由**命令式 DOM 操作**改为 React state——
 * 原实现用 `nextElementSibling.classList.toggle('hidden')`，导致：
 *  ① 屏幕阅读器无法感知展开/收起（无 `aria-expanded`）；
 *  ② 状态不同步（DOM 变了但 React 不知道），折叠态在重渲染时可能视觉回退；
 *  ③ 手写的 role/tabIndex/onKeyDown 与 `utils/a11y.clickableProps` 重复实现，
 *     两处逻辑若不同步即不一致——现统一走助手。
 */
import { useState } from 'react';
import { Spin } from 'antd';
import { clickableProps } from '@/utils/a11y';
import type { LogEntry } from './execution-log';

/** 执行记录单条条目卡片 */
export default function EntryCard({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const hasParams = !!entry.params && Object.keys(entry.params).length > 0;
  const hasResult = !!entry.result;
  const hasDetail = hasParams || hasResult;

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        {entry.status === 'running' ? (
          <span role="status" aria-label="执行中"><Spin size="small" /></span>
        ) : (
          <span className="text-green-500 text-xs" aria-hidden>✓</span>
        )}
        {entry.status === 'failed' && <span className="text-red-500 text-xs" aria-hidden>✗</span>}
        {entry.source === 'parent' && <span className="text-yellow-500 text-xs mr-1">父</span>}
        {entry.source === 'child' && <span className="text-blue-400 text-xs mr-1">子</span>}
        <span className="text-accent-blue text-xs font-mono">{entry.title ? `${entry.title}（${entry.name}）` : entry.name}</span>
        <span className="text-text-muted text-xs ml-auto">{entry.time}</span>
      </div>
      {entry.detail && <div className="text-text-muted text-xs mt-1">{entry.detail}</div>}
      {hasDetail ? (
        <div className="mt-1">
          <div
            className="flex items-center gap-1 cursor-pointer hover:bg-dark-hover rounded py-0.5"
            {...clickableProps(() => setOpen(v => !v), open ? '收起详情' : '查看详情')}
            aria-expanded={open}
          >
            <span className="text-accent-blue text-xs">{open ? '▲ 收起详情' : '▼ 查看详情'}</span>
          </div>
          {open && (
            <div className="mt-1 space-y-1">
              {hasParams && (
                <div>
                  <span className="text-text-muted text-xs">输入参数</span>
                  <pre className="mt-0.5 text-xs text-text-secondary font-mono whitespace-pre-wrap bg-dark-bg rounded p-2">{JSON.stringify(entry.params, null, 2)}</pre>
                </div>
              )}
              {hasResult && (
                <div>
                  <span className="text-text-muted text-xs">返回数据</span>
                  <pre className="mt-0.5 text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-dark-bg rounded p-2">{entry.result}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
