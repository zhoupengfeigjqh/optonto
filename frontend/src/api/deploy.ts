/** 本体部署（版本合并预览 + 部署）接口 —— 自原 client.ts 拆出，行为不变。 */
import { request } from './http';

export interface DeployDoc { md: string; yaml: string; thread_id: string; thread_title: string }

export const getDeployVersions = (ontologyId: number) =>
  request<{ versions: { version: string; docs: DeployDoc[]; count: number }[] }>(`/api/ontologies/${ontologyId}/deploy/versions`);

export const getDeployPreview = (ontologyId: number, version: string) =>
  request<{ version: string; docs: DeployDoc[]; merged: Record<string, any>; stats: Record<string, number> }>(
    `/api/ontologies/${ontologyId}/deploy/preview?version=${encodeURIComponent(version)}`
  );

/** 检查版本是否已存档到 ontology_versions */
export const checkVersionExists = (ontologyId: number, version: string) =>
  request<{ exists: boolean }>(`/api/ontologies/${ontologyId}/deploy/version-exists?version=${encodeURIComponent(version)}`);

/** 从 ontology_versions 读取已存档版本预览 */
export const getVersionPreview = (ontologyId: number, version: string) =>
  request<{ version: string; docs: DeployDoc[]; merged: Record<string, any>; stats: Record<string, number>; from_version_dir?: boolean }>(
    `/api/ontologies/${ontologyId}/deploy/version-preview?version=${encodeURIComponent(version)}`
  );

/** 本体合并：将 thread 合并结果保存到 ontology_versions/{version}/ */
export const saveVersionToDisk = (ontologyId: number, version: string) =>
  request<{ message: string; version: string; stats: Record<string, number> }>(
    `/api/ontologies/${ontologyId}/deploy/save-version`, { method: 'POST', body: JSON.stringify({ version }) }
  );

/** 获取当前部署的版本号 */
export const getDeployedVersion = (ontologyId: number) =>
  request<{ deployed_version: string }>(`/api/ontologies/${ontologyId}/deploy/deployed-version`);

export const deployOntology = (ontologyId: number, version: string) =>
  request<{ message: string; deployed_version: string; already_deployed: boolean; stats?: Record<string, number> }>(
    `/api/ontologies/${ontologyId}/deploy/deploy`, { method: 'POST', body: JSON.stringify({ version }) }
  );

/** 获取当前已部署的 ontology.yaml 内容 */
export const getDeployedOntology = (ontologyId: number) =>
  request<{ content: string }>(`/api/ontologies/${ontologyId}/deploy/deployed`);
