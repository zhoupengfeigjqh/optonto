/**
 * RunSession —— 一次 execute() 调用的 run 级状态唯一居所（深 module）。
 *
 * 收拢原先散落在 runExecute 大方法里的 mutable 局部变量与 Orchestrator 单例字段：
 *  - 父/子 Agent 引用（abort 寻址）
 *  - submittedPlan holder（submit_plan 工具回调在 await 期间写入，可变 holder 规避 TS 闭包窄化恒 null）
 *  - 已执行子任务结果 results（总结/兜底文案的数据源）
 *  - token 流式开关（规划/总结阶段流式到聊天区，子任务执行/反馈阶段关闭）
 *  - 终止语义：abort 标记 + 波次循环结局（aborted/blocked/failed/waveCapped）
 *
 * 接口即状态迁移：abort() / terminate() / terminalReason() / enableTokens() …
 * Orchestrator 经 activeSession 持有当前会话，execute() 入口互斥保证同一时刻只有一个 run，
 * 并发串扰从"注释假设"变成"机制强制"。
 */
import type { AgentPort } from './agent-port.js';
import type { SubTaskResult, SubTaskPlan } from '../types.js';

/**
 * 波次执行结局：
 *  - aborted：波内子任务被用户中止（拒确/中断；与 abort 标记并列——拒确不经 orchestrator.abort()）
 *  - blocked：依赖链断裂（前置失败，后继永不就绪）
 *  - failed：波内子任务普通执行失败
 *  - waveCapped：波数触顶仍有未执行子任务
 */
export type WaveOutcome = 'aborted' | 'blocked' | 'failed' | 'waveCapped';

export class RunSession {
  /** 在途子 Agent 集合：并行子任务各自创建子 Agent，abort 时逐个中断 */
  readonly childAgents = new Set<AgentPort>();
  /** 已执行子任务结果（含失败），按执行顺序累积 */
  readonly results: SubTaskResult[] = [];
  /** 父 Agent 最近一次 submit_plan 提交的规划（已过 schema 校验）。可变 holder：回调在 await 期间写入 */
  readonly submittedPlan: { value: SubTaskPlan | null } = { value: null };
  /** 本 run 的父 Agent（规划/波次反馈/总结复用同一实例） */
  parentAgent: AgentPort | null = null;

  private abortedFlag = false;
  /** token 流式开关：true=父 Agent 文本增量流式到聊天区（原 emitTokens 局部变量） */
  private tokens = true;
  private waveOutcome: WaveOutcome | null = null;

  /** 用户是否已请求中断本 run（orchestrator.abort() 经 activeSession 置位） */
  isAborted(): boolean { return this.abortedFlag; }

  /**
   * 中断本 run：置位标记 + 中断在途子/父 Agent（abort 幂等，安全重复调用）。
   * 待确认弹窗不在此列——由 ConfirmManager.abortAll() 兜底（orchestrator.abort() 一并调用）。
   */
  abort(): void {
    this.abortedFlag = true;
    for (const agent of this.childAgents) {
      try { agent.abort(); } catch {}
    }
    this.childAgents.clear();
    if (this.parentAgent) {
      try { this.parentAgent.abort(); } catch {}
    }
  }

  /** token 流式开关：规划/总结阶段开启，子任务执行/波次反馈阶段关闭（避免执行细节刷屏聊天区） */
  tokensEnabled(): boolean { return this.tokens; }
  enableTokens(): void { this.tokens = true; }
  disableTokens(): void { this.tokens = false; }

  /** 波次循环结局标记（终止语义从"4 个布尔的优先级解读"变为命名状态迁移） */
  terminate(outcome: WaveOutcome): void { if (!this.waveOutcome) this.waveOutcome = outcome; }
  terminalOutcome(): WaveOutcome | null { return this.waveOutcome; }

  /** 任务是否未全部完成（中断/拒确/失败/阻塞/触顶任一） */
  isIncomplete(): boolean {
    return this.abortedFlag || this.waveOutcome !== null;
  }

  /** 未完成原因文案（总结 prompt 用）；全部完成返回 null */
  terminalReason(pendingCount: number): string | null {
    if (this.abortedFlag || this.waveOutcome === 'aborted') return '任务已被用户中断';
    switch (this.waveOutcome) {
      case 'failed': return '存在子任务执行失败';
      case 'blocked': return '因前置依赖未完成而终止';
      case 'waveCapped': return `执行波数已达上限，仍有 ${pendingCount} 个子任务未执行`;
      default: return null;
    }
  }

  /** run 结束释放 Agent 引用（MCP 连接由 AgentFactory.closeAll() 统一释放） */
  release(): void {
    this.childAgents.clear();
    this.parentAgent = null;
  }
}
