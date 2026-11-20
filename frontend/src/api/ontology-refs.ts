/**
 * 存量本体引用接口（spec 010）：候选清单 + 创建前预检。
 *
 * 契约见 `specs/010-ontology-reuse-context/contracts/ontology-refs.md` A.1 / A.2。
 * 预检是**纯计算**（不落盘），创建才是权威校验点——前端不得据此跳过创建侧校验。
 */
import { request } from './http';

/** 三类顶层条目数（概念不展开属性） */
export interface RefCandidateCounts {
  concepts: number;
  functions: number;
  behaviors: number;
}

export interface OntologyRefCandidate {
  ontology_id: string;
  scenario_id: string;
  scenario_name: string;
  ontology_name: string;
  description: string;
  deployed_version: string;
  counts: RefCandidateCounts;
  referenceable: boolean;
  skip_reason: string | null;
}

export type ConflictKind = 'concept_attribute_mismatch' | 'cross_category_duplicate';

export interface RefConflictParticipant {
  scenario_name: string;
  ontology_name: string;
  detail: string;
}

export interface RefConflict {
  kind: ConflictKind;
  name: string;
  /** 仅跨类目冲突给出涉及的类目（concept / function / behavior） */
  category?: string[] | null;
  participants: RefConflictParticipant[];
  /** 仅同名概念属性不一致时非空，句式由后端固定 */
  differences: string[];
}

export interface PrecheckResult {
  allowed: boolean;
  max_tokens: number;
  token_estimate: number;
  conflicts: RefConflict[];
  reason: string | null;
}

export interface OntologyRefInput {
  scenario_name: string;
  ontology_name: string;
}

export const listOntologyRefCandidates = (params?: {
  excludeScenario?: string;
  excludeOntology?: string;
}) => {
  const search = new URLSearchParams();
  // 二者必须同时给出才生效（后端契约 A.1）
  if (params?.excludeScenario && params?.excludeOntology) {
    search.set('exclude_scenario', params.excludeScenario);
    search.set('exclude_ontology', params.excludeOntology);
  }
  const query = search.toString();
  return request<{ candidates: OntologyRefCandidate[]; max_count: number }>(
    `/api/ontology-refs/candidates${query ? '?' + query : ''}`,
  );
};

export const precheckOntologyRefs = (refs: OntologyRefInput[]) =>
  request<PrecheckResult>('/api/ontology-refs/precheck', {
    method: 'POST',
    body: JSON.stringify({ refs }),
  });
