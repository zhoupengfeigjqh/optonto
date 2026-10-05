/** 固定 MCP 服务管控 + 自建发布 接口（MCP发布页用）。
 * 
 * 固定服务键即角色（2026-10-04 语义统一）：
 * - ontology-query   本体查询 MCP 服务（内置对外工具面，只读 list* 查询）
 * - common-function  公共函数 MCP 服务（平台通用算力：发布 + 执行一体，无令牌只读计算）
 * - function-executor 本体函数执行服务（零工具、仅内网）
 * - data-engine      数据引擎执行服务（行为/引擎执行唯一实现，工具面仅内网）
 * 
 * 自建发布（用户创建的动态容器）走 /api/mcp/published 独立端点，不进固定服务白名单。
 */
import { request } from './http';

/** 平台可管控的 MCP 服务键（core mcp_ctl 白名单）；business 只读 */
/** 固定服务键即角色：本体查询（对外工具面）/ 函数执行（零工具）/ 数据引擎执行（内网）/ 业务系统 */
export type McpServiceKey = 'ontology-query' | 'common-function' | 'function-executor' | 'data-engine' | 'business';

export interface McpStatus {
  status: string;
  running: boolean;
  container: string;
}

export interface McpActionResult {
  message: string;
  running: boolean;
}

export const getMcpStatus = (service: McpServiceKey = 'ontology-query') =>
  request<McpStatus>(`/api/mcp/${service}/status`);

/** 业务系统 MCP 状态已并入通用口径：getMcpStatus('business') */

// 经 Nginx /mcp/ 代理到 optonto-ontology-query-mcp:8002，不直连端口（端口可不对外发布）
export const getMcpTools = async () => {
  const resp = await fetch('/mcp/tools');
  if (!resp.ok) {
    throw new Error(`获取 MCP 工具失败 (${resp.status})`);
  }
  return resp.json() as Promise<{ name: string; description: string }[]>;
};

export const startMcp = (service: McpServiceKey = 'ontology-query') =>
  request<McpActionResult>(`/api/mcp/${service}/start`, { method: 'POST' });

/** 业务系统 MCP 的工具清单（对外发布于 :8004，浏览器可直连其 /tools） */
export const getBusinessMcpTools = async () => {
  const resp = await fetch(`http://${window.location.hostname}:8004/tools`);
  if (!resp.ok) {
    throw new Error(`获取业务系统 MCP 工具失败 (${resp.status})`);
  }
  return resp.json() as Promise<{ name: string; description: string }[]>;
};

export const stopMcp = (service: McpServiceKey = 'ontology-query') =>
  request<McpActionResult>(`/api/mcp/${service}/stop`, { method: 'POST' });

// ─── 自建发布（动态 MCP 容器；core 侧唯一创建路径，镜像白名单收口）─────────────

/** 发布类型：本体函数（转发本体函数执行服务）/ 本体行为（转发数据引擎执行服务） */
export type PublishKind = 'ontology_function' | 'behavior';
/** 传输模式：streamable-http（单端点 /mcp）/ sse（双通道 /sse + /messages/） */
export type PublishTransport = 'streamable' | 'sse';

export interface PublishedService {
  name: string;
  kind: PublishKind;
  ontology_id: number;
  ontology_name: string;
  items: string[];
  tool_count: number;
  host_port: number;
  transport: PublishTransport;
  /** 访问令牌：连同时须带 X-MCP-Token 请求头（客户端配置片段里会给） */
  token: string;
  container_name: string;
  created_at: string;
  /** 容器实时状态：running / exited / not_found / unknown */
  status: string;
  running: boolean;
}

export interface PublishMeta {
  kinds: PublishKind[];
  transports: PublishTransport[];
  host_port_min: number;
  host_port_max: number;
}

export interface CreatePublishPayload {
  ontology_id: number;
  name: string;
  kind: PublishKind;
  items: string[];
  host_port: number;
  transport: PublishTransport;
}

export const listPublished = () =>
  request<{ services: PublishedService[] }>('/api/mcp/published');

export const getPublishMeta = () =>
  request<PublishMeta>('/api/mcp/published/meta');

export const createPublished = (payload: CreatePublishPayload) =>
  request<PublishedService>('/api/mcp/published', { method: 'POST', body: JSON.stringify(payload) });

export const startPublished = (name: string) =>
  request<PublishedService>(`/api/mcp/published/${encodeURIComponent(name)}/start`, { method: 'POST' });

export const stopPublished = (name: string) =>
  request<PublishedService>(`/api/mcp/published/${encodeURIComponent(name)}/stop`, { method: 'POST' });

export const deletePublished = (name: string) =>
  request<{ message: string; name: string }>(`/api/mcp/published/${encodeURIComponent(name)}`, { method: 'DELETE' });

/** 可粘贴连接片段：`{"mcpServers": {"<名字>": {"type":"url","url":"…","headers":{"X-MCP-Token":"…"}}}}` */
export type McpClientSnippet = Record<string, { type: string; url: string; headers: Record<string, string> }>;

/** 生成可直接粘进「MCP配置」的客户端配置片段（host 省略时用占位符） */
export const getPublishedClientConfig = (name: string, host?: string) =>
  request<{
    /** 宿主地址：给平台外的 AI 客户端（Claude / Cursor 等） */
    mcpServers: McpClientSnippet;
    /** 容器内地址（容器名 + 容器内端口）：给本平台 Agent——它在容器里，localhost 指向自己 */
    internal_mcpServers?: McpClientSnippet;
  }>(
    `/api/mcp/published/${encodeURIComponent(name)}/client-config${host ? `?host=${encodeURIComponent(host)}` : ''}`,
  );

/** 公共函数 MCP 的工具清单（对外发布于 :8007，经 nginx /mcp-common-function/ 代理） */
export const getCommonFunctionMcpTools = async () => {
  const resp = await fetch('/mcp-common-function/tools');
  if (!resp.ok) {
    throw new Error(`获取公共函数 MCP 工具失败 (${resp.status})`);
  }
  return resp.json() as Promise<{ name: string; description: string }[]>;
};