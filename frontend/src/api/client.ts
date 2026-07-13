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
export const deleteScenario = (id: number) =>
  request<{ message: string }>(`/api/scenarios/${id}`, { method: 'DELETE' });

// ─── Ontology ──────────────────────────────────────────────────────────────

export interface Ontology {
  id: number;
  scenario_id: number;
  name: string;
  description: string;
  creator: string;
  created_at: string;
  updated_at: string;
}

export interface OntologyData {
  concepts: Concept[];
  relations: Relation[];
  behaviors: Behavior[];
  rules: Rule[];
  events: Event[];
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

export const updateOntologyData = (id: number, data: OntologyData) =>
  request<OntologyData>(`/api/ontologies/${id}/data`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Concept ───────────────────────────────────────────────────────────────

export interface Attribute {
  name: string;
  type: string;
  required?: boolean;
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

// ─── Behavior ──────────────────────────────────────────────────────────────

export interface Behavior {
  name: string;
  description: string;
  url: string;
  method: string;
  params: Record<string, unknown>;
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
  display_name?: string;
  rule_type?: string;
  position?: string;
}

export const getRules = (ontologyId: number) =>
  request<Rule[]>(`/api/ontologies/${ontologyId}/rules`);

export const createRule = (ontologyId: number, data: Rule) =>
  request<Rule>(`/api/ontologies/${ontologyId}/rules`, { method: 'POST', body: JSON.stringify(data) });

export const deleteRule = (ontologyId: number, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/rules/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateRule = (ontologyId: number, name: string, data: Rule) =>
  request<Rule>(`/api/ontologies/${ontologyId}/rules/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });

// ─── Event ─────────────────────────────────────────────────────────────────

export interface Event {
  name: string;
  description: string;
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


export interface YamlFile {
  path: string;
  content: string;
}

export const getFileContent = (ontologyId: number) =>
  request<YamlFile>(`/api/ontologies/${ontologyId}/files/content`);

export const saveFileContent = (ontologyId: number, data: YamlFile) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/files/content`, { method: 'PUT', body: JSON.stringify(data) });
