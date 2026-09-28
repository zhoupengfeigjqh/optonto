/**
 * 统一错误解析单测（章程 VI：前后端按同一契约解析错误）。
 * 覆盖三类条件：属性传递（不同响应体形态）、事件触发（无）、边界（空体/非 JSON/数组）。
 */
import { describe, it, expect } from 'vitest';
import { extractErrorMessage } from './http-error';

describe('extractErrorMessage — 统一错误契约解析', () => {
  it('优先读 message（core-backend 统一结构）', () => {
    expect(extractErrorMessage({ code: 404, message: '本体不存在', detail: '本体不存在' }, 404))
      .toBe('本体不存在');
  });

  it('message 缺失时回退 error 别名（agent-backend 兼容字段）', () => {
    expect(extractErrorMessage({ code: 400, error: '缺少 MCP 服务 URL' }, 400))
      .toBe('缺少 MCP 服务 URL');
  });

  it('message/error 缺失时回退 detail 字符串（旧结构）', () => {
    expect(extractErrorMessage({ detail: '旧版错误文本' }, 400)).toBe('旧版错误文本');
  });

  it('detail 为数组（FastAPI 校验错误）时折叠为首条可读信息', () => {
    const body = { detail: [{ loc: ['path', 'ontology_id'], msg: 'Input should be a valid integer' }] };
    expect(extractErrorMessage(body, 422)).toBe('参数校验失败: Input should be a valid integer');
  });

  it('边界：空体 / null / 非对象 → 回退状态码文案', () => {
    expect(extractErrorMessage(null, 500)).toBe('请求失败（HTTP 500）');
    expect(extractErrorMessage(undefined, 502)).toBe('请求失败（HTTP 502）');
    expect(extractErrorMessage('', 503)).toBe('请求失败（HTTP 503）');
    expect(extractErrorMessage('plain text', 504)).toBe('请求失败（HTTP 504）');
  });

  it('边界：字段为空串或无 msg 的数组 → 仍回退状态码文案', () => {
    expect(extractErrorMessage({ message: '', detail: '' }, 400)).toBe('请求失败（HTTP 400）');
    expect(extractErrorMessage({ detail: [{}] }, 422)).toBe('请求失败（HTTP 422）');
    expect(extractErrorMessage({ detail: [] }, 422)).toBe('请求失败（HTTP 422）');
  });
});
