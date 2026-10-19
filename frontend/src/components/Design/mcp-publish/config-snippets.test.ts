/**
 * 固定服务配置片段单测：三个对外工具面给出「宿主 + 容器内」两段，
 * 两个零工具底座只给内网端点说明。
 *
 * 为什么这么细：这两段分别给平台外客户端与平台内 Agent，地址互换即不可用
 * （localhost 在 Agent 容器里指向它自己）——结构、type、地址、禁止字段都是用户直接粘贴的对象。
 */
import { describe, it, expect } from 'vitest';
import { findServiceEntry, staticServiceConfig } from './config-snippets';
import { FIXED_SERVICES, type FixedServiceDef } from './catalog';
import type { MCPServerConfig } from '@/api/agent-client';

const byKey = (key: string) => FIXED_SERVICES.find(d => d.key === key)!;
const snippet = (json: string) => JSON.parse(json) as { mcpServers: Record<string, any> };

describe('staticServiceConfig：对外工具面给两段', () => {
  const cases = [
    { key: 'ontologyQuery', clientKey: 'optonto-ontology-query', host: 'http://h:8002/mcp', inner: 'http://optonto-ontology-query-mcp:8002/mcp' },
    { key: 'commonFunction', clientKey: 'optonto-common-function', host: 'http://h:8007/mcp', inner: 'http://optonto-common-function-mcp:8007/mcp' },
    { key: 'business', clientKey: 'optonto-business', host: 'http://h:8004/mcp', inner: 'http://optonto-business-mcp:8004/mcp' },
  ];

  for (const c of cases) {
    it(`${c.key}：第一段宿主地址、第二段容器内地址，结构一致`, () => {
      const cfg = staticServiceConfig(byKey(c.key), 'h');
      const first = snippet(cfg.json);
      expect(first.mcpServers[c.clientKey]).toEqual({ type: 'http', url: c.host });

      expect(cfg.extra).toHaveLength(1);
      const second = snippet(cfg.extra![0].json);
      expect(second.mcpServers[c.clientKey]).toEqual({ type: 'http', url: c.inner });
      // 两段用途必须明说（否则用户只能靠试错判断该复制哪段）
      expect(cfg.extra![0].label).toContain('容器内地址');
    });
  }

  it('片段 type 取客户端认的取值 http（不是自造的 url）', () => {
    for (const key of ['ontologyQuery', 'commonFunction', 'business']) {
      expect(staticServiceConfig(byKey(key), 'h').json).toContain('"type": "http"');
      expect(staticServiceConfig(byKey(key), 'h').json).not.toContain('"type": "url"');
    }
  });

  it('不出现平台管理字段（enabled / business_data / allowed_tools / builtin）', () => {
    for (const key of ['ontologyQuery', 'commonFunction', 'business']) {
      const cfg = staticServiceConfig(byKey(key), 'h');
      for (const text of [cfg.json, ...(cfg.extra || []).map(e => e.json)]) {
        for (const forbidden of ['"enabled"', '"business_data"', '"allowed_tools"', '"builtin"']) {
          expect(text).not.toContain(forbidden);
        }
      }
    }
  });
});

describe('staticServiceConfig：请求头按配置并入', () => {
  const headers = { 'X-MCP-Token': 'tk' };

  it('登记了请求头 → 两段都带上；未登记 → 整个 headers 字段不出现', () => {
    const withHeaders = staticServiceConfig(byKey('business'), 'h', { headers });
    expect(snippet(withHeaders.json).mcpServers['optonto-business'].headers).toEqual(headers);
    expect(snippet(withHeaders.extra![0].json).mcpServers['optonto-business'].headers).toEqual(headers);

    const without = staticServiceConfig(byKey('business'), 'h');
    expect(snippet(without.json).mcpServers['optonto-business']).not.toHaveProperty('headers');
  });
});

describe('staticServiceConfig：业务系统的登记状态与配置读取失败', () => {
  it('未登记 → 仍给两段，并提示先去「MCP 配置」页新增', () => {
    const cfg = staticServiceConfig(byKey('business'), 'h', { registered: false });
    expect(cfg.extra).toHaveLength(1);
    expect(cfg.note).toContain('MCP 配置');
  });

  it('读取配置失败 → 仍给两段，并说明请求头未带入（不整块报错）', () => {
    const cfg = staticServiceConfig(byKey('business'), 'h', { configError: 'boom' });
    expect(cfg.extra).toHaveLength(1);
    expect(cfg.note).toContain('请求头');
  });
});

describe('staticServiceConfig：零工具底座只给内网端点', () => {
  it('8006 端点清单只含 /execute-function（不含已迁移的公共函数端点）', () => {
    const cfg = staticServiceConfig(byKey('functionExecutor'), 'h');
    expect(cfg.json).toContain('/execute-function');
    expect(cfg.json).not.toContain('execute-common-function');
    expect(cfg.json).not.toContain('mcpServers');
    expect(cfg.extra).toBeUndefined();
  });

  it('8005 零工具（2026-10-19 方案 B）：只给执行端点，不给 MCP 连接片段', () => {
    const cfg = staticServiceConfig(byKey('dataEngine'), 'h');
    expect(cfg.json).toContain('/call-behavior');
    expect(cfg.json).not.toContain('mcpServers');
    expect(cfg.json).not.toContain('8005/mcp');
    expect(cfg.extra).toBeUndefined();
  });

  it('声明不完整（无协议端点且缺容器内地址）→ 退回内网说明，绝不编造可粘贴片段', () => {
    // 防御分支：新增服务时若漏填 internalEndpoint，宁可给出"没有片段"的说明，也不产出连不上的地址
    const broken: FixedServiceDef = { ...byKey('business'), transport: 'none', internalEndpoint: undefined };
    const cfg = staticServiceConfig(broken, 'h');
    expect(cfg.json).not.toContain('mcpServers');
    expect(cfg.extra).toBeUndefined();
    expect(cfg.note).toContain('不提供客户端配置片段');
  });
});

describe('findServiceEntry：按规范化地址在平台配置里定位条目', () => {
  const servers: MCPServerConfig[] = [
    { name: '业务系统采购与库存MCP', url: 'http://optonto-business-mcp:8004/mcp/', enabled: true, business_data: true },
    { name: '别的服务', url: 'http://other:9000/mcp', enabled: true },
  ];

  it('容器内地址命中（容忍尾部斜杠与空白）', () => {
    expect(findServiceEntry(byKey('business'), servers)?.name).toBe('业务系统采购与库存MCP');
  });

  it('宿主地址命中也算（用户可能填的是宿主地址）', () => {
    const hostOnly: MCPServerConfig[] = [
      { name: 'biz', url: 'http://example.com:8004/mcp', enabled: true, business_data: true },
    ];
    expect(findServiceEntry(byKey('business'), hostOnly)?.name).toBe('biz');
  });

  it('端口/路径都不同 → undefined（指向另一套服务时不误取请求头）', () => {
    const other: MCPServerConfig[] = [
      { name: '业务系统采购与库存MCP', url: 'http://biz.corp:9100/mcp', enabled: true },
    ];
    expect(findServiceEntry(byKey('business'), other)).toBeUndefined();
  });

  it('改名不影响判定（身份看地址，不看显示名）', () => {
    const renamed: MCPServerConfig[] = [
      { name: '客户自己的业务系统', url: 'http://optonto-business-mcp:8004/mcp', enabled: true },
    ];
    expect(findServiceEntry(byKey('business'), renamed)?.name).toBe('客户自己的业务系统');
  });
});
