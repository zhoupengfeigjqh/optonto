'use client';

/**
 * 智能体会话界面（自 AgentApp.tsx 抽取）。
 *
 * 职责：SSE 流式接收与「消息流分阶段路由」——父Agent 的规划叙事 → 子任务执行块 → 最终总结。
 * 呈现层已拆分（章程 I）：
 * - `MessageList`：消息气泡序列（含思考区、子任务块、工具返回）
 * - `PlanConfirmModal`：规划确认（只读预览 / 高级编辑）
 * - `ExecutionLogDrawer`：执行记录侧面板
 * - `plan-editing` / `execution-log`：规划编辑与记录分组的纯逻辑（已单测）
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Input, message, Spin } from 'antd';
import { ArrowLeftOutlined, CodeOutlined, SendOutlined, StopOutlined, RobotOutlined } from '@ant-design/icons';
import { getAgentThread, agentChatStream, AgentMessage } from '@/api/agent-client';
import SecurityConfirmModal from './SecurityConfirmModal';
import MessageList from './MessageList';
import PlanConfirmModal from './PlanConfirmModal';
import ExecutionLogDrawer from './ExecutionLogDrawer';
import { useConfirmCountdown } from './use-confirm-countdown';
import type { ChatMessage } from './chat-types';
import type { LogEntry } from './execution-log';
import {
  updateSubtaskParam, deleteSubtask, setSubtaskDeps, validatePlan, isPlanUnchanged,
} from './plan-editing';

export default function AgentConversation({
  threadId, scenarioName, ontologyName, onBack,
}: {
  threadId: string;
  scenarioName: string;
  ontologyName: string;
  onBack: () => void;
}) {
  // 聊天消息：除 user/assistant/toolResult 外，含运行时的子任务执行块（role='subtask'）
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [executionLog, setExecutionLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
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
  // 规划确认弹窗：调整建议 / 结构校验错误 / 高级编辑折叠开关（倒计时见 useConfirmCountdown）
  const [planSuggestion, setPlanSuggestion] = useState('');
  const [planError, setPlanError] = useState('');
  const [showPlanAdvanced, setShowPlanAdvanced] = useState(false);
  // 规划确认弹窗：参数详情展开状态（key = `${seq}:${paramKey}`）
  const [expandedParams, setExpandedParams] = useState<Set<string>>(new Set());
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
  }, [messages]);

  // 聊天内子任务块的分阶段路由：planning(规划文本) → subtask(子任务块) → summary(最终总结新开消息)
  const phaseRef = useRef<'planning' | 'subtask' | 'summary'>('planning');
  // 当前对话轮次 id（每次发消息自增），用于区分多轮对话的子任务块
  const runIdRef = useRef(0);
  // 父Agent 分析中（子任务间空窗提示）
  const [analyzing, setAnalyzing] = useState(false);

  // ─── 确认弹窗倒计时（60s，随 confirmId 重置；编辑参数不重置倒计时） ───
  // 倒计时归零 → 回执拒绝（让后端即时解析；超时唯一权威在后端），再关闭弹窗
  const planCountdown = useConfirmCountdown(planConfirmModal?.confirmId, () => handleRejectPlan('exit'));
  const confirmCountdown = useConfirmCountdown(confirmModal?.confirmId, () => {
    if (!confirmModal) return;
    fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false }),
    }).catch(() => {});
    setConfirmModal(null);
  });

  // ─── 规划确认弹窗编辑助手 ─────────────────────────

  const onUpdateSubtaskParam = (seq: number, key: string, value: string) => {
    setPlanConfirmModal(prev => prev ? { ...prev, editedPlan: updateSubtaskParam(prev.editedPlan, seq, key, value) } : prev);
  };

  const onDeleteSubtask = (seq: number) => {
    setPlanConfirmModal(prev => prev ? { ...prev, editedPlan: deleteSubtask(prev.editedPlan, seq) } : prev);
  };

  const onUpdateSubtaskDeps = (seq: number, deps: number[]) => {
    setPlanConfirmModal(prev => prev ? { ...prev, editedPlan: setSubtaskDeps(prev.editedPlan, seq, deps) } : prev);
  };

  const onToggleParamExpand = (expandKey: string) => {
    setExpandedParams(prev => {
      const next = new Set(prev);
      if (next.has(expandKey)) next.delete(expandKey); else next.add(expandKey);
      return next;
    });
  };

  /** 拒绝规划：统一处理 API 回执 + 更新聊天消息 + 关闭弹窗 */
  const handleRejectPlan = (rejectAction: string, suggestion?: string) => {
    const m = planConfirmModal; if (!m) return;
    fetch(`/agent-api/plan-confirm/${m.confirmId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved: false,
        rejectAction,
        suggestion: suggestion || '',
      }),
    }).catch(() => {});
    // 更新 assistant 消息内容，显示拒绝信息
    const runId = runIdRef.current;
    const planSummary = `规划共 ${m.editedPlan?.subtasks?.length ?? 0} 个子任务`;
    const rejectText = rejectAction === 'replan'
      ? `🚫 已拒绝规划并要求重新规划。${suggestion ? `建议：${suggestion}` : ''}`
      : '🚫 已拒绝规划并退出。';
    setMessages(prev => prev.map(msg => {
      const it = msg as any;
      if (it.role === 'assistant' && it.runId === runId) {
        return { ...it, content: `${planSummary}\n\n${rejectText}`, narrative: undefined, narrativeStreaming: false };
      }
      return msg;
    }));
    setPlanConfirmModal(null);
  };

  const onConfirmExecute = () => {
    const m = planConfirmModal; if (!m) return;
    const errs = validatePlan(m.editedPlan);
    if (errs.length > 0) { setPlanError(errs.join('；')); return; } // 校验失败：留在弹窗内提示
    setPlanError('');
    // 仅当用户确实改过（参数/删子任务/依赖有变化）才回传 editedPlan，否则后端会误判"规划已修改"
    const unchanged = isPlanUnchanged(m.editedPlan, m.plan);
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

    // 重置执行状态（runId 先自增：占位 assistant 打标，本轮思考/直答都写进这条消息）
    phaseRef.current = 'planning';
    runIdRef.current += 1;
    setExecutionLog([]);
    setPlanConfirmModal(null);
    setConfirmModal(null);
    abortRef.current = new AbortController();

    // 用户消息 + 空助手占位（流式填充载体：规划期 narrative 字段流入它；直答正文也回流它）
    const userMsg: AgentMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: '', runId: runIdRef.current };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

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
            if (data.type === 'done') { setPlanConfirmModal(null); setConfirmModal(null); setMessages(prev => prev.map(m => (m as any).narrativeStreaming ? { ...(m as any), narrativeStreaming: false } : m)); break; }
            if (data.type === 'error') {
              // 定格思考区转圈（校验失败等路径不会再发 narrative_end）
              setMessages(prev => prev.map(m => (m as any).narrativeStreaming ? { ...(m as any), narrativeStreaming: false } : m));
              if (phaseRef.current === 'subtask') {
                phaseRef.current = 'summary';
                setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: '' }]);
              }
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if ((last as any).role === 'assistant' && !(last as any).content) {
                  updated[updated.length - 1] = { ...(last as any), content: `\n\n[错误: ${data.message}]` };
                } else if ((last as any).role !== 'assistant') {
                  // 末尾是子任务块等非正文消息 → 新开正文消息承接错误
                  updated.push({ role: 'assistant', content: `\n\n[错误: ${data.message}]`, timestamp: '' });
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
              setShowPlanAdvanced(false); // 每次新规划默认只读展示，编辑折叠
            }
            if (data.type === 'feedback') {
              // 父Agent 分析子任务结果期间的空窗提示（子任务间切换）
              setAnalyzing(data.status === 'running');
            }
            if (data.type === 'exec_entry') {
              const entry = data.entry;
              setExecutionLog(prev => {
                // 去重键含 type：不同条目类型（subtask_start/subtask_input/tool_call/security）即使 name 相同也不互相覆盖
                const exists = prev.findIndex(e => e.type === entry.type && e.name === entry.name && e.status === 'running' && e.seq === entry.seq);
                if (exists >= 0 && entry.status !== 'running') {
                  const n = [...prev];
                  n[exists] = { ...n[exists], status: entry.status, detail: entry.detail, params: entry.params, result: entry.result, seq: entry.seq, displayName: entry.displayName ?? n[exists].displayName };
                  return n;
                }
                if (exists >= 0) return prev;
                return [...prev, { time: entry.time, type: entry.type, name: entry.name, status: entry.status, detail: entry.detail, params: entry.params, result: entry.result, source: entry.source, seq: entry.seq, displayName: entry.displayName }];
              });
              // 聊天内子任务执行块（用 runId+seq 定位，避免多轮对话 seq 冲突）
              if (entry.source === 'child' && entry.seq != null) {
                if (entry.type === 'subtask_start') phaseRef.current = 'subtask';
                const runId = runIdRef.current;
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => (m as any).role === 'subtask' && (m as any).runId === runId && (m as any).seq === entry.seq);
                  if (entry.type === 'subtask_start') {
                    if (idx >= 0) {
                      const it = updated[idx] as any;
                      updated[idx] = { ...it, status: entry.status, displayName: entry.displayName, displayLabel: entry.displayLabel ?? it.displayLabel, description: entry.description ?? it.description, details: [...it.details, entry] };
                    } else {
                      updated.push({ role: 'subtask', runId, seq: entry.seq, behavior: entry.name, displayName: entry.displayName, displayLabel: entry.displayLabel, description: entry.description, status: entry.status, details: [entry] });
                    }
                  } else if (idx >= 0) {
                    const it = updated[idx] as any;
                    const status = entry.type === 'subtask_done' ? entry.status : it.status;
                    updated[idx] = { ...it, status, details: [...it.details, entry] };
                  }
                  return updated;
                });
              }
            }
            if (data.type === 'narrative') {
              // 规划叙事：流入本轮 assistant 消息的 narrative 字段（runId 定位，修复轮复用同一字段并重启转圈）
              const runId = runIdRef.current;
              setMessages(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(m => (m as any).role === 'assistant' && (m as any).runId === runId);
                if (idx >= 0) {
                  const it = updated[idx] as any;
                  updated[idx] = { ...it, narrative: (it.narrative || '') + (data.token || ''), narrativeStreaming: true };
                }
                return updated;
              });
              continue;
            }
            if (data.type === 'narrative_end') {
              const runId = runIdRef.current;
              setMessages(prev => prev.map(m => {
                const it = m as any;
                if (it.role !== 'assistant' || it.runId !== runId) return m;
                return data.outcome === 'answer'
                  // 直答：撤掉思考区（正文随后以 token 全文回流到本条消息）
                  ? { ...it, narrative: undefined, narrativeStreaming: false }
                  // 规划/中断：定格思考区（停止转圈，内容留存可展开）
                  : { ...it, narrativeStreaming: false };
              }));
              continue;
            }
            if (data.type === 'token') {
              const tokenText = data.token || '';
              // 子任务阶段后的第一个 token = 最终总结 → 新开一条 assistant 消息（排在子任务块之后）
              if (phaseRef.current === 'subtask') {
                phaseRef.current = 'summary';
                setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: '' }]);
              }
              flushSync(() => {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if ((last as any).role === 'assistant') {
                    updated[updated.length - 1] = { ...(last as any), content: (last as any).content + tokenText };
                  } else {
                    // 末尾是子任务块等非正文消息 → 末尾新开正文消息承接
                    updated.push({ role: 'assistant', content: tokenText, timestamp: '' });
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
          } else if (last.role !== 'assistant') {
            updated.push({ role: 'assistant', content: `\n\n[错误: ${e.message}]`, timestamp: '' });
          }
          return updated;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  // 执行记录按子任务分组的折叠状态（分组规则见 execution-log.ts）
  const [collapsedSubtasks, setCollapsedSubtasks] = useState<Set<number>>(new Set());
  const toggleSubtask = (seq: number) => {
    setCollapsedSubtasks(prev => {
      const n = new Set(prev);
      if (n.has(seq)) n.delete(seq); else n.add(seq);
      return n;
    });
  };

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
        <div className="flex items-center gap-2">
          <Button size="small" icon={<CodeOutlined />} onClick={() => setLogOpen(true)}>
            执行记录
          </Button>
        </div>
      </div>

      {/* Messages：flex-1 撑满，顶满可用高度；输入框贴底 */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mb-3 pr-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-text-muted">
            <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <p className="text-sm">开始一段新的智能体对话</p>
            <p className="text-xs mt-1">输入您的问题，AI Agent 将在所选本体范围内为您解答</p>
          </div>
        ) : <MessageList messages={messages} sending={sending} />}
        {analyzing && (
          <div className="flex gap-3 justify-start mb-2">
            <div className="w-8 h-8 shrink-0" />
            <div className="text-text-muted text-xs flex items-center gap-2">
              <Spin size="small" /> 父Agent 正在处理...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

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
      <PlanConfirmModal
        open={!!planConfirmModal}
        plan={planConfirmModal?.editedPlan}
        countdown={planCountdown}
        error={planError}
        showAdvanced={showPlanAdvanced}
        suggestion={planSuggestion}
        expandedParams={expandedParams}
        onToggleAdvanced={() => setShowPlanAdvanced(v => !v)}
        onSuggestionChange={setPlanSuggestion}
        onCancel={() => handleRejectPlan('exit')}
        onReject={(action) => handleRejectPlan(action, planSuggestion.trim())}
        onConfirm={onConfirmExecute}
        onUpdateParam={onUpdateSubtaskParam}
        onDeleteSubtask={onDeleteSubtask}
        onUpdateDeps={onUpdateSubtaskDeps}
        onToggleParamExpand={onToggleParamExpand}
      />

      {/* 安全管控确认弹窗 */}
      {confirmModal && (
        <SecurityConfirmModal
          confirmModal={confirmModal}
          countdown={confirmCountdown}
          onReject={() => {
            fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ approved: false }),
            }).catch(() => {});
            setConfirmModal(null);
          }}
          onApprove={() => {
            // 安全弹窗只做批准/拒绝，不改参数（参数已在规划确认/数据传播时定好）
            fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ approved: true }),
            }).catch(() => {});
            setConfirmModal(null);
          }}
        />
      )}

      {/* 执行记录侧面板 */}
      <ExecutionLogDrawer
        open={logOpen}
        entries={executionLog}
        collapsed={collapsedSubtasks}
        onToggleSubtask={toggleSubtask}
        onClose={() => setLogOpen(false)}
      />
    </div>
  );
}
