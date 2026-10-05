/**
 * API client for OPTONTO Agent Backend.
 * 通过 Nginx /agent-api/ 代理到 agent-backend:8003
 */

import { extractErrorMessage } from './http-error';

const AGENT_API = '/agent-api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(body, res.status));
  }
  return res.json();
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentThreadSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface AgentThread {
  id: string;
  title: string;
  status: string;
  messages: AgentMessage[];
  created_at: string;
  updated_at: string;
  scenario_name: string;
  ontology_name: string;
  /** 本次对话的本体范围（空数组 = 通用问答模式） */
  ontology_scope: OntologyScopeSelection[];
}

export interface AgentMessage {
  /** summary：短期记忆压缩生成的对话摘要（展示时过滤，仅后端上下文用） */
  role: 'user' | 'assistant' | 'toolResult' | 'summary';
  content: string;
  timestamp: string;
}

/** 对话本体范围单元（用户显式选择的 scenario+ontology） */
export interface OntologyScopeSelection {
  scenario: string;
  ontology: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  summary?: string;
  scenario?: string;
  ontology?: string;
}

// ─── Skills ─────────────────────────────────────────────────────────

/** 获取某本体下所有可用技能 */
export const listSkills = (scenario: string, ontology: string) =>
  request<SkillInfo[]>(
    `/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/skills`
  );

/** 扫描全部本体，获取所有技能及所在位置（技能选择下拉用） */
export const listAllSkills = () =>
  request<SkillInfo[]>(`/onto_market/skills/all`);

// ─── Threads ────────────────────────────────────────────────────────

/** 获取某本体下的 agent 线程列表 */
export const listAgentThreads = (scenario: string, ontology: string) =>
  request<AgentThreadSummary[]>(
    `/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/threads`
  );

/** 创建新 agent 线程（scope = 本体范围；空数组 = 通用问答模式） */
export const createAgentThread = (
  scenario: string,
  ontology: string,
  title: string,
  scope: OntologyScopeSelection[]
) =>
  request<AgentThread>(
    `/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/threads`,
    {
      method: 'POST',
      body: JSON.stringify({ title, ontology_scope: scope }),
    }
  );

/** 读取线程详情 */
export const getAgentThread = (scenario: string, ontology: string, threadId: string) =>
  request<AgentThread>(
    `/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/threads/${threadId}`
  );

/** 删除线程 */
export const deleteAgentThread = (scenario: string, ontology: string, threadId: string) =>
  request<{ message: string }>(
    `/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/threads/${threadId}`,
    { method: 'DELETE' }
  );

/** Agent Chat SSE 流式对话 */
export const agentChatStream = (
  scenario: string,
  ontology: string,
  threadId: string,
  message: string,
): Promise<Response> =>
  fetch(
    `${AGENT_API}/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/threads/${threadId}/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }
  );

// ─── MCP Config ──────────────────────────────────────────────────

export interface MCPServerConfig {
  name: string;
  url: string;
  enabled: boolean;
  /** 为空/不设置时注册全部工具；设置后只注册指定名称的工具 */
  allowed_tools?: string[];
  /** 内置固定项（本体查询 MCP / 公共函数 MCP）：不可删除/编辑/停用，始终注册全部工具 */
  builtin?: boolean;
  /**
   * 连接携带的 HTTP 头（远程 MCP 鉴权，架构文档 §九.3）。
   * 自建发布（动态容器）**必须**带 `{"X-MCP-Token": "<访问令牌>"}`，否则 401；
   * 固定服务与内网挂载不需要。平台会把它下发给 MCPClient 的 requestInit。
   */
  headers?: Record<string, string>;
  /**
   * **是否业务数据**（缺省视为「否」）：标记该服务提供可被本体的行为映射引用的业务数据。
   * 只有 `true` 的服务才会出现在「接口映射 → 目标接口设置」的**目标 MCP 服务**下拉里——
   * 否则列表会被本体查询 / 公共函数 / 图表类等非业务数据服务淹掉（2026-10-05 用户要求）。
   */
  business_data?: boolean;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  /** 输出 schema（可空；business-mcp 强制声明，第三方远程通常没有 → 走降级链） */
  outputSchema?: Record<string, any> | null;
}

export interface MCPTestResult {
  success: boolean;
  tools: MCPToolInfo[];
  error?: string;
}

/** 读取 MCP 配置（全局唯一） */
export const getMCPConfig = () =>
  request<MCPConfig>(`/mcp-config`);

/** 保存 MCP 配置（全局唯一） */
export const saveMCPConfig = (config: MCPConfig) =>
  request<{ message: string }>(
    `/mcp-config`,
    { method: 'PUT', body: JSON.stringify(config) }
  );

/** 测试 MCP 连接并列出工具（headers 必传才能连上带令牌的自建发布：X-MCP-Token） */
export const testMCPConnection = (
  url: string,
  headers?: Record<string, string>,
): Promise<MCPTestResult> =>
  request<MCPTestResult>(
    `/mcp-config/test`,
    { method: 'POST', body: JSON.stringify({ url, headers }) }
  );

/** 只读列出 MCP 工具（映射页二级下拉数据源，文档 §八.2） */
export const listMCPTools = (url: string, headers?: Record<string, string>): Promise<MCPTestResult> =>
  request<MCPTestResult>(
    `/mcp-config/tools`,
    { method: 'POST', body: JSON.stringify({ url, headers }) }
  );

/** 试调 MCP 工具（映射页"试调提取"：无 outputSchema 时真实调一次反推字段，文档 §九.2） */
export const callMCPTool = (
  url: string, toolName: string, args: Record<string, unknown>, headers?: Record<string, string>
): Promise<{ success: boolean; data?: unknown; error?: string }> =>
  request(
    `/mcp-config/call-tool`,
    { method: 'POST', body: JSON.stringify({ url, tool_name: toolName, arguments: args, headers }) }
  );
