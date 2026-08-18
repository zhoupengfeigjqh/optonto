/**
 * RunSession 单元测试 —— run 级状态模块经自身 interface 测试（不触 SDK）。
 * 覆盖：abort 状态迁移（置位 + 中断在途子/父 Agent）、token 流式开关、
 * 波次结局标记与终止原因文案（含优先级）、release 清理。
 */
import { describe, it, expect, vi } from 'vitest';
import { RunSession } from './run-session.js';
import type { AgentPort } from './agent-port.js';

function fakeAgent(): AgentPort & { abort: ReturnType<typeof vi.fn> } {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    subscribe: vi.fn(),
    state: { messages: [] },
  } as unknown as AgentPort & { abort: ReturnType<typeof vi.fn> };
}

describe('RunSession — abort 状态迁移', () => {
  it('初始未中断；abort() 后置位且幂等', () => {
    const s = new RunSession();
    expect(s.isAborted()).toBe(false);
    s.abort();
    s.abort(); // 幂等，不抛错
    expect(s.isAborted()).toBe(true);
  });

  it('abort() 中断全部在途子 Agent 与父 Agent，并清空子 Agent 集合', () => {
    const s = new RunSession();
    const c1 = fakeAgent(); const c2 = fakeAgent(); const p = fakeAgent();
    s.childAgents.add(c1); s.childAgents.add(c2);
    s.parentAgent = p;
    s.abort();
    expect(c1.abort).toHaveBeenCalledTimes(1);
    expect(c2.abort).toHaveBeenCalledTimes(1);
    expect(p.abort).toHaveBeenCalledTimes(1);
    expect(s.childAgents.size).toBe(0);
  });

  it('子 Agent abort 抛错不影响其余 Agent 的中断（try/catch 兜底）', () => {
    const s = new RunSession();
    const bad = fakeAgent(); bad.abort.mockImplementation(() => { throw new Error('boom'); });
    const good = fakeAgent();
    s.childAgents.add(bad); s.childAgents.add(good);
    s.abort();
    expect(good.abort).toHaveBeenCalledTimes(1);
    expect(s.isAborted()).toBe(true);
  });
});

describe('RunSession — token 流式开关', () => {
  it('默认开启；disable/enable 显式切换', () => {
    const s = new RunSession();
    expect(s.tokensEnabled()).toBe(true);
    s.disableTokens();
    expect(s.tokensEnabled()).toBe(false);
    s.enableTokens();
    expect(s.tokensEnabled()).toBe(true);
  });
});

describe('RunSession — 波次结局与终止原因', () => {
  it('无结局且无 abort → 未完成=false，terminalReason=null', () => {
    const s = new RunSession();
    expect(s.isIncomplete()).toBe(false);
    expect(s.terminalReason(3)).toBeNull();
  });

  it('terminate 首写胜出：failed → blocked 不覆盖', () => {
    const s = new RunSession();
    s.terminate('failed');
    s.terminate('blocked');
    expect(s.terminalOutcome()).toBe('failed');
    expect(s.terminalReason(0)).toBe('存在子任务执行失败');
  });

  it('blocked / waveCapped 原因文案（waveCapped 带剩余数）', () => {
    const b = new RunSession();
    b.terminate('blocked');
    expect(b.terminalReason(0)).toBe('因前置依赖未完成而终止');
    const w = new RunSession();
    w.terminate('waveCapped');
    expect(w.terminalReason(4)).toBe('执行波数已达上限，仍有 4 个子任务未执行');
  });

  it('abort 标记与 aborted 结局都映射为"任务已被用户中断"，且 abort 标记优先于其他结局', () => {
    const byOutcome = new RunSession();
    byOutcome.terminate('aborted');
    expect(byOutcome.isIncomplete()).toBe(true);
    expect(byOutcome.terminalReason(0)).toBe('任务已被用户中断');
    const byFlag = new RunSession();
    byFlag.terminate('failed');
    byFlag.abort();
    expect(byFlag.terminalReason(0)).toBe('任务已被用户中断');
  });
});

describe('RunSession — release', () => {
  it('release 清空子 Agent 集合与父 Agent 引用', () => {
    const s = new RunSession();
    s.childAgents.add(fakeAgent());
    s.parentAgent = fakeAgent();
    s.release();
    expect(s.childAgents.size).toBe(0);
    expect(s.parentAgent).toBeNull();
  });
});
