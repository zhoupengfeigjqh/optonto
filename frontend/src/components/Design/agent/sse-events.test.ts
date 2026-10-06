/**
 * SSE 事件契约防漂移测试（2026-10-05，agent 环节审查 C4 / M4）。
 *
 * 修复前前端没有任何 SSE 事件类型，data 全程隐式 any：后端发的 plan_received
 * 前端零处理（写而不读的死契约）；后端新增事件类型时前端也只是悄悄不处理。
 * 本文件把「前端镜像」与「后端实际发出的事件」显式绑定，漂移即测试失败。
 * 两侧不同语言、无代码级共享，故以后端源码文本为契约锚点。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SSE_EVENT_TYPES, isSSEEvent, type SSEEvent } from './sse-events';

const BACKEND_TYPES = join(process.cwd(), '..', 'agent-backend', 'src', 'types.ts');

/** 从后端源码提取 SSEEvent 联合里所有 { type: 'xxx' } 事件名 */
function backendEventTypes(): string[] {
  const src = readFileSync(BACKEND_TYPES, 'utf-8');
  const start = src.indexOf('export type SSEEvent');
  if (start < 0) throw new Error('未找到后端 SSEEvent 定义（契约锚点失效，需同步 sse-events.ts）');
  const end = src.indexOf('\nexport ', start + 10);
  const block = src.slice(start, end > 0 ? end : undefined);
  return [...block.matchAll(/\{\s*type:\s*'([^']+)'/g)].map(m => m[1]).sort();
}

describe('SSE 事件契约：前端镜像 vs 后端定义', () => {
  it('事件集合与后端完全一致（不多=死契约，不少=前端漏处理）', () => {
    expect([...SSE_EVENT_TYPES].sort()).toEqual(backendEventTypes());
  });

  it('提取逻辑非空（防空数组假通过）', () => {
    expect(backendEventTypes().length).toBeGreaterThanOrEqual(SSE_EVENT_TYPES.length);
  });
});

describe('isSSEEvent 类型守卫', () => {
  it('接受后端下发的全部事件类型', () => {
    for (const t of SSE_EVENT_TYPES) expect(isSSEEvent({ type: t })).toBe(true);
  });

  it('拒绝未知事件类型（交由调用方告警，不静默放行）', () => {
    expect(isSSEEvent({ type: 'brand_new_event' })).toBe(false);
  });

  it('边界：非对象 / 空 / 缺 type / type 非字符串一律拒绝', () => {
    expect(isSSEEvent(null)).toBe(false);
    expect(isSSEEvent(undefined)).toBe(false);
    expect(isSSEEvent('token')).toBe(false);
    expect(isSSEEvent({})).toBe(false);
    expect(isSSEEvent({ type: 123 })).toBe(false);
  });
});

describe('SSEEvent 判别联合可收窄', () => {
  it('token / plan_received / confirm 各自带对应字段', () => {
    const a: SSEEvent = { type: 'token', token: 'x' };
    if (a.type === 'token') expect(a.token).toBe('x');
    const b: SSEEvent = { type: 'plan_received', plan: { subtasks: [] } };
    if (b.type === 'plan_received') expect(b.plan.subtasks).toEqual([]);
    const c: SSEEvent = { type: 'confirm', confirmId: 'k1', behavior: 'B', content: 'c' };
    if (c.type === 'confirm') expect(c.confirmId).toBe('k1');
  });

  it('narrative_end 的 outcome 是三态', () => {
    for (const o of ['plan', 'answer', 'aborted'] as const) {
      const e: SSEEvent = { type: 'narrative_end', outcome: o };
      expect(e.type).toBe('narrative_end');
    }
  });
});
