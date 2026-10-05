/**
 * 固定服务目录的单测：传输模式声明完整、客户端 type 映射唯一。
 *
 * 为什么值得单测：卡片上的「传输模式」与配置片段里的 `type` 都由此推导，
 * 漏声明 / 写错一个值，用户就会照着一个连不上的端点去配客户端。
 */
import { describe, it, expect } from 'vitest';
import {
  CLIENT_TYPE, FIXED_SERVICES, FIXED_TRANSPORT_LABEL, clientTypeOf, type FixedTransport,
} from './catalog';

const ALL_TRANSPORTS: FixedTransport[] = ['streamable', 'sse', 'none'];

describe('固定服务传输模式', () => {
  it('五个固定服务都声明了传输模式，且都有展示文案', () => {
    expect(FIXED_SERVICES).toHaveLength(5);
    for (const def of FIXED_SERVICES) {
      expect(ALL_TRANSPORTS).toContain(def.transport);
      expect(FIXED_TRANSPORT_LABEL[def.transport]).toBeTruthy();
    }
  });

  it('传输模式与服务端实际一致：8002/8007/8004/8005 = streamable，8006 = none', () => {
    const byKey = Object.fromEntries(FIXED_SERVICES.map(d => [d.key, d.transport]));
    expect(byKey).toEqual({
      ontologyQuery: 'streamable',
      commonFunction: 'streamable',
      dataEngine: 'streamable',
      business: 'streamable',
      functionExecutor: 'none',
    });
  });

  it('不挂协议端点（none）的只能是「内网 + 不提供对外工具」', () => {
    // 反向不成立：数据引擎执行服务是 streamable 但 publishTools=false（有 /mcp，仅供内网挂载）
    for (const def of FIXED_SERVICES) {
      if (def.transport !== 'none') continue;
      expect(def.publishTools).toBe(false);
      expect(def.exposure).toBe('内网');
    }
  });
});

describe('客户端配置 type 映射（平台传输模式 → 客户端取值）', () => {
  it('streamable → http、sse → sse（不是自造的 url）', () => {
    expect(CLIENT_TYPE).toEqual({ streamable: 'http', sse: 'sse' });
    expect(clientTypeOf('streamable')).toBe('http');
    expect(clientTypeOf('sse')).toBe('sse');
  });

  it('none 没有可粘贴的连接片段 → null（不产出 type）', () => {
    expect(clientTypeOf('none')).toBeNull();
  });
});
