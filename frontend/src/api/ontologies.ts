/** 本体（Ontology）与本体文件接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';
import type { Behavior, Concept, Function, Process, Relation, Rule, Security } from './design';
import type { DataEngine } from './data-engines';

export interface Ontology {
  id: number;
  scenario_id: number;
  name: string;
  description: string;
  creator: string;
  scenario_name?: string;
  /** 已部署版本（从 ontology.yaml metadata.deployed_version 解析，空串表示未部署） */
  deployed_version?: string;
  created_at: string;
  updated_at: string;
}

export interface OntologyData {
  concepts: Concept[];
  relations: Relation[];
  behaviors: Behavior[];
  rules: Rule[];
  processes: Process[];
  securities: Security[];
  data_engines: DataEngine[];
  functions?: Function[];
}

export const getOntologies = (scenarioId: number) =>
  request<Ontology[]>(`/api/ontologies/by-scenario/${scenarioId}`);

/** 跨场景全量本体列表（智能体对话的本体范围选择器用；条目含 scenario_name/ontology_name） */
export interface OntologyScopeOption {
  id: number;
  scenario_name: string;
  ontology_name: string;
  description?: string;
}
export const listAllOntologies = () =>
  request<OntologyScopeOption[]>('/api/ontologies');

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

// ─── 本体 YAML 文件 ───────────────────────────────────────────────────────

export interface YamlFile {
  path: string;
  content: string;
  updated_at?: string;
}

export const getFileContent = (ontologyId: number) =>
  request<YamlFile>(`/api/ontologies/${ontologyId}/files/content`);

export const saveFileContent = (ontologyId: number, data: YamlFile) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/files/content`, { method: 'PUT', body: JSON.stringify(data) });
