/**
 * FunctionCatalog 单元测试 —— 三源合一 join 经 view() 接口测试（interface 即测试面）。
 * 覆盖两种模式：
 *  正常模式（MCP 目录为准）：①本体函数按 scope 过滤 / ②公共函数全局 / ③其他MCP工具全局，
 *   functionInfo 按 ①→②→③ 取源，displayName 取发布方标记；
 *  文件兜底模式（目录缺①②）：①②回落 gateway 文件声明，③仍走目录，console.warn 告警。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FunctionCatalog } from './function-catalog.js';
import type { MountableToolInfo, OntologyGatewayPort } from './agent-ports.js';

afterEach(() => {
  vi.restoreAllMocks(); // console.warn spy 复位（vitest4：用 afterEach 清而非 beforeEach reset）
});

function fakeGateway(): OntologyGatewayPort {
  return {
    getBehaviorNames: () => [],
    getBehaviorMeta: () => ({ params: {}, preRules: [], postRules: [], concepts: [], isWrite: false }),
    getFunctionNames: () => ['sumRawNotArrivalQty', 'calcSafetyStock'], // 文件两源（yaml∪json）
    getFunctionInfo: (_scenario, _ontology, fn) =>
      fn === 'sumRawNotArrivalQty'
        ? { display_name: '原料未到货量汇总', params: { purchaseRecordSet: { required: true, type: 'array' } }, concepts: [] }
        : null,
  };
}

/** 本体函数目录项（带 scope 供本体过滤） */
function ontoTool(name: string, scenario: string, ontology: string, params: Record<string, any> = {}, displayName = ''): MountableToolInfo {
  return { name, category: '本体函数', description: '', params, displayName, scope: { scenario_name: scenario, ontology_name: ontology } };
}

function commonTool(name: string, params: Record<string, any> = {}, displayName = ''): MountableToolInfo {
  return { name, category: '公共函数', description: '', params, displayName };
}

function otherTool(name: string, params: Record<string, any> = {}, displayName = ''): MountableToolInfo {
  return { name, category: '其他MCP工具', description: '', params, displayName };
}

const SC = '生产调度';
const ON = '原材料采购和库存';

/** 正常模式目录：①②③各一条 */
function normalCatalog(): MountableToolInfo[] {
  return [
    ontoTool('sumRawNotArrivalQty', SC, ON, { purchaseRecordSet: { required: true, type: 'array' } }, '原料未到货量汇总'),
    commonTool('getCurrentDate', {}, '获取当前日期'),
    otherTool('generate_line_chart', { data: { required: true, type: 'array' } }, '折线图生成'),
  ];
}

describe('正常模式 — functionNames', () => {
  it('合法名 = ①按本体过滤 ∪ ②全局 ∪ ③全局，与 gateway 无关', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      ...normalCatalog(),
      ontoTool('otherOntoFn', '其他场景', '其他本体'), // 不属于目标本体 → 不出现
    ]).view();
    const names = view.functionNames(SC, ON);
    expect(names).toContain('sumRawNotArrivalQty');
    expect(names).toContain('getCurrentDate');
    expect(names).toContain('generate_line_chart');
    expect(names).not.toContain('otherOntoFn');
    expect(names).not.toContain('calcSafetyStock'); // gateway 文件声明在正常模式不参与
  });

  it('同名去重（①与③重名时只出现一次）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      ...normalCatalog(),
      otherTool('sumRawNotArrivalQty'),
    ]).view();
    const names = view.functionNames(SC, ON);
    expect(names.filter(n => n === 'sumRawNotArrivalQty')).toHaveLength(1);
  });
});

describe('正常模式 — functionInfo', () => {
  it('①本体函数：本体匹配 → 取目录声明（含 displayName 标记）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => normalCatalog()).view();
    expect(view.functionInfo(SC, ON, 'sumRawNotArrivalQty')).toEqual({
      displayName: '原料未到货量汇总',
      description: '',
      params: { purchaseRecordSet: { required: true, type: 'array' } },
    });
  });

  it('①本体函数：本体不匹配 → 不按①取（落不到任何源则 null）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => normalCatalog()).view();
    expect(view.functionInfo('其他场景', '其他本体', 'sumRawNotArrivalQty')).toBeNull();
  });

  it('②公共函数全局可取', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => normalCatalog()).view();
    expect(view.functionInfo(SC, ON, 'getCurrentDate')).toEqual({
      displayName: '获取当前日期', description: '', params: {},
    });
  });

  it('③其他MCP工具全局可取', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => normalCatalog()).view();
    expect(view.functionInfo(SC, ON, 'generate_line_chart')).toEqual({
      displayName: '折线图生成', description: '', params: { data: { required: true, type: 'array' } },
    });
  });

  it('取源优先级：①（限定本体）→ ② → ③（同名时先命中谁取谁）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      ontoTool('fn', SC, ON, { from: { type: 'onto' } }, '本体版'),
      commonTool('fn', { from: { type: 'common' } }, '公共版'),
      otherTool('fn', { from: { type: 'other' } }, '外部版'),
    ]).view();
    expect(view.functionInfo(SC, ON, 'fn')?.displayName).toBe('本体版');
    // 本体不匹配时①出局，轮到②
    expect(view.functionInfo('其他场景', '其他本体', 'fn')?.displayName).toBe('公共版');
  });

  it('三源都无 → null（校验跳过，合法性由 functionNames 名单先行拦截）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => normalCatalog()).view();
    expect(view.functionInfo(SC, ON, 'notExistFn')).toBeNull();
  });
});

describe('文件兜底模式（目录缺①②）', () => {
  it('functionNames = gateway 文件声明 ∪ ③目录', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      otherTool('weatherQuery'),
    ]).view();
    const names = view.functionNames(SC, ON);
    expect(names).toContain('sumRawNotArrivalQty'); // gateway
    expect(names).toContain('calcSafetyStock');     // gateway
    expect(names).toContain('weatherQuery');        // 目录③
  });

  it('functionInfo：①②取 gateway 文件声明（display_name 来自文件）', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      otherTool('weatherQuery'),
    ]).view();
    expect(view.functionInfo(SC, ON, 'sumRawNotArrivalQty')).toEqual({
      displayName: '原料未到货量汇总',
      description: undefined,
      params: { purchaseRecordSet: { required: true, type: 'array' } },
    });
  });

  it('functionInfo：gateway 无声明 → 兜底③目录；都无 → null', async () => {
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      otherTool('weatherQuery', { city: { required: true, type: 'string' } }),
    ]).view();
    expect(view.functionInfo(SC, ON, 'weatherQuery')?.params).toEqual({ city: { required: true, type: 'string' } });
    expect(view.functionInfo(SC, ON, 'notExistFn')).toBeNull();
  });

  it('兜底触发时 console.warn 告警（我方 MCP server 未连接的信号）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await new FunctionCatalog(fakeGateway(), async () => []).view();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('回落文件声明兜底'));
  });

  it('目录只有①或只有② → 不触发兜底（正常模式，缺的那类就是空）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = await new FunctionCatalog(fakeGateway(), async () => [
      commonTool('getCurrentDate'),
    ]).view();
    expect(warn).not.toHaveBeenCalled();
    expect(view.functionNames(SC, ON)).toEqual(['getCurrentDate']);
    expect(view.functionInfo(SC, ON, 'sumRawNotArrivalQty')).toBeNull(); // gateway 文件声明不参与
  });
});
