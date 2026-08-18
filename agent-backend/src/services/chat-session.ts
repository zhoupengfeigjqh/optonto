/**
 * ChatSession —— 一轮对话的完整生命周期（深 module）：
 *  ① 读线程历史 → 短期记忆压缩（生成摘要则写回线程，压缩后的消息喂编排）
 *  ② 交给 Orchestrator 执行（父/子 Agent 编排）
 *  ③ 本轮 user/assistant 消息持久化回线程
 *
 * 路由层（routes/threads.ts）只做 HTTP 适配（SSE 头、参数校验、res.end），
 * 对话业务全部收在这里——记忆策略的触发点与压缩规则重逢（locality），
 * 且对话流程可脱离 HTTP 经 chat() 接口直接单测（interface 即测试面）。
 */
import type { ThreadStore } from './thread-store.js';
import type { MemoryService } from './memory-service.js';
import type { Orchestrator } from '../agent/orchestrator.js';
import type { ThreadMessage, SSEEvent } from '../types.js';

export class ChatSession {
  constructor(
    private threadStore: ThreadStore,
    private memoryService: MemoryService,
    private orchestrator: Orchestrator,
  ) {}

  /**
   * 执行一轮对话，返回 assistant 回复文本（编排结果）。
   * 线程不存在等错误向上抛，由路由统一映射为 SSE error 事件。
   */
  async chat(
    scenario: string,
    ontology: string,
    tid: string,
    message: string,
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    const thread = this.threadStore.get(scenario, ontology, tid);
    let history: ThreadMessage[] = thread.messages || [];

    // 短期记忆：压缩历史（生成摘要则写回线程，压缩后的消息喂父Agent 上下文）。
    // 压缩失败不阻断对话——走原始历史（降级策略与记忆模块内聚，路由不感知）。
    try {
      const prepared = await this.memoryService.prepareHistory(history);
      if (prepared.summary !== null) {
        this.threadStore.replaceMessages(scenario, ontology, tid, prepared.messages);
        history = prepared.messages;
      }
    } catch (e: any) {
      console.error(`[chat] 历史压缩失败（忽略，走原始历史）: ${e?.message || e}`);
    }

    const result = await this.orchestrator.execute(message, thread.skill_names, history, sendEvent);

    const userMsg: ThreadMessage = { role: 'user', content: message, timestamp: new Date().toISOString() };
    const asstMsg: ThreadMessage = { role: 'assistant', content: result, timestamp: new Date().toISOString() };
    this.threadStore.appendMessages(scenario, ontology, tid, [userMsg, asstMsg]);
    return result;
  }
}
