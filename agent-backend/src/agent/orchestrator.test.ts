/**
 * Orchestrator 规划确认策略单元测试。
 * 验证 planNeedsConfirm：仅多步任务需要规划确认弹窗，单步任务跳过（由安全管控弹窗兜底）。
 * 另覆盖 execute() 单 run 互斥（候选4：并发串扰从注释假设变为机制强制）。
 */
import { describe, it, expect, vi } from 'vitest';
import { Orchestrator, planNeedsConfirm } from './orchestrator.js';
import type { AgentFactoryPort, OntologyGatewayPort } from './agent-ports.js';
import type { AgentPort } from './agent-ports.js';
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
      createChildAgent: vi.fn().mockImplementation(async (_ctx, policy) => ({
        prompt: async () => { policy.security.gate.violation = '🔒 行为已被禁用：Behavior1 的权限范围为 disable，已中断执行。'; },
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
    const orch = new Orchestrator(factory, gateway, () => confirm as any);

    await orch.execute('测试 disable 中断', [], [], () => {});

    // 子任务2 从未启动（violation → securityBlocked → 不开新波、不反馈重规划）
    expect(factory.createChildAgent).toHaveBeenCalledTimes(1);
    // 总结阶段父 Agent 收到的终止原因 = 工具层闸的 disable 文案
    const prompts = (parent.prompt as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(prompts.some(p => p.includes('权限范围为 disable'))).toBe(true);
  });
});

// ─── 言行不一闸：声称已提交规划但未调用 submit_plan ─────────────────────

