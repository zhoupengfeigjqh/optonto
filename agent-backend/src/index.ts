/**
 * 进程入口 —— 只做「装配 + 监听 + 启动日志」。
 *
 * 应用装配已抽至 `app.ts`（2026-10-05，宪法 III 可测性改造）：原文件在模块顶层
 * 同时装配并 `app.listen()`，导致 `import` 即启动监听、端点无法被集成测试覆盖
 * （宪法 III 要求「每个接口（端点）MUST 有集成测试」）。现本文件只负责启动，
 * 装配逻辑与全部依赖构造集中在 `createAppFromConfig()`。
 */
import { config } from './config.js';
import { createAppFromConfig } from './app.js';

const app = createAppFromConfig();

app.listen(config.port, () => {
  console.log(`[agent-backend] 启动成功，端口: ${config.port}`);
  console.log(`[agent-backend] 数据目录: ${config.dataDir}`);
  console.log(`[agent-backend] 模型: ${config.modelName}`);
  console.log(`[agent-backend] DeepSeek API: ${config.deepseekBaseUrl}`);
  console.log(`[agent-backend] 多 Agent 编排已启用`);
});
