'use client';

/** 执行记录单条条目卡片（自 AgentApp.tsx 抽取，行为不变）。 */
import { Spin } from 'antd';

/** 执行记录单条条目卡片 */
export default function EntryCard({ entry }: { entry: any }) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        {entry.status === 'running' ? (
          <Spin size="small" />
        ) : (
          <span className="text-green-500 text-xs">✓</span>
        )}
        {entry.status === 'failed' && <span className="text-red-500 text-xs">✗</span>}
        {entry.source === 'parent' && <span className="text-yellow-500 text-xs mr-1">父</span>}
        {entry.source === 'child' && <span className="text-blue-400 text-xs mr-1">子</span>}
        <span className="text-accent-blue text-xs font-mono">{entry.displayName || entry.name}</span>
        <span className="text-text-muted text-xs ml-auto">{entry.time}</span>
      </div>
      {entry.detail && <div className="text-text-muted text-xs mt-1">{entry.detail}</div>}
      {(entry.params && Object.keys(entry.params).length > 0) || entry.result ? (
        <div className="mt-1">
          <div className="flex items-center gap-1 cursor-pointer hover:bg-dark-hover rounded py-0.5"
            role="button"
            tabIndex={0}
            aria-label="查看详情"
            onClick={(e) => {
              const panel = e.currentTarget.nextElementSibling as HTMLElement;
              if (panel) panel.classList.toggle('hidden');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const panel = e.currentTarget.nextElementSibling as HTMLElement;
                if (panel) panel.classList.toggle('hidden');
              }
            }}>
            <span className="text-accent-blue text-xs">▼ 查看详情</span>
          </div>
          <div className="hidden mt-1 space-y-1">
            {entry.params && Object.keys(entry.params).length > 0 && (
              <div>
                <span className="text-text-muted text-xs">输入参数</span>
                <pre className="mt-0.5 text-xs text-text-secondary font-mono whitespace-pre-wrap bg-dark-bg rounded p-2">{JSON.stringify(entry.params, null, 2)}</pre>
              </div>
            )}
            {entry.result && (
              <div>
                <span className="text-text-muted text-xs">返回数据</span>
                <pre className="mt-0.5 text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-dark-bg rounded p-2">{entry.result}</pre>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
