/**
 * ConversationChat 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 本组件在本轮新增的职责是**消费压缩相关 SSE 事件**：
 * - `status` → 归档进度提示（不进消息正文）
 * - `error`  → 错误横幅（不再伪装成助手回复落 messages）
 * - `archived_rounds` → 刷新「前 N 轮已归档」徽标
 * 因此测试手段是「喂一段可控的 SSE 事件流，断言界面落到正确状态」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  getThread: vi.fn(),
  chatStream: vi.fn(),
  clearChat: vi.fn(),
  exportThread: vi.fn(),
  validateAnalysis: vi.fn(),
}));
vi.mock('@/lib/markdown', () => ({ renderMarkdown: (text: string) => text }));

import ConversationChat from './ConversationChat';
import * as api from '@/api/client';

const encoder = new TextEncoder();

/** 手动可控的 SSE 流：用于在「流未结束」时断言中间态（status 提示）。 */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    stream,
    push(event: object) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n`));
    },
    close() { controller.close(); },
  };
}

const okResponse = (stream: ReadableStream<Uint8Array>) => ({ ok: true, body: stream }) as unknown as Response;

function thread(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: '需求对话',
    status: 'exploring',
    created_at: '',
    updated_at: '',
    messages: [{ role: 'user', content: '我们做供应链', timestamp: '' }],
    ...over,
  } as any;
}

function setup() {
  const props = { threadId: 't1', onBack: vi.fn(), scenarioName: '生产调度', ontologyName: '原材料采购和库存' };
  render(<ConversationChat {...props} />);
  return props;
}

/** 输入并发送一条消息（antd 对「图标+2 个汉字」不插空格，用正则匹配） */
async function send(text: string) {
  const textarea = await screen.findByPlaceholderText('输入您的需求或问题... (Shift+Enter 换行)');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
}

beforeEach(() => {
  vi.mocked(api.getThread).mockResolvedValue(thread());
});

describe('ConversationChat 上下文归档展示', () => {
  it('无 context 时不显示归档徽标', async () => {
    setup();
    await screen.findByText('需求对话');
    expect(screen.queryByText(/轮已归档/)).toBeNull();
  });

  it('有 context 时显示「前 N 轮已归档」，点击可查看摘要', async () => {
    vi.mocked(api.getThread).mockResolvedValue(thread({
      context: { summary: '【业务对象与概念】订单', covered_until: 60, archived_rounds: 30, summary_tokens: 120 },
    }));
    setup();

    const badge = await screen.findByText(/前 30 轮已归档/);
    fireEvent.click(badge);

    expect(await screen.findByText('已归档的历史摘要')).toBeTruthy();
    expect(await screen.findByText('【业务对象与概念】订单')).toBeTruthy();
  });

  it('covered_until 为 0 时不显示徽标（空摘要不算归档）', async () => {
    vi.mocked(api.getThread).mockResolvedValue(thread({
      context: { summary: '', covered_until: 0, archived_rounds: 0 },
    }));
    setup();
    await screen.findByText('需求对话');
    expect(screen.queryByText(/轮已归档/)).toBeNull();
  });
});

describe('ConversationChat 压缩相关 SSE 事件', () => {
  it('status 事件显示整理提示，结束后清除且不进入消息正文', async () => {
    const s = controlledStream();
    vi.mocked(api.chatStream).mockResolvedValue(okResponse(s.stream));
    setup();
    await screen.findByText('需求对话');

    await send('继续');
    s.push({ status: '正在整理更早的对话…', done: false });

    expect(await screen.findByText('正在整理更早的对话…')).toBeTruthy();

    s.push({ token: '好的', done: false });
    s.close();

    await waitFor(() => expect(screen.queryByText('正在整理更早的对话…')).toBeNull());
    expect(screen.queryByText(/正在整理更早的对话…/)).toBeNull();
  });

  it('error 事件走错误横幅，不伪装成助手回复', async () => {
    const s = controlledStream();
    vi.mocked(api.chatStream).mockResolvedValue(okResponse(s.stream));
    setup();
    await screen.findByText('需求对话');

    await send('继续');
    s.push({ error: 'context length exceeded', done: false });
    s.close();

    expect(await screen.findByText(/调用出错：context length exceeded/)).toBeTruthy();
    // 错误文本不得进入消息气泡
    expect(screen.queryByText(/\[错误:/)).toBeNull();
  });

  it('archived_rounds 事件触发归档状态刷新', async () => {
    vi.mocked(api.getThread)
      .mockResolvedValueOnce(thread())
      .mockResolvedValue(thread({
        context: { summary: '【规则与约束】无', covered_until: 62, archived_rounds: 31, summary_tokens: 80 },
      }));
    const s = controlledStream();
    vi.mocked(api.chatStream).mockResolvedValue(okResponse(s.stream));
    setup();
    await screen.findByText('需求对话');

    await send('继续');
    s.push({ status: '已归档前 31 轮对话', archived_rounds: 31, done: false });
    s.push({ token: '继续', done: false });
    s.close();

    expect(await screen.findByText(/前 31 轮已归档/)).toBeTruthy();
  });
});
