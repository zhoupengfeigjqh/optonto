/**
 * 规划编辑纯逻辑单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 原为 AgentConversation 里的内联逻辑，没有测试；抽成纯函数后按
 * 「正常 → 异常 → 边界」逐条覆盖，重点锁住三处易错约定：
 * 删除子任务必须级联清依赖、环检测、参数编辑的作用域。
 *
 * 2026-10-05：执行记录分组/统计/配对（`execution-log.ts`）的用例已迁至同目录
 * `execution-log.test.ts`——测试与被测文件一一对应，本文件回归「规划编辑」单一职责。
 */
import { describe, it, expect } from 'vitest';
import {
  clonePlan, updateSubtaskParam, deleteSubtask, setSubtaskDeps,
  validatePlan, isPlanUnchanged, type Plan,
} from './plan-editing';

const makePlan = (): Plan => ({
  subtasks: [
    { seq: 1, behavior: 'QueryInventory', params: { 原材料编号: { value: 'RM-001', required: true } } },
    { seq: 2, behavior: 'CreatePurchaseRecord', depends_on: [1], params: {} },
    { seq: 3, behavior: 'StartSchedTask', depends_on: [2], params: {} },
  ],
});

describe('updateSubtaskParam — 改参数值', () => {
  it('属性传递：写入指定子任务的参数 value', () => {
    const next = updateSubtaskParam(makePlan(), 1, '原材料编号', 'RM-002');
    expect(next.subtasks?.[0].params?.['原材料编号'].value).toBe('RM-002');
  });

  it('边界：不可变——原 plan 不被修改', () => {
    const plan = makePlan();
    updateSubtaskParam(plan, 1, '原材料编号', 'X');
    expect(plan.subtasks?.[0].params?.['原材料编号'].value).toBe('RM-001');
  });

  it('边界：参数项不存在时保持原样（不新增键）', () => {
    const next = updateSubtaskParam(makePlan(), 1, '不存在的参数', 'X');
    expect(next.subtasks?.[0].params?.['不存在的参数']).toBeUndefined();
  });

  it('边界：seq 不存在时不抛错、plan 等价', () => {
    const next = updateSubtaskParam(makePlan(), 999, '原材料编号', 'X');
    expect(JSON.stringify(next)).toBe(JSON.stringify(makePlan()));
  });
});

describe('deleteSubtask — 删子任务并级联清依赖', () => {
  it('属性传递：删除目标子任务', () => {
    const next = deleteSubtask(makePlan(), 2);
    expect(next.subtasks?.map(s => s.seq)).toEqual([1, 3]);
  });

  it('属性传递：其他子任务对它的依赖被一并移除（不留悬空依赖）', () => {
    const next = deleteSubtask(makePlan(), 1);
    expect(next.subtasks?.find(s => s.seq === 2)?.depends_on).toEqual([]);
  });

  it('边界：删不存在的 seq 时 plan 等价', () => {
    const next = deleteSubtask(makePlan(), 999);
    expect(JSON.stringify(next)).toBe(JSON.stringify(makePlan()));
  });

  it('边界：不可变——原 plan 不被修改', () => {
    const plan = makePlan();
    deleteSubtask(plan, 1);
    expect(plan.subtasks?.length).toBe(3);
  });
});

describe('setSubtaskDeps — 调依赖', () => {
  it('属性传递：覆盖依赖列表', () => {
    const next = setSubtaskDeps(makePlan(), 3, [1]);
    expect(next.subtasks?.find(s => s.seq === 3)?.depends_on).toEqual([1]);
  });

  it('边界：seq 不存在时不抛错', () => {
    const next = setSubtaskDeps(makePlan(), 999, [1]);
    expect(next.subtasks?.length).toBe(3);
  });
});

describe('validatePlan — 提交前结构校验', () => {
  it('正常：合法依赖链返回空错误列表', () => {
    expect(validatePlan(makePlan())).toEqual([]);
  });

  it('异常：自引用被拦下', () => {
    const plan: Plan = { subtasks: [{ seq: 1, behavior: 'A', depends_on: [1] }] };
    expect(validatePlan(plan)).toContain('子任务 1 不能依赖自身');
  });

  it('异常：依赖已被删除的子任务被拦下', () => {
    const plan: Plan = { subtasks: [{ seq: 1, behavior: 'A', depends_on: [9] }] };
    expect(validatePlan(plan)).toContain('子任务 1 依赖的子任务 9 已被删除');
  });

  it('异常：存在循环依赖时被拦下', () => {
    const plan: Plan = {
      subtasks: [
        { seq: 1, behavior: 'A', depends_on: [2] },
        { seq: 2, behavior: 'B', depends_on: [1] },
      ],
    };
    expect(validatePlan(plan)).toContain('子任务依赖关系存在循环');
  });

  it('边界：无 subtasks / 空数组均返回空错误列表', () => {
    expect(validatePlan({})).toEqual([]);
    expect(validatePlan({ subtasks: [] })).toEqual([]);
  });

  it('边界：非首节点成环（前序合法）也能检出', () => {
    const plan: Plan = {
      subtasks: [
        { seq: 1, behavior: 'A' },
        { seq: 2, behavior: 'B', depends_on: [3] },
        { seq: 3, behavior: 'C', depends_on: [2] },
      ],
    };
    expect(validatePlan(plan)).toContain('子任务依赖关系存在循环');
  });
});

describe('isPlanUnchanged — 是否用户确实改过', () => {
  it('属性传递：内容相同（引用不同）判定为未改', () => {
    expect(isPlanUnchanged(clonePlan(makePlan()), makePlan())).toBe(true);
  });

  it('属性传递：任一字段变化判定为已改', () => {
    const edited = updateSubtaskParam(makePlan(), 1, '原材料编号', 'RM-002');
    expect(isPlanUnchanged(edited, makePlan())).toBe(false);
  });
});
