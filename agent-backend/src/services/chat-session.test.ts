/**
 * ChatSession 单元测试 —— 对话生命周期经 chat() 接口测试（interface 即测试面，脱离 HTTP）。
 * 覆盖：历史压缩写回线程 / 无摘要不写回 / 压缩失败降级原始历史 / 持久化时机与内容 / 错误上抛。
 */
import { describe, it, expect, vi } from 'vitest';
import { ChatSession } from './chat-session.js';
import type { ThreadStore } from './thread-store.js';
import type { MemoryService } from './memory-service.js';
import type { Orchestrator } from '../agent/orchestrator.js';
import type { ThreadMessage } from '../types.js';

const H: ThreadMessage[] = [
  { role: 'user', content: '历史问题', timestamp: '2026-08-17T09:00:00.000Z' },
  { role: 'assistant', content: '历史回答', timestamp: '2026-08-17T09:00:05.000Z' },
];
const COMPRESSED: ThreadMessage[] = [
  { role: 'summary', content: '早期对话摘要', timestamp: '2026-08-17T09:00:00.000Z' },
];

function mkThreadStore() {
  return {
    get: vi.fn(() => ({ messages: H, skill_names: [{ name: 's1', scenario: 'sc', ontology: 'on' }] })),
    replaceMessages: vi.fn(),
    appendMessages: vi.fn(),
  };
}

function mkMemory(prepared: { messages: ThreadMessage[]; summary: string | null } | Error) {
  return {
    prepareHistory: prepared instanceof Error
      ? vi.fn().mockRejectedValue(prepared)
      : vi.fn().mockResolvedValue(prepared),
  };
}

function mkOrchestrator(result = '最终总结') {
  return { execute: vi.fn().mockResolvedValue(result) };
}

function mk(prepared: { messages: ThreadMessage[]; summary: string | null } | Error, result?: string) {
  const threadStore = mkThreadStore();
  const memory = mkMemory(prepared);
  const orchestrator = mkOrchestrator(result);
  const session = new ChatSession(
    threadStore as unknown as ThreadStore,
    memory as unknown as MemoryService,
    orchestrator as unknown as Orchestrator,
  );
  return { session, threadStore, memory, orchestrator };
}

describe('ChatSession.chat — 记忆压缩', () => {
  it('压缩产生摘要 → 写回线程，编排收到压缩后的历史', async () => {
    const { session, threadStore, memory, orchestrator } = mk({ messages: COMPRESSED, summary: '早期对话摘要' });
    await session.chat('sc', 'on', 't1', '当前问题', () => {});
    expect(memory.prepareHistory).toHaveBeenCalledWith(H);
    expect(threadStore.replaceMessages).toHaveBeenCalledWith('sc', 'on', 't1', COMPRESSED);
    expect(orchestrator.execute.mock.calls[0][2]).toBe(COMPRESSED); // 喂编排的是压缩后历史
  });

  it('无摘要（无需压缩）→ 不写回，编排收到原始历史', async () => {
    const { session, threadStore, orchestrator } = mk({ messages: H, summary: null });
    await session.chat('sc', 'on', 't1', '当前问题', () => {});
    expect(threadStore.replaceMessages).not.toHaveBeenCalled();
    expect(orchestrator.execute.mock.calls[0][2]).toBe(H);
  });

  it('压缩失败 → 降级走原始历史，对话不阻断', async () => {
    const { session, threadStore, orchestrator } = mk(new Error('LLM 不可用'));
    const reply = await session.chat('sc', 'on', 't1', '当前问题', () => {});
    expect(reply).toBe('最终总结');
    expect(threadStore.replaceMessages).not.toHaveBeenCalled();
    expect(orchestrator.execute.mock.calls[0][2]).toBe(H);
  });
});

describe('ChatSession.chat — 持久化与错误', () => {
  it('编排结果持久化：user + assistant 两条消息按序 append（含技能名透传编排）', async () => {
    const { session, threadStore, orchestrator } = mk({ messages: H, summary: null }, '执行完成');
    const reply = await session.chat('sc', 'on', 't1', '当前问题', () => {});
    expect(reply).toBe('执行完成');
    expect(orchestrator.execute.mock.calls[0][0]).toBe('当前问题');
    expect(orchestrator.execute.mock.calls[0][1]).toEqual([{ name: 's1', scenario: 'sc', ontology: 'on' }]);
    const appended = threadStore.appendMessages.mock.calls[0][3] as ThreadMessage[];
    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({ role: 'user', content: '当前问题' });
    expect(appended[1]).toMatchObject({ role: 'assistant', content: '执行完成' });
  });

  it('线程不存在（get 抛错）→ 错误上抛，不触发编排与持久化', async () => {
    const { session, threadStore, orchestrator } = mk({ messages: H, summary: null });
    threadStore.get.mockImplementation(() => { throw new Error('对话不存在'); });
    await expect(session.chat('sc', 'on', 'tX', 'msg', () => {})).rejects.toThrow('对话不存在');
    expect(orchestrator.execute).not.toHaveBeenCalled();
    expect(threadStore.appendMessages).not.toHaveBeenCalled();
  });
});
