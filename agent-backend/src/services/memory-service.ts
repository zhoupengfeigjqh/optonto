/**
 * MemoryService —— 短期记忆门面：按规则压缩对话历史（纯逻辑在 history-compressor），生成摘要。
 *
 * 职责：prepareHistory —— 压缩历史（50 条截断 / 30min 断点 / 30 条兜底），生成摘要写回线程，
 *       返回压缩后的消息供上层写回线程 + 喂给父Agent。
 *
 * 注：长期记忆（任务记忆/工作总结）已移除；此处只保留短期记忆。
 */
import type { ThreadMessage } from '../types.js';
import { askLLM } from './llm.js';
import { compressHistory } from './history-compressor.js';

/** 短期摘要：压缩历史为一段背景摘要 */
const SUMMARY_SYSTEM = `你是对话摘要助手。把用户提供的对话历史压缩成一段简洁的中文背景摘要。
保留：关键业务事实、已执行的写操作及产生的实体ID/编号、当前状态、用户意图和未完成事项。
不要编造不存在的信息。控制在 300 字以内，直接输出摘要文本，不要任何标记或解释。`;

const MAX_SUMMARY_INPUT = 20_000;

export class MemoryService {
  /**
   * 压缩历史并（如需）生成摘要。返回压缩后的消息 + 是否产出了摘要。
   * 压缩成功（摘要非空）时，上层应将返回的 messages 写回线程（replaceMessages），
   * 并以此作为父Agent 上下文（summary 前置为历史背景）。
   */
  async prepareHistory(messages: ThreadMessage[]): Promise<{ messages: ThreadMessage[]; summary: string | null }> {
    const { kept, toSummarize } = compressHistory(messages);
    if (toSummarize.length === 0) return { messages, summary: null };

    let summary = '';
    try {
      summary = await this.generateSummary(toSummarize);
    } catch (e: any) {
      console.error(`[memory] 摘要生成失败: ${e?.message || e}`);
    }
    if (!summary.trim()) return { messages, summary: null };

    const summaryMsg: ThreadMessage = {
      role: 'summary',
      content: summary.trim(),
      timestamp: toSummarize[0]?.timestamp ?? '',
    };
    return { messages: [summaryMsg, ...kept], summary };
  }

  private async generateSummary(messages: ThreadMessage[]): Promise<string> {
    const text = messages
      .map(m => `[${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '历史摘要'}] ${m.content}`)
      .join('\n');
    return askLLM(SUMMARY_SYSTEM, `以下是历史对话：\n${text.slice(-MAX_SUMMARY_INPUT)}\n\n请输出压缩摘要：`);
  }
}
