'use client';

/**
 * 确认回执（安全管控 / 规划确认）的答复逻辑——自 `AgentConversation.tsx` 抽取。
 *
 * 抽取动因（2026-10-05，宪法 II 单文件 ≤500 行）：该逻辑约 90 行，与 SSE 流式分发
 * 是两件不同的事，混在一个组件里让组件既长又难测。本 hook 只依赖弹窗状态与 setState、
 * 不碰流式循环，边界清晰、可独立测试。
 *
 * 核心语义（C3，宪法 IV 异步三态 / VI 契约一致性）：
 *  - 修复前五处 `fetch(...).catch(() => {})` 静默失败：弹窗照样关闭、UI 呈现已确认态，
 *    而后端要等 CONFIRM_TIMEOUT(60s) 才按超时判失败——用户与系统之间存在「状态真空」，
 *    写操作上尤其危险（用户以为已批准，系统实际已放弃）。
 *  - 现在：**失败时保持弹窗打开**并就地提示，用户可重试或改为拒绝；成功才关闭。
 *  - 404 单独识别：确认请求已失效（超时/中断/已答复），重试无意义，
 *    故引导用户「改为拒绝」结束等待，而不是让它反复失败。
 */
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage } from './chat-types';
import { isAssistantMessage } from './chat-types';

/** 规划确认弹窗状态（与 AgentConversation 内同名 state 同形） */
export interface PlanConfirmState {
  confirmId: string;
  plan: any;
  editedPlan: any;
}

/** 安全管控弹窗状态 */
export interface SecurityConfirmState {
  confirmId: string;
  behavior: string;
  content: string;
  params: Record<string, any>;
}

export interface UseConfirmRepliesArgs {
  planConfirmModal: PlanConfirmState | null;
  confirmModal: SecurityConfirmState | null;
  setPlanConfirmModal: Dispatch<SetStateAction<PlanConfirmState | null>>;
  setConfirmModal: Dispatch<SetStateAction<SecurityConfirmState | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  /** 取当前轮次的 runId（拒绝规划时定位要更新的 assistant 消息） */
  currentRunId: () => number;
  /** 规划结构校验：返回错误列表（空 = 通过） */
  validatePlan: (plan: any) => string[];
  /** 规划是否被用户改过（未改时只回 approved，不回传 plan——否则后端误判「规划已修改」） */
  isPlanUnchanged: (edited: any, original: any) => boolean;
  /** 提交前清空上一次的规划结构校验错误 */
  onClearPlanError: () => void;
  /** 展示规划结构校验错误（留在弹窗内，不提交） */
  onPlanError: (message: string) => void;
}

