import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/** MCP 工具调用结果（callTool 返回的显式类型，消除 as any 类型洞） */
export interface McpToolResult {
  content: any[];
  isError?: boolean;
}

/** MCP 工具元信息（listTools 返回） */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

/**
 * MCP 客户端包装器（SSE 传输）。
 * 连接到 optonto-mcp 容器的 SSE 端点，通过 MCP 协议调用本体行为。
 *
 * 连接管理收在本 module 内（调用方无感知）：
 *  - SSE 断连（容器重启/网络抖动）→ transport.onclose 作废客户端，下次调用惰性重连；
 *    此前 connected 标志断连后永不复位，后续调用全部打在死连接上。
 *  - listTools（只读）失败时重连重试一次；callTool 一律不自动重试——
 *    写操作重发可能重复执行（首调或已生效、只是响应丢失），失败原样上抛由上层处理。
 */
export class MCPClient {
  private client: Client | null = null;

  constructor(private readonly mcpUrl: string) {}

  /** 连接 MCP 服务（幂等：已连接直接返回） */
  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client(
      { name: 'optonto-agent', version: '1.0.0' },
      { capabilities: {} },
    );
    const transport = new SSEClientTransport(new URL(this.mcpUrl));
    // SSE 断连 → 作废当前客户端（仅当没被更新的连接替换过），下次调用惰性重连
    transport.onclose = () => { if (this.client === client) this.client = null; };
    await client.connect(transport);
    this.client = client;
    console.log(`[MCP] 已连接到 ${this.mcpUrl}`);
    return client;
  }

  /** 连接已死则作废并关闭旧客户端，下次调用重建 */
  private async invalidate(client: Client): Promise<void> {
    if (this.client === client) this.client = null;
    try { await client.close(); } catch {}
  }

  /**
   * 调用 MCP 工具。返回 { content, isError }。
   * 传输层失败（SDK 抛错）：作废连接后原样上抛——不自动重试，避免写操作重发重复执行。
   * 注：工具级错误（isError: true）不抛错，不走此路径。
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const client = await this.ensureConnected();
    try {
      return await client.callTool({ name, arguments: args }) as McpToolResult;
    } catch (e) {
      await this.invalidate(client);
      throw e;
    }
  }

  /** 获取可用工具列表（只读：传输层失败时重连重试一次） */
  async listTools(): Promise<{ tools: McpToolInfo[] }> {
    const client = await this.ensureConnected();
    try {
      return await client.listTools() as { tools: McpToolInfo[] };
    } catch (e) {
      await this.invalidate(client);
      const fresh = await this.ensureConnected();
      return await fresh.listTools() as { tools: McpToolInfo[] };
    }
  }

  /** 关闭连接，释放 SSE 传输资源 */
  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}
