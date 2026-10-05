/**
 * 「MCP 配置」纯逻辑单测：请求头解析/掩码、自建发布配置片段导入。
 *
 * 令牌是本模块的核心关切：解析必须严格（错就报错，不静默丢令牌）、展示必须掩码（不明文）。
 */
import { describe, it, expect } from 'vitest';
import {
  parseHeaders, formatHeaders, maskHeaderValue, headerSummary, hasTokenHeader,
  importServerSnippet, isLoopbackUrl,
} from './server-config';

const SNIPPET = {
  mcpServers: {
    raw_inventory_purchase_function: {
      type: 'url',
      url: 'http://192.168.1.9:8021/mcp',
      headers: { 'X-MCP-Token': '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z' },
    },
  },
};

describe('parseHeaders', () => {
  it('空串 / 空白 → 无 headers（不报错）', () => {
    expect(parseHeaders('')).toEqual({});
    expect(parseHeaders('   ')).toEqual({});
  });

  it('合法对象 → headers（键去空白）', () => {
    const r = parseHeaders('{"X-MCP-Token":"tk"," X-Trace ":"abc"}');
    expect(r.error).toBeUndefined();
    expect(r.headers).toEqual({ 'X-MCP-Token': 'tk', 'X-Trace': 'abc' });
  });

  it('空对象 → 无 headers（等价于清空）', () => {
    expect(parseHeaders('{}')).toEqual({});
  });

  it('非法 JSON / 非对象 / 值非字符串 → 报错且不返回 headers', () => {
    expect(parseHeaders('X-MCP-Token: tk').error).toMatch(/合法 JSON/);
    expect(parseHeaders('["a"]').error).toMatch(/JSON 对象/);
    expect(parseHeaders('{"X-MCP-Token":123}').error).toMatch(/必须是字符串/);
  });
});

describe('formatHeaders / 掩码', () => {
  it('headers → 文本可往返（编辑回填不丢令牌）', () => {
    const headers = { 'X-MCP-Token': 'tk-1234567890' };
    expect(parseHeaders(formatHeaders(headers)).headers).toEqual(headers);
    expect(formatHeaders(undefined)).toBe('');
    expect(formatHeaders({})).toBe('');
  });

  it('长值只露前 4 后 2；短值全掩', () => {
    expect(maskHeaderValue('6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z')).toBe('6UuE…3Z');
    expect(maskHeaderValue('abc')).toBe('••••');
  });

  it('摘要与令牌标记：不明文、按头名识别', () => {
    const headers = { 'X-MCP-Token': '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z' };
    expect(headerSummary(headers)).toBe('X-MCP-Token: 6UuE…3Z');
    expect(headerSummary(headers)).not.toContain('Y683gZ13');
    expect(headerSummary(undefined)).toBe('');
    expect(hasTokenHeader(headers)).toBe(true);
    expect(hasTokenHeader({ authorization: 'Bearer x' })).toBe(true);
    expect(hasTokenHeader({ 'X-Trace': 'x' })).toBe(false);
    expect(hasTokenHeader(undefined)).toBe(false);
  });
});

describe('importServerSnippet', () => {
  it('导入「查看配置」完整片段：名字/URL/令牌请求头全部落位', () => {
    const { server, error } = importServerSnippet(JSON.stringify(SNIPPET));
    expect(error).toBeUndefined();
    expect(server).toEqual({
      name: 'raw_inventory_purchase_function',
      url: 'http://192.168.1.9:8021/mcp',
      headers: { 'X-MCP-Token': '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z' },
    });
  });

  it('也接受裸条目（含 name/url）', () => {
    const { server } = importServerSnippet('{"name":"my-svc","url":"http://h:8021/mcp"}');
    expect(server).toEqual({ name: 'my-svc', url: 'http://h:8021/mcp' });
  });

  it('无 headers 时不产生空 headers 字段', () => {
    const { server } = importServerSnippet('{"mcpServers":{"s":{"url":"http://h/mcp"}}}');
    expect(server).toEqual({ name: 's', url: 'http://h/mcp' });
  });

  it('非法输入一律报错：空 / 非 JSON / 缺 url / stdio 形态 / 名字缺失', () => {
    expect(importServerSnippet('').error).toMatch(/粘贴/);
    expect(importServerSnippet('not json').error).toMatch(/合法 JSON/);
    expect(importServerSnippet('{"mcpServers":{}}').error).toMatch(/没有 mcpServers/);
    expect(importServerSnippet('{"mcpServers":{"s":{"type":"url"}}}').error).toMatch(/缺少 url/);
    expect(importServerSnippet('{"command":"npx","args":[]}').error).toMatch(/stdio/);
    expect(importServerSnippet('{"mcpServers":{"s":{"command":"npx"}}}').error).toMatch(/stdio/);
    expect(importServerSnippet('{"url":"http://h/mcp"}').error).toMatch(/服务名称/);
    expect(importServerSnippet('{"mcpServers":{"s":{"url":"http://h/mcp","headers":["x"]}}}').error)
      .toMatch(/headers 必须是 JSON 对象/);
    expect(importServerSnippet('{"mcpServers":{"s":{"url":"http://h/mcp","headers":{"A":1}}}}').error)
      .toMatch(/必须是字符串/);
  });
});

describe('isLoopbackUrl', () => {
  it('本机地址判为 true，容器名/外网 IP 判为 false，非法 URL 不抛错', () => {
    expect(isLoopbackUrl('http://localhost:8021/mcp')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:8021/mcp')).toBe(true);
    expect(isLoopbackUrl('http://optonto-mcp-publish-x-926190:8100/mcp')).toBe(false);
    expect(isLoopbackUrl('http://192.168.1.9:8021/mcp')).toBe(false);
    expect(isLoopbackUrl('不是URL')).toBe(false);
  });
});
