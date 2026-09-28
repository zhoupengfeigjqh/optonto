import { Router, Request, Response } from 'express';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { MCPClient } from '../services/mcp-client.js';
import { sendError } from '../utils/http-error.js';

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
      sendError(res, 400, e.message);
    }
  });

  /** PUT — 保存全局 MCP 配置 */
  router.put('/mcp-config', (req: Request, res: Response) => {
    try {
      configStore.saveConfig(req.body);
      res.json({ message: '配置已保存' });
    } catch (e: any) {
      sendError(res, 400, e.message);
    }
  });

  /**
   * POST — 测试 MCP 连接并列出工具
   * body: { url: "http://optonto-ontology-mcp:8002/mcp" }
   * 返回: { success: true, tools: [{name, description, inputSchema}] }
   */
  router.post('/mcp-config/test', async (req: Request, res: Response) => {
    const { url, headers } = req.body as { url: string; headers?: Record<string, string> };

    if (!url || typeof url !== 'string') {
      sendError(res, 400, '缺少 MCP 服务 URL');
      return;
    }

    // 真实超时：MCPClient 不接收 AbortSignal（此前 abortController 从未接线，超时是假的），
    // 用 Promise.race 限时 15s；超时/失败后 close 兜底释放底层连接
    const client = new MCPClient(url, headers);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('连接超时（15 秒）')), 15000));

    try {
      const result = await Promise.race([
        (async () => { await client.connect(); return client.listTools(); })(),
        timeout,
      ]);

      // 整理工具信息（outputSchema 一并透出：映射页"自动提取 schema"的权威来源，阶段四用）
      const tools = (result.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        outputSchema: tool.outputSchema || null,
      }));

      // 断开连接
      await client.close();

      res.json({ success: true, tools });
    } catch (e: any) {
      try { await client.close(); } catch {}
      res.json({
        success: false,
        error: e.message || '连接失败',
        tools: [],
      });
    }
  });

  /**
   * POST — 只读列出 MCP 工具（映射页"接口地址=选该服务下的函数"二级下拉数据源，文档 §八.2）
   * 与 /test 同逻辑，语义上标明只读、无配置校验副作用。
   * body: { url, headers? }  返回: { success, tools: [{name, description, inputSchema, outputSchema}] }
   */
  router.post('/mcp-config/tools', async (req: Request, res: Response) => {
    const { url, headers } = req.body as { url: string; headers?: Record<string, string> };
    if (!url || typeof url !== 'string') {
      sendError(res, 400, '缺少 MCP 服务 URL');
      return;
    }
    try {
      const result = await withTempClient(url, headers, c => c.listTools());
      res.json({ success: true, tools: shapeTools(result) });
    } catch (e: any) {
      res.json({ success: false, error: e.message || '连接失败', tools: [] });
    }
  });

  /**
   * POST — 试调 MCP 工具（映射页"试调提取"：无 outputSchema 时真实 callTool 一次，从响应反推字段，文档 §九.2）。
   * 显式设计期操作：用户填样例参数主动触发；错误穿透（下游 isError → success:false + error）。
   * body: { url, tool_name, arguments?, headers? }  返回: { success, data?, error? }
   */
  router.post('/mcp-config/call-tool', async (req: Request, res: Response) => {
    const { url, tool_name, arguments: args, headers } = req.body as {
      url: string; tool_name: string; arguments?: Record<string, unknown>; headers?: Record<string, string>;
    };
    if (!url || typeof url !== 'string' || !tool_name || typeof tool_name !== 'string') {
      sendError(res, 400, '缺少 MCP 服务 URL 或工具名');
      return;
    }
    try {
      const result = await withTempClient(url, headers, c => c.callTool(tool_name, args || {}));
      if (result.isError) {
        const detail = (result.content || []).map((c: any) => c?.text || '').join('').slice(0, 300);
        res.json({ success: false, error: `工具报错: ${detail || '未知错误'}` });
        return;
      }
      const text = (result.content || []).map((c: any) => c?.text || '').join('');
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* 非 JSON 原样返回文本 */ }
      res.json({ success: true, data });
    } catch (e: any) {
      res.json({ success: false, error: e.message || '调用失败' });
    }
  });

  return router;
}

/** 工具信息整理（/test 与 /tools 共用；outputSchema 是映射页"自动提取 schema"的权威来源） */
function shapeTools(result: any) {
  return (result.tools || []).map((tool: any) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    outputSchema: tool.outputSchema || null,
  }));
}

/** 带 15s 超时的临时客户端执行（MCPClient 不接收 AbortSignal；超时/失败后 close 兜底） */
async function withTempClient<T>(url: string, headers: Record<string, string> | undefined,
                                 fn: (c: MCPClient) => Promise<T>): Promise<T> {
  const client = new MCPClient(url, headers);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('连接超时（15 秒）')), 15000));
  try {
    return await Promise.race([(async () => { await client.connect(); return fn(client); })(), timeout]);
  } finally {
    try { await client.close(); } catch {}
  }
}
