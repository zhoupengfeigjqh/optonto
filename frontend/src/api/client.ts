/**
 * API client for OPTONTO backend.
 */

const API_BASE = '';  // 使用相对路径，由 Nginx 代理到后端

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// ─── Scenario ──────────────────────────────────────────────────────────────

export interface Scenario {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export const getScenarios = () => request<Scenario[]>('/api/scenarios');
export const createScenario = (data: { name: string; description?: string }) =>
  request<Scenario>('/api/scenarios', { method: 'POST', body: JSON.stringify(data) });
export const updateScenario = (id: number, data: { name?: string; description?: string }) =>
  request<Scenario>(`/api/scenarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Ontology ──────────────────────────────────────────────────────────────

export interface Ontology {
  id: number;
  scenario_id: number;
  name: string;
  description: string;
  creator: string;
  scenario_name?: string;
  created_at: string;
  updated_at: string;
}

export interface OntologyData {
  concepts: Concept[];
  relations: Relation[];
  behaviors: Behavior[];
  rules: Rule[];
  events: Event[];
  processes: Process[];
  securities: Security[];
  data_engines: DataEngine[];
  functions?: Function[];
}

export const getOntologies = (scenarioId: number) =>
  request<Ontology[]>(`/api/ontologies/by-scenario/${scenarioId}`);

export const createOntology = (data: { scenario_id: number; name: string; description?: string; creator?: string }) =>
  request<Ontology>('/api/ontologies', { method: 'POST', body: JSON.stringify(data) });

export const deleteOntology = (id: number) =>
  request<{ message: string }>(`/api/ontologies/${id}`, { method: 'DELETE' });

export const getOntology = (id: number) =>
  request<Ontology>(`/api/ontologies/${id}`);

export const updateOntology = (id: number, data: { name?: string; description?: string; creator?: string }) =>
  request<Ontology>(`/api/ontologies/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const getOntologyData = (id: number) =>
  request<OntologyData>(`/api/ontologies/${id}/data`);

// ─── Concept ───────────────────────────────────────────────────────────────

export interface Attribute {
  name: string;
  type: string;
  display_name?: string;
  example?: string;
  constraint?: string;
}

export interface Concept {
  name: string;
  description: string;
  attributes?: Attribute[];
  display_name?: string;
}

export const getConcepts = (ontologyId: number) =>
  request<Concept[]>(`/api/ontologies/${ontologyId}/concepts`);

export const createConcept = (ontologyId: number, data: Concept) =>
  request<Concept>(`/api/ontologies/${ontologyId}/concepts`, { method: 'POST', body: JSON.stringify(data) });

export const deleteConcept = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/concepts/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateConcept = (ontologyId: number, name: string, data: Concept) =>
  request<Concept>(`/api/ontologies/${ontologyId}/concepts/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

export const updateAttributes = (ontologyId: number, conceptName: string, attributes: Attribute[]) =>
  request<Attribute[]>(`/api/ontologies/${ontologyId}/concepts/${encodeURIComponent(conceptName)}/attributes`, { method: 'PUT', body: JSON.stringify(attributes) });

// ─── Relation ──────────────────────────────────────────────────────────────

export interface Relation {
  name: string;
  source: string;
  target: string;
  cardinality: string;
  description: string;
  display_name?: string;
}

export const getRelations = (ontologyId: number) =>
  request<Relation[]>(`/api/ontologies/${ontologyId}/relations`);

export const createRelation = (ontologyId: number, data: Relation) =>
  request<Relation>(`/api/ontologies/${ontologyId}/relations`, { method: 'POST', body: JSON.stringify(data) });

export const deleteRelation = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/relations/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateRelation = (ontologyId: number, name: string, data: Relation) =>
  request<Relation>(`/api/ontologies/${ontologyId}/relations/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Function ────────────────────────────────────────────────────────

export interface Function {
  name: string;
  display_name?: string;
  description?: string;
  related_attributes: string[];
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  code_file?: string;
}

export const getFunctions = (ontologyId: number) =>
  request<Function[]>(`/api/ontologies/${ontologyId}/functions`);

export const getCommonFunctions = () =>
  request<any[]>('/api/common-functions');


export const createFunction = (ontologyId: number, data: Function) =>
  request<Function>(`/api/ontologies/${ontologyId}/functions`, { method: 'POST', body: JSON.stringify(data) });

export const deleteFunction = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const getFunctionCode = (ontologyId: number, name: string) =>
  request<{ content: string; exists: boolean; code_file: string }>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}/code`);

export const saveFunctionCode = (ontologyId: number, name: string, code: string) =>
  request<{ message: string; code_file: string }>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}/code`, { method: 'PUT', body: JSON.stringify({ code }) });

export const generateFunctionCode = (ontologyId: number, name: string) =>
  request<{ code: string; code_file: string }>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}/generate-code`, { method: 'POST' });

export const executeFunction = (ontologyId: number, name: string, params: any) =>
  request<{ result: any }>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}/execute`, { method: 'POST', body: JSON.stringify({ params }) });

