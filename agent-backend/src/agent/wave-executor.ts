/**
 * 波次执行 —— 一波就绪子任务的调度：三分类 + 限流 + 安全闸截断。
 *
 * 无确认子任务（读操作）并行，按 MAX_PARALLEL 限流分块避免并发打爆 LLM/MCP；
 * 需确认子任务（写操作/security）逐个串行——前端 confirmModal 是单状态，并行弹多个确认窗会互相覆盖；
 * 函数子任务（确定性直连，无 LLM/确认/规则）与行为子任务并行。
 * 块间/串行间检查 run 级安全闸：工具层 disable 命中（violation 置位）后本波剩余子任务不再启动。
 *
 * 单个子任务怎么跑（直连还是子 Agent、确认弹窗、重试、起止执行记录）全部在 SubtaskRunner 的统一入口
 * runner.run(st, meta, emit)——本模块只管"这一波谁先谁后、谁并谁串、何时截断"，不再复制执行知识。
 * 从 Orchestrator 拆出后本模块即测试面：分类/限流/闸截断可脱离 execute() 全路径直测。
 */
import { needsSecurityConfirm } from './security-policy.js';
import type { SecurityGate } from './security-policy.js';
import type { EventChannel } from './event-channel.js';
import type { SubtaskRunner } from './subtask-runner.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { SubTask, SubTaskResult, BehaviorMeta } from '../types.js';

const MAX_PARALLEL = 5; // 波内并行子任务上限：避免就绪任务过多时并发打爆 LLM/MCP

/** 波次执行依赖：本体元信息（三分类查 meta 判确认与否） */
export interface WaveExecutorDeps {
  gateway: OntologyGatewayPort;
}

export class WaveExecutor {
  constructor(private deps: WaveExecutorDeps) {}

  /**
   * 执行一波子任务，返回本波全部结果。
   * runner 由调用方按 run 装配（策略派生/安全确认/重试/函数直连都在 SubtaskRunner 内）。
   */
  async runBatch(
    batch: SubTask[],
    emit: EventChannel,
    runner: SubtaskRunner,
    gate: SecurityGate,
  ): Promise<SubTaskResult[]> {
    const secured: { st: SubTask; meta: BehaviorMeta }[] = [];
    const plain: { st: SubTask; meta: BehaviorMeta }[] = [];
    const functions: SubTask[] = [];
    for (const st of batch) {
      if (st.function) { functions.push(st); continue; }
      const meta = this.deps.gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior);
      (needsSecurityConfirm(meta) ? secured : plain).push({ st, meta });
    }

    const results: SubTaskResult[] = [];
    // 函数子任务：确定性直连调用（无 LLM、无安全确认、无规则），与行为子任务并行
    results.push(...await Promise.all(functions.map(st => runner.run(st, null, emit))));
    // 并行分块：每块内 Promise.all 并发执行；块间安全闸截断
    for (let i = 0; i < plain.length; i += MAX_PARALLEL) {
      if (gate.violation) break;
      const chunk = plain.slice(i, i + MAX_PARALLEL);
      const chunkResults = await Promise.all(chunk.map(({ st, meta }) => runner.run(st, meta, emit)));
      results.push(...chunkResults);
    }
    // 需确认子任务串行执行；逐个之间安全闸截断
    for (const { st, meta } of secured) {
      if (gate.violation) break;
      results.push(await runner.run(st, meta, emit));
    }
    return results;
  }
}
