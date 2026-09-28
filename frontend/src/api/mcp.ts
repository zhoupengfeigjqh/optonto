/** MCP 平台服务管控接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';

/** 平台可管控的 MCP 服务键（core mcp_ctl 白名单）；business 只读 */
export type McpServiceKey = 'ontology' | 'data-engine';

export interface McpStatus {
  status: string;
  running: boolean;
  container: string;
}

export interface McpActionResult {
  message: string;
  running: boolean;
}

export const getMcpStatus = (service: McpServiceKey = 'ontology') =>
  request<McpStatus>(`/api/mcp/${service}/status`);

/** business-mcp 容器状态（只读；启停只能 Docker 手动，架构文档 §十六） */
export const getBusinessMcpStatus = () =>
  request<McpStatus>('/api/mcp/business/status');

// 经 Nginx /mcp/ 代理到 optonto-ontology-mcp:8002，不直连端口（端口可不对外发布）
export const getMcpTools = async () => {
  const resp = await fetch('/mcp/tools');
  if (!resp.ok) {
    throw new Error(`获取 MCP 工具失败 (${resp.status})`);
  }
  return resp.json() as Promise<{ name: string; description: string }[]>;
};

// 经 Nginx /mcp-data-engine/ 代理到 optonto-data-engine-mcp:8005
export const getDataEngineMcpTools = async () => {
  const resp = await fetch('/mcp-data-engine/tools');
  if (!resp.ok) {
    throw new Error(`获取数据引擎 MCP 工具失败 (${resp.status})`);
  }
  return resp.json() as Promise<{ name: string; description: string }[]>;
};

export const startMcp = (service: McpServiceKey = 'ontology') =>
  request<McpActionResult>(`/api/mcp/${service}/start`, { method: 'POST' });

export const stopMcp = (service: McpServiceKey = 'ontology') =>
  request<McpActionResult>(`/api/mcp/${service}/stop`, { method: 'POST' });
