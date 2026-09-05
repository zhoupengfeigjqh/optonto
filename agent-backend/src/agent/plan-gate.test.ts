/**
 * PlanGate 单元测试 —— 规划闸门脱离 execute() 全路径直测。
 * 测试面 = 两个深入口 validateInitial / validateAdjustment（链序编排在门内，测试经链首/链尾驱动各环）：
 * 干净放行 / nudge 一次修正 / 复验不过判废 / 未重提判废。
 * 参数校验（2026-09 facade 化后）对 core 编译 schema 统一跑「必填+类型+enum/pattern/min/max」，
 * 违例一律 nudge 一次（取值范围硬中断已退役），数据源 = ctx.catalog 快照（functionInfo.schema / behaviorSchema）。
 */
import { describe, it, expect, vi } from 'vitest';
import { PlanGate } from './plan-gate.js';
import type { PlanRepairCtx } from './plan-gate.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { AgentPort } from './agent-ports.js';
import { createEventChannel } from './event-channel.js';
import type { FunctionCatalogView } from './function-catalog.js';
import type { PlanSubmission } from './run-session.js';
import type { SubTask, SubTaskPlan, SSEEvent } from '../types.js';

function mkSub(seq: number): SubTask {
  return {
    seq, behavior: 'QuerySupplier', params: {}, description: `子任务${seq}`,
    scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1,
  };
}

const gateway = {
  getBehaviorMeta: () => ({ display_name: '', params: {}, preRules: [], postRules: [], concepts: [], isWrite: false }),
  getBehaviorNames: () => ['QuerySupplier'],
  getFunctionNames: () => [],
  getFunctionInfo: () => null,
} as unknown as OntologyGatewayPort;

/** PlanSubmission fake：与 RunSession 同款三动作（submit/reset/peek），测试经 submit 模拟工具回调写入 */
function mkSubmission(): PlanSubmission {
  let held: SubTaskPlan | null = null;
  return {
    submit: (p) => { held = p; },
    reset: () => { held = null; },
    peek: () => held,
  };
}

function mkCtx(catalog?: Partial<FunctionCatalogView>): { ctx: PlanRepairCtx; events: SSEEvent[]; parent: AgentPort } {
  const events: SSEEvent[] = [];
  const parent = { state: { messages: [] }, abort: vi.fn(), subscribe: vi.fn() } as unknown as AgentPort;
  return {
    events,
    parent,
    ctx: {
      parentAgent: parent,
      submittedPlan: mkSubmission(),
      emit: createEventChannel(e => events.push(e)),
      catalog: {
        functionInfo: () => null,
        functionNames: () => [],
        behaviorSchema: () => null,
        ...catalog,
      } as unknown as FunctionCatalogView,
    },
  };
}

describe('PlanGate · 修复循环骨架（validateInitial · 链首 seq 校验驱动）', () => {
  it('规划干净 → 原样放行，不 nudge 父Agent', async () => {
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway, promptParent });
    const { ctx } = mkCtx();
    const plan: SubTaskPlan = { subtasks: [mkSub(1), mkSub(2)] };

    const out = await gate.validateInitial(plan, ctx);
    expect(out).toBe(plan);
    expect(promptParent).not.toHaveBeenCalled();
  });

  it('seq 冲突 → nudge 一次，父Agent 重提干净规划 → 放行并记修正流水', async () => {
    const fixed: SubTaskPlan = { subtasks: [mkSub(1), mkSub(2)] };
    const { ctx, events } = mkCtx();
    const promptParent = vi.fn().mockImplementation(async () => { ctx.submittedPlan.submit(fixed); });
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateInitial({ subtasks: [mkSub(1), mkSub(1)] }, ctx);
    expect(out).toBe(fixed);
    expect(promptParent).toHaveBeenCalledTimes(1);
    const names = events.filter((e: any) => e.type === 'exec_entry').map((e: any) => `${e.entry.name}:${e.entry.status}`);
    expect(names).toContain('seq 冲突校验:failed');
    expect(names).toContain('seq 冲突已修正:done');
  });

  it('修正后仍有冲突 → 判废返回 null（只有一次修正机会）', async () => {
    const { ctx } = mkCtx();
    const promptParent = vi.fn().mockImplementation(async () => {
      ctx.submittedPlan.submit({ subtasks: [mkSub(3), mkSub(3)] }); // 仍冲突
    });
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateInitial({ subtasks: [mkSub(1), mkSub(1)] }, ctx);
    expect(out).toBeNull();
    expect(promptParent).toHaveBeenCalledTimes(1); // 不再二次 nudge
  });

  it('父Agent 未重提规划 → 判废返回 null', async () => {
    const { ctx } = mkCtx();
    const promptParent = vi.fn().mockResolvedValue(undefined); // 不写 holder
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateInitial({ subtasks: [mkSub(1), mkSub(1)] }, ctx);
    expect(out).toBeNull();
  });
});

