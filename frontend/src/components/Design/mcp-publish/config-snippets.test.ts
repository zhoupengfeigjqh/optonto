/** 固定服务配置片段单测：对外工具面给连接片段，执行底座只给内网端点。 */
import { describe, it, expect } from 'vitest';
import { staticServiceConfig } from './config-snippets';
import { FIXED_SERVICES } from './catalog';

const byKey = (key: string) => FIXED_SERVICES.find(d => d.key === key)!;

describe('staticServiceConfig', () => {
  it('本体查询 / 公共函数给出可粘贴的对外连接片段', () => {
    const q = staticServiceConfig(byKey('ontologyQuery'), 'example.com');
    expect(q).not.toBeNull();
    expect(q!.json).toContain('http://example.com:8002/mcp');

    const c = staticServiceConfig(byKey('commonFunction'), 'example.com');
    expect(c!.json).toContain('http://example.com:8007/mcp');
  });

  it('片段 type 取客户端认的取值 http（不是自造的 url）', () => {
    const json = staticServiceConfig(byKey('ontologyQuery'), 'h')!.json;
    expect(json).toContain('"type": "http"');
    expect(json).not.toContain('"type": "url"');
    expect(staticServiceConfig(byKey('commonFunction'), 'h')!.json).toContain('"type": "http"');
  });

  it('执行底座只给内网端点；8006 端点清单不含已迁移的公共函数端点', () => {
    const fe = staticServiceConfig(byKey('functionExecutor'), 'h')!;
    expect(fe.json).toContain('/execute-function');
    expect(fe.json).not.toContain('execute-common-function');

    const de = staticServiceConfig(byKey('dataEngine'), 'h')!;
    expect(de.json).toContain('/call-behavior');
  });

  it('业务系统 MCP 返回 null（需异步读「MCP 配置」页）', () => {
    expect(staticServiceConfig(byKey('business'), 'h')).toBeNull();
  });
});
