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
import type { SkillLoader } from './skill-loader.js';
import type { Orchestrator } from '../agent/orchestrator.js';
import type { ThreadMessage, SSEEvent, OntologySelection } from '../types.js';
import { DEFAULT_THREAD_TITLE } from './thread-store.js';

/** 本体范围校验失败（选中的本体不存在或元数据缺失） */
export class OntologyScopeError extends Error {
  constructor(public readonly invalid: string[]) {
    super(`以下本体不存在或元数据缺失：${invalid.join('、')}`);
    this.name = 'OntologyScopeError';
  }
}

export class ChatSession {
  constructor(
    private threadStore: ThreadStore,
    private memoryService: MemoryService,
    private orchestrator: Orchestrator,
    private skillLoader: SkillLoader,
  ) {}

  /**
   * 校验本体范围并创建线程（2026-10-05，agent 环节审查 M9 / 宪法 II 分层）。
   *
   * 此前这段业务规则内联在 `routes/threads.ts` 的 POST handler 里：路由层直接调
   * `skillLoader.resolveOntologyContext`（本体语义解析属业务层）并自行拼装中文错误文案
   * ——违反宪法 II「接口层 MUST NOT 直接 import 数据访问层 / MUST 经业务层完成读写」。
   * 现下沉到本类：路由只做 HTTP 适配（取参、映射状态码），业务规则与错误文案在此单点收口。
   *
   * @throws OntologyScopeError 选中本体不存在或元数据缺失（空数组合法 = 通用问答模式）
   */
  createThread(scenario: string, ontology: string, title: string | undefined, scope: OntologySelection[]) {
    const bad = scope.filter(sel => !sel?.scenario || !sel?.ontology || !this.skillLoader.resolveOntologyContext(sel.scenario, sel.ontology));
    if (bad.length > 0) {
      throw new OntologyScopeError(bad.map(b => `${b?.scenario ?? '?'}/${b?.ontology ?? '?'}`));
    }
    return this.threadStore.create(scenario, ontology, title || DEFAULT_THREAD_TITLE, scope);
  }

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

    // 本体作用域一次性解析：所选本体 → 权威四元组（取自 ontology.yaml.metadata）+ 目录下全部技能（自动关联）。
    // 空范围 = 通用问答模式（父 Agent 不挂业务工具）。
    const scope = this.skillLoader.resolveScope(thread.ontology_scope || []);
    // 传 tid 供 /abort 做归属校验（多标签页/多会话下防跨会话误中断，2026-10-05 审查 M8）
    const result = await this.orchestrator.execute(message, scope, history, sendEvent, tid);

    const userMsg: ThreadMessage = { role: 'user', content: message, timestamp: new Date().toISOString() };
    const asstMsg: ThreadMessage = { role: 'assistant', content: result, timestamp: new Date().toISOString() };
    this.threadStore.appendMessages(scenario, ontology, tid, [userMsg, asstMsg]);
    return result;
  }
}
