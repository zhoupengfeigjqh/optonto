/**
 * 「MCP 配置」页的纯逻辑（无 React 依赖）：请求头的编辑/掩码、自建发布配置片段导入。
 *
 * 为什么需要这一层：自建发布（动态容器）对外**强制** `X-MCP-Token` 鉴权，令牌只能随「请求头」
 * 下发（`agent-factory` 已把它透传给 MCPClient 的 requestInit，`/mcp-config/test` 探针同样接受）。
 * 而请求头是凭据——UI 必须能录入、能一眼看出「已带令牌」，又**不得**把明文令牌铺在表格里，
 * 故把「解析 / 格式化 / 掩码 / 片段导入」收成本模块一份实现，供组件与测试共用。
 */

/** 可导入的服务条目（导入只认这三个字段，其余键一律忽略） */
export interface ImportedServer {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * 请求头编辑框文本 → `headers`。
 *  - 空串/空白 → `{}`（无 headers，字段在落盘时省略）；
 *  - 非 JSON / 非对象 / 值为非字符串 → 返回 `error`（绝不静默丢弃，否则令牌「填了但没生效」最难查）。
 */
export function parseHeaders(text: string): { headers?: Record<string, string>; error?: string } {
  const raw = (text || '').trim();
  if (!raw) return {};

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { error: '请求头必须是合法 JSON，例如 {"X-MCP-Token":"xxx"}' };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: '请求头必须是 JSON 对象，例如 {"X-MCP-Token":"xxx"}' };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!key.trim()) return { error: '请求头名称不能为空' };
    if (typeof value !== 'string') return { error: `请求头 ${key} 的值必须是字符串` };
    headers[key.trim()] = value;
  }
  return Object.keys(headers).length > 0 ? { headers } : {};
}

/** `headers` → 编辑框文本（空 headers 给空串，便于直接开始输入） */
export function formatHeaders(headers?: Record<string, string>): string {
  return headers && Object.keys(headers).length > 0 ? JSON.stringify(headers) : '';
}

/** 单个头值的掩码：只露前 4 / 后 2（短值全掩），避免令牌明文出现在列表里 */
export function maskHeaderValue(value: string): string {
  const v = value || '';
  if (v.length <= 8) return '•'.repeat(Math.max(v.length, 4));
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}

/** 表格展示用摘要：`X-MCP-Token: 6UuE…3Z`（多个头以「、」连接）；无头返回空串 */
export function headerSummary(headers?: Record<string, string>): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${maskHeaderValue(v)}`)
    .join('、');
}

/** 是否携带令牌请求头（列表里给「已带令牌」标记用；只认头名，不看值） */
export function hasTokenHeader(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  return Object.keys(headers).some(k => k.toLowerCase() === 'x-mcp-token'
    || k.toLowerCase() === 'authorization');
}

/**
 * 导入自建发布「查看配置」给出的片段。接受两种形态：
 *  ① 完整片段 `{"mcpServers": {"<名字>": {"type":"http","url":"…","headers":{…}}}}`（取第一条；
 *     `type` 只认 http/sse，是客户端连接方式的标记，导入时忽略——地址里的端点已表达传输方式）；
 *  ② 裸条目 `{"name":"…","url":"…","headers":{…}}`。
 *
 * 只支持 HTTP/URL 形态：`command`（stdio）形态本地 Agent 挂不了，明确报错而不是静默生成死配置。
 */
export function importServerSnippet(text: string): { server?: ImportedServer; error?: string } {
  const raw = (text || '').trim();
  if (!raw) return { error: '请先粘贴配置片段' };

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { error: '不是合法 JSON——请整段复制「MCP发布 → 查看配置」里的内容' };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: '配置片段必须是 JSON 对象' };
  }

  const root = obj as Record<string, any>;
  let name = '';
  let entry: Record<string, any>;

  if (root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)) {
    const pairs = Object.entries(root.mcpServers as Record<string, any>);
    if (pairs.length === 0) return { error: '配置片段里没有 mcpServers 条目' };
    [name, entry] = pairs[0] as [string, Record<string, any>];
  } else if (root.url) {
    entry = root;
    name = typeof root.name === 'string' ? root.name : '';
  } else if (root.command) {
    return { error: '暂不支持 command（stdio）形态的服务——请在「新增 MCP 服务」里手工填 URL' };
  } else {
    return { error: '配置片段缺少 url——请整段复制「MCP发布 → 查看配置」里的内容' };
  }

  if (!entry || typeof entry !== 'object') return { error: '配置片段的条目格式不对' };
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!url) {
    if (typeof entry.command === 'string') {
      return { error: '暂不支持 command（stdio）形态的服务——请在「新增 MCP 服务」里手工填 URL' };
    }
    return { error: '配置片段缺少 url' };
  }
  name = (name || entry.name || '').trim();
  if (!name) return { error: '配置片段缺少服务名称' };

  const headers: Record<string, string> = {};
  if (entry.headers !== undefined) {
    if (typeof entry.headers !== 'object' || entry.headers === null || Array.isArray(entry.headers)) {
      return { error: 'headers 必须是 JSON 对象' };
    }
    for (const [k, v] of Object.entries(entry.headers as Record<string, unknown>)) {
      if (typeof v !== 'string') return { error: `请求头 ${k} 的值必须是字符串` };
      headers[k] = v;
    }
  }

  return {
    server: Object.keys(headers).length > 0 ? { name, url, headers } : { name, url },
  };
}

/** 片段里的地址是否指向本机（localhost/127.0.0.1 等）——给「平台 Agent 直连不到」的提示用 */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'host.docker.internal';
  } catch {
    return false;
  }
}
