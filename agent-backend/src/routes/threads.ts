import { Router, Request, Response } from 'express';
import { ThreadStore } from '../services/thread-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { ChatSession } from '../services/chat-session.js';
import { Orchestrator } from '../agent/orchestrator.js';
import type { SSEEvent } from '../types.js';
import { ForbiddenError } from '../security/path-access-controller.js';

export function createThreadsRouter(
  threadStore: ThreadStore,
  skillLoader: SkillLoader,
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
      res.status(400).json({ error: e.message });
    }
  });

  router.post('/onto_market/:scenario/:ontology/threads', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const { title, ontology_scope } = req.body as { title: string; ontology_scope?: { scenario: string; ontology: string }[] };
      const scope = ontology_scope || [];

      // 本体范围逐条校验：必须能解析到 core meta.json（选了不存在的本体 → 400 指出具体条目）。
      // 空数组合法——通用问答模式（父 Agent 不挂业务工具）。
      const bad = scope.filter(sel => !sel?.scenario || !sel?.ontology || !skillLoader.resolveOntologyContext(sel.scenario, sel.ontology));
      if (bad.length > 0) {
        res.status(400).json({ error: `以下本体不存在或元数据缺失：${bad.map(b => `${b?.scenario ?? '?'}/${b?.ontology ?? '?'}`).join('、')}` });
        return;
      }

      const thread = threadStore.create(scenario, ontology, title || '新对话', scope);
      res.status(201).json(thread);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
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
      if (e instanceof ForbiddenError) { res.status(404).json({ error: e.message }); }
      else { res.status(400).json({ error: e.message }); }
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
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Chat SSE + 安全管控确认 ──────────────────────

  router.post('/onto_market/:scenario/:ontology/threads/:tid/chat', async (req: Request, res: Response) => {
    const scenario = req.params.scenario as string;
    const ontology = req.params.ontology as string;
    const tid = req.params.tid as string;
    const { message } = req.body as { message: string };

    if (!message || !message.trim()) { res.status(400).json({ error: '消息不能为空' }); return; }
    if (!threadStore.exists(scenario, ontology, tid)) { res.status(404).json({ error: '对话不存在' }); return; }

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

  router.post('/abort', (_req: Request, res: Response) => {
    orchestrator.abort();
    res.json({ message: '已中断' });
  });

  router.post('/confirm/:confirmId', (req: Request, res: Response) => {
    const { approved } = req.body as { approved: boolean };
    orchestrator.handleConfirm(req.params.confirmId as string, approved);
    res.json({ message: 'ok' });
  });

  router.post('/plan-confirm/:confirmId', (req: Request, res: Response) => {
    const { approved, plan, rejectAction, suggestion } = req.body as { approved: boolean; plan?: any; rejectAction?: 'exit' | 'replan'; suggestion?: string };
    orchestrator.handlePlanConfirm(req.params.confirmId as string, approved, plan, { rejectAction, suggestion });
    res.json({ message: 'ok' });
  });

  return router;
}
