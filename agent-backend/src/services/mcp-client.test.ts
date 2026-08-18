/**
 * MCPClient 单元测试 —— 连接管理经公共接口测试（mock SDK 层，interface 即测试面）。
 * 覆盖：惰性连接复用、transport.onclose 断连作废后重建、callTool 传输失败不自动重试（防写操作重发）、
 * listTools 只读重连重试一次、close 幂等。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// SDK mock：按序捕获每次 new 的 Client / transport；行为按实例序号配置（构造时才入队，必须先建好再配 mock 会时序错乱）
const clients: Array<{ idx: number; connect: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; listTools: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
const transports: Array<{ onclose?: () => void }> = [];
let callToolBehavior: Array<() => Promise<any>> = [];
let listToolsBehavior: Array<() => Promise<any>> = [];

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    idx = clients.length;
    connect = vi.fn().mockResolvedValue(undefined);
    callTool = vi.fn(() => (callToolBehavior[this.idx] ?? (() => Promise.resolve({ content: [] })))());
    listTools = vi.fn(() => (listToolsBehavior[this.idx] ?? (() => Promise.resolve({ tools: [] })))());
    close = vi.fn().mockResolvedValue(undefined);
    constructor() { clients.push(this as any); }
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    onclose?: () => void;
    constructor(public url: URL) { transports.push(this as any); }
  },
}));

import { MCPClient } from './mcp-client.js';

beforeEach(() => {
  clients.length = 0;
  transports.length = 0;
  callToolBehavior = [];
  listToolsBehavior = [];
});

describe('MCPClient — 连接管理', () => {
  it('惰性连接：首次调用建立连接，后续复用同一 Client', async () => {
    const c = new MCPClient('http://mcp-test/sse');
    await c.listTools();
    await c.listTools();
    expect(clients).toHaveLength(1); // 只建了一个 Client
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
  });

  it('transport.onclose（SSE 断连）→ 作废客户端，下次调用重建连接', async () => {
    const c = new MCPClient('http://mcp-test/sse');
    await c.listTools();
    transports[0].onclose!(); // 模拟容器重启导致 SSE 断连
    await c.listTools();
    expect(clients).toHaveLength(2); // 惰性重建了新 Client
    expect(clients[1].connect).toHaveBeenCalledTimes(1);
  });

  it('callTool 传输层失败 → 作废连接并原样上抛，不自动重试（防写操作重发）', async () => {
    callToolBehavior[0] = () => Promise.reject(new Error('Connection closed'));
    const c = new MCPClient('http://mcp-test/sse');
    await expect(c.callTool('executeOntoBehavior', {})).rejects.toThrow('Connection closed');
    expect(clients[0].callTool).toHaveBeenCalledTimes(1); // 无重试
    // 连接已作废：下一次调用走新连接
    await c.listTools();
    expect(clients).toHaveLength(2);
  });

  it('listTools 传输层失败 → 重连重试一次成功（只读安全）', async () => {
    listToolsBehavior[0] = () => Promise.reject(new Error('Connection closed'));
    listToolsBehavior[1] = () => Promise.resolve({ tools: [{ name: 't1' }] });
    const c = new MCPClient('http://mcp-test/sse');
    const result = await c.listTools();
    expect(result.tools).toEqual([{ name: 't1' }]);
    expect(clients).toHaveLength(2);
    expect(clients[0].close).toHaveBeenCalled(); // 旧客户端被关闭
  });

  it('close 幂等：未连接/重复关闭均安全', async () => {
    const c = new MCPClient('http://mcp-test/sse');
    await c.close(); // 未连接
    await c.listTools();
    await c.close();
    await c.close();
    expect(clients[0].close).toHaveBeenCalledTimes(1);
  });
});
