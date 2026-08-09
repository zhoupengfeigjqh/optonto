import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * MCP 客户端包装器。
 * 连接到 optonto-mcp 容器的 SSE 端点，
 * 通过 MCP 协议调用本体行为。
 */
export class MCPClient {
  private client: Client;
  private connected = false;

  constructor(private readonly mcpUrl: string) {
    this.client = new Client(
      { name: 'optonto-agent', version: '1.0.0' },
      { capabilities: {} },
    );
  }

  /** 连接 MCP 服务 */
  async connect(): Promise<void> {
    if (this.connected) return;
    const transport = new SSEClientTransport(new URL(this.mcpUrl));
    await this.client.connect(transport);
    this.connected = true;
    console.log(`[MCP] 已连接到 ${this.mcpUrl}`);
  }

  /** 调用 MCP 工具。返回 { content, isError } */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: any[]; isError?: boolean }> {
    if (!this.connected) {
      await this.connect();
    }
    return this.client.callTool({ name, arguments: args }) as any;
  }

  /** 获取可用工具列表 */
  async listTools() {
    if (!this.connected) {
      await this.connect();
    }
    return this.client.listTools();
  }

  /** 关闭连接，释放 SSE 传输资源 */
  async close(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.close();
    } finally {
      this.connected = false;
    }
  }
}
