'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Button, Input, Modal, message, Space, Spin, Select, Table, Tooltip, Drawer, Dropdown } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowLeftOutlined,
  SendOutlined, StopOutlined, RobotOutlined, UserOutlined,
  MessageOutlined, CopyOutlined, CodeOutlined,
} from '@ant-design/icons';
import {
  listAgentThreads, createAgentThread, deleteAgentThread,
  getAgentThread, agentChatStream,
  listAllSkills,
  AgentThreadSummary, AgentMessage, SkillInfo, SkillSelection,
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
  const [planConfirmModal, setPlanConfirmModal] = useState<{
    confirmId: string;
    plan: any;
    editedPlan: any;
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    confirmId: string;
    behavior: string;
    content: string;
    params: Record<string, any>;
    editedParams: Record<string, any>;
  } | null>(null);
  // 规划确认弹窗：倒计时 / 调整建议 / 结构校验错误
  const [planCountdown, setPlanCountdown] = useState<number | null>(null);
  const [planSuggestion, setPlanSuggestion] = useState('');
  const [planError, setPlanError] = useState('');
  // 安全管控确认弹窗：倒计时
  const [confirmCountdown, setConfirmCountdown] = useState<number | null>(null);
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

  // ─── 确认弹窗倒计时（60s，随 confirmId 重置；编辑参数不重置倒计时） ───
  useEffect(() => {
    if (!planConfirmModal) { setPlanCountdown(null); return; }
    setPlanCountdown(60);
    const timer = setInterval(() => {
      setPlanCountdown(prev => (prev !== null && prev > 1) ? prev - 1 : 0);
    }, 1000);
    return () => clearInterval(timer);
  }, [planConfirmModal?.confirmId]);
  useEffect(() => {
    // 倒计时归零 → 自动关闭；后端 60s 超时兜底拒绝
    if (planCountdown === 0 && planConfirmModal) setPlanConfirmModal(null);
  }, [planCountdown, planConfirmModal]);

  useEffect(() => {
    if (!confirmModal) { setConfirmCountdown(null); return; }
    setConfirmCountdown(60);
    const timer = setInterval(() => {
      setConfirmCountdown(prev => (prev !== null && prev > 1) ? prev - 1 : 0);
    }, 1000);
    return () => clearInterval(timer);
  }, [confirmModal?.confirmId]);
  useEffect(() => {
    if (confirmCountdown === 0 && confirmModal) setConfirmModal(null);
  }, [confirmCountdown, confirmModal]);

  // ─── 规划确认弹窗编辑助手 ─────────────────────────
  const onUpdateSubtaskParam = (seq: number, key: string, value: string) => {
    setPlanConfirmModal(prev => {
      if (!prev) return prev;
      const newPlan = JSON.parse(JSON.stringify(prev.editedPlan));
      const target = newPlan.subtasks?.find((s: any) => s.seq === seq);
      if (target?.params?.[key]) target.params[key].value = value;
      return { ...prev, editedPlan: newPlan };
    });
  };

  const onDeleteSubtask = (seq: number) => {
    setPlanConfirmModal(prev => {
      if (!prev) return prev;
      const newPlan = JSON.parse(JSON.stringify(prev.editedPlan));
      newPlan.subtasks = (newPlan.subtasks || []).filter((s: any) => s.seq !== seq);
      // 级联清理：其他子任务对已删子任务的依赖一并移除
      newPlan.subtasks.forEach((s: any) => {
        if (s.depends_on) s.depends_on = s.depends_on.filter((d: number) => d !== seq);
      });
      return { ...prev, editedPlan: newPlan };
    });
  };

  const onUpdateSubtaskDeps = (seq: number, deps: number[]) => {
    setPlanConfirmModal(prev => {
      if (!prev) return prev;
      const newPlan = JSON.parse(JSON.stringify(prev.editedPlan));
      const target = newPlan.subtasks?.find((s: any) => s.seq === seq);
      if (target) target.depends_on = deps;
      return { ...prev, editedPlan: newPlan };
    });
  };

  /** 前端结构校验：依赖存在性 / 无自引用 / 无环。返回错误列表（空 = 通过）。 */
  const validatePlan = (plan: any): string[] => {
    const errors: string[] = [];
    const subs: any[] = plan?.subtasks || [];
    const seqs = new Set<number>(subs.map((s: any) => s.seq));
    for (const st of subs) {
      if (!st.depends_on || !st.depends_on.length) continue;
      for (const d of st.depends_on) {
        if (d === st.seq) errors.push(`子任务 ${st.seq} 不能依赖自身`);
        else if (!seqs.has(d)) errors.push(`子任务 ${st.seq} 依赖的子任务 ${d} 已被删除`);
      }
    }
    // 环检测（DFS 三色标记）
    const color = new Map<number, number>();
    const visit = (seq: number): boolean => {
      const c = color.get(seq) ?? 0;
      if (c === 1) return true;
      if (c === 2) return false;
      color.set(seq, 1);
      const st = subs.find((s: any) => s.seq === seq);
      if (st?.depends_on) for (const d of st.depends_on) if (visit(d)) return true;
      color.set(seq, 2);
      return false;
    };
    for (const st of subs) {
      if (visit(st.seq)) { errors.push('子任务依赖关系存在循环'); break; }
    }
    return errors;
  };

  const onConfirmExecute = () => {
    const m = planConfirmModal; if (!m) return;
    const errs = validatePlan(m.editedPlan);
    if (errs.length > 0) { setPlanError(errs.join('；')); return; } // 校验失败：留在弹窗内提示
    setPlanError('');
    // 仅当用户确实改过（参数/删子任务/依赖有变化）才回传 editedPlan，否则后端会误判"规划已修改"
    const unchanged = JSON.stringify(m.editedPlan) === JSON.stringify(m.plan);
    fetch(`/agent-api/plan-confirm/${m.confirmId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unchanged ? { approved: true } : { approved: true, plan: m.editedPlan }),
    }).catch(() => {});
    setPlanConfirmModal(null);
  };

  const handleAbort = async () => {
    // 中断执行：立即关掉弹窗（后端 abortAll 会解锁待确认弹窗），并请求中断在途 Agent
    setPlanConfirmModal(null);
    setConfirmModal(null);
    try { await fetch('/agent-api/abort', { method: 'POST' }); } catch {}
  };

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

    // 重置执行状态
    setSubtaskBox(null);
    setExecutionLog([]);
    setPlanConfirmModal(null);
    setConfirmModal(null);
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
            if (data.type === 'done') { setSubtaskDoneTimer(true); setPlanConfirmModal(null); setConfirmModal(null); break; }
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
            if (data.type === 'confirm') {
              setConfirmModal({
                confirmId: data.confirmId,
                behavior: data.behavior,
                content: data.content,
                params: data.params || {},
                editedParams: JSON.parse(JSON.stringify(data.params || {})),
              });
            }
            if (data.type === 'plan_confirm') {
              setPlanConfirmModal({
                confirmId: data.confirmId,
                plan: data.plan,
                editedPlan: JSON.parse(JSON.stringify(data.plan)),
              });
              setPlanSuggestion('');
              setPlanError('');
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
            }
            if (data.type === 'token') {
              const tokenText = data.token || '';
              flushSync(() => {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: last.content + tokenText };
                  }
                  return updated;
                });
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
        <div ref={messagesEndRef} />
      </div>

      {/* 子任务实时执行框 */}
      {subtaskBox && (
        <div className="mb-2 p-3 rounded-lg bg-dark-card/60 border border-yellow-500/20 font-mono text-xs space-y-1">
          {subtaskBox.lines.map((l, i) => (
            <div key={i}>
              <div className={`${l.failed ? 'text-red-400' : l.done ? 'text-green-400' : 'text-yellow-400'} ${l.done && !l.failed ? 'opacity-70' : ''}`}>
                {l.failed ? '✗' : l.done ? '✓' : '⟳'} {l.text}
              </div>
            </div>
          ))}
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
        {sending ? (
          <Button danger icon={<StopOutlined />} onClick={handleAbort}>
            中断
          </Button>
        ) : (
          <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={!input.trim()}>
            发送
          </Button>
        )}
      </div>

      {/* 规划确认弹窗 */}
      <Modal
        title={
          <span style={{ color: '#fff' }}>
            📋 规划确认
            {planCountdown !== null && planCountdown > 0 && (
              <span className="text-text-muted text-xs ml-2">（{planCountdown} 秒后自动取消）</span>
            )}
          </span>
        }
        open={!!planConfirmModal}
        width={560}
        onCancel={() => {
            // 关闭（X/遮罩）= 拒绝并退出
            const m = planConfirmModal; if (!m) return;
            fetch(`/agent-api/plan-confirm/${m.confirmId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ approved: false, rejectAction: 'exit' }),
            }).catch(() => {});
            setPlanConfirmModal(null);
          }}
          footer={
            <div className="flex items-center justify-between gap-2">
              <Dropdown
                menu={{
                  items: [
                    { key: 'exit', label: '拒绝并退出' },
                    { key: 'replan', label: '拒绝并重规划' },
                  ],
                  onClick: ({ key }) => {
                    const m = planConfirmModal; if (!m) return;
                    fetch(`/agent-api/plan-confirm/${m.confirmId}`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        approved: false,
                        rejectAction: key === 'replan' ? 'replan' : 'exit',
                        suggestion: planSuggestion.trim(),
                      }),
                    }).catch(() => {});
                    setPlanConfirmModal(null);
                  },
                }}
              >
                <Button danger>拒绝</Button>
              </Dropdown>
              <Button type="primary" onClick={onConfirmExecute}>确认执行</Button>
            </div>
          }
        >
          <div className="space-y-3 max-h-96 overflow-y-auto">
            <div className="text-text-muted text-xs mb-2">可编辑参数、删除子任务或调整依赖；参数留空则由 AI 自动补充。拒绝后可选择「退出」或填写下方建议重新规划。</div>
            {planError && (
              <div className="text-red-400 text-xs border border-red-500/30 rounded px-3 py-2">{planError}</div>
            )}
            {planConfirmModal?.editedPlan?.subtasks?.map((st: any, idx: number) => (
              <div key={st.seq} className="border border-dark-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-accent-blue text-xs font-mono">{idx + 1}.</span>
                  <span className="text-text-primary text-sm font-medium">{st.behavior}</span>
                  <span className="text-text-muted text-xs">— {st.description}</span>
                  <Button
                    size="small" type="text" danger icon={<DeleteOutlined />}
                    className="ml-auto shrink-0"
                    onClick={() => onDeleteSubtask(st.seq)}
                  />
                </div>
                {st.params && Object.keys(st.params).length > 0 && (
                  <div className="space-y-1.5 ml-4">
                    {Object.entries(st.params).map(([key, val]: [string, any]) => {
                      const pVal = typeof val === 'object' ? (val.value ?? '') : String(val ?? '');
                      const pReq = typeof val === 'object' && val.required ? ' *' : '';
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-text-muted text-xs w-24 shrink-0">{key}{pReq}</span>
                          <Input
                            size="small"
                            value={pVal}
                            onChange={(e) => onUpdateSubtaskParam(st.seq, key, e.target.value)}
                            className="bg-dark-bg border-dark-border text-text-primary flex-1"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 ml-4 mt-2">
                  <span className="text-text-muted text-xs w-24 shrink-0">依赖</span>
                  <Select
                    size="small"
                    mode="multiple"
                    allowClear
                    placeholder="选择前置子任务"
                    value={st.depends_on ?? []}
                    options={planConfirmModal?.editedPlan?.subtasks
                      ?.filter((o: any) => o.seq !== st.seq)
                      ?.map((o: any) => ({ value: o.seq, label: `子任务 ${o.seq}` })) ?? []}
                    onChange={(v) => onUpdateSubtaskDeps(st.seq, v)}
                    className="flex-1"
                  />
                </div>
              </div>
            ))}
            <div className="border border-dark-border rounded-lg p-3">
              <div className="text-text-muted text-xs mb-1.5">调整建议（拒绝并重规划时填写）</div>
              <Input.TextArea
                value={planSuggestion}
                onChange={e => setPlanSuggestion(e.target.value)}
                placeholder="例如：去掉第 2 个操作、把参数 XXX 改为 YYY…"
                rows={2}
                className="bg-dark-bg border-dark-border text-text-primary"
              />
            </div>
          </div>
        </Modal>

      {/* 安全管控确认弹窗 */}
      {confirmModal && (
      <Modal
        title={
          <span style={{ color: '#fff' }}>
            🔒 安全管控确认 — {confirmModal.behavior}
            {confirmCountdown !== null && confirmCountdown > 0 && (
              <span className="text-text-muted text-xs ml-2">（{confirmCountdown} 秒后自动取消）</span>
            )}
          </span>
        }
        open={true}
        destroyOnClose
        onCancel={() => {
            fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ approved: false }),
            }).catch(() => {});
            setConfirmModal(null);
          }}
          footer={
            <div className="flex justify-end gap-2">
              <Button danger onClick={() => {
                fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ approved: false }),
                }).catch(() => {});
                setConfirmModal(null);
              }}>拒绝</Button>
              <Button type="primary" onClick={() => {
                fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ approved: true, params: confirmModal.editedParams }),
                }).catch(() => {});
                setConfirmModal(null);
              }}>批准执行</Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="text-text-secondary text-sm whitespace-pre-wrap">{confirmModal.content}</div>
            {Object.keys(confirmModal.params).length > 0 && (
              <div>
                <div className="text-text-secondary text-xs font-semibold mb-2">参数（可修改）</div>
                {Object.entries(confirmModal.params).map(([key, val]: [string, any]) => {
                  const displayVal = typeof val === 'object' ? (val.value ?? '') : String(val ?? '');
                  return (
                    <div key={key} className="flex items-center gap-2 mb-1.5">
                      <span className="text-text-muted text-xs w-28 shrink-0">{key}</span>
                      <Input
                        size="small"
                        value={confirmModal.editedParams[key]?.value ?? confirmModal.editedParams[key] ?? displayVal}
                        onChange={(e) => {
                          const newVal = e.target.value;
                          setConfirmModal(prev => {
                            if (!prev) return prev;
                            const newEdited = { ...prev.editedParams };
                            if (typeof prev.params[key] === 'object' && prev.params[key] !== null) {
                              newEdited[key] = { ...prev.params[key], value: newVal };
                            } else {
                              newEdited[key] = newVal;
                            }
                            return { ...prev, editedParams: newEdited };
                          });
                        }}
                        className="bg-dark-bg border-dark-border text-text-primary flex-1"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}

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
  const [selectedSkills, setSelectedSkills] = useState<SkillSelection[]>([]);

  // 加载线程列表和技能列表（技能跨全部本体扫描）
  const load = async () => {
    if (!scenarioName || !ontologyName) return;
    setLoading(true);
    try {
      const [threadList, skillList] = await Promise.all([
        listAgentThreads(scenarioName, ontologyName),
        listAllSkills(),
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
              value={selectedSkills.map(sk => `${sk.scenario}/${sk.ontology}/${sk.name}`)}
              onChange={(keys: string[]) => {
                const sel: SkillSelection[] = keys.map(k => {
                  const [scenario, ontology, ...rest] = k.split('/');
                  return { scenario, ontology, name: rest.join('/') };
                });
                setSelectedSkills(sel);
              }}
              options={skills.map(s => ({
                label: s.ontology ? `${s.name}（${s.ontology}）` : s.name,
                value: `${s.scenario || ''}/${s.ontology || ''}/${s.name}`,
              }))}
              className="w-full"
              style={{ background: '#1a1a2e' }}
              popupClassName="bg-dark-card"
            />
            <p className="text-text-muted text-xs mt-1">
              选中的技能将作为 AI Agent 的知识来源（可跨本体选择）
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
