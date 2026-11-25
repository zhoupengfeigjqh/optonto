/**
 * 固定服务目录的单测：传输模式声明完整、客户端 type 映射唯一。
 *
 * 为什么值得单测：卡片上的「传输模式」与配置片段里的 `type` 都由此推导，
 * 漏声明 / 写错一个值，用户就会照着一个连不上的端点去配客户端。
 */
import { describe, it, expect } from 'vitest';
import {
  CLIENT_TYPE, FIXED_SERVICES, FIXED_TRANSPORT_LABEL, clientTypeOf, ontologySuffix,
  type FixedTransport,
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

  it('传输模式与服务端实际一致：8002/8007/8004 = streamable，8005/8006 = none', () => {
    const byKey = Object.fromEntries(FIXED_SERVICES.map(d => [d.key, d.transport]));
    expect(byKey).toEqual({
      ontologyQuery: 'streamable',
      commonFunction: 'streamable',
      dataEngine: 'none',
      business: 'streamable',
      functionExecutor: 'none',
    });
  });

  it('不挂协议端点（none）的只能是「内网 + 不提供对外工具」', () => {
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

describe('自建发布标题的本体后缀（区分同名/近名发布）', () => {
  it('本体信息齐全：括号内为「ontology_id · 本体名」', () => {
    expect(ontologySuffix({ ontology_id: '2', ontology_name: '订单排程' }))
      .toBe('（ontology_id=2 · 订单排程）');
  });

  it('本体名缺失时只挂 id（历史条目不因缺名而丢掉标识）', () => {
    expect(ontologySuffix({ ontology_id: '2', ontology_name: '' })).toBe('（ontology_id=2）');
  });

  it('本体 id 缺失时只挂名称', () => {
    expect(ontologySuffix({ ontology_id: '', ontology_name: '订单排程' })).toBe('（订单排程）');
  });

  it('两者都缺失：返回空串（标题不出现空括号）', () => {
    expect(ontologySuffix({ ontology_id: '', ontology_name: '' })).toBe('');
  });
});
