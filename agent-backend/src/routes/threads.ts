import { Router, Request, Response } from 'express';
import { ThreadStore } from '../services/thread-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { AgentFactory } from '../agent/agent-factory.js';
import type { ThreadMessage, SSEEvent } from '../types.js';
import { ForbiddenError } from '../security/path-access-controller.js';

export function createThreadsRouter(
  threadStore: ThreadStore,
  skillLoader: SkillLoader,
  agentFactory: AgentFactory,
): Router {
  const router = Router();

  // ─── 线程 CRUD ─────────────────────────────────

  /** GET — 线程列表 */
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

  /** POST — 创建新线程 */
  router.post('/onto_market/:scenario/:ontology/threads', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const { title, skill_names } = req.body as { title: string; skill_names: string[] };
      const thread = threadStore.create(scenario, ontology, title || '新对话', skill_names || []);
      res.status(201).json(thread);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /** GET — 读取线程 */
  router.get('/onto_market/:scenario/:ontology/threads/:tid', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const tid = req.params.tid as string;
      const thread = threadStore.get(scenario, ontology, tid);
      res.json(thread);
    } catch (e: any) {
      if (e instanceof ForbiddenError) {
        res.status(404).json({ error: e.message });
      } else {
        res.status(400).json({ error: e.message });
      }
    }
  });

  /** DELETE — 删除线程 */
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

  // ─── Chat SSE ──────────────────────────────────

  /**
   * POST — 发送消息，返回 SSE 流式响应
   *
   * 流程：
   * 1. 加载历史消息 + 技能文件
   * 2. 用 pi-agent-core SDK 创建 Agent
   * 3. 订阅 Agent 事件流
   * 4. 发送 prompt
   * 5. 将事件流转为 SSE 推送给前端
   * 6. 保存消息到 thread
   */
  router.post('/onto_market/:scenario/:ontology/threads/:tid/chat', async (req: Request, res: Response) => {
    const scenario = req.params.scenario as string;
    const ontology = req.params.ontology as string;
    const tid = req.params.tid as string;
    const { message, ontology_id } = req.body as { message: string; ontology_id?: number };

    if (!message || !message.trim()) {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }

    if (!ontology_id) {
      res.status(400).json({ error: '缺少 ontology_id' });
      return;
    }

    // 校验线程存在
    if (!threadStore.exists(scenario, ontology, tid)) {
      res.status(404).json({ error: '对话不存在' });
      return;
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 发送 SSE 事件的辅助函数
    const sendEvent = (event: SSEEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      // 1. 获取历史消息
      const thread = threadStore.get(scenario, ontology, tid);
      const history: ThreadMessage[] = thread.messages || [];

      // 2. 创建 Agent
      const agent = await agentFactory.createAgent(thread.skill_names, history, scenario, ontology, ontology_id);

      // 4. 订阅 agent 事件流，收集 assistant 回复
      const assistantMessage: ThreadMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };

      agent.subscribe((event: any) => {
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          const token = event.assistantMessageEvent.delta || '';
          assistantMessage.content += token;
          sendEvent({ type: 'token', token });
        } else if (event.type === 'tool_execution_start') {
          sendEvent({ type: 'tool_start', name: event.toolName });
        } else if (event.type === 'tool_execution_end') {
          const resultText = event.result?.content
            ?.map((c: any) => ('text' in c ? c.text : ''))
            .filter(Boolean)
            .join('\n') || '';
          sendEvent({ type: 'tool_end', name: event.toolName, result: resultText });
        }
      });

      // 5. 发送 prompt
      await agent.prompt(message);

      // 6. 保存消息
      const userMessage: ThreadMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };
      threadStore.appendMessages(scenario, ontology, tid, [userMessage, assistantMessage]);

      sendEvent({ type: 'done' });
    } catch (e: any) {
      sendEvent({ type: 'error', message: e.message || '请求失败' });
    } finally {
      res.end();
    }
  });

  return router;
}
