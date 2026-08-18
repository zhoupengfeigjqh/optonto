/**
 * ConfirmManager —— 规划确认 / 安全管控弹窗的等待-回调管理。
 * 独立成模块：避免 subtask-runner 与 orchestrator 循环依赖。
 *
 * 对外依赖 ConfirmPort 接口而非具体类（seam）：编排链路（orchestrator / SubtaskRunnerDeps）
 * 面向接口，测试可直接 fake 五个方法，无需 as unknown as 强转。
 */
import { randomUUID } from 'node:crypto';
import type { SubTaskPlan } from '../types.js';
import type { EventChannel } from './event-channel.js';

export const CONFIRM_TIMEOUT = 60000;

/** 确认结果来源：用户主动操作 / 超时 / 中断 */
export interface ConfirmResult {
  approved: boolean;
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

/** 确认管理接口 —— 编排层依赖的确认能力（弹窗请求 + 路由回调 + 全量中断） */
export interface ConfirmPort {
  /** 安全管控确认弹窗（写操作/security 行为执行前） */
  requestConfirm(behavior: string, content: string, params: Record<string, any> | undefined, emit: EventChannel): Promise<ConfirmResult>;
  /** 规划确认弹窗（多步规划执行前） */
  requestPlanConfirm(plan: SubTaskPlan, emit: EventChannel): Promise<PlanConfirmResult>;
  /** 路由回调：用户答复安全管控弹窗 */
  handleConfirm(confirmId: string, approved: boolean): void;
  /** 路由回调：用户答复规划确认弹窗 */
  handlePlanConfirm(confirmId: string, approved: boolean, plan?: SubTaskPlan, opts?: { rejectAction?: 'exit' | 'replan'; suggestion?: string }): void;
  /** 中断：立即拒绝所有待确认弹窗（reason='abort'） */
  abortAll(): void;
}

export class ConfirmManager implements ConfirmPort {
  private pending = new Map<string, {
    resolve: (v: ConfirmResult) => void;
    timer: NodeJS.Timeout;
  }>();
  private planPending = new Map<string, {
    resolve: (v: PlanConfirmResult) => void;
    timer: NodeJS.Timeout;
  }>();

  async requestConfirm(behavior: string, content: string, params: Record<string, any> | undefined, emit: EventChannel): Promise<ConfirmResult> {
    const confirmId = randomUUID();
    emit.raw({ type: 'confirm', confirmId, behavior, content, params });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(confirmId); resolve({ approved: false, reason: 'timeout' }); }, CONFIRM_TIMEOUT);
      this.pending.set(confirmId, { resolve, timer });
    });
  }

  handleConfirm(confirmId: string, approved: boolean): void {
    const entry = this.pending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(confirmId);
    entry.resolve({ approved, reason: 'user' });
  }

  async requestPlanConfirm(plan: SubTaskPlan, emit: EventChannel): Promise<PlanConfirmResult> {
    const confirmId = randomUUID();
    emit.raw({ type: 'plan_confirm', confirmId, plan });
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
   * 注：同一时刻只有一个活动 run（orchestrator.execute 入口互斥保证），abortAll 不误伤其他 run。
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