describe('PlanGate · 参数校验（validateInitial · 编译 schema 统一 nudge）', () => {
  /** 含必填 + 范围约束的编译 schema（core params_schema 编译产物形态） */
  const SCHEMA = {
    type: 'object',
    properties: {
      rawMaterialId: { type: 'string', minLength: 1 },
      qty: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['rawMaterialId'],
  };
  const catalogOf = (schema: Record<string, any> | null): Partial<FunctionCatalogView> => ({
    behaviorSchema: () => schema,
    functionInfo: () => null,
  });

  it('参数干净 → 原样放行，不 nudge', async () => {
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway, promptParent });
    const { ctx } = mkCtx(catalogOf(SCHEMA));
    const plan: SubTaskPlan = { subtasks: [{ ...mkSub(1), params: { rawMaterialId: { value: 'RM-1' }, qty: { value: 50 } } }] };
    const out = await gate.validateInitial(plan, ctx);
    expect(out).toBe(plan);
    expect(promptParent).not.toHaveBeenCalled();
  });

  it('缺必填 key → nudge 一次（提示含错误清单与声明结构 sketch），修正后放行', async () => {
    const fixed: SubTaskPlan = { subtasks: [{ ...mkSub(1), params: { rawMaterialId: { value: 'RM-1' } } }] };
    const { ctx, events } = mkCtx(catalogOf(SCHEMA));
    const promptParent = vi.fn().mockImplementation(async () => { ctx.submittedPlan.submit(fixed); });
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateInitial({ subtasks: [mkSub(1)] }, ctx);
    expect(out).toBe(fixed);
    expect(promptParent).toHaveBeenCalledTimes(1);
    const nudgeText = (promptParent.mock.calls[0][1] as string);
    expect(nudgeText).toContain('缺少必填参数 rawMaterialId');
    expect(nudgeText).toContain('参数声明结构'); // sketch 随 nudge 给出（单一事实源）
    expect(nudgeText).toContain('rawMaterialId');
    const names = events.filter((e: any) => e.type === 'exec_entry').map((e: any) => `${e.entry.name}:${e.entry.status}`);
    expect(names).toContain('参数校验:failed');
    expect(names).toContain('参数已修正:done');
  });

  it('取值范围违例 → 同样 nudge 一次（硬中断已退役），父Agent 修正后放行', async () => {
    const fixed: SubTaskPlan = { subtasks: [{ ...mkSub(1), params: { rawMaterialId: { value: 'RM-1' }, qty: { value: 50 } } }] };
    const { ctx } = mkCtx(catalogOf(SCHEMA));
    const promptParent = vi.fn().mockImplementation(async () => { ctx.submittedPlan.submit(fixed); });
    const gate = new PlanGate({ gateway, promptParent });
    const plan: SubTaskPlan = { subtasks: [{ ...mkSub(1), params: { rawMaterialId: { value: 'RM-1' }, qty: { value: 999 } } }] };

    const out = await gate.validateInitial(plan, ctx);
    expect(out).toBe(fixed);
    expect(promptParent).toHaveBeenCalledTimes(1); // 不再硬中断：给 LLM 一次自修机会
    expect(promptParent.mock.calls[0][1]).toContain('高于最大值 100');
  });

  it('范围违例且修正后仍违例 → 判废返回 null', async () => {
    const { ctx } = mkCtx(catalogOf(SCHEMA));
    const promptParent = vi.fn().mockImplementation(async () => {
      ctx.submittedPlan.submit({ subtasks: [{ ...mkSub(1), params: { rawMaterialId: { value: 'RM-1' }, qty: { value: 0 } } }] });
    });
    const gate = new PlanGate({ gateway, promptParent });
    const plan: SubTaskPlan = { subtasks: [{ ...mkSub(1), params: { rawMaterialId: { value: 'RM-1' }, qty: { value: 999 } } }] };
    expect(await gate.validateInitial(plan, ctx)).toBeNull();
  });

  it('无 schema（目录快照缺该行为工具）→ 跳过放行（执行期 harness schema 兜底）', async () => {
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway, promptParent });
    const { ctx } = mkCtx(catalogOf(null));
    const plan: SubTaskPlan = { subtasks: [mkSub(1)] };
    expect(await gate.validateInitial(plan, ctx)).toBe(plan);
    expect(promptParent).not.toHaveBeenCalled();
  });

  it('函数子任务走 functionInfo.schema 同源校验', async () => {
    const FN_SCHEMA = { type: 'object', properties: { recordSet: { type: 'array' } }, required: ['recordSet'] };
    const catalog: Partial<FunctionCatalogView> = {
      behaviorSchema: () => null,
      functionNames: () => ['sumQty'],
      functionInfo: (_s: string, _o: string, fn: string) =>
        fn === 'sumQty' ? { display_name: '', description: '', params: {}, schema: FN_SCHEMA } : null,
    };
    const fixed: SubTaskPlan = {
      subtasks: [{ ...mkSub(1), behavior: '', function: 'sumQty', params: { recordSet: { value: [] } } }],
    };
    const { ctx } = mkCtx(catalog);
    const promptParent = vi.fn().mockImplementation(async () => { ctx.submittedPlan.submit(fixed); });
    const gate = new PlanGate({ gateway, promptParent });
    const dirty: SubTaskPlan = { subtasks: [{ ...mkSub(1), behavior: '', function: 'sumQty' }] };

    const out = await gate.validateInitial(dirty, ctx);
    expect(out).toBe(fixed);
    expect(promptParent.mock.calls[0][1]).toContain('缺少必填参数 recordSet');
  });
});

