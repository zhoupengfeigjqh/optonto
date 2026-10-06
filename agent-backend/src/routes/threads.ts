import { Router, Request, Response } from 'express';
import { ThreadStore } from '../services/thread-store.js';
import { ChatSession } from '../services/chat-session.js';
import { Orchestrator } from '../agent/orchestrator.js';
import type { SSEEvent } from '../types.js';
import { ForbiddenError } from '../security/path-access-controller.js';
import { sendError } from '../utils/http-error.js';

export function createThreadsRouter(
  threadStore: ThreadStore,
  orchestrator: Orchestrator,
  chatSession: ChatSession,
): Router {
  const router = Router();

  // ─── 线程 CRUD ─────────────────────────────────

  router.get('/onto_market/:scenario/:ontology/threads', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const threads = threadStore.list(scenario, ontology);
      res.json(threads);
    } catch (e: any) {
      sendError(res, 400, e.message);
    }
  });

  router.post('/onto_market/:scenario/:ontology/threads', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const { title, ontology_scope } = req.body as { title?: string; ontology_scope?: { scenario: string; ontology: string }[] };
      // 本体范围校验与创建的业务规则已下沉到 ChatSession（宪法 II：路由只做 HTTP 适配）
      const thread = chatSession.createThread(scenario, ontology, title, ontology_scope || []);
      res.status(201).json(thread);
    } catch (e: any) {
      // 领域异常（本体范围非法）与其他客户端错误同属 400：请求本身不合法，不是服务端故障
      sendError(res, 400, e.message);
    }
  });

  router.get('/onto_market/:scenario/:ontology/threads/:tid', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const tid = req.params.tid as string;
      const thread = threadStore.get(scenario, ontology, tid);
      res.json(thread);
    } catch (e: any) {
      if (e instanceof ForbiddenError) { sendError(res, 404, e.message); }
      else { sendError(res, 400, e.message); }
    }
  });

  router.delete('/onto_market/:scenario/:ontology/threads/:tid', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const tid = req.params.tid as string;
      threadStore.delete(scenario, ontology, tid);
      res.json({ message: '已删除' });
    } catch (e: any) {
      // 归属不符（ForbiddenError）→ 404，与 GET 详情同口径：不泄露"线程存在但不属于当前本体"。
      // 该映射此前只存在于 GET，DELETE 一律 400 —— 前端因此无法区分两种失败（补端点测试时发现）。
      if (e instanceof ForbiddenError) { sendError(res, 404, e.message); }
      else { sendError(res, 400, e.message); }
    }
  });

  // ─── Chat SSE + 安全管控确认 ──────────────────────

  router.post('/onto_market/:scenario/:ontology/threads/:tid/chat', async (req: Request, res: Response) => {
    const scenario = req.params.scenario as string;
    const ontology = req.params.ontology as string;
    const tid = req.params.tid as string;
    const { message } = req.body as { message: string };

    if (!message || !message.trim()) { sendError(res, 400, '消息不能为空'); return; }
    if (!threadStore.exists(scenario, ontology, tid)) { sendError(res, 404, '对话不存在'); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event: SSEEvent) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };

    // 纯 HTTP 适配：对话生命周期（记忆压缩/编排/持久化）全部委托 ChatSession
    try {
      await chatSession.chat(scenario, ontology, tid, message, sendEvent);
    } catch (e: any) {
      sendEvent({ type: 'error', message: e.message || '请求失败' });
    } finally {
      res.end();
    }
  });

  /**
   * 中断当前 run（2026-10-05 C3/M8：不再让「没中断」伪装成「已中断」）。
   *
   * - 归属校验：body 带 `thread_id` 时必须与当前活动 run 所属线程一致，否则 409
   *   （多标签页/多用户场景下，A 会话的中断请求不得打断 B 会话正在跑的任务）。
   * - 无活动 run 时回 409 而非 200「已中断」——原实现会撒谎说中断成功，
   *   而实际什么都没发生，违反宪法 VI「失败 MUST 以错误表达」。
   */
  router.post('/abort', (req: Request, res: Response) => {
    const { thread_id } = (req.body ?? {}) as { thread_id?: string };
    if (thread_id !== undefined && typeof thread_id !== 'string') {
      sendError(res, 400, 'thread_id 必须是字符串'); return;
    }
    const r = orchestrator.abortRun(thread_id);
    if (r.aborted) { res.json({ message: '已中断' }); return; }
    if (r.reason === 'thread_mismatch') {
      sendError(res, 409, '中断请求与当前执行的任务不匹配（该任务属于其他会话）'); return;
    }
    sendError(res, 409, '当前没有正在执行的任务');
  });

  // ─── 确认回执（2026-10-05 C3：不再让「没生效」伪装成「已确认」）──
  // 确认请求是一次性的：答复后即从待确认表移除，超时/中断亦然。故 confirmId 未命中
  // 意味着「这次答复不会产生任何效果」——必须如实回 404，让调用方能提示用户重试或改用拒绝，
  // 而不是回 200 让前端以为已批准、实际后端仍在等 CONFIRM_TIMEOUT（60s）才按超时判失败。
  // 那种「状态真空」在写操作上尤其危险：用户以为已批准，系统实际已放弃。

  /** 回执公共部分：approved 必须是显式布尔（缺省/非布尔一律 400，不当拒绝处理） */
  function readApproved(res: Response, raw: unknown): boolean | null {
    if (typeof raw !== 'boolean') {
      sendError(res, 400, 'approved 必须是布尔值（true=批准 / false=拒绝）');
      return null;
    }
    return raw;
  }

  router.post('/confirm/:confirmId', (req: Request, res: Response) => {
    const approved = readApproved(res, (req.body as { approved?: unknown })?.approved);
    if (approved === null) return;
    const hit = orchestrator.handleConfirm(req.params.confirmId as string, approved);
    if (!hit) { sendError(res, 404, '该确认请求已失效（可能已超时、已中断或已被答复），本次答复未生效'); return; }
    res.json({ message: 'ok' });
  });

  router.post('/plan-confirm/:confirmId', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { approved?: unknown; plan?: any; rejectAction?: 'exit' | 'replan'; suggestion?: string };
    const approved = readApproved(res, body.approved);
    if (approved === null) return;
    if (body.rejectAction !== undefined && body.rejectAction !== 'exit' && body.rejectAction !== 'replan') {
      sendError(res, 400, 'rejectAction 只能是 exit 或 replan'); return;
    }
    const hit = orchestrator.handlePlanConfirm(req.params.confirmId as string, approved, body.plan, { rejectAction: body.rejectAction, suggestion: body.suggestion });
    if (!hit) { sendError(res, 404, '该规划确认请求已失效（可能已超时、已中断或已被答复），本次答复未生效'); return; }
    res.json({ message: 'ok' });
  });

  return router;
}
