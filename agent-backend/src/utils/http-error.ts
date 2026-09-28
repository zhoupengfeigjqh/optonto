import type { Response } from 'express';

/**
 * 统一错误响应（章程 VI：统一错误响应格式）。
 *
 * 响应体固定为 { code, message, detail, error }：
 * - code：稳定语义码，与 HTTP 状态码一致（后续可在不改结构前提下细分业务码）
 * - message / detail：面向用户的权威错误文本
 * - error：兼容既有前端解析（agent-client.ts）的过渡别名，新代码 MUST 读 message
 */
export function sendError(res: Response, status: number, message: string): void {
  const text = message || '请求处理失败';
  res.status(status).json({ code: status, message: text, detail: text, error: text });
}

/** 统一错误体的 TypeScript 形状（前端/测试共用） */
export interface ApiErrorBody {
  code: number;
  message: string;
  detail: string;
  /** @deprecated 兼容别名，请使用 message */
  error: string;
}
