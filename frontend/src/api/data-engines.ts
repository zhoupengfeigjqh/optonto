/** 数据引擎（映射执行配置）接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';

export interface TargetApiConfig {
  data_source_name: string;
  api_name: string;
  url: string;
  method: string;
  params: Record<string, unknown>;
  response: Record<string, unknown>;
  /** MCP 型引擎：下游 MCP 服务地址（Streamable HTTP 端点，选中即落盘） */
  server_url?: string;
  /** MCP 型引擎：下游工具名 */
  tool_name?: string;
  /** 无 outputSchema 时手工/试调录入的目标输出字段（设计期参照） */
  output_fields?: string[];
  /** 连接下游 MCP 携带的 HTTP 头（远程鉴权） */
  headers?: Record<string, string>;
}

export interface DataEngine {
  name: string;
  display_name?: string;
  behavior_name: string;
  target: TargetApiConfig;
  input_mapping: Record<string, string>;
  output_mapping: Record<string, string>;
}

export const getDataEngines = (ontologyId: number) =>
  request<DataEngine[]>(`/api/ontologies/${ontologyId}/data-engines`);

export const createDataEngine = (ontologyId: number, data: DataEngine) =>
  request<DataEngine>(`/api/ontologies/${ontologyId}/data-engines`, { method: 'POST', body: JSON.stringify(data) });

export const updateDataEngine = (ontologyId: number, name: string, data: DataEngine) =>
  request<DataEngine>(`/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

export const analyzeMapping = (ontologyId: number, name: string, body?: {
  onto_input_fields: string[];
  target_input_fields: string[];
  onto_output_fields: string[];
  target_output_fields: string[];
}) =>
  request<{ input_mapping: Record<string,string>; output_mapping: Record<string,string>; status: string; message: string; issues: string[] }>(
    `/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(name)}/analyze-mapping`,
    { method: 'POST', body: body ? JSON.stringify(body) : undefined }
  );

export const callBehavior = (ontologyId: number, name: string, params: Record<string, any>) =>
  request<{ status_code: number; headers: Record<string, string>; data: any }>(
    `/api/ontologies/${ontologyId}/behaviors/${encodeURIComponent(name)}/call`,
    { method: 'POST', body: JSON.stringify({ params }) }
  );

export const smartAlign = (ontologyId: number, name: string) =>
  request<{ params: Record<string, unknown>; response: Record<string, unknown> }>(
    `/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(name)}/smart-align`,
    { method: 'POST' }
  );
