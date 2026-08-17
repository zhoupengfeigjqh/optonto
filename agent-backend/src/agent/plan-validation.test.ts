/**
 * topologicalSort 单元测试 —— 独立出来的图算法，补边界兜底（此前只能靠编排集成测试间接覆盖）。
 * 环不在本函数职责内（validatePlanStructure 已前置拦截），故不测环。
 */
import { describe, it, expect } from 'vitest';
import { topologicalSort, validateBehaviorNames, validateFunctionNames, validateParamsStructure } from './plan-validation.js';
import type { SubTask, SubTaskPlan } from '../types.js';
import type { OntologyGatewayPort } from './agent-ports.js';

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
    getFunctionMeta: () => ({ display_name: '' }),
    getFunctionParams: (_scenario, _ontology, fn) =>
      fn === 'sumRawNotArrivalQty' ? { purchaseRecordSet: { required: true, type: 'array' } } : null,
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

describe('validateFunctionNames', () => {
  it('函数子任务的 function 不在 functions[] → 非法，并给出合法名', () => {
    const invalid = validateFunctionNames(fakeGateway(), plan([fnSubtask('notExistFn')]));
    expect(invalid).toHaveLength(1);
    expect(invalid[0].sub.function).toBe('notExistFn');
    expect(invalid[0].valid).toContain('sumRawNotArrivalQty');
  });

  it('行为子任务跳过函数名校验', () => {
    expect(validateFunctionNames(fakeGateway(), plan([behSubtask('QueryPurchaseRecords')]))).toEqual([]);
  });
});

describe('validateBehaviorNames 跳过函数节点', () => {
  it('函数子任务（behavior 空串）不误报行为名非法', () => {
    expect(validateBehaviorNames(fakeGateway(), plan([fnSubtask('sumRawNotArrivalQty')]))).toEqual([]);
  });
});

describe('validateParamsStructure 函数/行为分支', () => {
  it('函数子任务：按函数 params 校验必填', () => {
    const errors = validateParamsStructure(fakeGateway(), plan([fnSubtask('sumRawNotArrivalQty')]));
    expect(errors).toEqual(['子任务1(sumRawNotArrivalQty) 缺少必填参数 purchaseRecordSet']);
  });

  it('公共函数（getFunctionParams 返回 null）跳过结构校验', () => {
    expect(validateParamsStructure(fakeGateway(), plan([fnSubtask('calcSafetyStock')]))).toEqual([]);
  });

  it('行为子任务：仍按行为 params 校验', () => {
    const errors = validateParamsStructure(fakeGateway(), plan([behSubtask('CreatePurchaseRecord')]));
    expect(errors).toEqual(['子任务1(CreatePurchaseRecord) 缺少必填参数 rawMaterialId']);
  });
});
