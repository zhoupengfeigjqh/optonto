/**
 * 短期记忆压缩纯逻辑单元测试 —— 覆盖三条规则的全部边界。
 */
import { describe, it, expect } from 'vitest';
import { compressHistory } from './history-compressor.js';
import type { ThreadMessage } from '../types.js';

const now = Date.now();
const GAP = 40 * 60 * 1000;

/** 构造 n 条间隔 1min 的消息；gapAfterIdx 给定 → 该下标之后的消息时间戳整体后移 >30min（制造断点） */
function mk(n: number, gapAfterIdx?: number): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (let i = 1; i <= n; i++) {
    let t = now - (n - i) * 60_000;
    if (gapAfterIdx !== undefined && i > gapAfterIdx) t += GAP;
    out.push({ role: i % 2 === 1 ? 'user' : 'assistant', content: `msg-${i}`, timestamp: new Date(t).toISOString() });
  }
  return out;
}

describe('compressHistory — 短期记忆压缩纯逻辑', () => {
  it('≤30 条：不压缩，kept 为全量', () => {
    const r = compressHistory(mk(30));
    expect(r.toSummarize).toHaveLength(0);
    expect(r.kept).toHaveLength(30);
  });

  it('>50 条：截断前部（不进上下文也不摘要），窗口内保留最近 30', () => {
    const r = compressHistory(mk(51));
    // 51 条 → 窗口取最近 50 → 保留 30 + 压缩 20（被截断的最早 1 条不进上下文）
    expect(r.toSummarize).toHaveLength(20);
    expect(r.kept).toHaveLength(30);
    expect(r.kept[0].content).toBe('msg-22'); // 窗口 = msg-2..msg-51，kept = 窗口尾 30 条
  });

  it('>30min 断点且尾部 ≤30：采用断点，断点前压缩', () => {
    // 31 条，断点在 msg-30/msg-31 之间（尾部 1 条）
    const r = compressHistory(mk(31, 30));
    expect(r.toSummarize).toHaveLength(30);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].content).toBe('msg-31');
  });

  it('无断点：保留最近 30，压缩其余', () => {
    const r = compressHistory(mk(40));
    expect(r.toSummarize).toHaveLength(10);
    expect(r.kept).toHaveLength(30);
    expect(r.kept[0].content).toBe('msg-11');
  });

  it('断点存在但尾部 >30（断点太早）：放弃断点，兜底保留最近 30', () => {
    // 40 条，断点在 msg-5/msg-6（尾部 34 条 >30）
    const r = compressHistory(mk(40, 5));
    expect(r.toSummarize).toHaveLength(10);
    expect(r.kept).toHaveLength(30);
    expect(r.kept[0].content).toBe('msg-11');
  });

  it('非法时间戳安全处理（不抛错）', () => {
    const bad: ThreadMessage[] = [
      { role: 'user', content: 'a', timestamp: 'not-a-date' },
      { role: 'assistant', content: 'b', timestamp: '' },
    ];
    // 仅 2 条，不触发压缩；断言可正常返回
    const r = compressHistory(bad);
    expect(r.toSummarize).toHaveLength(0);
    expect(r.kept).toHaveLength(2);
  });
});
