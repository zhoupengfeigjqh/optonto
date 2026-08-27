/**
 * Orchestrator 规划确认策略单元测试。
 * 验证 planNeedsConfirm：仅多步任务需要规划确认弹窗，单步任务跳过（由安全管控弹窗兜底）。
 * 另覆盖 execute() 单 run 互斥（候选4：并发串扰从注释假设变为机制强制）。
 */
import { describe, it, expect, vi } from 'vitest';
import { Orchestrator, planNeedsConfirm } from './orchestrator.js';
import type { AgentFactoryPort, OntologyGatewayPort } from './agent-ports.js';
import type { AgentPort } from './agent-port.js';
import type { SubTask, SubTaskPlan, SSEEvent } from '../types.js';

function mkSubtask(seq: number): SubTask {
  return {
    seq, behavior: `Behavior${seq}`, params: {}, description: `子任务${seq}`,
    scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1,
  };
}

function plan(subtasks: SubTask[]): SubTaskPlan {
  return { subtasks };
}

describe('planNeedsConfirm — 规划确认策略', () => {
  it('单步任务：跳过规划确认（false）', () => {
    expect(planNeedsConfirm(plan([mkSubtask(1)]))).toBe(false);
  });

  it('多步任务：需要规划确认（true）', () => {
    expect(planNeedsConfirm(plan([mkSubtask(1), mkSubtask(2)]))).toBe(true);
    expect(planNeedsConfirm(plan([mkSubtask(1), mkSubtask(2), mkSubtask(3), mkSubtask(4), mkSubtask(5)]))).toBe(true);
  });

  it('空规划：不弹确认（false，兜底防御）', () => {
    expect(planNeedsConfirm(plan([]))).toBe(false);
  });
});

// ─── execute() 单 run 互斥 ─────────────────────

function fakeParentAgent(): AgentPort {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    subscribe: vi.fn(),
    state: { messages: [] },
  } as unknown as AgentPort;
}

function mkFactory(createParentAgent: AgentFactoryPort['createParentAgent']): AgentFactoryPort {
  return {
    createParentAgent,
    createChildAgent: vi.fn(),
    callFunctionTool: vi.fn(),
    getMountableToolCatalog: vi.fn().mockResolvedValue([]),
    closeAll: vi.fn().mockResolvedValue(undefined),
  };
}

// 规划阶段不触 gateway 的路径（父 Agent 无 submit_plan → 直接回复兜底），gateway 给空实现即可
const noopGateway = {} as unknown as OntologyGatewayPort;

describe('Orchestrator.execute — 单 run 互斥', () => {
  it('已有 run 在执行时，第二个 execute 立即被拒（error+done 事件），不污染在途 run', async () => {
    let release!: (agent: AgentPort) => void;
    const factory = mkFactory(vi.fn().mockImplementation(
      () => new Promise<AgentPort>(res => { release = res; }),
    ));
    const orch = new Orchestrator(factory, noopGateway);

    const events1: SSEEvent[] = [];
    const p1 = orch.execute('第一条消息', [], [], e => events1.push(e));
    // 等 execute1 进入 run（createParentAgent 挂起中 = activeSession 已就位）
    await vi.waitFor(() => expect(orch.hasActiveRun()).toBe(true));

    const events2: SSEEvent[] = [];
    const reply2 = await orch.execute('第二条消息', [], [], e => events2.push(e));
    expect(reply2).toContain('已有任务正在执行中');
    expect(events2.map(e => e.type)).toEqual(['error', 'done']);
    expect(factory.createParentAgent).toHaveBeenCalledTimes(1); // 第二个 run 未创建父 Agent

    // 收尾 run1：放行父 Agent 创建，无 submit_plan → 走兜底回复正常结束
    release(fakeParentAgent());
    await p1;
    expect(orch.hasActiveRun()).toBe(false);
    expect(factory.closeAll).toHaveBeenCalledTimes(1);
  });

  it('run 结束后互斥释放：下一次 execute 可正常进入', async () => {
    const factory = mkFactory(vi.fn().mockResolvedValue(fakeParentAgent()));
    const orch = new Orchestrator(factory, noopGateway);

    const reply1 = await orch.execute('第一条', [], [], () => {});
    expect(reply1).toContain('无法生成执行计划'); // 父 Agent 无规划/无回复 → 兜底
    const reply2 = await orch.execute('第二条', [], [], () => {});
    expect(reply2).not.toContain('已有任务正在执行中');
    expect(factory.createParentAgent).toHaveBeenCalledTimes(2);
  });

  it('abort() 无活动 run 时安全空转', () => {
    const orch = new Orchestrator(mkFactory(vi.fn()), noopGateway);
    expect(() => orch.abort()).not.toThrow();
  });
});

// ─── securityBlocked：工具层 disable 闸全场中断 ─────────────────────

describe('Orchestrator · securityBlocked（工具层 disable 闸命中 → 中断整个 run）', () => {
  it('子任务1 的工具层闸命中 → 依赖它的子任务2 不再启动，总结携带禁用原因', async () => {
    const parent = fakeParentAgent();
    const factory: AgentFactoryPort = {
      createParentAgent: vi.fn().mockImplementation(async (_s, _h, _onSkill, onPlanSubmitted) => {
        // 首次 prompt（规划阶段）提交规划：子任务2 依赖子任务1（跨波，验证"不开新波"）
        (parent.prompt as any).mockImplementationOnce(async () => {
          onPlanSubmitted?.({ subtasks: [{ ...mkSubtask(1) }, { ...mkSubtask(2), depends_on: [1] }] });
        });
        return parent;
      }),
      // 子 Agent fake：prompt 时模拟工具层闸1 命中——置 run 级 violation（真实判定在 scopeToOntology）
      createChildAgent: vi.fn().mockImplementation(async (_ctx, _rp, _budget, _legal, security) => ({
        prompt: async () => { security!.gate.violation = '🔒 行为已被禁用：Behavior1 的权限范围为 disable，已中断执行。'; },
        abort: () => {},
        subscribe: () => {},
        state: { messages: [] },
      })),
      callFunctionTool: vi.fn(),
      getMountableToolCatalog: vi.fn().mockResolvedValue([]),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = {
      getBehaviorMeta: () => ({ display_name: '', params: {}, preRules: [], postRules: [], concepts: [], isWrite: false }),
      getBehaviorNames: () => ['Behavior1', 'Behavior2'],
      getFunctionNames: () => [],
      getFunctionInfo: () => null,
    } as unknown as OntologyGatewayPort;
    const confirm = {
      requestConfirm: vi.fn(),
      requestPlanConfirm: vi.fn().mockResolvedValue({ approved: true }),
      abortAll: vi.fn(),
    };
    const orch = new Orchestrator(factory, gateway, confirm as any);

    await orch.execute('测试 disable 中断', [], [], () => {});

    // 子任务2 从未启动（violation → securityBlocked → 不开新波、不反馈重规划）
    expect(factory.createChildAgent).toHaveBeenCalledTimes(1);
    // 总结阶段父 Agent 收到的终止原因 = 工具层闸的 disable 文案
    const prompts = (parent.prompt as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(prompts.some(p => p.includes('权限范围为 disable'))).toBe(true);
  });
});
