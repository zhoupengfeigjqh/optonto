/**
 * PlanGate 单元测试 —— 规划闸门脱离 execute() 全路径直测。
 * 以 validateTaskSeqs（校验链首，校验器为纯函数 validateSeqConflicts）验证修复循环骨架：
 * 干净放行 / nudge 一次修正 / 复验不过判废 / 未重提判废；约束校验的范围硬中断另测。
 */
import { describe, it, expect, vi } from 'vitest';
import { PlanGate } from './plan-gate.js';
import type { PlanRepairCtx } from './plan-gate.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { AgentPort } from './agent-port.js';
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

function mkCtx(): { ctx: PlanRepairCtx; events: SSEEvent[]; parent: AgentPort } {
  const events: SSEEvent[] = [];
  const parent = { state: { messages: [] }, abort: vi.fn(), subscribe: vi.fn() } as unknown as AgentPort;
  return {
    events,
    parent,
    ctx: {
      parentAgent: parent,
      submittedPlan: mkSubmission(),
      emit: createEventChannel(e => events.push(e)),
      catalog: { functionInfo: () => null } as unknown as FunctionCatalogView,
    },
  };
}

describe('PlanGate · 修复循环骨架（validateTaskSeqs）', () => {
  it('规划干净 → 原样放行，不 nudge 父Agent', async () => {
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway, promptParent });
    const { ctx } = mkCtx();
    const plan: SubTaskPlan = { subtasks: [mkSub(1), mkSub(2)] };

    const out = await gate.validateTaskSeqs(plan, ctx);
    expect(out).toBe(plan);
    expect(promptParent).not.toHaveBeenCalled();
  });

  it('seq 冲突 → nudge 一次，父Agent 重提干净规划 → 放行并记修正流水', async () => {
    const fixed: SubTaskPlan = { subtasks: [mkSub(1), mkSub(2)] };
    const { ctx, events } = mkCtx();
    const promptParent = vi.fn().mockImplementation(async () => { ctx.submittedPlan.submit(fixed); });
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateTaskSeqs({ subtasks: [mkSub(1), mkSub(1)] }, ctx);
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

    const out = await gate.validateTaskSeqs({ subtasks: [mkSub(1), mkSub(1)] }, ctx);
    expect(out).toBeNull();
    expect(promptParent).toHaveBeenCalledTimes(1); // 不再二次 nudge
  });

  it('父Agent 未重提规划 → 判废返回 null', async () => {
    const { ctx } = mkCtx();
    const promptParent = vi.fn().mockResolvedValue(undefined); // 不写 holder
    const gate = new PlanGate({ gateway, promptParent });

    const out = await gate.validateTaskSeqs({ subtasks: [mkSub(1), mkSub(1)] }, ctx);
    expect(out).toBeNull();
  });
});

describe('PlanGate · 约束校验（validateTaskConstraints）', () => {
  it('取值范围违例 → 硬中断：fatalReason 带明细，不 nudge 父Agent', async () => {
    // gateway 回溯约束：qty 声明 integer + 概念属性带 min/max，子任务填值越界
    const gw = {
      getBehaviorMeta: () => ({
        display_name: '', params: { qty: { type: 'integer', required: true } }, preRules: [], postRules: [], isWrite: false,
        concepts: [{ name: 'PurchaseRecord', display_name: '采购记录', attributes: [
          { name: 'qty', type: 'integer', display_name: '数量', constraint: { min: 1, max: 100 } },
        ] }],
      }),
    } as unknown as OntologyGatewayPort;
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway: gw, promptParent });
    const { ctx, events } = mkCtx();
    const plan: SubTaskPlan = { subtasks: [{ ...mkSub(1), params: { qty: { value: 999 } } }] };

    const out = await gate.validateTaskConstraints(plan, ctx);
    expect(out.plan).toBeNull();
    expect(out.fatalReason).toContain('参数值超出取值范围');
    expect(promptParent).not.toHaveBeenCalled(); // 范围违例不给 LLM 自修机会
    expect(events.filter((e: any) => e.type === 'exec_entry').map((e: any) => e.entry.name)).toContain('取值范围校验');
  });

  it('无约束违例 → 原样放行', async () => {
    const promptParent = vi.fn();
    const gate = new PlanGate({ gateway, promptParent });
    const { ctx } = mkCtx();
    const plan: SubTaskPlan = { subtasks: [mkSub(1)] };
    const out = await gate.validateTaskConstraints(plan, ctx);
    expect(out.plan).toBe(plan);
    expect(out.fatalReason).toBeUndefined();
  });
});
