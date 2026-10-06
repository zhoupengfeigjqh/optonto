'use client';

/**
 * 智能体会话界面（自 AgentApp.tsx 抽取）。
 *
 * 职责：**编排**——持有会话状态、装配各子组件、把用户操作接到对应逻辑上。
 * 具体行为已按职责下沉（章程 I / II）：
 * - `use-agent-stream`：SSE 流式接收与事件分发（分阶段路由 / 中断 / 并发守卫）
 * - `use-confirm-replies`：确认回执（安全管控 / 规划确认）的答复与三态反馈
 * - `MessageList`：消息气泡序列（含思考区、子任务块、工具返回）
 * - `PlanConfirmModal`：规划确认（只读预览 / 高级编辑）
 * - `ExecutionLogDrawer`：执行记录侧面板
 * - `plan-editing` / `execution-log`：规划编辑与记录分组的纯逻辑（已单测）
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Input, message, Spin } from 'antd';
import { ArrowLeftOutlined, CodeOutlined, SendOutlined, StopOutlined, RobotOutlined } from '@ant-design/icons';
import { getAgentThread, type AgentMessage } from '@/api/agent-client';
import SecurityConfirmModal from './SecurityConfirmModal';
import MessageList from './MessageList';
import PlanConfirmModal from './PlanConfirmModal';
import ExecutionLogDrawer from './ExecutionLogDrawer';
import { useConfirmCountdown } from './use-confirm-countdown';
import { useConfirmReplies, type PlanConfirmState, type SecurityConfirmState } from './use-confirm-replies';
import { useAgentStream } from './use-agent-stream';
import type { LogEntry } from './execution-log';
import type { ChatMessage } from './chat-types';
import type { SubTaskPlan } from './sse-events';
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
  // 聊天消息：历史消息 + 运行时子任务执行块（role='subtask'）
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [executionLog, setExecutionLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [planConfirmModal, setPlanConfirmModal] = useState<PlanConfirmState | null>(null);
  const [confirmModal, setConfirmModal] = useState<SecurityConfirmState | null>(null);
  // 规划确认弹窗：调整建议 / 结构校验错误 / 高级编辑折叠开关（倒计时见 useConfirmCountdown）
  const [planSuggestion, setPlanSuggestion] = useState('');
  const [planError, setPlanError] = useState('');
  const [showPlanAdvanced, setShowPlanAdvanced] = useState(false);
  // 规划确认弹窗：参数详情展开状态（key = `${seq}:${paramKey}`）
  const [expandedParams, setExpandedParams] = useState<Set<string>>(new Set());
  // 历史加载失败（F1）：与「空对话」区分开，给显式错误态 + 重试入口
  const [loadError, setLoadError] = useState('');
  // 本轮用户最终确认的规划（C4：接收后端 plan_received，此前该事件前端零处理 = 写而不读的死契约）
  const [confirmedPlan, setConfirmedPlan] = useState<SubTaskPlan | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** 消息滚动容器（判定用户是否已上滑脱离贴底） */
  const messagesRef = useRef<HTMLDivElement>(null);

  // 加载历史消息（抽出为可重试的独立函数：F1 错误态的「重试」入口复用它）
  const loadThread = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const thread = await getAgentThread(scenarioName, ontologyName, threadId);
      setMessages(thread.messages || []);
    } catch (e: any) {
      setLoadError(e?.message || '未知错误');
    } finally {
      setLoading(false);
    }
  };

  // 加载历史消息
  useEffect(() => { void loadThread(); }, [threadId, scenarioName, ontologyName]);

  /**
   * 自动滚动到底（2026-10-05 宪法 I：昂贵/高频操作 MUST 移出渲染路径）。
   *
   * 原实现对 `[messages]` 直接 `scrollIntoView`，而流式期间每 token 都会产生新的
   * `messages` 数组 → **每 token 一次强制布局**（scrollIntoView 强制同步布局），
   * 长回答时明显拖慢渲染。现按帧合并：同一 tick 内多次变化只滚动一次。
   *
   * 同时提供「用户已上滑则不强制拉回」——用户主动翻历史时不该被流式输出拽到底部。
   */
  const stickToBottomRef = useRef(true);
  const scrollRafRef = useRef(0);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (scrollRafRef.current) return; // 本帧已排队
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    });
    return () => {
      if (scrollRafRef.current) { cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = 0; }
    };
  }, [messages]);
  /** 滚动容器 onScroll：距底部小于阈值即视为「贴底」，恢复自动跟随 */
  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // 流式接收与事件分发（分阶段路由 / 中断 / 并发守卫 —— 详见 use-agent-stream 文件头）
  // 声明在 useConfirmReplies 之前：回执要读 currentRunId 定位要更新的 assistant 消息
  const { sending, analyzing, currentRunId, send, abort } = useAgentStream({
    scenarioName, ontologyName, threadId,
    setMessages, setExecutionLog, setPlanConfirmModal, setConfirmModal, setConfirmedPlan, setInput,
  });

  // 确认回执（安全管控 / 规划确认）：答复、busy 防连点、失败就地提示（见 use-confirm-replies）
  const {
    replyBusy, planReplyError, securityReplyError,
    answerSecurityConfirm, handleRejectPlan, onConfirmExecute,
  } = useConfirmReplies({
    planConfirmModal, confirmModal, setPlanConfirmModal, setConfirmModal, setMessages,
    currentRunId, validatePlan, isPlanUnchanged,
    onClearPlanError: () => setPlanError(''),
    onPlanError: setPlanError,
  });

  // ─── 确认弹窗倒计时（60s，随 confirmId 重置；编辑参数不重置倒计时） ───
  // 倒计时归零 → 回执拒绝（让后端即时解析；超时唯一权威在后端）
  const planCountdown = useConfirmCountdown(planConfirmModal?.confirmId, () => { void handleRejectPlan('exit'); });
  const confirmCountdown = useConfirmCountdown(confirmModal?.confirmId, () => { void answerSecurityConfirm(false); });

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

  // 加载失败：显式错误态 + 重试（原先只弹 toast 后照常渲染「开始一段新的对话」空态，
  // 用户无法区分"加载失败"与"新对话"，看着空白页无从下手——F1）
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-red-400">加载对话失败：{loadError}</p>
        <div className="flex gap-2">
          <Button type="primary" onClick={() => void loadThread()}>重试</Button>
          <Button onClick={onBack}>返回会话列表</Button>
        </div>
      </div>
    );
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

      {/* Messages：flex-1 撑满，顶满可用高度；输入框贴底。
          role="log" + aria-live="polite"：流式追加内容时屏幕阅读器可播报（宪法 IV） */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mb-3 pr-2"
        ref={messagesRef} onScroll={onMessagesScroll}
        role="log" aria-live="polite" aria-label="对话内容">
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
            <div className="text-text-muted text-xs flex items-center gap-2" role="status" aria-live="polite">
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
          onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); void send(input.trim()); } }}
          placeholder="输入您的问题... (Shift+Enter 换行)"
          rows={2}
          className="bg-dark-bg border-dark-border text-text-primary"
          disabled={sending}
        />
        {sending ? (
          <Button danger icon={<StopOutlined />} onClick={() => { void abort(); }}>
            中断
          </Button>
        ) : (
          <Button type="primary" icon={<SendOutlined />} onClick={() => { void send(input.trim()); }} disabled={!input.trim()}>
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
        replyError={planReplyError}
        busy={replyBusy}
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
          busy={replyBusy}
          error={securityReplyError}
          onReject={() => answerSecurityConfirm(false)}
          onApprove={() => answerSecurityConfirm(true)}
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