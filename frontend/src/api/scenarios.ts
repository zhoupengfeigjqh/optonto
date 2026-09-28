/** 场景（Scenario）接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';

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
