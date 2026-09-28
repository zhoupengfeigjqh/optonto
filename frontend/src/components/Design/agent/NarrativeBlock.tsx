'use client';

/** 聊天里的规划叙事折叠块（自 AgentApp.tsx 抽取，行为不变）。 */
import { useState } from 'react';
import { Spin } from 'antd';
import { clickableProps } from '@/utils/a11y';

/** 聊天里的规划叙事折叠块：父Agent 规划阶段的思考/叙事实时流入，默认折叠；submit_plan 提交后定格（防编造执行叙事进正文） */
export default function NarrativeBlock({ item }: { item: { content: string; streaming?: boolean } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-dark-hover" {...clickableProps(() => setOpen(!open), open ? '收起' : '展开')}>
        <span className="text-text-muted text-xs">{open ? '▼' : '▶'}</span>
        <span className="text-accent-blue text-xs font-semibold">思考内容...</span>
        {item.streaming && <Spin size="small" />}
        <span className="text-text-muted text-xs ml-auto">{open ? '收起' : '展开'}</span>
      </div>
      {open && (
        <div className="pl-4 pr-3 py-2 bg-dark-bg/40 text-xs text-text-secondary whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{item.content}</div>
      )}
    </div>
  );
}
