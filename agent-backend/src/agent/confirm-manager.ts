/**
 * ConfirmManager —— 规划确认 / 安全管控弹窗的等待-回调管理。
 * 独立成模块：避免 subtask-runner 与 orchestrator 循环依赖。
 */
import { randomUUID } from 'node:crypto';
import type { SubTaskPlan, SSEEvent } from '../types.js';

export const CONFIRM_TIMEOUT = 60000;

/** 确认结果来源：用户主动操作 / 超时 / 中断 */
export interface ConfirmResult {
  approved: boolean;
  params?: Record<string, any>;
  reason?: 'user' | 'timeout' | 'abort';
}

export interface PlanConfirmResult {
  approved: boolean;
  plan?: SubTaskPlan;
  /** 拒绝时的动作：退出 or 让父Agent重规划 */
  rejectAction?: 'exit' | 'replan';
  /** 拒绝并重规划时用户附带的具体建议 */
  suggestion?: string;
  reason?: 'user' | 'timeout' | 'abort';
}

export class ConfirmManager {
  private pending = new Map<string, {
    resolve: (v: ConfirmResult) => void;
    timer: NodeJS.Timeout;
  }>();
  private planPending = new Map<string, {
    resolve: (v: PlanConfirmResult) => void;
    timer: NodeJS.Timeout;
  }>();

  async requestConfirm(behavior: string, content: string, params: Record<string, any> | undefined, sendEvent: (e: SSEEvent) => void): Promise<ConfirmResult> {
    const confirmId = randomUUID();
    sendEvent({ type: 'confirm', confirmId, behavior, content, params });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(confirmId); resolve({ approved: false, reason: 'timeout' }); }, CONFIRM_TIMEOUT);
      this.pending.set(confirmId, { resolve, timer });
    });
  }

  handleConfirm(confirmId: string, approved: boolean, params?: Record<string, any>): void {
    const entry = this.pending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(confirmId);
    entry.resolve({ approved, params, reason: 'user' });
  }

  async requestPlanConfirm(plan: SubTaskPlan, sendEvent: (e: SSEEvent) => void): Promise<PlanConfirmResult> {
    const confirmId = randomUUID();
    sendEvent({ type: 'plan_confirm', confirmId, plan });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.planPending.delete(confirmId); resolve({ approved: false, reason: 'timeout' }); }, CONFIRM_TIMEOUT);
      this.planPending.set(confirmId, { resolve, timer });
    });
  }

  handlePlanConfirm(confirmId: string, approved: boolean, plan?: SubTaskPlan, opts?: { rejectAction?: 'exit' | 'replan'; suggestion?: string }): void {
    const entry = this.planPending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.planPending.delete(confirmId);
    entry.resolve({ approved, plan, ...opts, reason: 'user' });
  }

  /**
   * 中断：立即拒绝所有待确认的规划/安全管控弹窗（reason='abort'）。
   * 注：ConfirmManager 与 Orchestrator 同属单例，假定同一时刻只有一个活动对话。
   */
  abortAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ approved: false, reason: 'abort' });
    }
    for (const [id, entry] of this.planPending) {
      clearTimeout(entry.timer);
      this.planPending.delete(id);
      entry.resolve({ approved: false, reason: 'abort' });
    }
  }
}