describe('Orchestrator · 言行不一闸（假提交声明检测 → nudge 一次 → 诚实兜底）', () => {
  const claimGateway = {
    getBehaviorMeta: () => ({ display_name: '', params: {}, preRules: [], postRules: [], concepts: [], isWrite: false }),
    getBehaviorNames: () => ['Behavior1'],
    getFunctionNames: () => [],
    getFunctionInfo: () => null,
  } as unknown as OntologyGatewayPort;
  const claimConfirm = {
    requestConfirm: vi.fn(),
    requestPlanConfirm: vi.fn().mockResolvedValue({ approved: true }),
    abortAll: vi.fn(),
  };

  /**
   * 父 Agent fake：第 1 次 prompt 输出虚假提交声明；第 2 次（nudge）按 afterNudge 分岔：
   *  plan   → 真的调用 onPlanSubmitted 提交单子任务规划（自救成功）
   *  claim  → 仍输出虚假声明（死不悔改）
   *  answer → 改为诚实直答（自救转直答）
   */
  function mkClaimFactory(afterNudge: 'plan' | 'claim' | 'answer') {
    const parent = {
      prompt: vi.fn(),
      abort: vi.fn(),
      subscribe: vi.fn(),
      state: { messages: [] as any[] },
    } as unknown as AgentPort;
    const factory: AgentFactoryPort = {
      createParentAgent: vi.fn().mockImplementation(async (_s, _h, _onSkill, onPlanSubmitted) => {
        let calls = 0;
        (parent.prompt as any).mockImplementation(async () => {
          calls++;
          const push = (content: string) => parent.state.messages.push({ role: 'assistant', content });
          if (calls === 1) { push('好的，我已提交了执行计划，共 2 个子任务，即将开始执行。'); return; }
          if (calls === 2) {
            if (afterNudge === 'plan') {
              onPlanSubmitted?.({ subtasks: [{ ...mkSubtask(1) }] });
              push('规划已重新提交。');
            } else if (afterNudge === 'claim') {
              push('执行计划已提交，请稍等。');
            } else {
              push('当前原材料库存 35 吨，无需执行操作。');
            }
          }
          // 第 3 次起（总结阶段等）：不再新增消息
        });
        return parent;
      }),
      createChildAgent: vi.fn().mockImplementation(async () => ({
        prompt: async () => {},
        abort: () => {},
        subscribe: () => {},
        state: { messages: [{ role: 'assistant', content: '子任务执行完成' }] },
      })),
      callFunctionTool: vi.fn(),
      getMountableToolCatalog: vi.fn().mockResolvedValue([]),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    return { parent, factory };
  }

  it('声称已提交 → nudge 后真提交规划 → 无缝自救进入正常校验链并执行', async () => {
    const { parent, factory } = mkClaimFactory('plan');
    const orch = new Orchestrator(factory, claimGateway, () => claimConfirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('查一下库存', [], [], e => events.push(e));

    // nudge 文案确实发给了父 Agent
    const prompts = (parent.prompt as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(prompts.some(p => p.includes('系统未收到你的 submit_plan 工具调用'))).toBe(true);
    // 留痕：检测条目已推送
    expect(events.some(e => e.type === 'exec_entry' && (e as any).entry?.name === '规划提交校验')).toBe(true);
    // 自救成功：子 Agent 真的启动了，未走"规划提交失败"兜底
    expect(factory.createChildAgent).toHaveBeenCalledTimes(1);
    expect(reply).not.toContain('规划提交失败');
  });

  it('声称已提交 → nudge 后仍声称已提交 → 诚实报错，虚假声明原文不进正文', async () => {
    const { parent, factory } = mkClaimFactory('claim');
    const orch = new Orchestrator(factory, claimGateway, () => claimConfirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('查一下库存', [], [], e => events.push(e));

    expect(reply).toContain('规划提交失败');
    expect(events.some(e => e.type === 'error' && (e as any).message?.includes('规划提交失败'))).toBe(true);
    // 虚假声明原文未作为正文 token 回流给用户
    const tokens = events.filter(e => e.type === 'token').map(e => (e as any).token).join('');
    expect(tokens).not.toContain('我已提交了执行计划');
    expect(tokens).not.toContain('执行计划已提交，请稍等');
    // 只 nudge 一次：初始 1 次 + nudge 1 次，不无限循环
    expect((parent.prompt as any).mock.calls).toHaveLength(2);
    expect(factory.createChildAgent).not.toHaveBeenCalled();
  });

  it('声称已提交 → nudge 后改为诚实直答 → 直答路径放行新回答', async () => {
    const { parent, factory } = mkClaimFactory('answer');
    const orch = new Orchestrator(factory, claimGateway, () => claimConfirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('查一下库存', [], [], e => events.push(e));

    expect(reply).toBe('当前原材料库存 35 吨，无需执行操作。');
    const tokens = events.filter(e => e.type === 'token').map(e => (e as any).token).join('');
    expect(tokens).toContain('当前原材料库存 35 吨');
    expect(factory.createChildAgent).not.toHaveBeenCalled();
  });

  it('非声明直答 → 不触发 nudge，原样直通（回归：正常直答零影响）', async () => {
    const parent = fakeParentAgent();
    (parent.prompt as any).mockImplementation(async () => {
      parent.state.messages.push({ role: 'assistant', content: '当前库存 35 吨，如需调整计划，请重新提交需求。' });
    });
    const factory = mkFactory(vi.fn().mockResolvedValue(parent));
    const orch = new Orchestrator(factory, noopGateway);
    const reply = await orch.execute('库存多少', [], [], () => {});

    expect(reply).toContain('当前库存 35 吨');
    expect((parent.prompt as any).mock.calls).toHaveLength(1); // 无 nudge
  });
});

// ─── 父Agent 工具调用留痕（load_skill / list* → 执行记录） ─────────────────────

describe('Orchestrator · 父Agent 工具调用留痕', () => {
  /** 父 Agent fake：subscribe 捕获 listener；prompt 期间按 fire 回调注入合成工具事件，最后压一条直答 */
  function mkTraceFactory(fire: (emitEv: (e: any) => void) => void) {
    const parent = {
      prompt: vi.fn(),
      abort: vi.fn(),
      subscribe: vi.fn(),
      state: { messages: [] as any[] },
    } as unknown as AgentPort;
    let listener: ((e: any, s: AbortSignal) => void) | null = null;
    (parent.subscribe as any).mockImplementation((l: any) => { listener = l; });
    (parent.prompt as any).mockImplementation(async () => {
      fire(e => listener?.(e, new AbortController().signal));
      parent.state.messages.push({ role: 'assistant', content: '直接回答你。' });
    });
    return { parent, factory: mkFactory(vi.fn().mockResolvedValue(parent)) };
  }

  function toolEntries(events: SSEEvent[]) {
    return events.filter(e => e.type === 'exec_entry').map(e => (e as any).entry).filter(en => en.type === 'tool_call');
  }

  it('list* 查询：running→done 成对推送，中文（英文）展示名，结果不截断，end 参数经桥接与 start 一致', async () => {
    const { factory } = mkTraceFactory(emitEv => {
      emitEv({ type: 'tool_execution_start', toolName: 'listOntoBehaviors', toolCallId: 't1', args: { ontology_id: 1 } });
      emitEv({ type: 'tool_execution_end', toolName: 'listOntoBehaviors', toolCallId: 't1', result: { content: [{ text: '行为A\n行为B' }] } });
    });
    const orch = new Orchestrator(factory, noopGateway);
    const events: SSEEvent[] = [];
    await orch.execute('本体里有哪些行为', [], [], e => events.push(e));

    const calls = toolEntries(events).filter(en => en.name === 'listOntoBehaviors');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ status: 'running', params: { ontology_id: 1 }, source: 'parent', displayName: '查询行为清单（listOntoBehaviors）', displayLabel: '查询行为清单' });
    expect(calls[1]).toMatchObject({ status: 'done', params: { ontology_id: 1 }, result: '行为A\n行为B', source: 'parent', displayName: '查询行为清单（listOntoBehaviors）' });
  });

  it('load_skill：仅完成时推一条，只记技能名，不带 SKILL 全文', async () => {
    const { factory } = mkTraceFactory(emitEv => {
      emitEv({ type: 'tool_execution_start', toolName: 'load_skill', toolCallId: 's1', args: { skill_name: 'raw-material-inventory' } });
      emitEv({ type: 'tool_execution_end', toolName: 'load_skill', toolCallId: 's1', result: { content: [{ text: '# SKILL 全文（很长）……' }] } });
    });
    const orch = new Orchestrator(factory, noopGateway);
    const events: SSEEvent[] = [];
    await orch.execute('加载技能看看', [], [], e => events.push(e));

    const calls = toolEntries(events).filter(en => en.name === 'load_skill');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 'done', source: 'parent', displayName: '加载技能知识（load_skill）', displayLabel: '加载技能知识', detail: '已加载技能：raw-material-inventory' });
    expect(calls[0].result).toBeUndefined();
  });

  it('submit_plan / listAllMcpFunctions 不推执行记录', async () => {
    const { factory } = mkTraceFactory(emitEv => {
      emitEv({ type: 'tool_execution_start', toolName: 'submit_plan', toolCallId: 'p1', args: { subtasks: [] } });
      emitEv({ type: 'tool_execution_end', toolName: 'submit_plan', toolCallId: 'p1', result: { content: [{ text: '已接收执行规划' }] } });
      emitEv({ type: 'tool_execution_start', toolName: 'listAllMcpFunctions', toolCallId: 'f1', args: {} });
      emitEv({ type: 'tool_execution_end', toolName: 'listAllMcpFunctions', toolCallId: 'f1', result: { content: [{ text: '[]' }] } });
    });
    const orch = new Orchestrator(factory, noopGateway);
    const events: SSEEvent[] = [];
    await orch.execute('随便聊聊', [], [], e => events.push(e));

    expect(toolEntries(events)).toHaveLength(0);
  });
});

// ─── 规划确认/重规划循环（ConfirmPort fake 打"用户说不"分支） ─────────────────────

describe('Orchestrator · 规划确认/重规划循环', () => {
  const loopGateway = {
    getBehaviorMeta: () => ({ display_name: '', params: {}, preRules: [], postRules: [], concepts: [], isWrite: false }),
    getBehaviorNames: () => ['Behavior1', 'Behavior2', 'Behavior3'],
    getFunctionNames: () => [],
    getFunctionInfo: () => null,
  } as unknown as OntologyGatewayPort;

  const noopChild = {
    prompt: async () => {},
    abort: () => {},
    subscribe: () => {},
    state: { messages: [{ role: 'assistant', content: '子任务执行完成 【状态】成功' }] },
  };

  /**
   * 规划循环 rig：submitAt = 第 N 次 prompt（从 1 计）提交的规划；replyAt = 第 N 次 prompt 压入的
   * assistant 消息（收尾话术/最终总结）；confirmQueue = requestPlanConfirm 依序出队的用户响应（耗尽默认批准）。
   */
  function mkLoopRig(opts: {
    submitAt?: Record<number, SubTaskPlan>;
    replyAt?: Record<number, string>;
    confirmQueue: any[];
  }) {
    const parent = {
      prompt: vi.fn(), abort: vi.fn(), subscribe: vi.fn(),
      state: { messages: [] as any[] },
    } as unknown as AgentPort;
    const submitAt = opts.submitAt ?? {};
    const replyAt = opts.replyAt ?? {};
    const factory: AgentFactoryPort = {
      createParentAgent: vi.fn().mockImplementation(async (_s, _h, _onSkill, onPlanSubmitted) => {
        let calls = 0;
        (parent.prompt as any).mockImplementation(async () => {
          calls++;
          if (submitAt[calls]) onPlanSubmitted?.(submitAt[calls]);
          if (replyAt[calls]) parent.state.messages.push({ role: 'assistant', content: replyAt[calls] });
        });
        return parent;
      }),
      createChildAgent: vi.fn().mockResolvedValue(noopChild),
      callFunctionTool: vi.fn(),
      getMountableToolCatalog: vi.fn().mockResolvedValue([]),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const confirm = {
      requestConfirm: vi.fn(),
      requestPlanConfirm: vi.fn().mockImplementation(() => Promise.resolve(opts.confirmQueue.shift() ?? { approved: true })),
      abortAll: vi.fn(),
    };
    return { parent, factory, confirm };
  }

  const promptsOf = (parent: AgentPort) => (parent.prompt as any).mock.calls.map((c: any[]) => String(c[0]));
  const entryDetails = (events: SSEEvent[]) =>
    events.filter(e => e.type === 'exec_entry').map(e => `${(e as any).entry?.name}|${(e as any).entry?.detail ?? ''}`);

  it('用户拒绝并退出 → 父Agent 收尾话术作回复，不创建子Agent，流以 done 收尾', async () => {
    const { parent, factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), mkSubtask(2)]) },
      replyAt: { 2: '已按您的意愿取消，未执行任何操作。' },
      confirmQueue: [{ approved: false }],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('帮我建两张采购单', [], [], e => events.push(e));

    expect(reply).toBe('已按您的意愿取消，未执行任何操作。');
    expect(factory.createChildAgent).not.toHaveBeenCalled();
    expect(entryDetails(events).some(d => d.startsWith('规划审核|用户拒绝执行规划'))).toBe(true);
    expect(promptsOf(parent).some(p => p.includes('用户取消了本次执行计划'))).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('拒绝并重规划 → 建议带给父Agent，新规划（单子任务）过校验后不再弹窗、直接执行', async () => {
    const { parent, factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), mkSubtask(2)]), 2: plan([mkSubtask(1)]) },
      replyAt: { 3: '全部执行完毕。' },
      confirmQueue: [{ approved: false, rejectAction: 'replan', suggestion: '只保留一个子任务' }],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('建采购单', [], [], e => events.push(e));

    expect(promptsOf(parent)[1]).toContain('只保留一个子任务'); // 用户建议透传给父Agent
    expect(confirm.requestPlanConfirm).toHaveBeenCalledTimes(1); // 第二轮单子任务跳过弹窗
    expect(entryDetails(events).some(d => d.startsWith('规划审核|用户拒绝并要求重新规划'))).toBe(true);
    expect(factory.createChildAgent).toHaveBeenCalledTimes(1);
    expect(reply).toBe('全部执行完毕。');
  });

  it('连续重规划触顶 MAX_PLAN_ROUNDS → 以「重规划次数已达上限」退出，不执行任何子任务', async () => {
    const { factory, confirm } = mkLoopRig({
      submitAt: {
        1: plan([mkSubtask(1), mkSubtask(2)]),
        2: plan([mkSubtask(1), mkSubtask(2)]),
        3: plan([mkSubtask(1), mkSubtask(2)]),
      },
      replyAt: { 4: '已取消。' },
      confirmQueue: [
        { approved: false, rejectAction: 'replan', suggestion: '再改一版' },
        { approved: false, rejectAction: 'replan', suggestion: '还不行' },
        { approved: false, rejectAction: 'replan', suggestion: '继续改' },
      ],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    await orch.execute('建采购单', [], [], e => events.push(e));

    expect(entryDetails(events).some(d => d.startsWith('规划审核|重规划次数已达上限'))).toBe(true);
    expect(factory.createChildAgent).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('done');
  });

  it('重规划未提交有效规划 → 以「重规划未生成有效规划」退出', async () => {
    const { factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), mkSubtask(2)]) }, // 重规划 prompt（第 2 次）不提交
      replyAt: { 3: '已取消。' },
      confirmQueue: [{ approved: false, rejectAction: 'replan' }],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    await orch.execute('建采购单', [], [], e => events.push(e));

    expect(entryDetails(events).some(d => d.startsWith('规划审核|重规划未生成有效规划'))).toBe(true);
    expect(factory.createChildAgent).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('done');
  });

  it('用户确认时编辑规划（删子任务）→ 按编辑版执行，最终规划注入父Agent 上下文', async () => {
    const { parent, factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), mkSubtask(2)]) },
      replyAt: { 2: '已完成。' },
      confirmQueue: [{ approved: true, plan: plan([mkSubtask(2)]) }], // 用户删掉子任务1
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    await orch.execute('建采购单', [], [], e => events.push(e));

    expect(entryDetails(events).some(d => d.startsWith('规划已修改|'))).toBe(true);
    // 只执行编辑后留下的 Behavior2（经真实 SubtaskPolicy 的 legalCalls 断言）
    expect(factory.createChildAgent).toHaveBeenCalledTimes(1);
    const policy = (factory.createChildAgent as any).mock.calls[0][1];
    expect(policy.legalCalls.behaviors).toContain('Behavior2');
    expect(policy.legalCalls.behaviors).not.toContain('Behavior1');
    // injectFinalPlan：父Agent 上下文带最终规划，不脑补被删的子任务
    const injected = parent.state.messages.some((m: any) =>
      String(m.content).includes('用户在确认时修改了执行计划') && String(m.content).includes('Behavior2'));
    expect(injected).toBe(true);
  });

  it('L1：用户把规划删空后确认 → 视同取消，不创建子Agent', async () => {
    const { factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), mkSubtask(2)]) },
      replyAt: { 2: '已取消。' },
      confirmQueue: [{ approved: true, plan: { subtasks: [] } }],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('建采购单', [], [], e => events.push(e));

    expect(reply).toBe('已取消。');
    expect(entryDetails(events).some(d => d.startsWith('规划为空|'))).toBe(true);
    expect(factory.createChildAgent).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('done');
  });

  it('seq 冲突且 nudge 后未修正 → error 与 done 都在（回归：链首失败曾漏发 done）', async () => {
    const { factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), mkSubtask(1)]) }, // 重复 seq；nudge（第 2 次 prompt）不修正
      confirmQueue: [],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('建采购单', [], [], e => events.push(e));

    expect(reply).toContain('规划校验失败');
    expect(events.some(e => e.type === 'error' && (e as any).message?.includes('规划校验失败'))).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
    expect(confirm.requestPlanConfirm).not.toHaveBeenCalled();
    expect(factory.createChildAgent).not.toHaveBeenCalled();
  });

  it('跨波依赖触发波次反馈：父Agent 收到整波结果，无调整则剔除反馈轮上下文并继续原计划', async () => {
    const { parent, factory, confirm } = mkLoopRig({
      submitAt: { 1: plan([mkSubtask(1), { ...mkSubtask(2), depends_on: [1] }]) },
      replyAt: { 2: '继续执行原计划。', 3: '全部完成。' },
      confirmQueue: [{ approved: true }],
    });
    const orch = new Orchestrator(factory, loopGateway, () => confirm as any);
    const events: SSEEvent[] = [];
    const reply = await orch.execute('查库存再建采购单', [], [], e => events.push(e));

    // 反馈 prompt 确已发出，且含本波执行结果
    expect(promptsOf(parent).some(p => p.includes('本波次已执行完毕') && p.includes('子任务 1'))).toBe(true);
    // 无调整 → 反馈轮的 prompt+回复整体剔除（不撑爆父Agent 上下文）
    expect(parent.state.messages.some((m: any) => String(m.content).includes('继续执行原计划'))).toBe(false);
    // 两个子任务分波执行完毕
    expect(factory.createChildAgent).toHaveBeenCalledTimes(2);
    expect(reply).toBe('全部完成。');
  });
});