export const updateFunction = (ontologyId: number, name: string, data: Function) =>
  request<Function>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Behavior ──────────────────────────────────────────────────────────────

export interface Behavior {
  name: string;
  description: string;
  behavior_type?: string;
  params: Record<string, unknown>;
  response?: Record<string, unknown>;
  related_concepts: string[];
  display_name?: string;
}

export const getBehaviors = (ontologyId: number) =>
  request<Behavior[]>(`/api/ontologies/${ontologyId}/behaviors`);

export const createBehavior = (ontologyId: number, data: Behavior) =>
  request<Behavior>(`/api/ontologies/${ontologyId}/behaviors`, { method: 'POST', body: JSON.stringify(data) });

export const deleteBehavior = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/behaviors/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateBehavior = (ontologyId: number, name: string, data: Behavior) =>
  request<Behavior>(`/api/ontologies/${ontologyId}/behaviors/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Rule ──────────────────────────────────────────────────────────────────

export interface Rule {
  name: string;
  description: string;
  related_behaviors: string[];
  related_functions: string[];
  display_name?: string;
  rule_type?: string;
  position?: string;
  rule_detail?: any;
}

export const getRules = (ontologyId: number) =>
  request<Rule[]>(`/api/ontologies/${ontologyId}/rules`);

export const getRuleTemplateTypes = () =>
  request<string[]>("/api/rule-templates/types");

export const getRuleTemplate = (ruleName: string) =>
  request<any>(`/api/rule-templates/${encodeURIComponent(ruleName)}`);

export const generateRule = (ontologyId: number, data: any) =>
  request<{ rule_detail: any }>(`/api/ontologies/${ontologyId}/rules/generate`, { method: 'POST', body: JSON.stringify(data) });
export const createRule = (ontologyId: number, data: Rule) =>
  request<Rule>(`/api/ontologies/${ontologyId}/rules`, { method: 'POST', body: JSON.stringify(data) });

export const deleteRule = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/rules/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateRule = (ontologyId: number, name: string, data: Rule) =>
  request<Rule>(`/api/ontologies/${ontologyId}/rules/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Event ─────────────────────────────────────────────────────────────────

export interface Event {
  name: string;
  event_type?: string;
  trigger_condition?: string;
  related_concepts?: string[];
  related_behavior: string | null;
  trigger_behaviors: string[];
  display_name?: string;
}

export const getEvents = (ontologyId: number) =>
  request<Event[]>(`/api/ontologies/${ontologyId}/events`);

export const createEvent = (ontologyId: number, data: Event) =>
  request<Event>(`/api/ontologies/${ontologyId}/events`, { method: 'POST', body: JSON.stringify(data) });

export const deleteEvent = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/events/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateEvent = (ontologyId: number, name: string, data: Event) =>
  request<Event>(`/api/ontologies/${ontologyId}/events/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Business Process ──────────────────────────────────────────────────────

export interface ProcessStep {
  current_action: string;
  previous_action: string;
  description?: string;
  connection_type?: string;
}

export interface Process {
  name: string;
  display_name?: string;
  goal?: string;
  description?: string;
  steps?: ProcessStep[];
}

export const getProcesses = (ontologyId: number) =>
  request<Process[]>(`/api/ontologies/${ontologyId}/processes`);

export const createProcess = (ontologyId: number, data: Process) =>
  request<Process>(`/api/ontologies/${ontologyId}/processes`, { method: 'POST', body: JSON.stringify(data) });

export const deleteProcess = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/processes/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateProcess = (ontologyId: number, name: string, data: Process) =>
  request<Process>(`/api/ontologies/${ontologyId}/processes/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Security ──────────────────────────────────────────────────────────────

export interface Security {
  action_name: string;
  audit_node: string;
  audit_content?: string;
}

export const getSecurities = (ontologyId: number) =>
  request<Security[]>(`/api/ontologies/${ontologyId}/securities`);

export const createSecurity = (ontologyId: number, data: Security) =>
  request<Security>(`/api/ontologies/${ontologyId}/securities`, { method: 'POST', body: JSON.stringify(data) });

export const deleteSecurity = (ontologyId: number, action_name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/securities/${encodeURIComponent(action_name)}`, { method: 'DELETE' });

export const updateSecurity = (ontologyId: number, action_name: string, data: Security) =>
  request<Security>(`/api/ontologies/${ontologyId}/securities/${encodeURIComponent(action_name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Data Engine ──────────────────────────────────────────────────────────────

export interface TargetApiConfig {
  data_source_name: string;
  api_name: string;
  url: string;
  method: string;
  params: Record<string, unknown>;
  response: Record<string, unknown>;
}

export interface DataEngine {
  name: string;
  display_name?: string;
  behavior_name: string;
  engine_type?: string;
  target: TargetApiConfig;
  input_mapping: Record<string, string>;
  output_mapping: Record<string, string>;
  sql?: string;
  sql_vars?: Record<string, string>;
  datasource?: string;
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

export const callDataEngine = (ontologyId: number, engineName: string, params: Record<string, any>) =>
  request<any>(`/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(engineName)}/call`, { method: 'POST', body: JSON.stringify({ params }) });

export const callBehavior = (ontologyId: number, name: string, params: Record<string, any>) =>
  request<{ status_code: number; headers: Record<string, string>; data: any }>(
    `/api/ontologies/${ontologyId}/behaviors/${encodeURIComponent(name)}/call`,
    { method: 'POST', body: JSON.stringify({ params }) }
  );

export const smartParseTarget = (ontologyId: number, name: string, paramsContent: string, responseContent: string) =>
  request<{ api_name: string; data_source_name: string; url: string; method: string; params: Record<string, unknown>; response: Record<string, unknown> }>(
    `/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(name)}/smart-parse`,
    { method: 'POST', body: JSON.stringify({ params_content: paramsContent, response_content: responseContent }) }
  );

export const smartAlign = (ontologyId: number, name: string) =>
  request<{ params: Record<string, unknown>; response: Record<string, unknown> }>(
    `/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(name)}/smart-align`,
    { method: 'POST' }
  );

// ─── MCP Control ───────────────────────────────────────────────────────

export interface McpStatus {
  status: string;
  running: boolean;
  container: string;
}

export interface McpActionResult {
  message: string;
  running: boolean;
}

export const getMcpStatus = () =>
  request<McpStatus>('/api/mcp/status');

export const getMcpTools = async (host: string) => {
  const resp = await fetch(`http://${host}:8002/tools`);
  if (!resp.ok) {
    throw new Error(`获取 MCP 工具失败 (${resp.status})`);
  }
  return resp.json() as Promise<{ name: string; description: string }[]>;
};

export const startMcp = () =>
  request<McpActionResult>('/api/mcp/start', { method: 'POST' });

export const stopMcp = () =>
  request<McpActionResult>('/api/mcp/stop', { method: 'POST' });

// ─── Thread / Chat ────────────────────────────────────────────────────────

export interface ThreadSummary {
  id: string;
  title: string;
  status: string;
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
  created_at: string;
  updated_at: string;
  messages: ThreadMessage[];
}

export const getThreads = (query: string = '') =>
  request<ThreadSummary[]>(`/api/threads${query ? '?' + query : ''}`);

export const createThread = (title: string = '新对话', scenario_name: string = '', ontology_name: string = '') =>
  request<Thread>('/api/threads', { method: 'POST', body: JSON.stringify({ title, scenario_name, ontology_name }) });

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

export const generateOntology = (threadId: string, filename: string) =>
  request<{ message: string; scenario: string; ontology: string; concepts: number; relations: number; behaviors: number; rules: number; events: number }>(
    `/api/threads/${threadId}/generate-ontology`, { method: 'POST', body: JSON.stringify({ filename }) }
  );

export const exportThread = (id: string, title: string = 'requirement', selectedIndices: number[] = []) =>
  request<{ message: string; path: string; filename: string }>(`/api/threads/${id}/export`, { method: 'POST', body: JSON.stringify({ title, selected_indices: selectedIndices }) });

export const chatStream = (threadId: string, message: string): Promise<Response> =>
  fetch(`/api/threads/${threadId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

// ─── Requirement Files ───────────────────────────────────────────────────

export interface RequirementItem {
  filename: string;
  req_name: string;
  thread_id: string;
  thread_title: string;
  created_at: string;
  updated_at: string;
  has_ontology: boolean;
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

export interface YamlFile {
  path: string;
  content: string;
  updated_at?: string;
}

export const getFileContent = (ontologyId: number) =>
  request<YamlFile>(`/api/ontologies/${ontologyId}/files/content`);

// ─── DB Schema ────────────────────────────────────────────────────────────

export const getDbSchema = (ontologyId: number) =>
  request<{ content: string; exists: boolean }>(`/api/ontologies/${ontologyId}/db-schema`);

export const uploadDbSchema = async (ontologyId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/ontologies/${ontologyId}/db-schema`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `上传失败 (${res.status})`);
  }
  return res.json();
};

// ─── Generate SQL ─────────────────────────────────────────────────────────

export const generateSQL = (ontologyId: number, engineName: string) =>
  request<{ sql: string }>(`/api/ontologies/${ontologyId}/data-engines/${encodeURIComponent(engineName)}/generate-sql`, { method: 'POST' });

export const saveFileContent = (ontologyId: number, data: YamlFile) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/files/content`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Skill ────────────────────────────────────────────────────────────────

export interface SkillSummary {
  name: string;
  has_skill: boolean;
  format_ok: boolean;
  format_error?: string;
  description?: string;
  updated_at: number;
}

export interface SkillContent {
  content: string;
  skill_name: string;
}

export const getSkills = (ontologyId: number) =>
  request<SkillSummary[]>(`/api/ontologies/${ontologyId}/skills`);

export const getSkillContent = (ontologyId: number, name: string) =>
  request<SkillContent>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/content`);

export const saveSkillContent = (ontologyId: number, name: string, content: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/content`, { method: 'PUT', body: JSON.stringify({ content }) });

export const deleteSkill = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateSkillMeta = (ontologyId: number, name: string, data: { name?: string; description?: string }) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/meta`, { method: 'PUT', body: JSON.stringify(data) });

export const generateSkill = (ontologyId: number, name: string, description?: string) =>
  request<{ message: string; skill_name: string; content: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/generate`, { method: 'POST', body: JSON.stringify({ description: description || '' }) });
