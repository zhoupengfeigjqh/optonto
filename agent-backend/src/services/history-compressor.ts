/**
 * 短期记忆 —— 对话历史压缩规则（纯函数，无 I/O、无 LLM）。
 *
 * 规则（依次应用，最终形态：summary + 最近 ≤30 条原文）：
 *  1. 历史 >50 条：截断 50 条前（不进上下文，不摘要）
 *  2. 在 50 条窗口内找相邻消息间隔 >30min 的【最近】断点；
 *     若断点之后 ≤30 条 → 断点之前压缩成 summary
 *  3. 规则 2 不采用（无断点 / 断点后 >30 条）→ 保留最近 30 条原文，30 条之前压缩
 */
import type { ThreadMessage } from '../types.js';

const MAX_WINDOW = 50;
const KEEP_TAIL = 30;
const GAP_MS = 30 * 60 * 1000;

export interface CompressResult {
  /** 保留的原文尾部 */
  kept: ThreadMessage[];
  /** 需要 LLM 生成摘要的压缩区原文（空 = 无需压缩）。摘要消息由上层组装：
   *  role=summary、时间戳取压缩区首条（便于后续断点判定）——见 memory-service */
  toSummarize: ThreadMessage[];
}

/** 解析消息时间戳，非法返回 0 */
function ts(m: ThreadMessage): number {
  const t = Date.parse(m.timestamp);
  return Number.isFinite(t) ? t : 0;
}

export function compressHistory(messages: ThreadMessage[]): CompressResult {
  const n = messages.length;
  if (n <= KEEP_TAIL) {
    return { kept: messages, toSummarize: [] };
  }

  // 规则1：> MAX_WINDOW 截断前部（太旧，不进上下文也不摘要）
  const window = n > MAX_WINDOW ? messages.slice(n - MAX_WINDOW) : messages;

  // 规则2：自右向左找最近的 >30min 断点；断点后 ≤30 条则采用，否则放弃（更早断点尾部更长，必不满足）
  let cutoff = -1;
  for (let i = window.length - 2; i >= 0; i--) {
    const t1 = ts(window[i]);
    const t2 = ts(window[i + 1]);
    if (t1 && t2 && t2 - t1 > GAP_MS) {
      if (window.length - (i + 1) <= KEEP_TAIL) cutoff = i;
      break;
    }
  }

  // 规则3：无适用断点 → 保留最近 30 条，之前压缩
  const splitAt = cutoff >= 0 ? cutoff : window.length - KEEP_TAIL - 1;
  const toSummarize = window.slice(0, splitAt + 1);
  const kept = window.slice(splitAt + 1);
  return { kept, toSummarize };
}
