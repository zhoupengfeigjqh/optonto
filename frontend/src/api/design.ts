/**
 * 本体设计要素接口（概念/关系/函数/行为/规则/流程/安全）—— 自原 client.ts 拆出，行为不变。
 */
import { request } from './http';

// ─── Concept ───────────────────────────────────────────────────────────────

export interface AttributeConstraint {
  unique?: boolean;
  required?: boolean;
  enum?: (string | number)[];
  pattern?: string;
  min?: number;
  max?: number;
}

export interface Attribute {
  name: string;
  type: string;
  display_name?: string;
  description?: string;
  example?: string;
  constraint?: AttributeConstraint | null;
}

export interface Concept {
  name: string;
  description: string;
  attributes?: Attribute[];
  display_name?: string;
  instance_label?: string;
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
  source_attr?: string;
  target_attr?: string;
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

// ─── Function ───────────────────────────────────────────────────────────────

export interface Function {
  name: string;
  display_name?: string;
  description?: string;
  related_concepts: string[];
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
  op_type?: string;
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

// ─── Security（行为安全管控，独立 securities.yaml 全花名册存储，六字段齐全） ────────

export interface Security {
  action_name: string;
  /** 行为展示名称（后端保存时从行为定义刷新，只读快照） */
  display_name?: string;
  /** 操作类型 command/query（后端保存时推导刷新，只读快照） */
  op_type?: string;
  /** 权限范围（恒数组，类型稳定）：['everyone']=所有用户（默认）/['disable']=全部禁用/用户或组织白名单（后续） */
  scope: string[];
  /** 人工确认：true=执行前弹窗确认（command 默认），false=显式关闭 */
  confirm: boolean;
  /** 确认内容（弹窗提示文案，留空用通用文案） */
  confirm_content?: string;
}

export const getSecurities = (ontologyId: number) =>
  request<Security[]>(`/api/ontologies/${ontologyId}/securities`);

export const createSecurity = (ontologyId: number, data: Security) =>
  request<Security>(`/api/ontologies/${ontologyId}/securities`, { method: 'POST', body: JSON.stringify(data) });

export const deleteSecurity = (ontologyId: number, action_name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/securities/${encodeURIComponent(action_name)}`, { method: 'DELETE' });

export const updateSecurity = (ontologyId: number, action_name: string, data: Security) =>
  request<Security>(`/api/ontologies/${ontologyId}/securities/${encodeURIComponent(action_name)}`, { method: 'PUT', body: JSON.stringify(data) });
