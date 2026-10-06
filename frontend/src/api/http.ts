/**
 * 后端 REST 请求底座（章程 VI：统一错误解析）。
 *
 * 自原 `client.ts` 拆出，行为不变；各领域模块（scenarios/ontologies/...）复用同一 `request`，
 * 避免每个模块各写一份 fetch 与错误处理。
 */
import { extractErrorMessage } from './http-error';

const API_BASE = ''; // 使用相对路径，由 Nginx 代理到后端

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // 2026-10-05（审查 m7）修正合并顺序：原先 `headers` 写在 `...options` 之前，
  // 调用方传 `options.headers` 会**整块覆盖** Content-Type（JSON 体丢正确头）。
  // 现让 options 先落地、headers 再叠加——保住默认头同时不丢调用方的头。
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(body, res.status));
  }
  return res.json();
}
