import { Router, Request, Response } from 'express';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { MCPClient } from '../services/mcp-client.js';

/**
 * MCP 配置路由 —— 全局唯一，不区分场景/本体。
 * 配置存于 ./config/mcp-config.json。
 */
export function createMCPConfigRouter(configStore: MCPConfigStore): Router {
  const router = Router();

  /** GET — 读取全局 MCP 配置 */
  router.get('/mcp-config', (_req: Request, res: Response) => {
    try {
      res.json(configStore.getConfig());
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /** PUT — 保存全局 MCP 配置 */
  router.put('/mcp-config', (req: Request, res: Response) => {
    try {
      configStore.saveConfig(req.body);
      res.json({ message: '配置已保存' });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /**
   * POST — 测试 MCP 连接并列出工具
   * body: { url: "http://optonto-mcp:8002/sse" }
   * 返回: { success: true, tools: [{name, description, inputSchema}] }
   */
  router.post('/mcp-config/test', async (req: Request, res: Response) => {
    const { url } = req.body as { url: string };

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: '缺少 MCP 服务 URL' });
      return;
    }

    // 超时控制
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);

    try {
      const client = new MCPClient(url);
      await client.connect();

      const result = await client.listTools();

      // 整理工具信息
      const tools = (result.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      }));

      // 断开连接
      await client.close();

      res.json({ success: true, tools });
    } catch (e: any) {
      res.json({
        success: false,
        error: e.message || '连接失败',
        tools: [],
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  return router;
}
