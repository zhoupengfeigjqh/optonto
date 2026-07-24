import { Router, Request, Response } from 'express';
import { MCPConfigStore, type MCPServerConfig } from '../services/mcp-config-store.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export function createMCPConfigRouter(configStore: MCPConfigStore): Router {
  const router = Router();

  /** GET — 读取 MCP 配置 */
  router.get('/onto_market/:scenario/:ontology/mcp-config', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const config = configStore.getConfig(scenario, ontology);
      res.json(config);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /** PUT — 保存 MCP 配置 */
  router.put('/onto_market/:scenario/:ontology/mcp-config', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const config = req.body;
      configStore.saveConfig(scenario, ontology, config);
      res.json({ message: '配置已保存' });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /**
   * POST — 测试 MCP 连接并列出工具
   * body: { url: "http://mcp:8002/sse" }
   * 返回: { success: true, tools: [{name, description, inputSchema}] }
   */
  router.post('/onto_market/:scenario/:ontology/mcp-config/test', async (req: Request, res: Response) => {
    const { url } = req.body as { url: string };

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: '缺少 MCP 服务 URL' });
      return;
    }

    // 超时控制
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);

    try {
      const client = new Client(
        { name: 'optonto-config-test', version: '1.0.0' },
        { capabilities: {} },
      );

      const transport = new SSEClientTransport(new URL(url));
      await client.connect(transport);

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
