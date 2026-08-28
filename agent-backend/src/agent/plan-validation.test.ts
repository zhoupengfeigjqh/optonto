/**
 * topologicalSort 单元测试 —— 独立出来的图算法，补边界兜底（此前只能靠编排集成测试间接覆盖）。
 * 环不在本函数职责内（validatePlanStructure 已前置拦截），故不测环。
 */
import { describe, it, expect } from 'vitest';
import { topologicalSort, validateBehaviorNames, validateFunctionNames, validateAllParams, validateAllConstraints, validatePlanStructure, validateSeqConflicts, looksLikePlanClaim } from './plan-validation.js';
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

// ─── 函数子任务名校验 + 参数结构校验分支 ─────────────────────────────

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
        ? { display_name: '', params: { purchaseRecordSet: { required: true, type: 'array' } }, concepts: [] }
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

/** 其他MCP工具目录项（FunctionCatalog 的第三数据源） */
function mcpTool(name: string, params: Record<string, any> = {}): MountableToolInfo {
  return { name, category: '其他MCP工具', description: '', params };
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
});

describe('validateBehaviorNames 跳过函数节点', () => {
  it('函数子任务（behavior 空串）不误报行为名非法', () => {
    expect(validateBehaviorNames(fakeGateway(), plan([fnSubtask('sumRawNotArrivalQty')]))).toEqual([]);
  });
});

