/**
 * SubtaskRunner 集成测试 —— 工具报错预算（errorBudget）接线。
 * 用真实 wrapExecuteWithErrorBudget + 真实 SubtaskRunner，替换 createChildAgent 返回的 AgentPort，
 * 验证"连续报错 3 次 → 返回失败+明确原因、prompt 只调 1 次不再外层重试"。
 * 注：vitest4 的 beforeEach mockReset 会让 mock 抛错被误报未捕获，统一用 afterEach 清。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SubtaskRunner, type SubtaskRunnerDeps } from './subtask-runner.js';
import { wrapExecuteWithErrorBudget, type ToolErrorBudget } from './error-budget.js';
import type { AgentPort } from './agent-port.js';
import type { ConfirmPort } from './confirm-manager.js';
import { createEventChannel } from './event-channel.js';
import type { SubTask, BehaviorMeta, SkillContext } from '../types.js';

/** 静默事件通道（测试不关心事件流，只关心返回值） */
const noopChannel = createEventChannel(() => {});

// ─── fixtures ──────────────────────────────

const subTask: SubTask = {
  seq: 1,
  behavior: 'CreatePurchaseRecord',
  params: { supplier_id: 7, item_id: 3, quantity: 10 },
  description: '创建采购记录',
  scenario_name: '生产调度',
  scenario_id: 1,
  ontology_name: '原材料采购和库存',
  ontology_id: 1,
};

const meta: BehaviorMeta = {
  display_name: '创建采购记录',
  params: { supplier_id: { required: true }, item_id: { required: true }, quantity: { required: true } },
  preRules: [],
  postRules: [],
  concepts: [],
  isWrite: true,
};

const context: SkillContext = {
  scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1,
};

/** 构造最小 deps：confirm 自动批准；createChildAgent 由各测试注入 */
function makeDeps(createChildAgent: SubtaskRunnerDeps['createChildAgent']): SubtaskRunnerDeps {
  const confirm = vi.fn(async () => ({ approved: true }));
  return {
    confirmManager: { requestConfirm: confirm } as unknown as ConfirmPort,
    createChildAgent,
    childAgents: new Set(),
    getBehaviorDisplayName: () => '',
    getFunctionDisplayName: () => '',
    getBehaviorParams: () => ({}),
  };
}

/** 一个恒抛错的 MCP 工具 execute，通过真实预算包装 */
function throwingTool(errorBudget: ToolErrorBudget) {
  return wrapExecuteWithErrorBudget(async () => { throw new Error('MCP error -32000: Connection closed'); }, errorBudget);
}

afterEach(() => { vi.clearAllMocks(); });

