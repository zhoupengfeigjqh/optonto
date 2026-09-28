'use client';

/**
 * 确认弹窗的自动取消倒计时（60s）。
 *
 * 规划确认与安全确认共用同一语义（原为两段几乎逐字重复的 useEffect）：
 * - 打开时重置为 60s，每秒递减；
 * - 倒计时归零 → 回执「拒绝」让后端即时解析，再由调用方关闭弹窗
 *   （超时的唯一权威在后端，前端倒计时只是体验层）；
 * - 按 `activeKey`（confirmId）重置——**编辑弹窗内容不应重置倒计时**。
 *
 * 回调经 ref 转发：避免调用方每次渲染新建的箭头函数把 effect 变成"每次渲染都可能重新触发"，
 * 那会在倒计时归零时重复提交拒绝回执。
 */
import { useEffect, useRef, useState } from 'react';

const COUNTDOWN_SECONDS = 60;

export function useConfirmCountdown(activeKey: string | undefined, onExpire: () => void): number | null {
  const [countdown, setCountdown] = useState<number | null>(null);

  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!activeKey) { setCountdown(null); return; }
    setCountdown(COUNTDOWN_SECONDS);
    const timer = setInterval(() => {
      setCountdown(prev => (prev !== null && prev > 1) ? prev - 1 : 0);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeKey]);

  useEffect(() => {
    if (countdown === 0 && activeKey) expireRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, activeKey]);

  return countdown;
}
