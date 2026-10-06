/**
 * text-utils 单测 —— 文本提取（content 块解析的单一事实源）。
 *
 * 该文件此前无任何测试。本文件按「每条分支都要被执行验证」的原则覆盖三类输入形态：
 * 字符串 / 块数组 / 其他（undefined、null、数字、对象）。
 *
 * 为什么值得单独测：这三个函数是**全仓所有文本取值的收口**
 * （orchestrator 取父Agent 最后回复、子任务结果提取、工具结果拼接都用它们）。
 * 一旦解析出错，表现是「模型明明回复了但界面空白」，且难以定位。
 */
import { describe, it, expect } from 'vitest';
import { contentToText, toolResultToText, getLastAssistantMessage } from './text-utils.js';

describe('contentToText', () => {
  it('字符串形态 → 原样返回（最常见：多数模型返回纯字符串）', () => {
    expect(contentToText('你好')).toBe('你好');
  });

  it('空字符串 → 空串（不为 undefined）', () => {
    expect(contentToText('')).toBe('');
  });

  it('块数组 → 顺序拼接各块 text', () => {
    expect(contentToText([{ text: '第一段' }, { text: '第二段' }])).toBe('第一段第二段');
  });

  it('块数组含无 text 的块 → 该块取空串，不产生 "undefined" 字样', () => {
    expect(contentToText([{ text: 'A' }, { type: 'image' }, { text: 'B' }])).toBe('AB');
  });

  it('text 为空串的块 → 视为空', () => {
    expect(contentToText([{ text: '' }, { text: 'X' }])).toBe('X');
  });

  it('空数组 → 空串', () => {
    expect(contentToText([])).toBe('');
  });

  it('非字符串非数组（undefined / null / 数字 / 对象）→ 空串而非抛错', () => {
    expect(contentToText(undefined)).toBe('');
    expect(contentToText(null)).toBe('');
    expect(contentToText(42)).toBe('');
    expect(contentToText({ text: 'x' })).toBe('');
  });
});

describe('toolResultToText', () => {
  it('多块文本 → 换行拼接（可读性优先于紧凑）', () => {
    expect(toolResultToText([{ text: '行1' }, { text: '行2' }])).toBe('行1\n行2');
  });

  it('含非文本块（如 image / resource）→ 跳过，不产出空行', () => {
    expect(toolResultToText([{ text: 'A' }, { type: 'image' }, { text: 'B' }])).toBe('A\nB');
  });

  it('含 text 为空串的块 → 被 filter(Boolean) 剔除（不留空行）', () => {
    expect(toolResultToText([{ text: 'A' }, { text: '' }, { text: 'B' }])).toBe('A\nB');
  });

  it('undefined → 空串（MCP 工具无内容时的常见形态）', () => {
    expect(toolResultToText(undefined)).toBe('');
  });

  it('空数组 → 空串', () => {
    expect(toolResultToText([])).toBe('');
  });

  it('全部为非文本块 → 空串', () => {
    expect(toolResultToText([{ type: 'image' }])).toBe('');
  });
});

describe('getLastAssistantMessage', () => {
  it('取最后一条 assistant 消息的文本', () => {
    const msgs = [
      { role: 'user', content: '问1' },
      { role: 'assistant', content: '答1' },
      { role: 'user', content: '问2' },
      { role: 'assistant', content: '答2' },
    ];
    expect(getLastAssistantMessage(msgs)).toBe('答2');
  });

  it('末尾是 user → 向前找到最近的 assistant（不是返回空）', () => {
    const msgs = [
      { role: 'assistant', content: '答1' },
      { role: 'user', content: '问2' },
    ];
    expect(getLastAssistantMessage(msgs)).toBe('答1');
  });

  it('带 errorMessage 的消息视为失败答复 → 跳过继续往前找', () => {
    const msgs = [
      { role: 'assistant', content: '正常答复' },
      { role: 'assistant', content: '报错内容', errorMessage: 'LLM 503' },
    ];
    expect(getLastAssistantMessage(msgs)).toBe('正常答复');
  });

  it('assistant 内容为块数组 → 走contentToText 解析', () => {
    const msgs = [{ role: 'assistant', content: [{ text: '块' }, { text: '式' }] }];
    expect(getLastAssistantMessage(msgs)).toBe('块式');
  });

  it('无 assistant 消息 → 空串', () => {
    expect(getLastAssistantMessage([{ role: 'user', content: '只有提问' }])).toBe('');
  });

  it('空数组 → 空串', () => {
    expect(getLastAssistantMessage([])).toBe('');
  });

  it('assistant 存在但内容为空 → 返回空串而非 undefined', () => {
    expect(getLastAssistantMessage([{ role: 'assistant', content: '' }])).toBe('');
  });
});