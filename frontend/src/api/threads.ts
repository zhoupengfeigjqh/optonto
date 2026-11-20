/** 需求线程、对话与需求文件接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';
import type { OntologyRefInput } from './ontology-refs';

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

/** 上下文归档状态：早期对话被压缩成摘要后注入系统提示词（messages 全量仍在后端） */
export interface ThreadContext {
  /** 归档摘要（≤2000 tokens），已注入 system prompt 末尾 */
  summary: string;
  /** 已归档的消息下标（messages[0:covered_until] 已压入摘要） */
  covered_until: number;
  /** 已归档的对话轮数（用于展示） */
  archived_rounds?: number;
  summary_tokens?: number;
  updated_at?: string;
}

// ─── 存量本体引用快照（spec 010） ────────────────────────────────────────────

export interface OntologyRefCounts {
  concepts: number;
  functions: number;
  behaviors: number;
}

export interface OntologyRefAttribute {
  name: string;
  /** 中文名；缺失时后端不返回该键（不编造） */
  title?: string;
  type: string;
  /** 约束文本（如「唯一；必填」）；无约束时不返回该键 */
  constraint?: string;
}

export interface OntologyRefConcept {
  name: string;
  title?: string;
  attributes: OntologyRefAttribute[];
}

/** 单个被引用本体的快照条目（身份四元组 + 提取项 + 条数） */
export interface OntologyRefEntry {
  ontology_id: string;
  scenario_id: string;
  scenario_name: string;
  ontology_name: string;
  counts: OntologyRefCounts;
  items: {
    concepts: OntologyRefConcept[];
    functions: { name: string; title?: string }[];
    behaviors: { name: string; title?: string }[];
  };
}

/** 线程顶层的引用快照：创建时定格，源本体后续变更不影响 */
export interface OntologyRefSnapshot {
  snapshot_at: string;
  max_tokens: number;
  token_estimate: number;
  refs: OntologyRefEntry[];
  /** 渲染好的 system prompt 段落（每轮直接拼接，不再重渲染） */
  prompt_text: string;
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
  /** 上下文归档状态（未归档时缺省） */
  context?: ThreadContext | null;
  /** 最近一次调用错误（不再混入 messages） */
  last_error?: { message: string; at: string } | null;
  /** 存量本体引用快照；未引用时**不出现该键**（不是 null） */
  ontology_refs?: OntologyRefSnapshot;
}

export const getThreads = (query: string = '') =>
  request<ThreadSummary[]>(`/api/threads${query ? '?' + query : ''}`);

/**
 * 新建对话线程。
 *
 * `ontology_refs`（spec 010）：省略或空数组时**请求体不带该键**——与后端「未引用时线程 JSON
 * 不出现该字段」的约定一一对应（SC-005 零回归的前提）。
 */
export const createThread = (
  title: string = '新对话',
  scenario_name: string = '',
  ontology_name: string = '',
  version: string = '',
  ontology_refs?: OntologyRefInput[],
) =>
  request<Thread>('/api/threads', {
    method: 'POST',
    body: JSON.stringify({
      title,
      scenario_name,
      ontology_name,
      version,
      ...(ontology_refs && ontology_refs.length ? { ontology_refs } : {}),
    }),
  });

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