describe('validateAllParams 函数/行为分支', () => {
  it('函数子任务：按函数 params 校验必填', async () => {
    const errors = validateAllParams(fakeGateway(), await mkView(), plan([fnSubtask('sumRawNotArrivalQty')]));
    expect(errors).toEqual(['子任务1(sumRawNotArrivalQty) 缺少必填参数 purchaseRecordSet']);
  });

  it('函数无声明源（view 返回 null）跳过结构校验', async () => {
    expect(validateAllParams(fakeGateway(), await mkView(), plan([fnSubtask('calcSafetyStock')]))).toEqual([]);
  });

  it('其他MCP工具：按目录声明校验必填（gateway 无声明时兜底数据源）', async () => {
    const view = await mkView([mcpTool('generate_line_chart', { data: { required: true, type: 'array' } })]);
    const errors = validateAllParams(fakeGateway(), view, plan([fnSubtask('generate_line_chart')]));
    expect(errors).toEqual(['子任务1(generate_line_chart) 缺少必填参数 data']);
  });

  it('其他MCP工具：目录声明为空（MCP 无 inputSchema）→ 跳过结构校验', async () => {
    const view = await mkView([mcpTool('weatherQuery')]);
    expect(validateAllParams(fakeGateway(), view, plan([fnSubtask('weatherQuery')]))).toEqual([]);
  });

  it('行为子任务：仍按行为 params 校验', async () => {
    const errors = validateAllParams(fakeGateway(), await mkView(), plan([behSubtask('CreatePurchaseRecord')]));
    expect(errors).toEqual(['子任务1(CreatePurchaseRecord) 缺少必填参数 rawMaterialId']);
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

// ─── validateAllConstraints · 行为/函数统一约束校验 ─────────────────────────
// 函数子任务经 getFunctionInfo().concepts（related_concepts 解析）回溯约束，与行为同路径。

describe('validateAllConstraints · 行为/函数统一约束校验', () => {
  const CONCEPT = {
    name: 'PurchaseRecord', display_name: '采购记录',
    attributes: [
      { name: 'status', type: 'string', display_name: '状态', constraint: { enum: ['有效', '无效'] } },
      { name: 'arrivalTime', type: 'string', display_name: '到位时间', constraint: { pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
      { name: 'rawMaterialName', type: 'string', display_name: '原料名', constraint: { enum: ['钢板'] } },
      { name: 'qty', type: 'number', display_name: '数量', constraint: { min: 0, max: 100 } },
      { name: 'leadTime', type: 'integer', display_name: '交期', constraint: { min: 1 } },
      { name: 'note', type: 'string', display_name: '备注', constraint: { required: true } }, // 无范围：不查
    ],
  };
  const gw = (): OntologyGatewayPort => ({
    getBehaviorNames: () => ['CreatePurchaseRecord'],
    getFunctionNames: () => ['sumRawNotArrivalQty'],
    getBehaviorMeta: (_s, _o, b) => ({
      display_name: '',
      params: { status: { type: 'string' }, arrivalTime: { type: 'string' }, qty: { type: 'number' }, leadTime: { type: 'integer' }, note: { type: 'string' } },
      preRules: [], postRules: [],
      concepts: b === 'CreatePurchaseRecord' ? [CONCEPT] : [],
      isWrite: false,
    }),
    getFunctionInfo: (_s, _o, fn) =>
      fn === 'sumRawNotArrivalQty'
        ? {
            display_name: '',
            params: {
              filterRawMaterialName: { type: 'string' }, // 改名参数：与属性 rawMaterialName 不同名
              purchaseRecordSet: { type: 'array', items: { type: 'object', properties: { arrivalTime: { type: 'string' }, status: { type: 'string' } } } },
            },
            concepts: [CONCEPT],
          }
        : fn === 'dateAdd'
          ? { display_name: '', params: { days: { type: 'integer' } }, concepts: [] } // 公共函数：无概念关联
          : null, // 第三源 MCP 工具
  });

  it('行为子任务：枚举违例 → enumErrors（回归，原行为分支不变）', () => {
    const sub = { ...behSubtask('CreatePurchaseRecord'), params: { status: { value: '未知' }, arrivalTime: { value: '2026-08-24' } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.enumErrors).toHaveLength(1);
    expect(v.enumErrors[0]).toContain('status');
    expect(v.patternErrors).toEqual([]);
  });

  it('函数子任务：嵌套数组项字段按属性约束递归校验，错误带路径', () => {
    const sub = {
      ...fnSubtask('sumRawNotArrivalQty'),
      params: {
        purchaseRecordSet: { value: [
          { arrivalTime: '2026-08-24', status: '有效' },
          { arrivalTime: '2026-8-4', status: '未知' },
        ] },
      },
    };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.patternErrors).toHaveLength(1);
    expect(v.patternErrors[0]).toContain('purchaseRecordSet[1].arrivalTime');
    expect(v.enumErrors).toHaveLength(1);
    expect(v.enumErrors[0]).toContain('purchaseRecordSet[1].status');
  });

  it('函数子任务：改名顶层参数 ≠ 属性名 → 不查（键名匹配的既定边界，静默漏检而非误拦）', () => {
    const sub = { ...fnSubtask('sumRawNotArrivalQty'), params: { filterRawMaterialName: { value: '铁板' } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.enumErrors).toEqual([]);
    expect(v.patternErrors).toEqual([]);
  });

  it('公共函数（concepts 恒空）→ 无校验依据，跳过', () => {
    const sub = { ...fnSubtask('dateAdd'), params: { days: { value: 30 } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.enumErrors).toEqual([]);
    expect(v.patternErrors).toEqual([]);
  });

  it('第三源 MCP 工具（getFunctionInfo 返回 null）→ 跳过', () => {
    const sub = { ...fnSubtask('weatherQuery'), params: { city: { value: '北京' } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.enumErrors).toEqual([]);
    expect(v.patternErrors).toEqual([]);
  });

  // ─── 取值范围（number/integer，min/max 非空才查） ─────────────────────────

  it('number 低于最小值 → rangeErrors（含范围文本）', () => {
    const sub = { ...behSubtask('CreatePurchaseRecord'), params: { qty: { value: -5 } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.rangeErrors).toHaveLength(1);
    expect(v.rangeErrors[0]).toContain('qty');
    expect(v.rangeErrors[0]).toContain('低于最小值 0');
    expect(v.rangeErrors[0]).toContain('0 ~ 100');
  });

  it('number 高于最大值 → rangeErrors', () => {
    const sub = { ...behSubtask('CreatePurchaseRecord'), params: { qty: { value: 500 } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.rangeErrors).toHaveLength(1);
    expect(v.rangeErrors[0]).toContain('高于最大值 100');
  });

  it('integer 单边范围（仅 min）：低于报错 / 高于不限', () => {
    const bad = { ...behSubtask('CreatePurchaseRecord'), params: { leadTime: { value: 0 } } };
    const good = { ...behSubtask('CreatePurchaseRecord'), params: { leadTime: { value: 9999 } } };
    expect(validateAllConstraints(gw(), plan([bad])).rangeErrors).toHaveLength(1);
    expect(validateAllConstraints(gw(), plan([good])).rangeErrors).toEqual([]);
  });

  it('范围内 / 无范围声明（note） → 不查不报', () => {
    const sub = { ...behSubtask('CreatePurchaseRecord'), params: { qty: { value: 50 }, note: { value: '任意文本' } } };
    const v = validateAllConstraints(gw(), plan([sub]));
    expect(v.rangeErrors).toEqual([]);
  });

  it('数字字符串纳入校验（"500" 超界报错）；非数字字符串跳过（类型校验负责）', () => {
    const strBad = { ...behSubtask('CreatePurchaseRecord'), params: { qty: { value: '500' } } };
    const strSkip = { ...behSubtask('CreatePurchaseRecord'), params: { qty: { value: 'abc' } } };
    expect(validateAllConstraints(gw(), plan([strBad])).rangeErrors).toHaveLength(1);
    expect(validateAllConstraints(gw(), plan([strSkip])).rangeErrors).toEqual([]);
  });

  it('空值放行（缺值非本校验职责）', () => {
    const sub = { ...behSubtask('CreatePurchaseRecord'), params: { qty: { value: '' } } };
    expect(validateAllConstraints(gw(), plan([sub])).rangeErrors).toEqual([]);
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
