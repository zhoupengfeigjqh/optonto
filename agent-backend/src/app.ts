/**
 * Express 应用装配 —— 自 `index.ts` 抽取（2026-10-05，宪法 III 可测性改造）。
 *
 * ## 为什么抽
 *
 * 原 `index.ts` 在模块顶层完成「装配 + `app.listen()`」，于是：
 *  - `import` 该模块即启动监听 → 测试无法安全引入；
 *  - 宪法 III 要求「每个接口（端点）MUST 有集成测试」，而 `/health` 与
 *    `/agent-api/health` 两个端点此前**无任何测试**，根因就是它们无法被测。
 *
 * 拆成「纯装配的 `createApp()`」+「只做启动的 `index.ts`」后：
 *  - 组件装配（含全部路由与中间件注册）可被 supertest 直接驱动；
 *  - `index.ts` 回归为进程入口，监听行为不变。
 *
 * 本 module **不产生任何副作用**（不监听、不读配置、不建连接）——
 * 依赖全部由调用方注入，测试可整体替换。
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { PathAccessController } from './security/path-access-controller.js';
import { ThreadStore } from './services/thread-store.js';
import { SkillLoader } from './services/skill-loader.js';
import { MCPConfigStore } from './services/mcp-config-store.js';
import { AgentFactory } from './agent/agent-factory.js';
import { Orchestrator } from './agent/orchestrator.js';
import { OntologyGateway } from './services/ontology-gateway.js';
import { VisibilityGuard } from './services/visibility-guard.js';
import { MemoryService } from './services/memory-service.js';
import { ChatSession } from './services/chat-session.js';
import { createThreadsRouter } from './routes/threads.js';
import { createSkillsRouter } from './routes/skills.js';
import { createMCPConfigRouter } from './routes/mcp-config.js';

/** 装配所需的依赖（测试可整体替换，避免真实磁盘/网络） */
export interface AppDeps {
  threadStore: ThreadStore;
  skillLoader: SkillLoader;
  mcpConfigStore: MCPConfigStore;
  orchestrator: Orchestrator;
  chatSession: ChatSession;
}

/**
 * 按真实依赖装配 Express app（含全部路由与全局错误兜底）。
 *
 * 路由挂载前缀 `apiPrefix = '/agent-api'` 与 `index.ts` 保持一致；
 * `/health` 挂在根路径（容器健康检查用），`/agent-api/health` 是同处理函数的别名。
 */
export function createApp(deps: AppDeps): Express {
  const { threadStore, skillLoader, mcpConfigStore, orchestrator, chatSession } = deps;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // 健康检查（2026-10-05 审查 M9：两个端点响应体曾逐字重复 → 收敛为同一处理函数）
  const healthHandler = (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  };
  app.get('/health', healthHandler);
  app.get('/agent-api/health', healthHandler);

  // ─── 挂载路由 ────────────────────────────────────
  const apiPrefix = '/agent-api';
  app.use(apiPrefix, createSkillsRouter(skillLoader));
  app.use(apiPrefix, createMCPConfigRouter(mcpConfigStore));
  app.use(apiPrefix, createThreadsRouter(threadStore, orchestrator, chatSession));

  // ─── 统一错误兜底（章程 VI）────────────────────────
  // 未捕获异常一律输出结构化错误体，避免 Express 默认 HTML 错误页造成前后端契约不一致。
  //
  // 2026-10-05（agent 环节审查 M6）修正：错误体三字段（message/detail/error）曾**同值固定文案**
  // ——code 恒 500、message 恒「服务器内部错误」，等于没有可读错误（宪法 VI 要求
  // 「稳定错误码 + 可读 message」）。现：code 稳定、message 对外可读、detail 带**原始错误消息**
  // 便于定位；原始错误对象始终落服务端日志（含 stack），不外泄堆栈/内部路径。
  //
  // 说明：本中间件是**最后一道兜底**——各路由按宪法 II/III 的分层要求自行 try/catch 并转
  // 400/404，故正常路径不会走到这里；保留它是为了防止新增路由漏写 catch 时退回 Express 默认
  // HTML 错误页（那会直接破坏前后端契约一致性）。
  app.use(errorHandler);

  return app;
}

/**
 * 统一错误兜底中间件（导出以便单测）。
 *
 * 注意它在 `createApp` 内的注册位置：**必须在全部路由之后**（Express 的错误中间件
 * 只捕获其之后注册的路由所抛的异常）。当前各路由均自行 try/catch 并转 400/404，
 * 故此中间件在现有路由下**不会被触发**——它是防止将来新增路由漏写 catch 的护栏。
 * 因此它无法用「构造一个会抛错的真实路由」来集成测试（后注册的路由不在其捕获范围内），
 * 只能直接调用做单测。
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  void next; // 四参数签名是 Express 判定错误中间件的唯一依据，勿删
  // 原始错误（含 stack）只进服务端日志：这是排查的唯一线索，不能被统一文案吞掉
  console.error('[agent-backend] 未处理异常:', err);
  if (res.headersSent) return;
  const detail = err instanceof Error ? err.message : String(err);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    detail,
  });
}

/** 按真实配置构建全套依赖并装配 app（`index.ts` 与集成测试的公共入口） */
export function createAppFromConfig(): Express {
  const pac = new PathAccessController(config.dataDir, config.threadsDir);
  const threadStore = new ThreadStore(pac);
  const skillLoader = new SkillLoader(pac);
  const mcpConfigStore = new MCPConfigStore(config.mcpConfigPath);
  const ontologyGateway = new OntologyGateway(pac);
  const visibilityGuard = new VisibilityGuard(pac);
  const agentFactory = new AgentFactory(mcpConfigStore, skillLoader, visibilityGuard);
  const orchestrator = new Orchestrator(agentFactory, ontologyGateway);
  const chatSession = new ChatSession(threadStore, new MemoryService(), orchestrator, skillLoader);
  return createApp({ threadStore, skillLoader, mcpConfigStore, orchestrator, chatSession });
}