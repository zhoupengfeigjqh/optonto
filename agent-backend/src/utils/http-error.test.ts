/**
 * 统一错误响应单测（章程 VI：统一错误格式）。
 * 覆盖：code 与 HTTP 状态码一致、message/detail/error 三字段同源、空消息兜底、状态码透传。
 */
import { describe, it, expect, vi } from 'vitest';
import { sendError } from './http-error.js';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { res: { status } as any, status, json };
}

describe('sendError — 统一错误响应', () => {
  it('输出 {code,message,detail,error} 且 code 等于 HTTP 状态码', () => {
    const { res, status, json } = mockRes();
    sendError(res, 400, '参数不合法');
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 400,
      message: '参数不合法',
      detail: '参数不合法',
      error: '参数不合法',
    });
  });

  it('同源：message/detail/error 三者一致（兼容旧前端解析）', () => {
    const { res, json } = mockRes();
    sendError(res, 404, '对话不存在');
    const body = json.mock.calls[0][0];
    expect(body.message).toBe(body.detail);
    expect(body.message).toBe(body.error);
  });

  it('空消息走兜底文案，不产生空串', () => {
    const { res, json } = mockRes();
    sendError(res, 500, '');
    expect(json.mock.calls[0][0].message).toBe('请求处理失败');
  });

  it('透传任意状态码（含 5xx）', () => {
    const { res, status } = mockRes();
    sendError(res, 503, '服务不可用');
    expect(status).toHaveBeenCalledWith(503);
  });
});
