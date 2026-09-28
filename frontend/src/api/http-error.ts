/**
 * 统一错误响应解析（章程 VI：前后端按同一契约解析错误）。
 *
 * 服务端契约：
 * - core-backend：`{code, message, detail}`（detail 为字符串）
 * - agent-backend：`{code, message, detail, error}`（error 为兼容别名）
 * - 网关/代理异常：可能返回非 JSON 或空体
 *
 * 兼容三种历史形态：`message` 字符串 → `detail` 字符串 → `detail` 数组（FastAPI 校验错误）。
 * 独立成模块是为了让错误解析可被单测直接覆盖（原先内联在两个 client 中，无法测到分支）。
 */

export interface ApiErrorBody {
  code?: number;
  message?: string;
  detail?: unknown;
  /** @deprecated 兼容别名，新代码应读 message */
  error?: string;
}

/** 从错误响应体提取可读信息；无法识别时回退到状态码文案。 */
export function extractErrorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as ApiErrorBody;
  if (typeof b.message === 'string' && b.message) return b.message;
  if (typeof b.error === 'string' && b.error) return b.error;
  if (typeof b.detail === 'string' && b.detail) return b.detail;
  if (Array.isArray(b.detail)) {
    const first = b.detail[0] as { msg?: string } | undefined;
    if (first?.msg) return `参数校验失败: ${first.msg}`;
  }
  return `请求失败（HTTP ${status}）`;
}