describe('SubtaskRunner · 工具报错预算', () => {
  it('连续报错达上限 → 返回失败+明确原因，prompt 只调 1 次（不再外层重试）', async () => {
    let promptCalls = 0;
    let capturedBudget: ToolErrorBudget | undefined;

    const deps = makeDeps(async (_ctx, _pb, _rp, errorBudget) => {
      capturedBudget = errorBudget;
      const wrapped = throwingTool(errorBudget!);
      return {
        prompt: async () => {
          promptCalls++;
          // 模拟 pi-agent 内层 while(hasMoreToolCalls)：
          // 连续调 3 次工具，前 2 次 rethrow（LLM 自纠），第 3 次返回 terminate:true 停循环
          for (let i = 0; i < 3; i++) {
            try {
              const res = await wrapped(`c-${i}`, {});
              if (res?.terminate) break;
            } catch { /* 前 2 次：预算 rethrow，交给 LLM 自纠 */ }
          }
        },
        abort: () => {},
        subscribe: () => {},
        state: { messages: [] },
      } satisfies AgentPort;
    });

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, meta, context, noopChannel);

    // createChildAgent 确实收到了预算
    expect(capturedBudget).toBeDefined();
    expect(capturedBudget!.count).toBe(3);
    expect(capturedBudget!.exceeded).toBe(true);

    // 记为失败 + 明确原因，不置 aborted（aborted 语义是用户中断/拒绝）
    expect(result).toMatchObject({ seq: 1, task: 'CreatePurchaseRecord', success: false });
    expect(result.error).toContain('连续报错已达 3 次');
    expect(result.error).toContain('已中断执行');
    expect(result.aborted).toBeUndefined();

    // 内层已被 terminate 停住，外层不再重试；子 Agent 已移出在途集合
    expect(promptCalls).toBe(1);
    expect(deps.childAgents.size).toBe(0);
  });

  it('无工具报错 → 正常成功，预算不拦截', async () => {
    let promptCalls = 0;
    let capturedBudget: ToolErrorBudget | undefined;

    const deps = makeDeps(async (_ctx, _pb, _rp, errorBudget) => {
      capturedBudget = errorBudget;
      return {
        prompt: async () => { promptCalls++; },
        abort: () => {},
        subscribe: () => {},
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '已创建采购记录 PO-20260809-001\n【状态】成功' }] }] },
      } satisfies AgentPort;
    });

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, meta, context, noopChannel);

    expect(capturedBudget!.exceeded).toBe(false);
    expect(capturedBudget!.count).toBe(0);
    expect(result.success).toBe(true);
    expect(promptCalls).toBe(1);
  });

  it('工具报错 1 次后内层自纠成功 → 直接成功，不再整轮重做', async () => {
    let promptCalls = 0;
    let capturedBudget: ToolErrorBudget | undefined;

    const deps = makeDeps(async (_ctx, _pb, _rp, errorBudget) => {
      capturedBudget = errorBudget;
      const wrapped = throwingTool(errorBudget!);
      return {
        prompt: async () => {
          promptCalls++;
          // 一次 prompt 内：1 次工具报错（rethrow，预算未达上限），LLM 修正后成功
          await wrapped('c-1', {}).catch(() => {});
        },
        abort: () => {},
        subscribe: () => {},
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '已创建采购记录 PO-001\n【状态】成功' }] }] },
      } satisfies AgentPort;
    });

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, meta, context, noopChannel);

    // 结果以【状态】标记为准：工具报过 1 次错（预算未达上限）但最终成功 → 成功
    expect(result.success).toBe(true);
    expect(promptCalls).toBe(1);                 // 不再整轮重做
    expect(capturedBudget!.count).toBe(1);
    expect(capturedBudget!.exceeded).toBe(false);
  });

  it('工具报错但预算未超限、LLM 自报失败 → 直接失败，不再整轮重做', async () => {
    let promptCalls = 0;
    let capturedBudget: ToolErrorBudget | undefined;

    const deps = makeDeps(async (_ctx, _pb, _rp, errorBudget) => {
      capturedBudget = errorBudget;
      const wrapped = throwingTool(errorBudget!);
      return {
        prompt: async () => {
          promptCalls++;
          await wrapped('c-1', {}).catch(() => {});   // 1 次工具报错（预算未达上限）
        },
        abort: () => {},
        subscribe: () => {},
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '前置规则验证失败\n【状态】失败' }] }] },
      } satisfies AgentPort;
    });

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, meta, context, noopChannel);

    expect(result.success).toBe(false);
    expect(result.error).toContain('前置规则验证失败');
    expect(promptCalls).toBe(1);                 // 失败即终，不整轮重做
    expect(capturedBudget!.count).toBe(1);
  });

  it('prompt() 抛异常（LLM API 错误）→ 重试后成功', async () => {
    let promptCalls = 0;

    const deps = makeDeps(async (_ctx, _pb, _rp) => ({
      prompt: async () => {
        promptCalls++;
        if (promptCalls === 1) throw new Error('LLM API 503: Service Unavailable');
        // 第 2 次成功
      },
      abort: () => {},
      subscribe: () => {},
      state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '已创建采购记录 PO-002\n【状态】成功' }] }] },
    } satisfies AgentPort));

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, meta, context, noopChannel);

    expect(result.success).toBe(true);
    expect(promptCalls).toBe(2);                 // 1 次初始 + 1 次异常重试
  });

  it('prompt() 持续抛异常 → 重试达上限后失败', async () => {
    let promptCalls = 0;

    const deps = makeDeps(async (_ctx, _pb, _rp) => ({
      prompt: async () => {
        promptCalls++;
        throw new Error('LLM API 503: Service Unavailable');
      },
      abort: () => {},
      subscribe: () => {},
      state: { messages: [] },
    } satisfies AgentPort));

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, meta, context, noopChannel);

    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM 调用异常');
    expect(promptCalls).toBe(3);                 // 1 次初始 + MAX_LLM_EXCEPTION_RETRIES=2 次重试
  });

  it('无前置/后置规则时：合法行为列表只含主行为，关联概念属性不渲染', async () => {
    let instruction = '';
    const metaNoRules: BehaviorMeta = {
      display_name: '取消采购记录',
      params: { purchaseRecordId: { required: true } },
      preRules: [],
      postRules: [],
      concepts: [{ name: 'PurchaseRecord', display_name: '采购记录', attributes: [{ name: 'purchaseRecordId', type: 'string', display_name: '采购单号' }] }],
      isWrite: true,
    };
    const deps = makeDeps(async () => ({
      prompt: async (msg: string) => { instruction = msg; },
      abort: () => {},
      subscribe: () => {},
      state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '执行成功\n【状态】成功' }] }] },
    } satisfies AgentPort));

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, metaNoRules, context, noopChannel);

    expect(result.success).toBe(true);
    expect(instruction).toContain('### 本子任务合法行为列表');
    expect(instruction).toContain('- 主行为: CreatePurchaseRecord');
    expect(instruction).toContain('- 规则关联行为: （无）');
    // 无规则且父 Agent 未指定时，可用函数/工具为无（不再恒挂公共函数）
    expect(instruction).toContain('- 可用函数/工具（规则声明或父 Agent 指定，直接工具调用）: （无）');
    // 无规则 → 关联概念属性不渲染，避免诱导无谓查证
    expect(instruction).not.toContain('关联概念属性');
  });

  it('有前置/后置规则时：规则关联行为与关联函数填入合法列表，关联概念属性渲染', async () => {
    let instruction = '';
    const metaWithRules: BehaviorMeta = {
      display_name: '创建采购记录',
      params: {},
      preRules: [
        { name: 'V01', description: '单位一致性', position: '前置', related_behaviors: ['CreatePurchaseRecord'], data_supplements: ['QueryRawMaterials'], related_functions: [] },
      ],
      postRules: [
        { name: 'I02', description: '超期预警', position: '后置', related_behaviors: ['CreatePurchaseRecord'], data_supplements: [], related_functions: ['getCurrentDate', 'calcSafetyStock'] },
      ],
      concepts: [{ name: 'PurchaseRecord', display_name: '采购记录', attributes: [{ name: 'purchaseRecordId', type: 'string', display_name: '采购单号' }] }],
      isWrite: true,
    };
    const deps = makeDeps(async () => ({
      prompt: async (msg: string) => { instruction = msg; },
      abort: () => {},
      subscribe: () => {},
      state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '执行成功\n【状态】成功' }] }] },
    } satisfies AgentPort));

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTask, metaWithRules, context, noopChannel);

    expect(result.success).toBe(true);
    expect(instruction).toContain('- 规则关联行为: QueryRawMaterials');
    // 规则关联函数直接工具调用；可用函数/工具按「规则声明 ∪ 父 Agent 指定」挂载（不再恒挂全部）
    expect(instruction).toContain('- 可用函数/工具（规则声明或父 Agent 指定，直接工具调用）: getCurrentDate、calcSafetyStock');
    // 有规则 → 关联概念属性渲染（规则可能引用属性验证）
    expect(instruction).toContain('### 关联概念属性');
  });

  it('父 Agent 指定 related_functions 时：规则外函数并入合法列表（合并）', async () => {
    let instruction = '';
    const subTaskWithFuncs: SubTask = { ...subTask, related_functions: ['sumRawNotArrivalQty'] };
    const metaWithRules: BehaviorMeta = {
      display_name: '创建采购记录',
      params: {},
      preRules: [],
      postRules: [
        { name: 'I02', description: '超期预警', position: '后置', related_behaviors: ['CreatePurchaseRecord'], data_supplements: [], related_functions: ['getCurrentDate', 'calcSafetyStock'] },
      ],
      concepts: [],
      isWrite: true,
    };
    const deps = makeDeps(async () => ({
      prompt: async (msg: string) => { instruction = msg; },
      abort: () => {},
      subscribe: () => {},
      state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '执行成功\n【状态】成功' }] }] },
    } satisfies AgentPort));

    const runner = new SubtaskRunner(deps);
    const result = await runner.run(subTaskWithFuncs, metaWithRules, context, noopChannel);

    expect(result.success).toBe(true);
    // 规则声明 getCurrentDate、calcSafetyStock + 父 Agent 补充 sumRawNotArrivalQty → 并集（单一「可用函数/工具」行）
    expect(instruction).toContain('- 可用函数/工具（规则声明或父 Agent 指定，直接工具调用）: getCurrentDate、calcSafetyStock、sumRawNotArrivalQty');
  });
});
