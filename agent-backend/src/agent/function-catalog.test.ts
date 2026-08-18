/**
 * FunctionCatalog 单元测试 —— 三源合一 join 经 view() 接口测试（interface 即测试面）。
 * 覆盖：合法名并集/去重、参数声明按序取源（gateway 优先、MCP 目录兜底、null 跳过语义）、
 * 非"其他MCP工具"条目不泄漏进视图。
 */
import { describe, it, expect } from 'vitest';
import { FunctionCatalog } from './function-catalog.js';
import type { MountableToolInfo, OntologyGatewayPort } from './agent-ports.js';

function fakeGateway(): OntologyGatewayPort {
  return {
    getBehaviorNames: () => [],
    getBehaviorMeta: () => ({ params: {}, preRules: [], postRules: [], concepts: [], isWrite: false }),
    getFunctionMeta: () => ({ display_name: '' }),
    getFunctionNames: () => ['sumRawNotArrivalQty', 'calcSafetyStock'], // 本体∪公共（gateway 侧）
    getFunctionParams: (_s, _o, fn) =>
      fn === 'sumRawNotArrivalQty' ? { purchaseRecordSet: { required: true, type: 'array' } } : null,
  };
}

function mcpTool(name: string, category: MountableToolInfo['category'], params: Record<string, any> = {}): MountableToolInfo {
  return { name, category, description: '', params };
}

describe('FunctionCatalog.view — functionNames', () => {
  it('合法名 = gateway（本体∪公共）∪ 目录中的其他MCP工具', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      mcpTool('generate_line_chart', '其他MCP工具'),
    ]).view();
    const names = view.functionNames('生产调度', '原材料采购和库存');
    expect(names).toContain('sumRawNotArrivalQty');
    expect(names).toContain('generate_line_chart');
  });

  it('目录中的本体函数/公共函数条目不重复计入（gateway 已覆盖，去重）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      mcpTool('calcSafetyStock', '本体函数'),
      mcpTool('getCurrentDate', '公共函数'),
      mcpTool('weatherQuery', '其他MCP工具'),
    ]).view();
    const names = view.functionNames('s', 'o');
    expect(names.filter(n => n === 'calcSafetyStock')).toHaveLength(1);
    expect(names).not.toContain('getCurrentDate'); // 公共函数条目非"其他MCP工具"，不进视图补充（fake gateway 未声明它）
    expect(names).toContain('weatherQuery');
  });
});

describe('FunctionCatalog.view — functionParams', () => {
  it('gateway 有声明 → 优先用 gateway（本体函数按所属本体拦截语义保留）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      mcpTool('sumRawNotArrivalQty', '其他MCP工具', { other: { required: true, type: 'string' } }),
    ]).view();
    expect(view.functionParams('s', 'o', 'sumRawNotArrivalQty')).toEqual({ purchaseRecordSet: { required: true, type: 'array' } });
  });

  it('gateway 无声明 → 兜底到其他MCP工具目录声明', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      mcpTool('generate_line_chart', '其他MCP工具', { data: { required: true, type: 'array' } }),
    ]).view();
    expect(view.functionParams('s', 'o', 'generate_line_chart')).toEqual({ data: { required: true, type: 'array' } });
  });

  it('三源都无声明 → null（跳过结构校验，MCP schema 兜底）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => []).view();
    expect(view.functionParams('s', 'o', 'calcSafetyStock')).toBeNull();
    expect(view.functionParams('s', 'o', 'notExistFn')).toBeNull();
  });
});
