/**
 * chat-types 单测 —— 消息结构与类型守卫（2026-10-06 补，宪法 III）。
 *
 * ## 为什么必须有
 *
 * 两个守卫（`isAssistantMessage` / `isSubtaskItem`）是**全仓类型收窄的唯一依据**。
 * `chat-types.ts` 自身的历史说明：此前用交叉类型内联定义 `role`，导致
 * `Extract<..., { role: 'assistant' }>` 收窄得到 `never`，于是全屏`as any`。
 * 守卫一旦失准（该 true 时 false），表现为「运行时走错分支」且**编译器不报错**——
 * 例如把子任务块当assistant 消息处理，就会去读它不存在的 `content`。
 *
 * 该文件此前零测试、且不在覆盖率门禁内。
 */
import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@/api/agent-client';
import type { AssistantChatMessage, ChatMessage, SubtaskChatItem } from './chat-types';
import { isAssistantMessage, isSubtaskItem } from './chat-types';

/** 构造 user 消息（AgentMessage 联合里 role 为字面量的分支） */
const userMsg = (content: string): AgentMessage => ({ role: 'user', content, timestamp: '2026-10-06T00:00:00Z' });

/** 构造 assistant 运行时消息 */
const asstMsg = (over: Partial<AssistantChatMessage> = {}): AssistantChatMessage =>
  ({ role: 'assistant', content: '', timestamp: '', ...over });

/** 构造子任务执行块 */
const subMsg = (over: Partial<SubtaskChatItem> = {}): SubtaskChatItem =>
  ({ role: 'subtask', runId: 1, seq: 1, behavior: 'B1', status: 'running', details: [], ...over });

describe('isAssistantMessage', () => {
  it('assistant 消息 → true', () => {
    expect(isAssistantMessage(asstMsg({ content: '你好' }))).toBe(true);
  });

  it('user 消息 → false（不误判）', () => {
    expect(isAssistantMessage(userMsg('问'))).toBe(false);
  });

  it('子任务块 → false（关键：它没有 content，误判会导致读 undefined）', () => {
    expect(isAssistantMessage(subMsg())).toBe(false);
  });

  it('收窄后可直接访问 assistant 专属字段（narrative / narrativeStreaming）', () => {
    const m = asstMsg({ content: 'x', narrative: '思考', narrativeStreaming: true });
    if (isAssistantMessage(m)) {
      // 收窄生效则这些字段可直接访问，无需任何断言
      expect(m.narrative).toBe('思考');
      expect(m.narrativeStreaming).toBe(true);
    } else {
      throw new Error('收窄失败：assistant 消息未被守卫识别');
    }
  });
});

describe('isSubtaskItem', () => {
  it('子任务块 → true', () => {
    expect(isSubtaskItem(subMsg())).toBe(true);
  });

  it('assistant 消息 → false', () => {
    expect(isSubtaskItem(asstMsg())).toBe(false);
  });

  it('user 消息 → false', () => {
    expect(isSubtaskItem(userMsg('问'))).toBe(false);
  });

  it('收窄后可直接访问子任务专属字段（seq / behavior / details）', () => {
    const m = subMsg({ details: [{ time: 't', type: 'subtask_start', name: 'B1', status: 'running' }] });
    if (isSubtaskItem(m)) {
      expect(m.seq).toBe(1);
      expect(m.behavior).toBe('B1');
      expect(m.details).toHaveLength(1);
    } else {
      throw new Error('收窄失败：子任务块未被守卫识别');
    }
  });
});

describe('ChatMessage 联合的三种形态', () => {
  const all: ChatMessage[] = [userMsg('问'), asstMsg({ content: '答' }), subMsg()];

  it('每个守卫恰好命中其对应形态（三个守卫构成完备划分）', () => {
    const flags = all.map(m => ({
      asst: isAssistantMessage(m),
      sub: isSubtaskItem(m),
    }));
    expect(flags).toEqual([
      { asst: false, sub: false }, // user：两个守卫都不命中
      { asst: true, sub: false },
      { asst: false, sub: true },
    ]);
  });

  it('assistant 与 subtask 互斥（任一消息不可能同时是两者）', () => {
    for (const m of all) {
      expect(isAssistantMessage(m) && isSubtaskItem(m)).toBe(false);
    }
  });

  it('toolResult 消息：两个守卫都不命中（它有自己的渲染分支）', () => {
    const toolResult: ChatMessage = { role: 'toolResult', content: '{}', timestamp: '' };
    expect(isAssistantMessage(toolResult)).toBe(false);
    expect(isSubtaskItem(toolResult)).toBe(false);
  });

  it('summary 消息（短期记忆摘要，聊天区不展示）同样不命中两个守卫', () => {
    const summary = { role: 'summary', content: '摘要', timestamp: '' } as unknown as ChatMessage;
    expect(isAssistantMessage(summary)).toBe(false);
    expect(isSubtaskItem(summary)).toBe(false);
  });
});