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
  AgentThreadSummary, AgentMessage, OntologyScopeSelection,
} from '@/api/agent-client';
import { listAllOntologies, OntologyScopeOption } from '@/api/client';
import { renderMarkdown } from '@/lib/markdown';

// ─── 安全管控确认弹窗 ───────────────────────────────

/** 安全确认弹窗：从 params 构建参数行（中文名/英文key/值/必填/是否待补充） */
function buildConfirmRows(params: Record<string, any>): {
  key: string; name: string; value: string; required: boolean; empty: boolean;
}[] {
  return Object.entries(params || {}).map(([key, val]) => {
    const spec = val !== null && typeof val === 'object' ? val : null;
    const value = spec ? (spec.value ?? '') : String(val ?? '');
    return {
      key,
      name: spec?.description || key,
      value,
      required: !!(spec && spec.required),
      empty: value === '' || value === null || value === undefined,
    };
  });
}

/** 安全确认弹窗：从 content 文本解析出【说明】/【审核要求】区块 */
function parseConfirmContent(content: string): { description: string; audit: string } {
  let description = '', audit = '';
  for (const raw of (content || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('【说明】')) description = line.slice('【说明】'.length).trim();
    else if (line.startsWith('【审核要求】')) audit = line.slice('【审核要求】'.length).trim();
  }
  return { description, audit };
}

