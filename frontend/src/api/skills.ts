/** 技能（Skill）接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';

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

export const getSkills = (ontologyId: string) =>
  request<SkillSummary[]>(`/api/ontologies/${ontologyId}/skills`);

export const getSkillContent = (ontologyId: string, name: string) =>
  request<SkillContent>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/content`);

export const saveSkillContent = (ontologyId: string, name: string, content: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/content`, { method: 'PUT', body: JSON.stringify({ content }) });

export const deleteSkill = (ontologyId: string, name: string) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const updateSkillMeta = (ontologyId: string, name: string, data: { name?: string; description?: string }) =>
  request<{ message: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/meta`, { method: 'PUT', body: JSON.stringify(data) });

export const generateSkill = (ontologyId: string, name: string, description?: string) =>
  request<{ message: string; skill_name: string; content: string }>(`/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/generate`, { method: 'POST', body: JSON.stringify({ description: description || '' }) });
