/**
 * topologicalSort 单元测试 —— 独立出来的图算法，补边界兜底（此前只能靠编排集成测试间接覆盖）。
 * 环不在本函数职责内（validatePlanStructure 已前置拦截），故不测环。
 *
 * validateAllParams（2026-09 facade 化后）：对 core 编译 inputSchema 跑「必填 key 齐全 + 已填值合规」，
 * 数据源 = run 级目录快照（函数 functionInfo.schema 三源 / 行为 behaviorSchema）；无 schema → 跳过。
 * 约束（enum/pattern/min/max）已编进 schema，由同一道校验覆盖（细粒度断言见 param-contract.test.ts）。
 */
import { describe, it, expect } from 'vitest';
import { topologicalSort, validateBehaviorNames, validateFunctionNames, validateAllParams, validatePlanStructure, validateSeqConflicts, looksLikePlanClaim } from './plan-validation.js';
import { FunctionCatalog } from './function-catalog.js';
import type { FunctionCatalogView } from './function-catalog.js';
import type { SubTask, SubTaskPlan } from '../types.js';
import type { MountableToolInfo, OntologyGatewayPort } from './agent-ports.js';

function st(seq: number, depends_on?: number[]): SubTask {
  return {
    seq, behavior: `B${seq}`, params: {}, description: `子任务${seq}`,
    scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1,
    ...(depends_on ? { depends_on } : {}),
  };
}

describe('topologicalSort', () => {
  it('无依赖：保持原序', () => {
    expect(topologicalSort([st(1), st(2), st(3)]).map(s => s.seq)).toEqual([1, 2, 3]);
  });

  it('线性依赖：依赖在前', () => {
    // 3 依赖 2，2 依赖 1，输入乱序
    expect(topologicalSort([st(3, [2]), st(1), st(2, [1])]).map(s => s.seq)).toEqual([1, 2, 3]);
  });

  it('多依赖汇聚：所有依赖先于后继', () => {
    // 4 依赖 2、3；2、3 都依赖 1
    const sorted = topologicalSort([st(4, [2, 3]), st(2, [1]), st(3, [1]), st(1)]);
    const idx = new Map(sorted.map((s, i) => [s.seq, i]));
    expect(idx.get(1)!).toBeLessThan(idx.get(2)!);
    expect(idx.get(1)!).toBeLessThan(idx.get(3)!);
    expect(idx.get(2)!).toBeLessThan(idx.get(4)!);
    expect(idx.get(3)!).toBeLessThan(idx.get(4)!);
  });

  it('悬空依赖（引用不存在的 seq）被跳过，不抛错', () => {
    expect(topologicalSort([st(1), st(2, [99])]).map(s => s.seq)).toEqual([1, 2]);
  });

  it('空数组 → 空数组', () => {
    expect(topologicalSort([])).toEqual([]);
  });
});

// ─── 依赖结构校验（含 executedSeqs 中继语义） ─────────────────────────