/** 安全管控确认弹窗：结构化展示行为 + 说明/审核要求 + 参数表，纯知情确认（不可改参） */
function SecurityConfirmModal({
  confirmModal, countdown, onReject, onApprove,
}: {
  confirmModal: { confirmId: string; behavior: string; content: string; params: Record<string, any> };
  countdown: number | null;
  onReject: () => void;
  onApprove: () => void;
}) {
  const rows = buildConfirmRows(confirmModal.params);
  const emptyCount = rows.filter(r => r.empty).length;
  const { description, audit } = parseConfirmContent(confirmModal.content);
  return (
    <Modal
      title={
        <span style={{ color: '#fff' }}>
          🔒 安全管控确认
          <span className="text-amber-400 text-xs border border-amber-500/40 rounded px-1.5 py-0.5 ml-2">写操作</span>
          {countdown !== null && countdown > 0 && (
            <span className="text-text-muted text-xs ml-2">（{countdown} 秒后自动取消）</span>
          )}
        </span>
      }
      open
      width={620}
      destroyOnClose
      onCancel={onReject}
      footer={
        <div className="flex justify-end gap-2">
          <Button danger onClick={onReject}>拒绝</Button>
          <Button type="primary" onClick={onApprove}>批准执行</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* 警示条 */}
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <span className="text-amber-400 text-sm leading-6">⚠️</span>
          <span className="text-amber-200 text-sm leading-6">
            批准后该写操作将<span className="font-semibold">立即执行</span>
            {emptyCount > 0 && `；其中 ${emptyCount} 项参数待补充，将由 AI 自动推断`}
          </span>
        </div>

        {/* 行为 */}
        <div className="rounded-lg border border-dark-border px-3 py-2">
          <div className="text-text-muted text-xs mb-1">行为</div>
          <div className="text-text-primary text-sm font-medium font-mono">{confirmModal.behavior}</div>
        </div>

        {/* 说明 */}
        {description && (
          <div className="rounded-lg border border-dark-border px-3 py-2">
            <div className="text-text-muted text-xs mb-1">说明</div>
            <div className="text-text-primary text-sm whitespace-pre-wrap">{description}</div>
          </div>
        )}

        {/* 审核要求 */}
        {audit && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <div className="text-amber-400 text-xs mb-1">审核要求</div>
            <div className="text-amber-200/90 text-sm whitespace-pre-wrap">{audit}</div>
          </div>
        )}

        {/* 参数表 */}
        {rows.length > 0 ? (
          <div className="rounded-lg border border-dark-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dark-border bg-dark-bg/60">
              <span className="text-text-muted text-xs">本次将写入/修改/删除的数据</span>
              <span className="text-text-muted text-xs">共 {rows.length} 项</span>
            </div>
            <div className="divide-y divide-dark-border/60">
              {rows.map(row => (
                <div key={row.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="w-44 shrink-0">
                    <div className="text-text-primary text-sm leading-5 truncate">{row.name}</div>
                    <div className="text-text-muted text-xs font-mono leading-4">{row.key}</div>
                  </div>
                  <div className="w-12 shrink-0">
                    {row.required ? (
                      <span className="text-red-400 text-xs border border-red-500/40 rounded px-1.5 py-0.5">必填</span>
                    ) : (
                      <span className="text-text-muted text-xs border border-dark-border rounded px-1.5 py-0.5">选填</span>
                    )}
                  </div>
                  <div className={`flex-1 text-sm truncate ${row.empty ? 'text-amber-400' : 'text-text-primary'}`}>
                    {row.empty ? '（待补充）' : row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-text-secondary text-sm whitespace-pre-wrap rounded-lg border border-dark-border px-3 py-2">{confirmModal.content}</div>
        )}

        <div className="text-text-muted text-xs">ℹ️ 参数已在规划阶段确定，此处仅作知情确认，不可修改</div>
      </div>
    </Modal>
  );
}

// ─── Agent Conversation 子组件（聊天界面） ─────────────────

/** 聊天内嵌的子任务执行块（由 exec_entry 事件构建） */
interface SubtaskChatItem {
  role: 'subtask';
  /** 所属对话轮次 id（每次发消息自增），避免多轮对话的 seq 冲突 */
  runId: number;
  seq: number;
  behavior: string;
  /** 展示名：中文（英文），如 创建采购记录（CreatePurchaseRecord） */
  displayName?: string;
  /** 纯中文展示名（行为中文名或子任务描述），聊天区标题用 */
  displayLabel?: string;
  /** 子任务描述（父 Agent 生成），标题副行用 */
  description?: string;
  status: 'running' | 'done' | 'failed';
  details: any[];
}

/** 聊天消息：assistant 可携带运行时字段——规划思考挂在消息内部（runId 定位本轮消息；
 *  头像/思考/正文一体，不再是独立数组项，从结构上消除空白占位气泡与头像错位）。
 *  narrative 为临时态，不写回历史。 */
type ChatMessage = (AgentMessage & {
  runId?: number;
  narrative?: string;
  narrativeStreaming?: boolean;
}) | SubtaskChatItem;

/** 聊天里的子任务执行块：显示状态 + 可展开的执行动作明细（与原子任务执行框一致：✓/⟳/✗ + 动作名） */
function SubtaskBlock({ item }: { item: SubtaskChatItem }) {
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
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-dark-hover" onClick={() => setOpen(!open)}>
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

/** 聊天里的规划叙事折叠块：父Agent 规划阶段的思考/叙事实时流入，默认折叠；submit_plan 提交后定格（防编造执行叙事进正文） */
function NarrativeBlock({ item }: { item: { content: string; streaming?: boolean } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-dark-hover" onClick={() => setOpen(!open)}>
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

/** 执行记录单条条目卡片 */
function EntryCard({ entry }: { entry: any }) {
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
      ) : null}
    </div>
  );
}

function AgentConversation({
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
  const [executionLog, setExecutionLog] = useState<{
    time: string; type: string;
    name: string; description?: string; params?: any; result?: string; status: string; detail?: string; source?: string; seq?: number; displayName?: string;
  }[]>([]);
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
  // 规划确认弹窗：倒计时 / 调整建议 / 结构校验错误 / 高级编辑折叠开关
  const [planCountdown, setPlanCountdown] = useState<number | null>(null);
  const [planSuggestion, setPlanSuggestion] = useState('');
  const [planError, setPlanError] = useState('');
  const [showPlanAdvanced, setShowPlanAdvanced] = useState(false);
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
  }, [messages]);

  // 聊天内子任务块的分阶段路由：planning(规划文本) → subtask(子任务块) → summary(最终总结新开消息)
  const phaseRef = useRef<'planning' | 'subtask' | 'summary'>('planning');
  // 当前对话轮次 id（每次发消息自增），用于区分多轮对话的子任务块
  const runIdRef = useRef(0);
  // 父Agent 分析中（子任务间空窗提示）
  const [analyzing, setAnalyzing] = useState(false);

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
    // 倒计时归零 → 回执拒绝（让后端即时解析；超时唯一权威在后端），再关闭弹窗
    if (planCountdown === 0 && planConfirmModal) {
      const m = planConfirmModal;
      fetch(`/agent-api/plan-confirm/${m.confirmId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false, rejectAction: 'exit' }),
      }).catch(() => {});
      setPlanConfirmModal(null);
    }
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
    // 倒计时归零 → 回执拒绝（让后端即时解析；超时唯一权威在后端），再关闭弹窗
    if (confirmCountdown === 0 && confirmModal) {
      fetch(`/agent-api/confirm/${confirmModal.confirmId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      }).catch(() => {});
      setConfirmModal(null);
    }
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

  // 执行记录按子任务分组 + 折叠状态
  const [collapsedSubtasks, setCollapsedSubtasks] = useState<Set<number>>(new Set());
  const groupedLog = useMemo(() => {
    // 按原始事件顺序生成渲染节点：顶层条目（父/全局）在时间位置出现。
    // 子任务条目按 seq 归入同一组（并行子任务事件交错到达，不能用"相邻才合并"）。
    const nodes: any[] = [];
    const seqNodes = new Map<number, any>();
    for (const e of executionLog) {
      if (e.source === 'child' && e.seq != null) {
        let node = seqNodes.get(e.seq);
        if (!node) {
          node = { kind: 'subtask', seq: e.seq, entries: [] };
          seqNodes.set(e.seq, node);
          nodes.push(node);
        }
        node.entries.push(e);
      } else {
        nodes.push({ kind: 'top', entry: e });
      }
    }
    return nodes;
  }, [executionLog]);
  const toggleSubtask = (seq: number) => {
    setCollapsedSubtasks(prev => {
      const n = new Set(prev);
      if (n.has(seq)) n.delete(seq); else n.add(seq);
      return n;
    });
  };

  // 消息列表用 useMemo 缓存，仅 messages/sending/toolCalls 变化时重新渲染
  // 避免输入框每按一次键都触发全部消息的 renderMarkdown()
  const messagesContent = useMemo(() => messages.map((msg, idx) => {
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
              onClick={(e) => {
                const target = e.currentTarget.nextElementSibling as HTMLElement;
                if (target) target.classList.toggle('hidden');
              }}>
              🔧 工具返回数据 <span className="text-accent-blue">▼</span>
              <pre className="hidden mt-1 text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{msg.content}</pre>
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
        ) : messagesContent}
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
            {/* 顶部信息条（info 色调，类比安全确认的警示条） */}
            <div className="flex items-center justify-between gap-2 rounded-lg bg-accent-blue/10 border border-accent-blue/30 px-3 py-2">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-accent-blue text-sm leading-6 shrink-0">📋</span>
                <span className="text-text-primary text-sm leading-6">
                  规划已就绪，共 {planConfirmModal?.editedPlan?.subtasks?.length ?? 0} 个操作；写操作会在执行前另行确认
                </span>
              </div>
              <Button
                size="small" type="text"
                className="text-accent-blue hover:text-accent-blue shrink-0"
                onClick={() => setShowPlanAdvanced(v => !v)}
              >
                {showPlanAdvanced ? '收起高级选项' : '⚙️ 高级选项'}
              </Button>
            </div>
            {planError && (
              <div className="text-red-400 text-xs border border-red-500/30 rounded px-3 py-2">{planError}</div>
            )}
            {!showPlanAdvanced && (
              <div className="text-text-muted text-xs">ℹ️ 默认只读预览；展开「高级选项」可编辑参数、删除子任务或调整依赖（参数留空由 AI 自动补充）。拒绝后可选择「退出」或填写下方建议重新规划。</div>
            )}
            {planConfirmModal?.editedPlan?.subtasks?.map((st: any, idx: number) => (
              <div key={st.seq} className="rounded-lg border border-dark-border overflow-hidden">
                {/* 子任务头：header 背景 + 序号/中文名/英文名/描述 */}
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-dark-border bg-dark-bg/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-accent-blue text-xs font-mono shrink-0">{idx + 1}.</span>
                    <span className="text-text-primary text-sm font-medium truncate">{st.display_name || st.behavior}</span>
                    {st.display_name && (
                      <span className="text-text-muted text-xs font-mono shrink-0">{st.behavior}</span>
                    )}
                    {st.description && (
                      <span className="text-text-muted text-xs truncate">— {st.description}</span>
                    )}
                  </div>
                  {showPlanAdvanced && (
                    <Button
                      size="small" type="text" danger icon={<DeleteOutlined />}
                      className="shrink-0"
                      onClick={() => onDeleteSubtask(st.seq)}
                    />
                  )}
                </div>
                {/* 参数表：与安全确认弹窗一致的 divide 行 */}
                <div className="divide-y divide-dark-border/60">
                  {st.params && Object.keys(st.params).length > 0 && Object.entries(st.params).map(([key, val]: [string, any]) => {
                    const pDesc = typeof val === 'object' && val?.description ? val.description : '';
                    const label = pDesc || key;
                    const pVal = typeof val === 'object' ? (val.value ?? '') : String(val ?? '');
                    const required = typeof val === 'object' && val.required;
                    if (!showPlanAdvanced) {
                      return (
                        <div key={key} className="flex items-center gap-3 px-3 py-2">
                          <div className="w-40 shrink-0">
                            <div className="text-text-primary text-sm truncate">{label}</div>
                            <div className="text-text-muted text-xs font-mono truncate">{key}</div>
                          </div>
                          <div className="w-12 shrink-0">
                            {required ? (
                              <span className="text-red-400 text-xs border border-red-500/40 rounded px-1.5 py-0.5">必填</span>
                            ) : (
                              <span className="text-text-muted text-xs border border-dark-border rounded px-1.5 py-0.5">选填</span>
                            )}
                          </div>
                          <div className={`flex-1 text-sm break-all ${pVal ? 'text-text-primary' : 'text-amber-400'}`}>
                            {pVal || '（待补充）'}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={key} className="flex items-center gap-2 px-3 py-2">
                        <div className="w-40 shrink-0">
                          <div className="text-text-primary text-sm truncate">{label}</div>
                          <div className="text-text-muted text-xs font-mono truncate">{key}</div>
                        </div>
                        <Input
                          size="small"
                          value={pVal}
                          onChange={(e) => onUpdateSubtaskParam(st.seq, key, e.target.value)}
                          className="bg-dark-bg border-dark-border text-text-primary flex-1"
                        />
                      </div>
                    );
                  })}
                  {showPlanAdvanced && (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-text-muted text-xs w-40 shrink-0">依赖</span>
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
                  )}
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-dark-border px-3 py-2">
              <div className="text-text-muted text-xs mb-1">调整建议（拒绝并重规划时填写）</div>
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
            {/* 按原始顺序：顶层条目在时间位置出现，子任务条目归入其组（可折叠+缩进） */}
            {groupedLog.map((node, ni) => (
              node.kind === 'top' ? (
                <div key={`t-${ni}`}><EntryCard entry={node.entry} /></div>
              ) : (
                <div key={`st-${node.seq}`} className="border border-dark-border rounded-lg overflow-hidden">
                  {(() => {
                    const collapsed = collapsedSubtasks.has(node.seq);
                    const start = node.entries.find((e: any) => e.type === 'subtask_start');
                    const done = node.entries.find((e: any) => e.type === 'subtask_done');
                    const title = start ? `子任务 ${node.seq}: ${start.displayName || start.name}` : `子任务 ${node.seq}`;
                    // 标题状态取 subtask_done（type 键去重后 start 不再被 done 覆盖）
                    const st = done?.status || start?.status || 'running';
                    return (
                      <>
                        <div
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${st === 'failed' ? 'bg-red-500/10' : 'bg-dark-card'}`}
                          onClick={() => toggleSubtask(node.seq)}
                        >
                          <span className="text-text-muted text-xs">{collapsed ? '▶' : '▼'}</span>
                          <span className="text-accent-blue text-xs font-semibold">{title}</span>
                          {st === 'done' && <span className="text-green-500 text-xs">✓</span>}
                          {st === 'failed' && <span className="text-red-500 text-xs">✗</span>}
                          <span className="text-text-muted text-xs ml-auto">{node.entries.filter((e: any) => e.type !== 'subtask_start' && e.type !== 'subtask_done' && e.type !== 'subtask_input').length} 步</span>
                        </div>
                        {!collapsed && (
                          <div className="pl-4 pr-2 py-2 space-y-2 bg-dark-bg/40">
                            {/* 只留执行动作（安全确认/工具调用）；start/done 由标题覆盖，input 是指令不是步骤 */}
                            {(node.entries as any[]).filter((e: any) => e.type !== 'subtask_start' && e.type !== 'subtask_done' && e.type !== 'subtask_input').map((entry: any, ei: number) => (
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
  const [ontologies, setOntologies] = useState<OntologyScopeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedScope, setSelectedScope] = useState<OntologyScopeSelection[]>([]);

  // 加载线程列表和全量本体列表（本体范围选择器数据源）
  const load = async () => {
    if (!scenarioName || !ontologyName) return;
    setLoading(true);
    try {
      const [threadList, ontologyList] = await Promise.all([
        listAgentThreads(scenarioName, ontologyName),
        listAllOntologies(),
      ]);
      setThreads(threadList);
      setOntologies(ontologyList);
    } catch (e: any) {
      message.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scenarioName, ontologyName]);

  // 新建线程（本体范围默认勾选当前本体，用户可加选/清空；清空 = 通用问答模式）
  const handleNew = async () => {
    if (!scenarioName || !ontologyName) return;
    try {
      const thread = await createAgentThread(
        scenarioName,
        ontologyName,
        newTitle || '新对话',
        selectedScope
      );
      setShowNewDialog(false);
      setNewTitle('');
      setSelectedScope([]);
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
        <div className="flex items-center gap-2">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            // 打开时默认勾选当前页所在本体，用户可加选/清空
            if (scenarioName && ontologyName) {
              setSelectedScope([{ scenario: scenarioName, ontology: ontologyName }]);
            }
            setShowNewDialog(true);
          }}>
            新建对话
          </Button>
        </div>
      </div>
      <p className="text-text-muted text-xs mb-3">
        与 AI Agent 进行对话，查询与执行将限定在对话所选的本体范围内。
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
          setSelectedScope([]);
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
            <label className="text-text-secondary text-sm block mb-1">本体范围</label>
            <Select
              mode="multiple"
              placeholder="选择本次对话限定的本体（不选 = 通用问答模式）"
              value={selectedScope.map(s => `${s.scenario}/${s.ontology}`)}
              onChange={(keys: string[]) => {
                const sel: OntologyScopeSelection[] = keys.map(k => {
                  const idx = k.indexOf('/');
                  return { scenario: k.slice(0, idx), ontology: k.slice(idx + 1) };
                });
                setSelectedScope(sel);
              }}
              options={ontologies.map(o => ({
                label: `${o.scenario_name} / ${o.ontology_name}`,
                value: `${o.scenario_name}/${o.ontology_name}`,
              }))}
              className="w-full"
              style={{ background: '#1a1a2e' }}
              popupClassName="bg-dark-card"
            />
            <p className="text-text-muted text-xs mt-1">
              本次对话的查询与执行将限定在所选本体内（可跨本体多选）；不选则为通用问答模式，不使用任何业务工具
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
