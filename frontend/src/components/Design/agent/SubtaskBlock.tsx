'use client';

/** 聊天里的子任务执行块（自 AgentApp.tsx 抽取，行为不变）。 */
import { useState } from 'react';
import { Spin } from 'antd';
import { clickableProps } from '@/utils/a11y';
import type { SubtaskChatItem } from './chat-types';

/** 聊天里的子任务执行块：显示状态 + 可展开的执行动作明细（与原子任务执行框一致：✓/⟳/✗ + 动作名） */
export default function SubtaskBlock({ item }: { item: SubtaskChatItem }) {
  const [open, setOpen] = useState(false);
  // 只取执行动作（工具调用 / 安全确认），按动作名去重、保留最终状态（等同原执行框的展示）
  const actionMap = new Map<string, any>();
  for (const d of (item.details as any[]) || []) {
    if (d.type === 'tool_call' || d.type === 'security_confirm') actionMap.set(d.name, d);
  }
  const actions = [...actionMap.values()];
  const done = (item.details as any[]).find(d => d.type === 'subtask_done');
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-dark-hover" {...clickableProps(() => setOpen(!open), open ? '收起' : '展开')}>
        <span className="text-text-muted text-xs">{open ? '▼' : '▶'}</span>
        <span className="text-accent-blue text-xs font-semibold">子任务 {item.seq}: {item.displayLabel || item.displayName || item.behavior}</span>
        {item.status === 'running' && <Spin size="small" />}
        {item.status === 'done' && <span className="text-green-500 text-xs">✓</span>}
        {item.status === 'failed' && <span className="text-red-500 text-xs">✗</span>}
        <span className="text-text-muted text-xs ml-auto">{open ? '收起' : '展开'}</span>
      </div>
      {item.description && (
        <div className="px-3 pb-2 -mt-1 text-xs text-text-primary truncate" title={item.description}>{item.description}</div>
      )}
      {open && (
        <div className="pl-4 pr-2 py-2 bg-dark-bg/40">
          {actions.map((d: any, i: number) => (
            <div key={i} className={`text-xs font-mono py-0.5 ${d.status === 'failed' ? 'text-red-400' : d.status === 'done' ? 'text-green-400' : 'text-yellow-400'}`}>
              {d.type === 'security_confirm' ? '🔒 安全确认' : (d.status === 'failed' ? '✗' : d.status === 'done' ? '✓' : '⟳')} {d.name}
            </div>
          ))}
          {done && done.result && (
            <div className="mt-1 pt-1 border-t border-dark-border text-xs text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto">{String(done.result)}</div>
          )}
        </div>
      )}
    </div>
  );
}
