/**
 * useConfirmCountdown 单测 —— 确认弹窗 60s 自动取消（2026-10-06 补，宪法 III）。
 *
 * 用 fake timers：真实等60 秒不可行，且本 hook 全部逻辑都在 setInterval 里，
 * 不打桩则一行也测不了。
 *
 * 重点固化三条语义：
 *  ① 倒计时归零触发 onExpire，且**只触发一次**（重复回执会把"超时"变成多次请求）
 *  ② 按 activeKey（confirmId）重置，**编辑弹窗内容不重置**（用户改参数不该延长等待）
 *  ③ 回调经 ref 转发：调用方每次渲染新建的箭头函数不得导致重复触发
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmCountdown } from './use-confirm-countdown';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** 推进 n 秒 */
const tick = async (n: number) => {
  for (let i = 0; i < n; i++) {
    await act(async () => { vi.advanceTimersByTime(1000); });
  }
};

describe('useConfirmCountdown', () => {
  it('无 activeKey（弹窗未打开）→ countdown 为 null 且不启动倒计时', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useConfirmCountdown(undefined, onExpire));
    expect(result.current).toBeNull();
  });

  it('打开弹窗 → 重置为 60', () => {
    const { result } = renderHook(() => useConfirmCountdown('c1', vi.fn()));
    expect(result.current).toBe(60);
  });

  it('每秒递减：59 → 58 → 57', async () => {
    const { result } = renderHook(() => useConfirmCountdown('c1', vi.fn()));
    await tick(1);
    expect(result.current).toBe(59);
    await tick(2);
    expect(result.current).toBe(57);
  });

  it('归零时触发 onExpire（自动拒绝，让后端即时解析）', async () => {
    const onExpire = vi.fn();
    renderHook(() => useConfirmCountdown('c1', onExpire));
    await tick(59);
    expect(onExpire).not.toHaveBeenCalled();
    await tick(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('归零后不重复触发（继续推进时间也只回调一次）', async () => {
    const onExpire = vi.fn();
    renderHook(() => useConfirmCountdown('c1', onExpire));
    await tick(60);
    expect(onExpire).toHaveBeenCalledTimes(1);
    await tick(10); // 多等 10 秒
    expect(onExpire).toHaveBeenCalledTimes(1); // 关键：不得重复回执
  });

  it('activeKey 变化 → 倒计时重置为 60（换弹窗重新计时）', async () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useConfirmCountdown(key, onExpire),
      { initialProps: { key: 'c1' } },
    );
    await tick(10);
    expect(result.current).toBe(50);
    rerender({ key: 'c2' });
    expect(result.current).toBe(60);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('activeKey 不变但组件重渲染 → 倒计时**不重置**（编辑参数不该延长等待）', async () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ key, _tick }: { key: string; _tick: number }) => useConfirmCountdown(key, onExpire),
      { initialProps: { key: 'c1', _tick: 0 } },
    );
    await tick(10);
    expect(result.current).toBe(50);
    // 模拟用户在弹窗内编辑参数（父组件重渲染，但 confirmId 不变）
    rerender({ key: 'c1', _tick: 1 });
    expect(result.current).toBe(50); // 关键：仍是 50 而非重置为 60
  });

  it('回调经 ref 转发：调用方每次渲染新建箭头函数不导致重复触发', async () => {
    const spy = vi.fn();
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useConfirmCountdown(key, () => spy()), // 每次新建函数
      { initialProps: { key: 'c1' } },
    );
    await tick(30);
    rerender({ key: 'c1' }); // 重渲染：若 effect 依赖 onExpire，倒计时会被重启回 60
    await tick(30);        // 累计 60 秒 → 应恰好触发一次
    expect(spy).toHaveBeenCalledTimes(1);
    // 关键验证：重渲染后倒计时没有被重启——否则第 30 秒时又会重置，
    // 第 60 秒就还没归零、永远不触发
  });

  it('弹窗关闭（activeKey 变 undefined）→ 停止倒计时且不再触发', async () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: string | undefined }) => useConfirmCountdown(key, onExpire),
      { initialProps: { key: 'c1' as string | undefined } },
    );
    await tick(10);
    rerender({ key: undefined });
    expect(result.current).toBeNull();
    await tick(60); // 关闭后继续推进
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('倒计时不会减到负数（下界为 0）', async () => {
    const { result } = renderHook(() => useConfirmCountdown('c1', vi.fn()));
    await tick(80);
    expect(result.current).toBe(0);
  });
});