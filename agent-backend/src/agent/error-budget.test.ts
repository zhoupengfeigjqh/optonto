/**
 * 工具报错预算单元测试。
 * 验证 wrapExecuteWithErrorBudget：未达上限 rethrow 让 LLM 自纠；达上限返回 terminate:true 停止 pi-agent 内层循环。
 */
import { describe, it, expect } from 'vitest';
import { createToolErrorBudget, wrapExecuteWithErrorBudget, TOOL_ERROR_LIMIT } from './error-budget.js';

describe('createToolErrorBudget', () => {
  it('默认上限 3，初始未超限', () => {
    const b = createToolErrorBudget();
    expect(b).toEqual({ count: 0, limit: 3, exceeded: false });
    expect(TOOL_ERROR_LIMIT).toBe(3);
  });

  it('支持自定义上限', () => {
    const b = createToolErrorBudget(5);
    expect(b.limit).toBe(5);
  });
});

describe('wrapExecuteWithErrorBudget', () => {
  it('成功时不计数、返回原结果', async () => {
    const budget = createToolErrorBudget();
    const wrapped = wrapExecuteWithErrorBudget(async () => ({ content: [{ type: 'text', text: 'ok' }] }), budget);
    const res = await wrapped('c1', {});
    expect(res).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(budget).toEqual({ count: 0, limit: 3, exceeded: false });
  });

  it('前 2 次报错 rethrow（LLM 可自纠），count 递增、未超限', async () => {
    const budget = createToolErrorBudget();
    const wrapped = wrapExecuteWithErrorBudget(async () => { throw new Error('MCP error -32000: Connection closed'); }, budget);
    await expect(wrapped('c1', {})).rejects.toThrow(/Connection closed/);
    expect(budget.count).toBe(1);
    expect(budget.exceeded).toBe(false);

    await expect(wrapped('c2', {})).rejects.toThrow(/Connection closed/);
    expect(budget.count).toBe(2);
    expect(budget.exceeded).toBe(false);
  });

  it('第 3 次报错不抛，返回 terminate:true 并置 exceeded', async () => {
    const budget = createToolErrorBudget();
    const wrapped = wrapExecuteWithErrorBudget(async () => { throw new Error('boom'); }, budget);
    await wrapped('c1', {}).catch(() => {});
    await wrapped('c2', {}).catch(() => {});
    const res = await wrapped('c3', {});   // 不应 reject
    expect(res.terminate).toBe(true);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('已中断执行');
    expect(budget.count).toBe(3);
    expect(budget.exceeded).toBe(true);
  });

  it('超限后再报错也一律返回 terminate（不再抛）', async () => {
    const budget = createToolErrorBudget(2);
    const wrapped = wrapExecuteWithErrorBudget(async () => { throw new Error('boom'); }, budget);
    await wrapped('c1', {}).catch(() => {});
    const res2 = await wrapped('c2', {});
    expect(res2.terminate).toBe(true);
    const res3 = await wrapped('c3', {});   // 超限后再次调用同样终止
    expect(res3.terminate).toBe(true);
  });

  it('超限后短路：后续【成功】调用也不执行真实工具，直接返回 terminate', async () => {
    const budget = createToolErrorBudget();
    // 先用恒报错工具把预算打到超限
    const bad = wrapExecuteWithErrorBudget(async () => { throw new Error('boom'); }, budget);
    await bad('c1', {}).catch(() => {});
    await bad('c2', {}).catch(() => {});
    await bad('c3', {});   // 第3次 → exceeded=true

    // 超限后换一个本应成功的工具（模拟并行批里后续发起的调用）：必须被短路，真实 execute 不被调用
    let realCalls = 0;
    const ok = wrapExecuteWithErrorBudget(async () => { realCalls++; return { content: [{ type: 'text', text: 'ok' }] }; }, budget);
    const res = await ok('c4', {});
    expect(realCalls).toBe(0);                 // 真实工具一次都没执行 → 无多余写操作
    expect(res.terminate).toBe(true);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('已中断执行');
    expect(budget.count).toBe(3);              // 短路不计数、不重置
  });

  it('超限后短路：后续【报错】调用也直接返回 terminate，不 rethrow、不累计计数', async () => {
    const budget = createToolErrorBudget(2);
    const wrapped = wrapExecuteWithErrorBudget(async () => { throw new Error('boom'); }, budget);
    await wrapped('c1', {}).catch(() => {});
    await wrapped('c2', {});                    // 第2次 → exceeded=true

    const res = await wrapped('c3', {});        // 短路路径：不再进 catch
    expect(res.terminate).toBe(true);
    expect(budget.count).toBe(2);               // count 停在超限值，不继续 +1
    expect(budget.exceeded).toBe(true);
  });
});
