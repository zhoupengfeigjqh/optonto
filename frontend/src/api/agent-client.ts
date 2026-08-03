/**
 * API client for OPTONTO Agent Backend.
 * 通过 Nginx /agent-api/ 代理到 agent-backend:8003
 */

const AGENT_API = '/agent-api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
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
  skill_names: SkillSelection[];
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp: string;
}

/** 选中的技能及其所在本体/场景 */
export interface SkillSelection {
  name: string;
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

/** 创建新 agent 线程 */
export const createAgentThread = (
  scenario: string,
  ontology: string,
  title: string,
  skills: SkillSelection[]
) =>
  request<AgentThread>(
    `/onto_market/${encodeURIComponent(scenario)}/${encodeURIComponent(ontology)}/threads`,
    {
      method: 'POST',
      body: JSON.stringify({ title, skill_names: skills }),
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
  /** 内置本体MCP：不可删除/编辑，始终注册全部工具 */
  builtin?: boolean;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
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

/** 测试 MCP 连接并列出工具 */
export const testMCPConnection = (
  url: string
): Promise<MCPTestResult> =>
  request<MCPTestResult>(
    `/mcp-config/test`,
    { method: 'POST', body: JSON.stringify({ url }) }
  );