describe('validatePlanStructure', () => {
  const plan = (...subs: SubTask[]): SubTaskPlan => ({ subtasks: subs } as SubTaskPlan);

  it('合法依赖链 → 无错误', () => {
    expect(validatePlanStructure(plan(st(1), st(2, [1]), st(3, [2])))).toEqual([]);
  });

  it('悬空依赖（dep 既不在规划也未执行）→ 报错', () => {
    const errors = validatePlanStructure(plan(st(2, [1])));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('子任务 2 依赖的子任务 1 不存在');
  });

  it('dep 指向已执行成功的子任务（executedSeqs）→ 合法（中继调整规划只含剩余子任务的场景）', () => {
    // 波次反馈：子任务 1（getCurrentDate）已执行，父Agent 重提的调整规划只含剩余 seq 2/3
    const adjusted = plan(st(2, [1]), st(3, [2]));
    expect(validatePlanStructure(adjusted, new Set([1]))).toEqual([]);
  });

  it('dep 指向未执行的未知 seq → 仍报错（executedSeqs 不放行真空引用）', () => {
    const errors = validatePlanStructure(plan(st(2, [9])), new Set([1]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('子任务 2 依赖的子任务 9 不存在');
  });

  it('自引用仍报错（executedSeqs 不豁免）', () => {
    const errors = validatePlanStructure(plan(st(2, [2])), new Set([2]));
    expect(errors[0]).toContain('不能依赖自身');
  });

  it('循环依赖仍检出', () => {
    const errors = validatePlanStructure(plan(st(1, [2]), st(2, [1])));
    expect(errors.some(e => e.includes('循环'))).toBe(true);
  });
});

// ─── 名称校验 + 参数校验分支 ─────────────────────────────

function fakeGateway(): OntologyGatewayPort {
  return {
    getBehaviorNames: () => ['QueryPurchaseRecords', 'CreatePurchaseRecord'],
    getFunctionNames: () => ['sumRawNotArrivalQty', 'calcSafetyStock'],
    getBehaviorMeta: (_scenario, _ontology, behavior) => ({
      display_name: '',
      params: behavior === 'CreatePurchaseRecord' ? { rawMaterialId: { required: true, type: 'string' } } : {},
      preRules: [],
      postRules: [],
      concepts: [],
      isWrite: false,
    }),
    getFunctionInfo: (_scenario, _ontology, fn) =>
      fn === 'sumRawNotArrivalQty'
        ? { display_name: '', params: { purchaseRecordSet: { required: true, type: 'array' } } }
        : null,
  };
}

function fnSubtask(fn: string): SubTask {
  return { seq: 1, behavior: '', function: fn, params: {}, description: '', scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1 };
}

function behSubtask(behavior: string): SubTask {
  return { seq: 1, behavior, params: {}, description: '', scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1 };
}

function plan(subtasks: SubTask[]): SubTaskPlan {
  return { subtasks };
}

const ONTARIO_SCOPE = { name: '', ontology_id: 1, scenario_id: 1, scenario_name: '生产调度', ontology_name: '原材料采购和库存' };

/** 本体行为目录项（facade 一等工具；schema = core 编译产物，scope.name 为裸名） */
function behaviorTool(bareName: string, schema: Record<string, any>, toolName?: string): MountableToolInfo {
  return {
    name: toolName ?? bareName, category: '本体行为', description: '', params: {},
    schema, scope: { ...ONTARIO_SCOPE, name: bareName },
  };
}

/** 本体函数目录项（正常模式数据源） */
function ontoFnTool(name: string, schema: Record<string, any>): MountableToolInfo {
  return {
    name, category: '本体函数', description: '', params: {},
    schema, scope: { ...ONTARIO_SCOPE, name },
  };
}

/** 其他MCP工具目录项（FunctionCatalog 的第三数据源） */
function mcpTool(name: string, schema?: Record<string, any>): MountableToolInfo {
  return { name, category: '其他MCP工具', description: '', params: {}, ...(schema ? { schema } : {}) };
}

/** 经真实 FunctionCatalog 构建 view（fake gateway + fake MCP 目录），测试覆盖真实三源 join 链路 */
async function mkView(mcpTools: MountableToolInfo[] = []): Promise<FunctionCatalogView> {
  return new FunctionCatalog(fakeGateway(), async () => mcpTools).view();
}

describe('validateFunctionNames', () => {
  it('函数子任务的 function 不在 functions[] → 非法，并给出合法名', async () => {
    const invalid = validateFunctionNames(await mkView(), plan([fnSubtask('notExistFn')]));
    expect(invalid).toHaveLength(1);
    expect(invalid[0].sub.function).toBe('notExistFn');
    expect(invalid[0].valid).toContain('sumRawNotArrivalQty');
  });

  it('行为子任务跳过函数名校验', async () => {
    expect(validateFunctionNames(await mkView(), plan([behSubtask('QueryPurchaseRecords')]))).toEqual([]);
  });

  it('其他MCP工具在目录中 → 合法（函数子任务可规划外部工具）', async () => {
    const view = await mkView([mcpTool('generate_line_chart')]);
    expect(validateFunctionNames(view, plan([fnSubtask('generate_line_chart')]))).toEqual([]);
  });

  it('其他MCP工具不在目录中 → 非法，合法名含目录内工具', async () => {
    const view = await mkView([mcpTool('weatherQuery')]);
    const invalid = validateFunctionNames(view, plan([fnSubtask('generate_line_chart')]));
    expect(invalid).toHaveLength(1);
    expect(invalid[0].valid).toContain('weatherQuery');
    expect(invalid[0].valid).toContain('sumRawNotArrivalQty');
  });

  it('本体行为工具不进合法函数名集合（行为规划走 listOntoBehaviors，与函数取值域隔离）', async () => {
    const view = await mkView([behaviorTool('CreatePurchaseRecord', { type: 'object', properties: {} })]);
    // 目录含行为工具（正常模式判定不受影响：fileFallback 由本体函数/公共函数缺位触发，
    // 此处 fileFallback=true → 函数名走文件兜底），行为名不得混入函数名集合
    expect(view.functionNames('生产调度', '原材料采购和库存')).not.toContain('CreatePurchaseRecord');
  });
});

describe('validateBehaviorNames 跳过函数节点', () => {
  it('函数子任务（behavior 空串）不误报行为名非法', () => {
    expect(validateBehaviorNames(fakeGateway(), plan([fnSubtask('sumRawNotArrivalQty')]))).toEqual([]);
  });
});

describe('validateAllParams · 编译 schema 校验（行为/函数统一）', () => {
  const BEH_SCHEMA = {
    type: 'object',
    properties: {
      rawMaterialId: { type: 'string', minLength: 1 },
      qty: { type: 'integer', minimum: 1, maximum: 100 },
      status: { type: 'string', enum: ['有效', '无效'] },
    },
    required: ['rawMaterialId'],
  };
  const FN_SCHEMA = {
    type: 'object',
    properties: { purchaseRecordSet: { type: 'array' } },
    required: ['purchaseRecordSet'],
  };

  it('行为子任务：按 behaviorSchema 校验必填（缺 key → 报错）', async () => {
    const view = await mkView([behaviorTool('CreatePurchaseRecord', BEH_SCHEMA)]);
    const errors = validateAllParams(view, plan([behSubtask('CreatePurchaseRecord')]));
    expect(errors).toEqual(['子任务1(CreatePurchaseRecord) 缺少必填参数 rawMaterialId']);
  });

  it('行为子任务：已填值的类型/约束违例一道拦（范围/枚举进同一错误流，统一 nudge）', async () => {
    const view = await mkView([behaviorTool('CreatePurchaseRecord', BEH_SCHEMA)]);
    const sub = {
      ...behSubtask('CreatePurchaseRecord'),
      params: { rawMaterialId: { value: 'RM-1' }, qty: { value: 500 }, status: { value: '未知' } },
    };
    const errors = validateAllParams(view, plan([sub]));
    expect(errors.some(e => e.includes('高于最大值 100'))).toBe(true);
    expect(errors.some(e => e.includes('不在枚举值'))).toBe(true);
  });

  it('行为子任务：跨本体重名工具带前缀 → 按 scope.name 裸名回溯 schema，不误判', async () => {
    const view = await mkView([behaviorTool('CreatePurchaseRecord', BEH_SCHEMA, 'onto1__CreatePurchaseRecord')]);
    const errors = validateAllParams(view, plan([behSubtask('CreatePurchaseRecord')]));
    expect(errors).toEqual(['子任务1(CreatePurchaseRecord) 缺少必填参数 rawMaterialId']);
  });

  it('行为无 schema（目录无该行为工具）→ 跳过（执行期 harness schema 兜底）', async () => {
    const errors = validateAllParams(await mkView(), plan([behSubtask('CreatePurchaseRecord')]));
    expect(errors).toEqual([]);
  });

  it('函数子任务：本体函数目录项带 schema → 校验必填', async () => {
    const view = await mkView([ontoFnTool('sumRawNotArrivalQty', FN_SCHEMA)]);
    const errors = validateAllParams(view, plan([fnSubtask('sumRawNotArrivalQty')]));
    expect(errors).toEqual(['子任务1(sumRawNotArrivalQty) 缺少必填参数 purchaseRecordSet']);
  });

  it('文件兜底模式（目录无本体/公共函数）→ gateway 声明无 schema，跳过校验', async () => {
    const errors = validateAllParams(await mkView(), plan([fnSubtask('sumRawNotArrivalQty')]));
    expect(errors).toEqual([]);
  });

  it('其他MCP工具：目录带 schema → 校验必填；无 schema → 跳过', async () => {
    const withSchema = await mkView([mcpTool('generate_line_chart', { type: 'object', properties: { data: { type: 'array' } }, required: ['data'] })]);
    expect(validateAllParams(withSchema, plan([fnSubtask('generate_line_chart')])))
      .toEqual(['子任务1(generate_line_chart) 缺少必填参数 data']);
    const noSchema = await mkView([mcpTool('weatherQuery')]);
    expect(validateAllParams(noSchema, plan([fnSubtask('weatherQuery')]))).toEqual([]);
  });
});

describe('validateSeqConflicts（seq 防碰撞）', () => {
  const planOf = (subs: SubTask[]): SubTaskPlan => ({ subtasks: subs });

  it('规划内 seq 重复 → 报错指出重复占用', () => {
    const errors = validateSeqConflicts(planOf([st(1), st(2), { ...st(2), behavior: 'Other' }]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('seq 2');
    expect(errors[0]).toContain('重复占用');
  });

  it('seq 全部唯一 → 通过', () => {
    expect(validateSeqConflicts(planOf([st(1), st(2), st(3)]))).toEqual([]);
  });

  it('反馈路径：复述已执行子任务（seq 与任务名一致）→ 合法', () => {
    const executed = new Map([[1, 'B1']]);
    expect(validateSeqConflicts(planOf([st(1), st(2)]), executed)).toEqual([]);
  });

  it('反馈路径：新任务冒名已执行 seq（任务名不一致）→ 报错', () => {
    const executed = new Map([[1, 'B1']]);
    const errors = validateSeqConflicts(planOf([{ ...st(1), behavior: 'NewTask' }]), executed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('冒用');
    expect(errors[0]).toContain('B1');
  });

  it('反馈路径：函数子任务按 function 名比对（一致则合法）', () => {
    const executed = new Map([[1, 'sumRawNotArrivalQty']]);
    const fnSub: SubTask = { ...st(1), behavior: '', function: 'sumRawNotArrivalQty' };
    expect(validateSeqConflicts(planOf([fnSub]), executed)).toEqual([]);
  });

  it('规划路径不传 executedTasks → 冒名规则休眠（只查重复）', () => {
    expect(validateSeqConflicts(planOf([st(1)]))).toEqual([]);
  });
});

// ─── looksLikePlanClaim — 言行不一检测（假提交声明） ─────────────────────

describe('looksLikePlanClaim — 言行不一检测', () => {
  it('命中：完成态/宣告态措辞', () => {
    expect(looksLikePlanClaim('已提交计划，共3个子任务。')).toBe(true);
    expect(looksLikePlanClaim('我已为您提交了执行计划。')).toBe(true);
    expect(looksLikePlanClaim('好的，我提交了规划。')).toBe(true);
    expect(looksLikePlanClaim('执行计划已提交，即将开始执行子任务。')).toBe(true);
    expect(looksLikePlanClaim('执行计划已生成，共两步。')).toBe(true);
    expect(looksLikePlanClaim('现在我将通过 submit_plan 提交规划：')).toBe(true);
    expect(looksLikePlanClaim('规划已成功提交。')).toBe(true);
    expect(looksLikePlanClaim('即将开始执行以下子任务。')).toBe(true);
  });

  it('不命中：条件要约与建议性表述（防误杀正常直答）', () => {
    expect(looksLikePlanClaim('如果您需要，我可以提交执行计划，请确认。')).toBe(false);
    expect(looksLikePlanClaim('您可以先提交计划，确认无误后再执行。')).toBe(false);
    expect(looksLikePlanClaim('如需调整计划，请重新提交需求。')).toBe(false);
    expect(looksLikePlanClaim('当前库存35吨，供应商A本月到货2批。')).toBe(false);
  });

  it('不命中：业务数据直答里的"计划已完成"（生产调度域高频合法表述）', () => {
    expect(looksLikePlanClaim('该生产计划已完成，共入库 500 件。')).toBe(false);
    expect(looksLikePlanClaim('计划已完成 80%，剩余部分预计明天完成。')).toBe(false);
  });

  it('空文本安全', () => {
    expect(looksLikePlanClaim('')).toBe(false);
  });
});
