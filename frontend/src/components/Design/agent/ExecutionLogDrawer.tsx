'use client';

/**
 * 执行记录侧面板（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 只负责渲染：分组规则与状态/步数推导在 `execution-log.ts`（纯函数，已单测），
 * 折叠状态由父组件持有（跨渲染保留用户的展开选择）。
 */
import { Drawer } from 'antd';
import EntryCard from './EntryCard';
import {
  groupExecutionLog, subtaskTitle, subtaskStatus, subtaskStepEntries, countSubtaskSteps,
  type LogEntry,
} from './execution-log';

interface Props {
  open: boolean;
  entries: LogEntry[];
  /** 已折叠的子任务 seq 集合 */
  collapsed: Set<number>;
  onToggleSubtask: (seq: number) => void;
  onClose: () => void;
}

export default function ExecutionLogDrawer({ open, entries, collapsed, onToggleSubtask, onClose }: Props) {
  const nodes = groupExecutionLog(entries);

  return (
    <Drawer title="执行记录" placement="right" width={420} open={open} onClose={onClose}>
      {entries.length === 0 ? (
        <p className="text-text-muted text-sm">暂无执行记录</p>
      ) : (
        <div className="space-y-2">
          {/* 按原始顺序：顶层条目在时间位置出现，子任务条目归入其组（可折叠+缩进） */}
          {nodes.map((node, ni) => (
            node.kind === 'top' ? (
              <div key={`t-${ni}`}><EntryCard entry={node.entry} /></div>
            ) : (
              <div key={`st-${node.seq}`} className="border border-dark-border rounded-lg overflow-hidden">
                {(() => {
                  const isCollapsed = collapsed.has(node.seq);
                  const st = subtaskStatus(node.entries);
                  return (
                    <>
                      <div
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${st === 'failed' ? 'bg-red-500/10' : 'bg-dark-card'}`}
                        onClick={() => onToggleSubtask(node.seq)}
                      >
                        <span className="text-text-muted text-xs">{isCollapsed ? '▶' : '▼'}</span>
                        <span className="text-accent-blue text-xs font-semibold">{subtaskTitle(node.entries, node.seq)}</span>
                        {st === 'done' && <span className="text-green-500 text-xs">✓</span>}
                        {st === 'failed' && <span className="text-red-500 text-xs">✗</span>}
                        <span className="text-text-muted text-xs ml-auto">{countSubtaskSteps(node.entries)} 步</span>
                      </div>
                      {!isCollapsed && (
                        <div className="pl-4 pr-2 py-2 space-y-2 bg-dark-bg/40">
                          {/* 只留执行动作（安全确认/工具调用）；start/done 由标题覆盖，input 是指令不是步骤 */}
                          {subtaskStepEntries(node.entries).map((entry, ei) => (
                            <div key={`s-${node.seq}-${ei}`}><EntryCard entry={entry} /></div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )
          ))}
        </div>
      )}
    </Drawer>
  );
}
