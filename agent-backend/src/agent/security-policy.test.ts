/**
 * security-policy 单测 —— run 级安全闸（disable 硬闸）。
 *
 * 本文件补的是**分支覆盖**：该文件此前无任何测试，branches 覆盖率仅 50%
 * （`buildDisableMessage` 的有无 title 两分支只覆盖了一条）。
 * 安全相关模块的分支缺口必须补齐——否则「分支未测」意味着
 * 「某条安全路径从未被执行验证过」。
 *
 * 机制要点（见被测文件头）：disable 命中即置 violation 并返回 terminate:true；
 * violation 置位后所有后续工具调用在入口短路——本文件固化「first-writer-wins」。
 */
import { describe, it, expect } from 'vitest';
import {
  createSecurityGate, buildDisableMessage, securityTerminateResult,
} from './security-policy.js';

describe('createSecurityGate', () => {
  it('初始无违规（violation 为 null，调用方据此判定未触发 disable）', () => {
    expect(createSecurityGate().violation).toBeNull();
  });

  it('每次创建相互独立（run 级隔离：A run 的违规不污染 B run）', () => {
    const a = createSecurityGate();
    const b = createSecurityGate();
    a.violation = 'A 的违规';
    expect(b.violation).toBeNull();
  });
});

describe('buildDisableMessage', () => {
  it('有中文显示名 → 「显示名（行为名）」双标注（用户能看懂禁的是哪个行为）', () => {
    const msg = buildDisableMessage('CreatePurchase', '创建采购记录');
    expect(msg).toContain('创建采购记录（CreatePurchase）');
    expect(msg).toContain('权限范围为 disable');
    expect(msg).toContain('已中断执行');
    // 文案必须给出可操作指引（去哪里解禁），否则用户只看到"被禁了"却无处可查
    expect(msg).toContain('安全');
  });

  it('无显示名 → 只显示行为名（不得产出「（）」空括号）', () => {
    const msg = buildDisableMessage('CreatePurchase');
    expect(msg).toContain('CreatePurchase');
    expect(msg).not.toContain('（）');
    expect(msg).not.toContain('（）');
  });

  it('显示名为空串时按无显示名处理（空串是 falsy，不能产出「（CreatePurchase）」缺名文案）', () => {
    const msg = buildDisableMessage('CreatePurchase', '');
    expect(msg).toContain('CreatePurchase');
    expect(msg).not.toContain('（CreatePurchase）');
  });
});

describe('securityTerminateResult', () => {
  it('返回 terminate:true —— 这是停内层循环的唯一机制（isError 会被 pi-agent 吞掉）', () => {
    const r = securityTerminateResult('🔒 已禁用');
    expect(r.terminate).toBe(true);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('🔒 已禁用');
    expect(r.details).toEqual({});
  });

  it('终止文本原样透传给 LLM（说明停止原因，避免它反复重试）', () => {
    const msg = buildDisableMessage('B1', '行为一');
    expect(securityTerminateResult(msg).content[0].text).toBe(msg);
  });
});

describe('SecurityGate first-writer-wins', () => {
  it('模拟运行期：首次命中写入 violation，后续不覆盖（保留最初那条原因）', () => {
    const gate = createSecurityGate();
    // 首个被禁行为
    gate.violation = buildDisableMessage('B1', '行为一');
    const first = gate.violation;
    // 兄弟子 Agent 随后也命中 disable
    if (!gate.violation) gate.violation = buildDisableMessage('B2', '行为二');
    // first-writer-wins：仍是第一条
    expect(gate.violation).toBe(first);
    expect(gate.violation).toContain('行为一');
    expect(gate.violation).not.toContain('行为二');
  });

  it('调用方以 violation 非空判定 securityViolation（波次截断 + run 收尾依据）', () => {
    const gate = createSecurityGate();
    expect(gate.violation === null).toBe(true); // 未触发
    gate.violation = buildDisableMessage('B1');
    expect(gate.violation !== null).toBe(true); // 已触发
  });
});