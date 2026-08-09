/**
 * MemoryService.prepareHistory 单元测试 —— mock LLM，验证压缩 + 摘要的编排行为。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// 用 factory 整体替换 llm 模块（llm.ts 不会被真实加载）
vi.mock('./llm.js', () => ({ askLLM: vi.fn() }));

import { askLLM } from './llm.js';
import { MemoryService } from './memory-service.js';
import type { ThreadMessage } from '../types.js';

const mockedAskLLM = vi.mocked(askLLM);
const svc = new MemoryService();

/** 构造 n 条间隔 1min 的消息（>30 触发压缩：保留 30 + 压缩前部） */
function mk(n: number): ThreadMessage[] {
  const now = Date.now();
  const out: ThreadMessage[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({ role: i % 2 === 1 ? 'user' : 'assistant', content: `msg-${i}`, timestamp: new Date(now - (n - i) * 60_000).toISOString() });
  }
  return out;
}

describe('MemoryService.prepareHistory', () => {
  // 注意：不用 beforeEach mockReset —— vitest 4 会把 mock 抛错误报为未捕获拒绝。
  // 改用 afterEach mockClear：只清调用记录、保留实现，避免跨用例累计。
  afterEach(() => mockedAskLLM.mockClear());

  it('历史 ≤30 条：不触发压缩，不调用 LLM', async () => {
    const history = mk(30);
    const r = await svc.prepareHistory(history);
    expect(r.summary).toBeNull();
    expect(r.messages).toBe(history); // 原样返回，同一引用
    expect(mockedAskLLM).not.toHaveBeenCalled();
  });

  it('触发压缩且摘要成功：summary 置前 + 保留尾部 + 摘要被写回', async () => {
    mockedAskLLM.mockResolvedValue('已采购高强度钢板 0.1 吨，供应商宝钢');
    const history = mk(40);
    const r = await svc.prepareHistory(history);
    expect(r.summary).toBe('已采购高强度钢板 0.1 吨，供应商宝钢');
    expect(r.messages[0]?.role).toBe('summary');
    expect(r.messages[0]?.content).toBe('已采购高强度钢板 0.1 吨，供应商宝钢');
    expect(r.messages[0]?.timestamp).toBe(history[0].timestamp); // 占位时间戳=压缩区首条
    expect(r.messages.length).toBe(31); // 1 summary + 30 kept
    expect(mockedAskLLM).toHaveBeenCalledTimes(1);
  });

  it('摘要生成抛错：回退原始历史，不崩溃、不写 summary', async () => {
    mockedAskLLM.mockImplementation(() => { throw new Error('LLM 不可用'); });
    const history = mk(40);
    const r = await svc.prepareHistory(history);
    expect(r.summary).toBeNull();
    expect(r.messages).toBe(history);
  });

  it('摘要为空/空白：视为未产出摘要，回退原始历史', async () => {
    mockedAskLLM.mockResolvedValue('   ');
    const history = mk(40);
    const r = await svc.prepareHistory(history);
    expect(r.summary).toBeNull();
    expect(r.messages).toBe(history);
  });

  it('摘要输入取最近 20k 字符（超长历史不撑爆上下文）', async () => {
    mockedAskLLM.mockResolvedValue('摘要');
    const long = Array.from({ length: 80 }, (_, i) => ({
      role: ('user' as const),
      content: 'x'.repeat(500),
      timestamp: new Date(Date.now() - (80 - i) * 60_000).toISOString(),
    }));
    await svc.prepareHistory(long);
    expect(mockedAskLLM).toHaveBeenCalledTimes(1);
    const [, userPrompt] = mockedAskLLM.mock.calls[0];
    expect(userPrompt.length).toBeLessThanOrEqual(20_500); // 截断到 20k + 前后缀
  });
});
