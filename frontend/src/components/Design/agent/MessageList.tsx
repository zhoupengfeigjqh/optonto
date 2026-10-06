'use client';

/**
 * 会话消息列表（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 只负责把消息数组渲染成气泡序列：用户消息、工具返回（历史）、assistant 思考区+正文、内嵌子任务块。
 * 业务状态（发送中/中断/滚到底）由父组件（AgentConversation）负责。
 *
 * 2026-10-05（宪法 I 性能 / IV 无障碍）整改：
 * ① markdown 缓存——流式期间 `messages` 每 token 都是新数组，`useMemo([messages])`
 *    必然失效，导致每 token 触发**全部历史消息**重跑 renderMarkdown()（O(N) 次/token）。
 *    改为按「消息内容」缓存 HTML（见 useMarkdownCache）：内容未变的历史消息直接命中。
 * ② 工具返回的展开态由命令式 DOM（`getElementById` + `classList.toggle`）改为 React state
 *    ——前者屏幕阅读器无法感知（无 aria-expanded）、状态不同步，且 id 用数组下标会在
 *    多个列表实例间撞 id。
 * ③ `as any` 清理：改用 `chat-types` 的类型收窄。
 * ④ 转圈补 `role="status"`：屏幕阅读器需要知道"正在输出"。
 */
import { useMemo, useRef, useState } from 'react';
import { Button, Spin, Tooltip, message } from 'antd';
import { UserOutlined, RobotOutlined, CopyOutlined } from '@ant-design/icons';
import { renderMarkdown } from '@/lib/markdown';
import { clickableProps } from '@/utils/a11y';
import SubtaskBlock from './SubtaskBlock';
import NarrativeBlock from './NarrativeBlock';
import type { AssistantChatMessage, ChatMessage, SubtaskChatItem } from './chat-types';

interface Props {
  messages: ChatMessage[];
  /** 是否处于流式输出中（决定末尾气泡显示"正在输出..."） */
  sending: boolean;
}

/**
 * 按「内容 → HTML」的 markdown 渲染缓存（宪法 I：昂贵计算 MUST 移出渲染路径）。
 *
 * 必须缓存的原因：流式输出的每一帧 `messages` 都是新数组，React 侧任何 memo 都失效；
 * 唯一稳定的键是消息内容本身。用 ref 持有 Map（不用 useMemo，否则缓存本身会被 GC），
 * 并设上限——聊天进程有界，缓存只增不减会缓慢涨内存。
 */
const MAX_CACHE = 300;
function useMarkdownCache() {
  const cache = useRef(new Map<string, string>());
  return (text: string): string => {
    const hit = cache.current.get(text);
    if (hit !== undefined) return hit;
    const html = renderMarkdown(text);
    if (cache.current.size >= MAX_CACHE) cache.current.clear();
    cache.current.set(text, html);
    return html;
  };
}

/** 工具返回条（历史消息）：展开态收在组件内 state，不再操作 DOM */
function ToolResultItem({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-[75%] text-xs text-text-muted bg-dark-bg border border-dark-border rounded px-3 py-1.5">
      <div
        className="cursor-pointer hover:bg-dark-hover flex items-center gap-1"
        {...clickableProps(() => setOpen(v => !v), open ? '收起工具返回数据' : '展开工具返回数据')}
        aria-expanded={open}
      >
        <span aria-hidden>🔧</span> 工具返回数据
        <span className="text-accent-blue" aria-hidden>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <pre className="mt-1 text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{content}</pre>
      )}
    </div>
  );
}

export default function MessageList({ messages, sending }: Props) {
  const md = useMarkdownCache();
  const content = useMemo(() => messages.map((msg, idx) => {
    const isLast = idx === messages.length - 1;
    // 短期记忆摘要：仅供后端父Agent上下文，聊天区不展示
    if (msg.role === 'summary') return null;
    // 聊天内嵌的子任务执行块：无头像，占位对齐到 assistant 气泡下方，保持对话整体感
    if (msg.role === 'subtask') {
      return (
        <div key={idx} className="flex gap-3 justify-start mb-1">
          <div className="w-8 h-8 shrink-0" />
          <div className="flex-1 max-w-[75%]">
            <SubtaskBlock item={msg as SubtaskChatItem} />
          </div>
        </div>
      );
    }
    if (msg.role === 'toolResult') {
      return (
        <div key={idx} className="flex gap-3 justify-start mb-2 ml-10">
          <ToolResultItem content={msg.content} />
        </div>
      );
    }
    const am = msg as AssistantChatMessage;
    if (am.role !== 'assistant') {
      // User message
      return (
        <div key={idx} className="flex gap-3 justify-end mb-2">
          <div className="relative max-w-[75%] rounded-xl px-4 py-2.5 text-sm bg-accent-blue text-white">
            <div className="whitespace-pre-wrap break-words">{am.content}</div>
            {am.timestamp && (
              <div className="text-xs mt-1 text-white/60">
                {new Date(am.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div className="w-8 h-8 rounded-full bg-accent-green/20 flex items-center justify-center shrink-0">
            <UserOutlined style={{ color: '#10b981', fontSize: 16 }} />
          </div>
        </div>
      );
    }
    // Assistant：思考折叠块与正文气泡同属一行（同一头像），思考在上正文在下；
    // 空内容且无思考且非末尾时不渲染（规划路径下占位消息只留思考区，无空白气泡）
    if (!(am.content || am.narrative || isLast)) return null;
    return (
      <div key={idx} className="flex gap-3 justify-start mb-2">
        <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
          <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
        </div>
        <div className="flex flex-col gap-1 max-w-[75%] min-w-0">
          {am.narrative && (
            <div className="self-stretch">
              <NarrativeBlock item={{ content: am.narrative, streaming: !!am.narrativeStreaming }} />
            </div>
          )}
          {(am.content || !am.narrative) && (
            <div className="relative rounded-xl px-4 py-2.5 text-sm bg-dark-card border border-dark-border text-text-primary">
              {am.content ? (
                sending && isLast ? (
                  <div>
                    {/* 末尾流式消息走纯文本：内容每帧都变，markdown 渲染无收益且白烧 CPU */}
                    <div className="whitespace-pre-wrap break-words text-sm">{am.content}</div>
                    <div className="flex items-center gap-2 text-xs text-text-muted mt-2" role="status" aria-live="polite">
                      <Spin size="small" />
                      <span>正在输出...</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: md(am.content) }} />
                    <div className="flex items-center justify-end gap-2 mt-2">
                      <Tooltip title="复制内容">
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined />}
                          aria-label="复制内容"
                          className="text-text-muted hover:text-text-primary opacity-0 hover:opacity-100 transition-opacity"
                          onClick={() => { navigator.clipboard.writeText(am.content ?? ''); message.success('已复制'); }}
                        />
                      </Tooltip>
                      {am.timestamp && (
                        <span className="text-xs text-text-muted">{new Date(am.timestamp).toLocaleTimeString()}</span>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <div className="whitespace-pre-wrap break-words">
                  {isLast && <span role="status" aria-label="生成中"><Spin size="small" /></span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }), [messages, sending, md]);

  return <>{content}</>;
}