export function useConfirmReplies(args: UseConfirmRepliesArgs) {
  const {
    planConfirmModal, confirmModal, setPlanConfirmModal, setConfirmModal,
    setMessages, currentRunId, validatePlan, isPlanUnchanged,
    onClearPlanError, onPlanError,
  } = args;

  const [replyBusy, setReplyBusy] = useState(false);
  /**
   * 「回执进行中」的**同步**镜像（2026-10-05 防连点竞态修复）。
   *
   * 为什么不能只用 `replyBusy` state：`setReplyBusy(true)` 到下次渲染之间存在窗口，
   * 同一 tick 内的两次调用（连点按钮、Enter 重复提交）都会读到 `replyBusy === false`
   * 而双双通过 → 同一份确认被答复两次。第二次答复在语义上是危险的：
   * 第一次已把弹窗关闭、后端已按 approved 推进，第二次属于对已终结请求的重复表态。
   * ref 是同步的，能真正做到「同一时刻只有一次回执在途」。
   */
  const busyRef = useRef(false);
  const [planReplyError, setPlanReplyError] = useState('');
  const [securityReplyError, setSecurityReplyError] = useState('');

  /** 统一回执入口：把 HTTP 结果收敛为 `{ ok, message }`，404 单独给出可操作文案 */
  const postReply = useCallback(async (path: string, body: unknown): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true, message: '' };
      const data = await res.json().catch(() => null);
      const msg = (data && typeof data.message === 'string' && data.message) || `回执失败（HTTP ${res.status}）`;
      return { ok: false, message: res.status === 404 ? `${msg}。该确认已失效，可改为「拒绝」结束等待。` : msg };
    } catch (e: any) {
      return { ok: false, message: `回执失败：${e?.message || '网络错误'}` };
    }
  }, []);

  /** 安全管控回执（批准 / 拒绝同一入口）：成功才关弹窗；失败保留弹窗并展示原因 */
  const answerSecurityConfirm = useCallback(async (approved: boolean) => {
    const m = confirmModal;
    if (!m || busyRef.current) return;
    busyRef.current = true;
    setReplyBusy(true);
    setSecurityReplyError('');
    const r = await postReply(`/agent-api/confirm/${m.confirmId}`, { approved });
    busyRef.current = false;
    setReplyBusy(false);
    if (!r.ok) { setSecurityReplyError(r.message); return; }
    setConfirmModal(null);
  }, [confirmModal, postReply, setConfirmModal]);

  /** 拒绝规划：回执 + 在聊天区留痕（拒绝原因/建议），成功后关弹窗 */
  const handleRejectPlan = useCallback(async (rejectAction: string, suggestion?: string) => {
    const m = planConfirmModal;
    if (!m || busyRef.current) return;
    busyRef.current = true;
    setReplyBusy(true);
    setPlanReplyError('');
    const r = await postReply(`/agent-api/plan-confirm/${m.confirmId}`, {
      approved: false, rejectAction, suggestion: suggestion || '',
    });
    busyRef.current = false;
    setReplyBusy(false);
    if (!r.ok) { setPlanReplyError(r.message); return; } // 弹窗保持打开
    // 在聊天区留痕：把「拒绝了什么」写进本轮 assistant 消息
    const runId = currentRunId();
    const planSummary = `规划共 ${m.editedPlan?.subtasks?.length ?? 0} 个子任务`;
    const rejectText = rejectAction === 'replan'
      ? `已拒绝规划并要求重新规划。${suggestion ? `建议：${suggestion}` : ''}`
      : '已拒绝规划并退出。';
    setMessages(prev => prev.map(msg =>
      isAssistantMessage(msg) && msg.runId === runId
        ? { ...msg, content: `${planSummary}\n\n${rejectText}`, narrative: undefined, narrativeStreaming: false }
        : msg));
    setPlanConfirmModal(null);
  }, [planConfirmModal, postReply, currentRunId, setMessages, setPlanConfirmModal]);

  /** 确认执行：先做规划结构校验（不通过则留在弹窗内），再回执 */
  const onConfirmExecute = useCallback(async () => {
    const m = planConfirmModal;
    if (!m || busyRef.current) return;
    const errs = validatePlan(m.editedPlan);
    if (errs.length > 0) { onPlanError(errs.join('；')); return; }
    onClearPlanError();
    // 仅当用户确实改过（参数/删子任务/依赖有变化）才回传 editedPlan，否则后端会误判「规划已修改」
    const unchanged = isPlanUnchanged(m.editedPlan, m.plan);
    busyRef.current = true;
    setReplyBusy(true);
    setPlanReplyError('');
    const r = await postReply(
      `/agent-api/plan-confirm/${m.confirmId}`,
      unchanged ? { approved: true } : { approved: true, plan: m.editedPlan },
    );
    busyRef.current = false;
    setReplyBusy(false);
    if (!r.ok) { setPlanReplyError(r.message); return; } // 弹窗保持打开
    setPlanConfirmModal(null);
  }, [planConfirmModal, validatePlan, onPlanError, onClearPlanError, isPlanUnchanged, postReply, setPlanConfirmModal]);

  return { replyBusy, planReplyError, securityReplyError, answerSecurityConfirm, handleRejectPlan, onConfirmExecute };
}
