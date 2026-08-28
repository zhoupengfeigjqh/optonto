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

describe('RunSession — adjustmentInvalid（调整规划校验失败主动中止）', () => {
  it('terminate(adjustmentInvalid) → isIncomplete=true，原因文案点破中止动机', () => {
    const s = new RunSession();
    expect(s.isIncomplete()).toBe(false);
    s.terminate('adjustmentInvalid');
    expect(s.isIncomplete()).toBe(true);
    expect(s.terminalReason(2)).toContain('调整规划校验未通过');
    expect(s.terminalReason(2)).toContain('主动中止');
  });
});

describe('RunSession — 规划提交口（PlanSubmission 复位-重提协议）', () => {
  it('submit 后 peek 取回；reset 后 peek 为 null（只认下一次新提交）', () => {
    const s = new RunSession();
    expect(s.submittedPlan.peek()).toBeNull();
    const plan = { subtasks: [] };
    s.submittedPlan.submit(plan);
    expect(s.submittedPlan.peek()).toBe(plan);
    s.submittedPlan.reset();
    expect(s.submittedPlan.peek()).toBeNull();
    const plan2 = { subtasks: [{ seq: 1 }] };
    s.submittedPlan.submit(plan2 as never);
    expect(s.submittedPlan.peek()).toBe(plan2);
  });
});

describe('RunSession — 规划叙事通道', () => {
  it('默认开启；closePlanningNarrative 后关闭（总结阶段走 token 正文）', () => {
    const s = new RunSession();
    expect(s.isPlanningNarrative()).toBe(true);
    s.closePlanningNarrative();
    expect(s.isPlanningNarrative()).toBe(false);
  });
});

describe('RunSession — 父 Agent 上下文手术', () => {
  it('injectFinalPlan 向父 Agent 注入最终规划消息（user 角色 + 模板文案）', () => {
    const s = new RunSession();
    const p = fakeAgent();
    s.parentAgent = p;
    s.injectFinalPlan('1. QueryA（场景/本体）');
    expect(p.state.messages).toHaveLength(1);
    const msg = p.state.messages[0] as { role: string; content: string };
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('用户在确认时修改了执行计划');
    expect(msg.content).toContain('1. QueryA（场景/本体）');
  });

  it('父 Agent 缺失时 injectFinalPlan/markFeedbackStart/dropFeedbackRound 均安全空转', () => {
    const s = new RunSession();
    expect(() => s.injectFinalPlan('x')).not.toThrow();
    expect(s.markFeedbackStart()).toBe(0);
    expect(() => s.dropFeedbackRound(0)).not.toThrow();
  });

  it('markFeedbackStart/dropFeedbackRound：剔除标记之后的反馈轮上下文，之前的保留', () => {
    const s = new RunSession();
    const p = fakeAgent();
    s.parentAgent = p;
    p.state.messages.push({ role: 'user', content: '规划' }, { role: 'assistant', content: '规划已提交' });
    const mark = s.markFeedbackStart();
    p.state.messages.push({ role: 'user', content: '反馈prompt' }, { role: 'assistant', content: '继续执行原计划' });
    expect(p.state.messages).toHaveLength(4);
    s.dropFeedbackRound(mark);
    expect(p.state.messages).toHaveLength(2);
    expect((p.state.messages[1] as { content: string }).content).toBe('规划已提交');
  });
});
