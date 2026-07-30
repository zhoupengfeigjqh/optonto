'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Button, Input, Modal, message, Space, Spin, Select, Table, Tooltip, Drawer } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowLeftOutlined,
  SendOutlined, RobotOutlined, UserOutlined,
  MessageOutlined, CopyOutlined, CodeOutlined,
} from '@ant-design/icons';
import {
  listAgentThreads, createAgentThread, deleteAgentThread,
  getAgentThread, agentChatStream,
  listSkills,
  AgentThreadSummary, AgentMessage, SkillInfo,
} from '@/api/agent-client';
import { renderMarkdown } from '@/lib/markdown';

// ─── Agent Conversation 子组件（聊天界面） ─────────────────

function AgentConversation({
  threadId, scenarioName, ontologyName, onBack,
}: {
  threadId: string;
  scenarioName: string;
  ontologyName: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [executionLog, setExecutionLog] = useState<{
    time: string; type: string;
    name: string; description?: string; params?: any; result?: string; status: string; detail?: string; source?: string;
  }[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [subtaskBox, setSubtaskBox] = useState<{lines: {text: string; done: boolean; failed?: boolean; params?: any}[]; childRunning?: boolean} | null>(null);
  const [planRoute, setPlanRoute] = useState<{seq: number; behavior: string; description: string}[] | null>(null);
  const [childAgentDetail, setChildAgentDetail] = useState<{
    seq: number;
    behavior: string;
    description?: string;
    input?: string;
    steps: { type: 'tool_call' | 'result'; name: string; params?: any; result?: string; time: string }[];
    output?: string;
    status: 'running' | 'done' | 'failed';
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 加载历史消息
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const thread = await getAgentThread(scenarioName, ontologyName, threadId);
        setMessages(thread.messages || []);
      } catch (e: any) {
        message.error('加载对话失败: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [threadId, scenarioName, ontologyName]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, subtaskBox]);

  // received `done` event from orchestrator → 4s后隐藏执行框
  const [subtaskDoneTimer, setSubtaskDoneTimer] = useState<boolean>(false);
  useEffect(() => {
    if (subtaskDoneTimer) {
      const timer = setTimeout(() => { setSubtaskBox(null); setSubtaskDoneTimer(false); }, 4000);
      return () => clearTimeout(timer);
    }
  }, [subtaskDoneTimer]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    // 添加用户消息
    const userMsg: AgentMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    // 添加空助手消息用于流式填充
    const assistantMsg: AgentMessage = { role: 'assistant', content: '', timestamp: '' };
    setMessages(prev => [...prev, assistantMsg]);

    // 重置规划链路、子Agent明细、执行状态
    setPlanRoute(null);
    setChildAgentDetail(null);
    setSubtaskBox(null);
    setExecutionLog([]);
    abortRef.current = new AbortController();

    try {
      const response = await agentChatStream(scenarioName, ontologyName, threadId, text);
      if (!response.ok) throw new Error(await response.text());

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'done') { setSubtaskDoneTimer(true); break; }
            if (data.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant' && !last.content) {
                  updated[updated.length - 1] = { ...last, content: `\n\n[错误: ${data.message}]` };
                }
                return updated;
              });
              break;
            }
            if (data.type === 'plan_received') {
              setPlanRoute((data.plan?.subtasks || []).map((st: any) => ({
                seq: st.seq,
                behavior: st.behavior,
                description: st.description,
              })));
            }
            if (data.type === 'confirm') {
              Modal.confirm({
                title: <span style={{ color: '#fff' }}>🔒 安全管控确认 — {data.behavior}</span>,
                content: <div style={{ color: '#e5e7eb', whiteSpace: 'pre-wrap' }}>{data.content}</div>,
                icon: null,
                okText: '批准执行',
                cancelText: '拒绝',
                okButtonProps: { style: { background: '#1677ff' } },
                cancelButtonProps: { danger: true },
                onOk: async () => {
                  try {
                    await fetch(`/agent-api/confirm/${data.confirmId}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ approved: true }),
                    });
                  } catch {}
                },
                onCancel: async () => {
                  try {
                    await fetch(`/agent-api/confirm/${data.confirmId}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ approved: false }),
                    });
                  } catch {}
                },
              });
            }
            if (data.type === 'exec_entry') {
              const entry = data.entry;
              setExecutionLog(prev => {
                const exists = prev.findIndex(e => e.name === entry.name && e.status === 'running');
                if (exists >= 0 && entry.status !== 'running') {
                  const n = [...prev]; n[exists] = { ...n[exists], status: entry.status, detail: entry.detail, params: entry.params, result: entry.result }; return n;
                }
                if (exists >= 0) return prev;
                return [...prev, { time: entry.time, type: entry.type, name: entry.name, status: entry.status, detail: entry.detail, params: entry.params, result: entry.result, source: entry.source }];
              });
              // 子任务框实时更新
              if (entry.source === 'child' || entry.source === 'parent') {
                setSubtaskBox(prev => {
                  if (!prev) return { lines: [{ text: entry.detail || entry.name, done: entry.status !== 'running', failed: entry.status === 'failed' }], childRunning: entry.source === 'child' && entry.status === 'running' };
                  const key = entry.name;
                  const idx = prev.lines.findIndex(l => l.text.startsWith(key));
                  if (idx >= 0) {
                    const n = [...prev.lines]; n[idx] = { text: entry.detail || entry.name, done: entry.status !== 'running', failed: entry.status === 'failed', params: entry.params };
                    return { ...prev, lines: n, childRunning: entry.source === 'child' && entry.status === 'running' };
                  }
                  return { ...prev, lines: [...prev.lines, { text: entry.detail || entry.name, done: entry.status !== 'running', failed: entry.status === 'failed', params: entry.params }], childRunning: entry.source === 'child' && entry.status === 'running' };
                });
              }
              // 子Agent明细面板
              if (entry.type === 'subtask_input') {
                setChildAgentDetail({
                  seq: 0,
                  behavior: entry.name,
                  description: entry.detail?.split('\n')[1]?.replace('描述: ', '') || '',
                  input: entry.detail,
                  steps: [],
                  status: 'running',
                });
              } else if (entry.type === 'tool_call') {
                setChildAgentDetail(prev => {
                  if (!prev) return prev;
                  // 找到同名的 running 步骤更新 result，否则新增
                  const idx = prev.steps.findIndex(s => s.type === 'tool_call' && s.name === entry.name && !s.result);
                  if (idx >= 0 && entry.status === 'done') {
                    const newSteps = [...prev.steps];
                    newSteps[idx] = { ...newSteps[idx], result: entry.result };
                    return { ...prev, steps: newSteps };
                  }
                  if (entry.status === 'running') {
                    return { ...prev, steps: [...prev.steps, { type: 'tool_call', name: entry.name, params: entry.params, time: entry.time }] };
                  }
                  return prev;
                });
              } else if (entry.type === 'subtask_done' && entry.source === 'child') {
                setChildAgentDetail(prev => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    output: entry.detail || entry.result || '',
                    status: entry.status === 'done' ? 'done' : 'failed',
                    steps: [...prev.steps, { type: 'result', name: '执行结果', result: entry.result || entry.detail, time: entry.time }],
                  };
                });
              }
            }
            if (data.type === 'token') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + (data.token || '') };
                }
                return updated;
              });
            }
          } catch { /* skip parse errors */ }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = { ...last, content: `\n\n[错误: ${e.message}]` };
          }
          return updated;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  // 消息列表用 useMemo 缓存，仅 messages/sending/toolCalls 变化时重新渲染
  // 避免输入框每按一次键都触发全部消息的 renderMarkdown()
  const messagesContent = useMemo(() => messages.map((msg, idx) => {
    const isAssistant = msg.role === 'assistant';
    const isToolResult = msg.role === 'toolResult';
    const isLast = idx === messages.length - 1;
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
              onClick={(e) => {
                const target = e.currentTarget.nextElementSibling as HTMLElement;
                if (target) target.classList.toggle('hidden');
              }}>
              🔧 工具返回数据 <span className="text-accent-blue">▼</span>
              <pre className="hidden mt-1 text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{msg.content}</pre>
            </div>
          </div>
        )}

        {/* Tool calls (only for the last assistant turn when sending) */}
        {isAssistant && isLast && sending && executionLog.filter(e => e.status === 'running').length > 0 && (
          <div className="flex gap-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
              <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
            </div>
            <div className="flex flex-col gap-1">
              {executionLog.filter(e => e.status === 'running').map((entry, ti) => (
                <div key={ti} className="flex items-center gap-2 text-xs text-text-muted bg-dark-card border border-dark-border rounded px-3 py-1.5">
                  <Spin size="small" />
                  <span>调用了 <code className="text-accent-blue">{entry.name}</code></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assistant message */}
        {isAssistant && (
          <div className="flex gap-3 justify-start mb-2">
            <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
              <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
            </div>
            <div className="relative max-w-[75%] rounded-xl px-4 py-2.5 text-sm bg-dark-card border border-dark-border text-text-primary">
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
          </div>
        )}
      </div>
    );
  }), [messages, sending, executionLog]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Spin /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} className="text-text-muted hover:text-text-primary" />
          <h3 className="text-base font-semibold text-text-primary ml-2">智能体对话</h3>
        </div>
        <Button size="small" icon={<CodeOutlined />} onClick={() => setLogOpen(true)}>
          执行记录
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-text-muted">
            <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <p className="text-sm">开始一段新的智能体对话</p>
            <p className="text-xs mt-1">输入您的问题，AI Agent 将基于加载的技能为您解答</p>
          </div>
        ) : messagesContent}

        {/* 规划链路 */}
        {planRoute && !sending && (
          <div className="mb-3 p-3 rounded-lg bg-dark-card/40 border border-accent-blue/20">
            <div className="text-xs font-semibold text-accent-blue mb-2">📋 规划链路</div>
            <div className="space-y-1">
              {planRoute.map((step, i) => (
                <div key={step.seq} className="flex items-center gap-2 text-xs">
                  <span className="text-accent-blue font-mono">{i + 1}.</span>
                  <span className="text-text-primary font-medium">{step.behavior}</span>
                  <span className="text-text-muted">— {step.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 子Agent执行明细面板 */}
      {childAgentDetail && (
        <div className="mb-2 rounded-lg bg-dark-card/60 border border-blue-500/20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-blue-500/10">
            <span className="text-xs font-semibold text-blue-400">📦 子Agent 执行明细</span>
            <span className={`text-xs ${childAgentDetail.status === 'running' ? 'text-yellow-400' : childAgentDetail.status === 'done' ? 'text-green-400' : 'text-red-400'}`}>
              {childAgentDetail.status === 'running' ? '⟳ 执行中' : childAgentDetail.status === 'done' ? '✓ 完成' : '✗ 失败'}
            </span>
          </div>
          <div className="p-3 space-y-2 max-h-48 overflow-y-auto font-mono text-xs">
            {/* 行为名 */}
            <div>
              <span className="text-text-muted">行为: </span>
              <span className="text-accent-blue">{childAgentDetail.behavior}</span>
              {childAgentDetail.description && (
                <span className="text-text-muted ml-2">— {childAgentDetail.description}</span>
              )}
            </div>
            {/* 输入（可折叠） */}
            <div>
              <div className="flex items-center gap-1 cursor-pointer hover:bg-dark-hover rounded py-0.5"
                onClick={(e) => { const p = e.currentTarget.nextElementSibling as HTMLElement; if (p) p.classList.toggle('hidden'); }}>
                <span className="text-text-muted">▶ 查看输入</span>
              </div>
              <pre className="hidden mt-1 text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto bg-dark-bg rounded p-2">
                {childAgentDetail.input || ''}
              </pre>
            </div>
            {/* 执行步骤 */}
            {childAgentDetail.steps.map((step, si) => (
              <div key={si} className="flex items-start gap-2">
                {step.type === 'tool_call' ? (
                  <>
                    <span className="text-yellow-400 shrink-0">🔧</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-yellow-400 break-all">{step.name}</div>
                      <div className="flex items-center gap-1 cursor-pointer hover:bg-dark-hover rounded py-0.5"
                        onClick={(e) => { const p = e.currentTarget.nextElementSibling as HTMLElement; if (p) p.classList.toggle('hidden'); }}>
                        <span className="text-text-muted text-xxs">查看详情 ▼</span>
                      </div>
                      <div className="hidden mt-0.5 space-y-1">
                        {step.params && Object.keys(step.params).length > 0 && (
                          <pre className="text-text-muted whitespace-pre-wrap bg-dark-bg rounded p-1">{JSON.stringify(step.params, null, 2)}</pre>
                        )}
                        {step.result && (
                          <pre className="text-green-400/80 whitespace-pre-wrap bg-dark-bg rounded p-1 max-h-60 overflow-y-auto">{step.result}</pre>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-green-400 shrink-0">✓</span>
                    <div className="text-green-400/80 min-w-0 flex-1 break-all">{step.result || ''}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 子任务实时执行框 */}
      {subtaskBox && (
        <div className="mb-2 p-3 rounded-lg bg-dark-card/60 border border-yellow-500/20 font-mono text-xs space-y-1">
          {subtaskBox.lines.map((l, i) => (
            <div key={i}>
              <div className={`${l.failed ? 'text-red-400' : l.done ? 'text-green-400' : 'text-yellow-400'} ${l.done && !l.failed ? 'opacity-70' : ''}`}>
                {l.failed ? '✗' : l.done ? '✓' : '⟳'} {l.text}
              </div>
              {l.params && !l.done && Object.keys(l.params).length > 0 && (
                <div className="mt-0.5 ml-3 text-text-muted text-xxs">
                  {Object.entries(l.params).slice(0, 4).map(([k, v]: any) => {
                    const val = typeof v === 'object' ? (v.value !== undefined && v.value !== '' ? v.value : '?') : v;
                    return <span key={k} className="mr-2">{k}={val}</span>;
                  })}
                  {Object.keys(l.params).length > 4 && <span>...</span>}
                </div>
              )}
            </div>
          ))}
          {subtaskBox.childRunning && (
            <button
              className="mt-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded px-2 py-0.5"
              onClick={async () => { await fetch('/agent-api/abort', { method: 'POST' }); }}
            >
              中断执行
            </button>
          )}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end border-t border-dark-border pt-3">
        <Input.TextArea
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="输入您的问题... (Shift+Enter 换行)"
          rows={2}
          className="bg-dark-bg border-dark-border text-text-primary"
          disabled={sending}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={!input.trim()}
        >
          发送
        </Button>
      </div>

      {/* 执行记录侧面板 */}
      <Drawer
        title="执行记录"
        placement="right"
        width={420}
        open={logOpen}
        onClose={() => setLogOpen(false)}
      >
        {executionLog.length === 0 ? (
          <p className="text-text-muted text-sm">暂无执行记录</p>
        ) : (
          <div className="space-y-2">
            {executionLog.map((entry, idx) => (
              <div key={idx} className="bg-dark-card border border-dark-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  {entry.status === 'running' ? (
                    <Spin size="small" />
                  ) : (
                    <span className="text-green-500 text-xs">✓</span>
                  )}
                  {entry.status === 'failed' && <span className="text-red-500 text-xs">✗</span>}
                  {entry.source === 'parent' && <span className="text-yellow-500 text-xs mr-1">父</span>}
                  {entry.source === 'child' && <span className="text-blue-400 text-xs mr-1">子</span>}
                  <span className="text-accent-blue text-xs font-mono">{entry.name}</span>
                  <span className="text-text-muted text-xs ml-auto">{entry.time}</span>
                </div>
                {entry.detail && <div className="text-text-muted text-xs mt-1">{entry.detail}</div>}
                {(entry.params && Object.keys(entry.params).length > 0) || entry.result ? (
                  entry.name === 'load_skill' ? (
                    <div className="mt-1 text-xs">
                      <div className="text-text-muted">技能名称: <span className="text-text-secondary">{entry.params?.skill_name || '-'}</span></div>
                      <div className="text-text-muted">描述: <span className="text-text-secondary">{(entry.result || '').match(/^---[\s\S]*?description:\s*(.+?)[\s\S]*?^---/m)?.[1]?.trim() || '已加载'}</span></div>
                    </div>
                  ) : (
                    <div className="mt-1">
                      <div className="flex items-center gap-1 cursor-pointer hover:bg-dark-hover rounded py-0.5"
                        onClick={(e) => {
                          const panel = e.currentTarget.nextElementSibling as HTMLElement;
                          if (panel) panel.classList.toggle('hidden');
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
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ─── Agent Thread List 子组件（线程列表） ─────────────────

export default function AgentApp({
  scenarioName,
  ontologyName,
}: {
  scenarioName?: string;
  ontologyName?: string;
}) {
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // 加载线程列表和技能列表
  const load = async () => {
    if (!scenarioName || !ontologyName) return;
    setLoading(true);
    try {
      const [threadList, skillList] = await Promise.all([
        listAgentThreads(scenarioName, ontologyName),
        listSkills(scenarioName, ontologyName),
      ]);
      setThreads(threadList);
      setSkills(skillList);
    } catch (e: any) {
      message.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scenarioName, ontologyName]);

  // 新建线程
  const handleNew = async () => {
    if (!scenarioName || !ontologyName) return;
    try {
      const thread = await createAgentThread(
        scenarioName,
        ontologyName,
        newTitle || '新对话',
        selectedSkills
      );
      setShowNewDialog(false);
      setNewTitle('');
      setSelectedSkills([]);
      setActiveThreadId(thread.id);
    } catch (e: any) {
      message.error('创建失败: ' + e.message);
    }
  };

  // 删除线程
  const handleDelete = (id: string) => {
    if (!scenarioName || !ontologyName) return;
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认删除</span>,
      content: <span style={{ color: '#ef4444' }}>删除后不可恢复，确定要删除吗？</span>,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAgentThread(scenarioName, ontologyName, id);
          message.success('已删除');
          await load();
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  // 进入对话后显示聊天界面
  if (activeThreadId) {
    return (
      <AgentConversation
        threadId={activeThreadId}
        scenarioName={scenarioName || ''}
        ontologyName={ontologyName || ''}
        onBack={() => { setActiveThreadId(null); load(); }}
      />
    );
  }

  const columns = [
    {
      title: '会话标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: AgentThreadSummary) => (
        <span
          className="text-text-primary cursor-pointer hover:text-accent-blue"
          onClick={() => setActiveThreadId(r.id)}
        >
          {v || '未命名对话'}
        </span>
      ),
    },
    {
      title: '消息数',
      dataIndex: 'message_count',
      key: 'message_count',
      width: 100,
      render: (v: number) => <span className="text-text-secondary text-sm">{v}</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 200,
      render: (v: string) => (
        <span className="text-text-secondary text-sm">
          {v ? new Date(v).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, r: AgentThreadSummary) => (
        <Space>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => setActiveThreadId(r.id)}>
            对话
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">智能体应用</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewDialog(true)}>
          新建对话
        </Button>
      </div>
      <p className="text-text-muted text-xs mb-3">
        与 AI Agent 进行对话，它将基于加载的技能文件为您提供领域知识解答。
      </p>

      <Table
        dataSource={threads}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        className="bg-transparent"
      />

      {/* 新建对话弹窗 */}
      <Modal
        title="新建智能体对话"
        open={showNewDialog}
        onOk={handleNew}
        onCancel={() => {
          setShowNewDialog(false);
          setNewTitle('');
          setSelectedSkills([]);
        }}
        okText="创建"
        cancelText="取消"
      >
        <div className="py-3 space-y-4">
          <div>
            <label className="text-text-secondary text-sm block mb-1">对话标题</label>
            <Input
              placeholder="输入对话标题（可选）"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">选择加载的技能</label>
            <Select
              mode="multiple"
              placeholder="选择该对话要加载的技能文件"
              value={selectedSkills}
              onChange={setSelectedSkills}
              options={skills.map(s => ({
                label: s.name,
                value: s.name,
              }))}
              className="w-full"
              style={{ background: '#1a1a2e' }}
              popupClassName="bg-dark-card"
            />
            <p className="text-text-muted text-xs mt-1">
              选中的技能将作为 AI Agent 的知识来源
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