describe('PlanGate · 调整链（validateAdjustment · 依赖收尾 + 已执行上下文）', () => {
  it('dep 指向已执行 seq → 合法放行（调整规划常只含剩余子任务）', async () => {
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway, promptParent });
    const { ctx } = mkCtx();
    const plan: SubTaskPlan = { subtasks: [{ ...mkSub(2), depends_on: [1] }] };

    const out = await gate.validateAdjustment(plan, ctx, { seqs: new Set([1]), tasks: new Map([[1, 'QuerySupplier']]) });
    expect(out).toBe(plan);
    expect(promptParent).not.toHaveBeenCalled();
  });

  it('dep 悬空（既不在规划内也未执行）→ nudge 一次，修正后放行', async () => {
    const fixed: SubTaskPlan = { subtasks: [mkSub(3)] };
    const { ctx, events } = mkCtx();
    const promptParent = vi.fn().mockImplementation(async () => { ctx.submittedPlan.submit(fixed); });
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateAdjustment({ subtasks: [{ ...mkSub(3), depends_on: [9] }] }, ctx, { seqs: new Set(), tasks: new Map() });
    expect(out).toBe(fixed);
    expect(promptParent).toHaveBeenCalledTimes(1);
    const names = events.filter((e: any) => e.type === 'exec_entry').map((e: any) => `${e.entry.name}:${e.entry.status}`);
    expect(names).toContain('依赖结构校验:failed');
    expect(names).toContain('依赖结构已修正:done');
  });

  it('新任务冒名已执行 seq（同 seq 不同名）→ seq 校验拦下', async () => {
    const { ctx } = mkCtx();
    const promptParent = vi.fn().mockResolvedValue(undefined); // 不重提 → 判废
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateAdjustment({ subtasks: [{ ...mkSub(1), description: '冒名任务' }] }, ctx,
      { seqs: new Set([1]), tasks: new Map([[1, '原有任务']]) });
    expect(out).toBeNull();
    expect(promptParent).toHaveBeenCalledTimes(1);
  });
});
