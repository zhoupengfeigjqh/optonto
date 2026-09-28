import express, { type NextFunction, type Request, type Response } from 'express';
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

// ─── 初始化核心组件 ──────────────────────────────

const pac = new PathAccessController(config.dataDir, config.threadsDir);
const threadStore = new ThreadStore(pac);
const skillLoader = new SkillLoader(pac);
const mcpConfigStore = new MCPConfigStore(config.mcpConfigPath);

const ontologyGateway = new OntologyGateway(pac);
const visibilityGuard = new VisibilityGuard(pac);
const agentFactory = new AgentFactory(mcpConfigStore, skillLoader, visibilityGuard);
const orchestrator = new Orchestrator(agentFactory, ontologyGateway);
const memoryService = new MemoryService();
const chatSession = new ChatSession(threadStore, memoryService, orchestrator, skillLoader);

// ─── Express 应用 ────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/agent-api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 挂载路由 ────────────────────────────────────

const apiPrefix = '/agent-api';

app.use(apiPrefix, createSkillsRouter(skillLoader));
app.use(apiPrefix, createMCPConfigRouter(mcpConfigStore));
app.use(apiPrefix, createThreadsRouter(threadStore, skillLoader, orchestrator, chatSession));

// ─── 统一错误兜底（章程 VI）────────────────────────
// 未捕获异常一律输出结构化错误体，避免 Express 默认 HTML 错误页造成前后端契约不一致。
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[agent-backend] 未处理异常:', err);
  if (res.headersSent) return;
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    detail: '服务器内部错误',
    error: '服务器内部错误',
  });
});

// ─── 启动服务 ────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[agent-backend] 启动成功，端口: ${config.port}`);
  console.log(`[agent-backend] 数据目录: ${config.dataDir}`);
  console.log(`[agent-backend] 模型: ${config.modelName}`);
  console.log(`[agent-backend] DeepSeek API: ${config.deepseekBaseUrl}`);
  console.log(`[agent-backend] 多 Agent 编排已启用`);
});
