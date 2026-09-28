'use client';

/**
 * 会话消息列表（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 只负责把消息数组渲染成气泡序列：用户消息、工具返回（历史）、assistant 思考区+正文、内嵌子任务块。
 * 业务状态（发送中/中断/滚到底）由父组件（AgentConversation）负责。
 *
 * 性能：用 useMemo 仅依赖 messages/sending——抽取前依赖里多带了 executionLog，
 * 会让每次执行记录更新都触发全部消息重新 renderMarkdown()。
 */
import { useMemo } from 'react';
import { Button, Spin, Tooltip, message } from 'antd';
import { UserOutlined, RobotOutlined, CopyOutlined } from '@ant-design/icons';
import { renderMarkdown } from '@/lib/markdown';
import { clickableProps } from '@/utils/a11y';
import SubtaskBlock from './SubtaskBlock';
import NarrativeBlock from './NarrativeBlock';
import type { ChatMessage } from './chat-types';

interface Props {
  messages: ChatMessage[];
  /** 是否处于流式输出中（决定末尾气泡显示"正在输出..."） */
  sending: boolean;
}

export default function MessageList({ messages, sending }: Props) {
  const content = useMemo(() => messages.map((msg, idx) => {
    const isAssistant = msg.role === 'assistant';
    const isToolResult = msg.role === 'toolResult';
    const isLast = idx === messages.length - 1;
    // 短期记忆摘要：仅供后端父Agent上下文，聊天区不展示
    if ((msg as any).role === 'summary') return null;
    // 聊天内嵌的子任务执行块：无头像，占位对齐到 assistant 气泡下方，保持对话整体感
    if ((msg as any).role === 'subtask') {
      return (
        <div key={idx} className="flex gap-3 justify-start mb-1">
          <div className="w-8 h-8 shrink-0" />
          <div className="flex-1 max-w-[75%]">
            <SubtaskBlock item={msg as any} />
          </div>
        </div>
      );
    }
    return (
      <div key={idx}>
        {/* User message */}
        {msg.role === 'user' && (
          <div className="flex gap-3 justify-end mb-2">
            <div className="relative max-w-[75%] rounded-xl px-4 py-2.5 text-sm bg-accent-blue text-white">
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.timestamp && (
                <div className="text-xs mt-1 text-white/60">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
            <div className="w-8 h-8 rounded-full bg-accent-green/20 flex items-center justify-center shrink-0">
              <UserOutlined style={{ color: '#10b981', fontSize: 16 }} />
            </div>
          </div>
        )}

        {/* Tool result (from history) */}
        {isToolResult && (
          <div className="flex gap-3 justify-start mb-2 ml-10">
            <div className="max-w-[75%] text-xs text-text-muted bg-dark-bg border border-dark-border rounded px-3 py-1.5 cursor-pointer hover:bg-dark-hover"
              {...clickableProps(() => {
                // 修复：详情 <pre> 是本节点的**子节点**，此前用 nextElementSibling 取的是
                // 外层兄弟（不存在），导致「点击展开工具返回数据」一直是失效的。
                const detail = document.getElementById(`tool-result-${idx}`);
                if (detail) detail.classList.toggle('hidden');
              }, '展开/收起工具返回数据')}>
              🔧 工具返回数据 <span className="text-accent-blue">▼</span>
              <pre id={`tool-result-${idx}`} className="hidden mt-1 text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{msg.content}</pre>
            </div>
          </div>
        )}

        {/* Assistant message：思考折叠块与正文气泡同属一行（同一头像），思考在上正文在下；
            空内容且无思考且非末尾时不渲染（规划路径下占位消息只留思考区，无空白气泡） */}
        {isAssistant && (msg.content || (msg as any).narrative || isLast) && (
          <div className="flex gap-3 justify-start mb-2">
            <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
              <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
            </div>
            <div className="flex flex-col gap-1 max-w-[75%] min-w-0">
              {(msg as any).narrative && (
                <div className="self-stretch">
                  <NarrativeBlock item={{ content: (msg as any).narrative, streaming: (msg as any).narrativeStreaming }} />
                </div>
              )}
              {(msg.content || !(msg as any).narrative) && (
                <div className="relative rounded-xl px-4 py-2.5 text-sm bg-dark-card border border-dark-border text-text-primary">
                  {msg.content ? (
                    sending && isLast ? (
                      <div>
                        <div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>
                        <div className="flex items-center gap-2 text-xs text-text-muted mt-2">
                          <Spin size="small" />
                          <span>正在输出...</span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                        <div className="flex items-center justify-end gap-2 mt-2">
                          <Tooltip title="复制内容">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              className="text-text-muted hover:text-text-primary opacity-0 hover:opacity-100 transition-opacity"
                              onClick={() => { navigator.clipboard.writeText(msg.content); message.success('已复制'); }}
                            />
                          </Tooltip>
                          {msg.timestamp && (
                            <span className="text-xs text-text-muted">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{isLast ? <Spin size="small" /> : ''}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }), [messages, sending]);

  return <>{content}</>;
}
