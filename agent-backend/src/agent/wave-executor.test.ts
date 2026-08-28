/**
 * WaveExecutor 单元测试 —— 波次调度脱离 execute() 全路径直测。
 * 验证三分类分派（函数 meta=null / 读操作并行 / 写操作串行）与 run 级安全闸截断。
 * 单个任务怎么跑（直连/子Agent/确认/重试）是 SubtaskRunner 的事，这里用 fake runner 隔离。
 */
import { describe, it, expect, vi } from 'vitest';
import { WaveExecutor } from './wave-executor.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { SubtaskRunner } from './subtask-runner.js';
import { createSecurityGate } from './security-policy.js';
import { createEventChannel } from './event-channel.js';
import type { SubTask, SubTaskResult, BehaviorMeta } from '../types.js';

const noopChannel = createEventChannel(() => {});

function mkSub(seq: number, over?: Partial<SubTask>): SubTask {
  return {
    seq, behavior: `Behavior${seq}`, params: {}, description: `子任务${seq}`,
    scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1,
    ...over,
  };
}

/** gateway fake：Behavior2 是写操作（需确认串行），其余是读操作（并行） */
function mkGateway(): OntologyGatewayPort {
  return {
    getBehaviorMeta: (_s: string, _o: string, b: string): BehaviorMeta => ({
      display_name: `${b}中文名`, params: {}, preRules: [], postRules: [], concepts: [],
      isWrite: b === 'Behavior2',
    }),
  } as unknown as OntologyGatewayPort;
}

/** fake runner：记录每次 run 的 (seq, meta 是否为空)，按序返回成功 */
function mkRunner() {
  const calls: { seq: number; metaNull: boolean }[] = [];
  const runner = {
    run: async (st: SubTask, meta: BehaviorMeta | null): Promise<SubTaskResult> => {
      calls.push({ seq: st.seq, metaNull: meta === null });
      return { seq: st.seq, task: st.function || st.behavior, success: true, summary: 'ok' };
    },
  } as unknown as SubtaskRunner;
  return { runner, calls };
}

describe('WaveExecutor · 三分类分派', () => {
  it('函数子任务以 meta=null 进统一入口；行为子任务带 meta；全部结果收齐', async () => {
    const executor = new WaveExecutor({ gateway: mkGateway() });
    const { runner, calls } = mkRunner();

    const batch = [
      mkSub(1),                                                  // 读操作 → 并行
      mkSub(2),                                                  // 写操作 → 串行（需确认）
      mkSub(3, { function: 'calcSafetyStock', behavior: '' }),   // 函数 → 直连（runner 内）
    ];
    const results = await executor.runBatch(batch, noopChannel, runner, createSecurityGate());

    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
    const bySeq = new Map(calls.map(c => [c.seq, c.metaNull]));
    expect(bySeq.get(1)).toBe(false);  // 行为子任务带 meta
    expect(bySeq.get(2)).toBe(false);
    expect(bySeq.get(3)).toBe(true);   // 函数子任务 meta=null（runner 内走直连路径）
  });

  it('runner 失败结果原样透传（不抛错打断整波）', async () => {
    const executor = new WaveExecutor({ gateway: mkGateway() });
    const runner = {
      run: async (st: SubTask): Promise<SubTaskResult> => st.seq === 1
        ? { seq: 1, task: st.behavior, success: false, error: '❌ 函数执行失败：MCP error', summary: '' }
        : { seq: st.seq, task: st.function || st.behavior, success: true, summary: 'ok' },
    } as unknown as SubtaskRunner;

    const results = await executor.runBatch([mkSub(1), mkSub(3)], noopChannel, runner, createSecurityGate());
    expect(results.find(r => r.seq === 1)!.success).toBe(false);
    expect(results.find(r => r.seq === 3)!.success).toBe(true);
  });
});

describe('WaveExecutor · 安全闸截断', () => {
  it('violation 预置 → 行为子任务一律不启动（函数子任务不受闸管辖，照常分派）', async () => {
    const executor = new WaveExecutor({ gateway: mkGateway() });
    const { runner, calls } = mkRunner();
    const gate = createSecurityGate();
    gate.violation = '🔒 行为已被禁用';

    const batch = [mkSub(1), mkSub(2), mkSub(3, { function: 'calcSafetyStock', behavior: '' })];
    const results = await executor.runBatch(batch, noopChannel, runner, gate);

    expect(calls.map(c => c.seq)).toEqual([3]); // 读/写行为子任务全部被截断，仅函数子任务分派
    expect(results).toHaveLength(1);
  });
});
