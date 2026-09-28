/**
 * MessageList 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 被测职责是**按 role 路由消息**（user / assistant / toolResult / subtask / summary），
 * 因此把子块（SubtaskBlock / NarrativeBlock）替换为探针组件——它们的内部渲染不属于本组件职责。
 * 覆盖点：各类消息渲染、空消息、assistant 空内容是否渲染、流式末尾态、复制按钮。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./SubtaskBlock', () => ({
  default: ({ item }: any) => <div data-testid="subtask-block">{item.displayName}</div>,
}));
vi.mock('./NarrativeBlock', () => ({
  default: ({ item }: any) => <div data-testid="narrative">{item.content}</div>,
}));

import MessageList from './MessageList';
import type { ChatMessage } from './chat-types';

const userMsg = (content: string): ChatMessage =>
  ({ role: 'user', content, timestamp: '2026-09-28T10:00:00.000Z' } as ChatMessage);
const assistantMsg = (content: string, extra: Record<string, unknown> = {}): ChatMessage =>
  ({ role: 'assistant', content, timestamp: '2026-09-28T10:00:01.000Z', ...extra } as ChatMessage);

function setup(messages: ChatMessage[], sending = false) {
  return render(<MessageList messages={messages} sending={sending} />);
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('MessageList — 属性传递', () => {
  it('渲染用户消息正文与头像', () => {
    setup([userMsg('查一下高强度钢板库存')]);
    expect(screen.getByText('查一下高强度钢板库存')).toBeInTheDocument();
    // 用户气泡右侧头像（icon 以 role=img 暴露）
    expect(document.querySelectorAll('.anticon-user').length).toBe(1);
  });

  it('渲染 assistant 正文（走 markdown 渲染，气泡内可见文本）', () => {
    setup([assistantMsg('库存充足')]);
    expect(screen.getByText('库存充足')).toBeInTheDocument();
  });

  it('assistant 带 narrative 时同时渲染思考区（探针组件收到内容）', () => {
    setup([assistantMsg('', { narrative: '正在分析…', narrativeStreaming: true })]);
    expect(screen.getByTestId('narrative')).toHaveTextContent('正在分析…');
  });

  it('toolResult 渲染为可展开的「工具返回数据」块', () => {
    setup([{ role: 'toolResult', content: '{"a":1}', timestamp: '' } as ChatMessage]);
    expect(screen.getByText(/工具返回数据/)).toBeInTheDocument();
  });

  it('subtask 消息交给子任务块渲染（保持无头像对齐）', () => {
    setup([{ role: 'subtask', seq: 1, displayName: '查库存', details: [] } as unknown as ChatMessage]);
    expect(screen.getByTestId('subtask-block')).toHaveTextContent('查库存');
    expect(document.querySelectorAll('.anticon-user').length).toBe(0);
    expect(document.querySelectorAll('.anticon-robot').length).toBe(0);
  });

  it('抄送时间戳展示在用户气泡内（本地时间字符串）', () => {
    setup([userMsg('你好')]);
    expect(screen.getByText(/^\d{1,2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });
});

describe('MessageList — 事件触发', () => {
  it('点击复制按钮把正文写入剪贴板', async () => {
    setup([assistantMsg('要复制的内容')]);
    // 复制按钮是最后一条 assistant 的 tooltip 内按钮，按 icon 定位
    const copyBtn = document.querySelector('.anticon-copy')!.closest('button') as HTMLButtonElement;
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('要复制的内容');
  });
});

describe('MessageList — 边界条件', () => {
  it('空消息数组不渲染任何气泡', () => {
    const { container } = setup([]);
    expect(container.querySelectorAll('.anticon-user').length).toBe(0);
    expect(container.querySelectorAll('.anticon-robot').length).toBe(0);
  });

  it('summary 角色不展示（仅作后端上下文）', () => {
    setup([{ role: 'summary', content: '短期记忆摘要', timestamp: '' } as unknown as ChatMessage]);
    expect(screen.queryByText('短期记忆摘要')).not.toBeInTheDocument();
  });

  it('assistant 空内容且非末尾时不渲染气泡（规划期只留思考区）', () => {
    setup([assistantMsg('', { runId: 1 }), assistantMsg('最终总结', { runId: 1 })]);
    // 只有最后一条 assistant 有气泡 => 机器人头像仅 1 个
    expect(document.querySelectorAll('.anticon-robot').length).toBe(1);
  });

  it('assistant 空内容但是在末尾时渲染转圈占位', () => {
    const { container } = setup([assistantMsg('', { runId: 1 })]);
    expect(container.querySelectorAll('.ant-spin').length).toBeGreaterThan(0);
  });

  it('流式输出中且是末尾消息时显示「正在输出...」', () => {
    setup([assistantMsg('部分内容', { runId: 1 })], true);
    expect(screen.getByText('正在输出...')).toBeInTheDocument();
  });

  it('非末尾消息即使 sending 也不显示「正在输出...」', () => {
    setup([assistantMsg('历史内容'), assistantMsg('', { runId: 2 })], true);
    expect(screen.queryByText('正在输出...')).not.toBeInTheDocument();
  });

  it('点击工具返回块可切换详情展开（此处曾因取错兄弟节点而失效）', () => {
    setup([{ role: 'toolResult', content: '{"a":1}', timestamp: '' } as ChatMessage]);
    const toggle = screen.getByText(/工具返回数据/).closest('div') as HTMLElement;
    const detail = document.getElementById('tool-result-0') as HTMLElement;
    expect(detail.className).toContain('hidden');
    fireEvent.click(toggle);
    expect(detail.classList.contains('hidden')).toBe(false);
    fireEvent.click(toggle);
    expect(detail.classList.contains('hidden')).toBe(true);
  });
});
