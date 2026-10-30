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
  title?: string;
  description?: string;
  example?: string;
  constraint?: AttributeConstraint | null;
}

/**
 * 继承属性的收窄（spec 005）：只能收窄不能放宽。
 * 缺省（undefined）= 该维度完全继承父概念。
 */
export interface AttributeRestriction {
  /** 父有效枚举的非空子集（只删不增） */
  enum?: (string | number)[];
  /** 不得小于父最小值 */
  min?: number;
  /** 不得大于父最大值 */
  max?: number;
  /** 覆盖父匹配模式；空串 = 显式清除父模式 */
  pattern?: string;
}

/** 继承来的属性（只读派生结果，值已按整条继承链合成） */
export interface InheritedAttribute extends Attribute {
  /** 属性实际声明的概念名（继承源头） */
  inherited_from?: string;
  /** 本概念是否对该属性做了收窄 */
  restricted?: boolean;
}

export interface Concept {
  name: string;
  description: string;
  /** 仅本概念自有的属性声明（继承项不落盘） */
  attributes?: Attribute[];
  title?: string;
  instance_label?: string;
  /** 术语集：该概念的其他表述（同义词/别名/简称等）；与 instance_label 平级 */
  terms?: string[];
  /** 父概念（OWL subClassOf），至多 1 个；空 = 根概念 */
  sub_class_of?: string | null;
  /** 对继承属性的收窄（key = 属性英文名） */
  attribute_restrictions?: Record<string, AttributeRestriction>;
  /** 继承属性（服务端派生，只读） */
  inherited_attributes?: InheritedAttribute[];
}

/** 有效属性 = 自有 ∪ 继承（继承项在后，同名继承优先已由服务端保证） */
export const effectiveAttributes = (c?: Concept | null): Attribute[] => [
  ...(c?.attributes || []),
  ...(c?.inherited_attributes || []),
];

export const getConcepts = (ontologyId: number) =>
  request<Concept[]>(`/api/ontologies/${ontologyId}/concepts`);

export const createConcept = (ontologyId: number, data: Concept) =>
  request<Concept>(`/api/ontologies/${ontologyId}/concepts`, { method: 'POST', body: JSON.stringify(data) });

export const deleteConcept = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/concepts/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateConcept = (ontologyId: number, name: string, data: Concept) =>
  request<Concept>(`/api/ontologies/${ontologyId}/concepts/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

export const updateAttributes = (
  ontologyId: number,
  conceptName: string,
  attributes: Attribute[],
  attributeRestrictions?: Record<string, AttributeRestriction>,
) =>
  request<Attribute[]>(`/api/ontologies/${ontologyId}/concepts/${encodeURIComponent(conceptName)}/attributes`, {
    method: 'PUT',
    // 传了 restrictions 才用对象形态；省略时保持历史裸数组契约
    body: JSON.stringify(attributeRestrictions === undefined ? attributes : { attributes, attribute_restrictions: attributeRestrictions }),
  });

// ─── Relation ──────────────────────────────────────────────────────────────

export interface Relation {
  name: string;
  source: string;
  target: string;
  cardinality: string;
  /** 关系类型（可多选，大驼峰）：Asymmetric/Symmetric/Transitive/Functional/InverseFunctional */
  relation_type?: string[];
  source_attr?: string;
  target_attr?: string;
  description: string;
  title?: string;
}

export const getRelations = (ontologyId: number) =>
  request<Relation[]>(`/api/ontologies/${ontologyId}/relations`);

export const createRelation = (ontologyId: number, data: Relation) =>
  request<Relation>(`/api/ontologies/${ontologyId}/relations`, { method: 'POST', body: JSON.stringify(data) });

export const deleteRelation = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/relations/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateRelation = (ontologyId: number, name: string, data: Relation) =>
  request<Relation>(`/api/ontologies/${ontologyId}/relations/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── ConceptRelation（概念关系：类级公理，无基数） ─────────────────────────────

export type ConceptRelationType = 'SubClassOf' | 'EquivalentClass' | 'DisjointWith';

/**
 * 概念关系。`SubClassOf` 的成员关系由概念设计的父子关系派生（只读，仅关联概念属性可改），
 * 用户手工新增只允许 `EquivalentClass` / `DisjointWith`。
 */
export interface ConceptRelation {
  name: string;
  title?: string;
  relation_type: ConceptRelationType;
  /** SubClassOf：源 = 子概念 */
  source: string;
  /** SubClassOf：目标 = 父概念 */
  target: string;
  source_attr?: string;
  target_attr?: string;
  description?: string;
}

export const getConceptRelations = (ontologyId: number) =>
  request<ConceptRelation[]>(`/api/ontologies/${ontologyId}/concept-relations`);

export const createConceptRelation = (ontologyId: number, data: ConceptRelation) =>
  request<ConceptRelation>(`/api/ontologies/${ontologyId}/concept-relations`, { method: 'POST', body: JSON.stringify(data) });

export const updateConceptRelation = (ontologyId: number, name: string, data: ConceptRelation) =>
  request<ConceptRelation>(`/api/ontologies/${ontologyId}/concept-relations/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteConceptRelation = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/concept-relations/${encodeURIComponent(name)}`, { method: 'DELETE' });

// ─── Function ───────────────────────────────────────────────────────────────

export interface Function {
  name: string;
  title?: string;
  description?: string;
  related_concepts: string[];
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  code_file?: string;
  /** 函数类型：TRANSFORMATION/CALCULATION/DERIVATION/VALIDATION/MODEL（英文码，单选） */
  type?: string;
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
  request<{ success: boolean; data: any; error: any }>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}/execute`, { method: 'POST', body: JSON.stringify({ params }) });

export const updateFunction = (ontologyId: number, name: string, data: Function) =>
  request<Function>(`/api/ontologies/${ontologyId}/functions/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Behavior ──────────────────────────────────────────────────────────────

export interface Behavior {
  name: string;
  description: string;
  op_type?: string;
  params: Record<string, unknown>;
  response?: Record<string, unknown>;
  /** 关联概念（唯一）：行为只关联一个概念，其 status 属性枚举即状态机取值来源 */
  concept: string;
  title?: string;
  /** 源状态：command 行为的状态机跃迁起点（取自关联概念 status 属性的枚举） */
  from_status?: string;
  /** 目标状态：command 行为的状态机跃迁终点 */
  to_status?: string;
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
  /** 绑定行为（唯一） */
  behavior: string;
  /** 关联函数（本体∪公共）；其中本体且 type=VALIDATION 者为判断函数——返回 data.pass/reason，前置判断不通过时系统拒绝主行为 */
  related_functions: string[];
  /** 数据补充（可多选 query 行为；按关联函数声明的关联概念自动推导，可手工增减） */
  data_supplements?: string[];
  title?: string;
  position?: string;
}

export const getRules = (ontologyId: number) =>
  request<Rule[]>(`/api/ontologies/${ontologyId}/rules`);

export const generateRule = (ontologyId: number, data: any) =>
  request<{ related_functions: string[]; reasoning: string }>(`/api/ontologies/${ontologyId}/rules/generate`, { method: 'POST', body: JSON.stringify(data) });
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
  title?: string;
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
  title?: string;
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
