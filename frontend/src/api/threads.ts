/** 需求线程、对话与需求文件接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';

export interface ThreadSummary {
  id: string;
  title: string;
  status: string;
  version?: string;
  created_at: string;
  updated_at: string;
  scenario_name?: string;
  ontology_name?: string;
}

export interface ThreadMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface Thread {
  id: string;
  title: string;
  status: string;
  version?: string;
  created_at: string;
  updated_at: string;
  messages: ThreadMessage[];
  /** 最新一次「验证」的分析结果（后端临时保存，仅保留最新一次） */
  validate_result?: { result: string; updated_at: string } | null;
}

export const getThreads = (query: string = '') =>
  request<ThreadSummary[]>(`/api/threads${query ? '?' + query : ''}`);

export const createThread = (title: string = '新对话', scenario_name: string = '', ontology_name: string = '', version: string = '') =>
  request<Thread>('/api/threads', { method: 'POST', body: JSON.stringify({ title, scenario_name, ontology_name, version }) });

export const getThread = (id: string, scenario?: string, ontology?: string) => {
  let url = `/api/threads/${id}`;
  const params: string[] = [];
  if (scenario) params.push(`scenario=${encodeURIComponent(scenario)}`);
  if (ontology) params.push(`ontology=${encodeURIComponent(ontology)}`);
  if (params.length) url += '?' + params.join('&');
  return request<Thread>(url);
};

export const deleteThread = (id: string) =>
  request<{ message: string }>(`/api/threads/${id}`, { method: 'DELETE' });

export const updateThread = (id: string, data: { title?: string; status?: string }) =>
  request<Thread>(`/api/threads/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const clearChat = (id: string) =>
  request<{ message: string }>(`/api/threads/${id}/clear`, { method: 'POST' });

export const validateAnalysis = (threadId: string, selectedIndices: number[]) =>
  request<{ result: string }>(`/api/threads/${threadId}/validate`, { method: 'POST', body: JSON.stringify({ selected_indices: selectedIndices }) });

export const generateOntology = (threadId: string, filename: string, sections: string[] = []) =>
  request<{ message: string; filename: string; scenario: string; ontology: string; stats: Record<string, number> }>(
    `/api/threads/${threadId}/generate-ontology`, { method: 'POST', body: JSON.stringify({ filename, sections }) }
  );

/** 本体模板的一级目录（后端从 onto_template.yaml 动态解析） */
export const getOntologyTemplateSections = () =>
  request<{ sections: string[] }>('/api/threads/ontology-template/sections');

export const exportThread = (id: string, ontologyName: string, content: string, selectedIndices: number[] = []) =>
  request<{ message: string; path: string; filename: string }>(`/api/threads/${id}/export`, { method: 'POST', body: JSON.stringify({ ontology_name: ontologyName, content, selected_indices: selectedIndices }) });

export const chatStream = (threadId: string, message: string, grilling: boolean = false): Promise<Response> =>
  fetch(`/api/threads/${threadId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, grilling }),
  });

// ─── Requirement Files ───────────────────────────────────────────────────

export interface RequirementItem {
  filename: string;
  req_name: string;
  onto_name: string;
  content_name: string;
  version: string;
  thread_id: string;
  thread_title: string;
  created_at: string;
  updated_at: string;
  has_ontology: boolean;
  /** 已生成时匹配到的本体 yaml 文件名（判定依据，便于核对配对关系） */
  ontology_file?: string;
  scenario_name?: string;
  ontology_name?: string;
}

export const listRequirements = (scenario?: string, ontology?: string) => {
  let url = '/api/threads/requirements/list';
  const params: string[] = [];
  if (scenario) params.push(`scenario=${encodeURIComponent(scenario)}`);
  if (ontology) params.push(`ontology=${encodeURIComponent(ontology)}`);
  if (params.length) url += '?' + params.join('&');
  return request<RequirementItem[]>(url);
};

export const getRequirementFile = (threadId: string, filename: string, scenario?: string, ontology?: string) => {
  let url = `/api/threads/${threadId}/requirements/${filename}`;
  const params: string[] = [];
  if (scenario) params.push(`scenario=${encodeURIComponent(scenario)}`);
  if (ontology) params.push(`ontology=${encodeURIComponent(ontology)}`);
  if (params.length) url += '?' + params.join('&');
  return request<{ content: string; filename: string; thread_id: string }>(url);
};

export const saveRequirementFile = (threadId: string, filename: string, content: string) =>
  request<{ message: string }>(`/api/threads/${threadId}/requirements/${filename}`, { method: 'PUT', body: JSON.stringify({ content }) });

export const deleteRequirementFile = (threadId: string, filename: string) =>
  request<{ message: string }>(`/api/threads/${threadId}/requirements/${filename}`, { method: 'DELETE' });
