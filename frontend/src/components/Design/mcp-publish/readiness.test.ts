/** 行为就绪判据单测：与后端 is_engine_ready 同口径（target 齐备 + engine_type 缺省/MCP + trim）。 */
import { describe, it, expect } from 'vitest';
import { isEngineReady, readyBehaviorNames } from './readiness';

describe('isEngineReady', () => {
  it('server_url 与 tool_name 齐备即就绪', () => {
    expect(isEngineReady({ behavior_name: 'B', target: { server_url: 'http://x:8004/mcp', tool_name: 't' } })).toBe(true);
  });

  it('字段为空或纯空白都不就绪', () => {
    expect(isEngineReady({ target: { server_url: '', tool_name: 't' } })).toBe(false);
    expect(isEngineReady({ target: { server_url: '   ', tool_name: 't' } })).toBe(false);
    expect(isEngineReady({ target: { server_url: 'http://x', tool_name: '' } })).toBe(false);
    expect(isEngineReady({ target: {} })).toBe(false);
    expect(isEngineReady({})).toBe(false);
    expect(isEngineReady(null)).toBe(false);
    expect(isEngineReady(undefined)).toBe(false);
  });

  it('engine_type 非 MCP 不就绪；缺省或 MCP 就绪', () => {
    const base = { target: { server_url: 'http://x', tool_name: 't' } };
    expect(isEngineReady({ ...base, engine_type: 'MCP' })).toBe(true);
    expect(isEngineReady({ ...base })).toBe(true);
    expect(isEngineReady({ ...base, engine_type: 'HTTP' })).toBe(false);
  });
});

describe('readyBehaviorNames', () => {
  it('仅收集就绪且带 behavior_name 的引擎', () => {
    const names = readyBehaviorNames([
      { behavior_name: 'A', target: { server_url: 'http://x', tool_name: 't' } },
      { behavior_name: 'B', target: { server_url: '  ', tool_name: 't' } },
      { behavior_name: '', target: { server_url: 'http://x', tool_name: 't' } },
    ]);
    expect([...names]).toEqual(['A']);
  });

  it('空输入返回空集合', () => {
    expect(readyBehaviorNames(null).size).toBe(0);
    expect(readyBehaviorNames([]).size).toBe(0);
  });
});
