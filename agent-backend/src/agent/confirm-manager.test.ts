/**
 * ConfirmManager 单元测试（2026-10-05 补齐——本文件此前**零测试**，而它正是 C3 的核心部件）。
 *
 * 重点固化「回执命中判定」：确认请求是一次性的（答复后即移除，超时/中断亦然），
 * 故 handleConfirm / handlePlanConfirm 必须如实返回是否命中——路由层据此回 404，
 * 让调用方能提示「本次答复未生效」，而不是回 200 伪装成已确认（写操作上尤其危险：
 * 用户以为已批准，系统实际已放弃，只能等 60s 超时）。
 *
 * 超时相关用例全部用 fake timers（宪法 III：时间 MUST 打桩）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmManager, CONFIRM_TIMEOUT } from './confirm-manager.js';
import { createEventChannel } from './event-channel.js';
import type { SSEEvent } from '../types.js';

/** 捕获 emit 出的事件（confirmId 只能从这里取——requestConfirm 不直接返回它） */
function captureChannel() {
  const events: SSEEvent[] = [];
  return { events, emit: createEventChannel(e => events.push(e)) };
}

const confirmIdOf = (events: SSEEvent[]): string => {
  const e = events.find(x => x.type === 'confirm' || x.type === 'plan_confirm') as any;
  if (!e) throw new Error('未捕获到确认事件');
  return e.confirmId;
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('ConfirmManager · 安全管控回执（2026-10-05 C3）', () => {
  it('命中待确认项 → 返回 true，且以 reason=user resolve', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p = m.requestConfirm('CreatePurchaseRecord', '确认执行', {}, emit);
    const id = confirmIdOf(events);

    expect(m.handleConfirm(id, true)).toBe(true);
    await expect(p).resolves.toEqual({ approved: true, reason: 'user' });
  });

  it('未知 confirmId → 返回 false（路由据此回 404，绝不静默丢弃）', () => {
    const m = new ConfirmManager();
    expect(m.handleConfirm('not-exist', true)).toBe(false);
  });

  it('同一 id 二次答复 → 首次 true、再次 false（一次性语义）', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p = m.requestConfirm('B', 'c', {}, emit);
    const id = confirmIdOf(events);
    expect(m.handleConfirm(id, false)).toBe(true);
    await expect(p).resolves.toMatchObject({ approved: false });
    expect(m.handleConfirm(id, true)).toBe(false);
  });

  it('超时后回执不再命中 —— C3 核心场景：前端拿到 404 而非静默 200', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p = m.requestConfirm('B', 'c', {}, emit);
    const id = confirmIdOf(events);

    vi.advanceTimersByTime(CONFIRM_TIMEOUT + 1);
    await expect(p).resolves.toEqual({ approved: false, reason: 'timeout' });
    // 超时后前端若再来回执（网络延迟 / 用户刚点），必须如实报告「未生效」
    expect(m.handleConfirm(id, true)).toBe(false);
  });

  it('中断（abortAll）后回执不再命中', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p = m.requestConfirm('B', 'c', {}, emit);
    const id = confirmIdOf(events);

    m.abortAll();
    await expect(p).resolves.toEqual({ approved: false, reason: 'abort' });
    expect(m.handleConfirm(id, true)).toBe(false);
  });
});

describe('ConfirmManager · 规划确认回执', () => {
  it('命中 → true；未命中 → false；答复内容（rejectAction / suggestion）透传', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p = m.requestPlanConfirm({ subtasks: [] }, emit);
    const id = confirmIdOf(events);

    expect(m.handlePlanConfirm(id, false, undefined, { rejectAction: 'replan', suggestion: '改成先查库存' })).toBe(true);
    await expect(p).resolves.toMatchObject({
      approved: false, rejectAction: 'replan', suggestion: '改成先查库存', reason: 'user',
    });
    expect(m.handlePlanConfirm(id, true)).toBe(false);
  });

  it('规划确认超时后回执不再命中', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p = m.requestPlanConfirm({ subtasks: [] }, emit);
    const id = confirmIdOf(events);

    vi.advanceTimersByTime(CONFIRM_TIMEOUT + 1);
    await expect(p).resolves.toEqual({ approved: false, reason: 'timeout' });
    expect(m.handlePlanConfirm(id, true)).toBe(false);
  });

  it('abortAll 同时清理两张表（安全管控 + 规划确认）', async () => {
    const { events, emit } = captureChannel();
    const m = new ConfirmManager();
    const p1 = m.requestConfirm('B1', 'c', {}, emit);
    const p2 = m.requestPlanConfirm({ subtasks: [] }, emit);

    m.abortAll();
    await expect(p1).resolves.toMatchObject({ reason: 'abort' });
    await expect(p2).resolves.toMatchObject({ reason: 'abort' });
    // 两张表都清空 → 后续任何回执都不命中
    expect(m.handleConfirm(confirmIdOf(events), true)).toBe(false);
  });
});
