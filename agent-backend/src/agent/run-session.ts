/**
 * RunSession —— 一次 execute() 调用的 run 级状态唯一居所（深 module）。
 *
 * 收拢原先散落在 runExecute 大方法里的 mutable 局部变量与 Orchestrator 单例字段：
 *  - 父/子 Agent 引用（abort 寻址）
 *  - submittedPlan holder（submit_plan 工具回调在 await 期间写入，可变 holder 规避 TS 闭包窄化恒 null）
 *  - confirmedPlan 一等状态（用户确认的规划 + 编辑标记；与 holder 分离，confirmPlan 内含最终规划注入）
 *  - 已执行子任务结果 results（总结/兜底文案的数据源）
 *  - token 流式开关（规划/总结阶段流式到聊天区，子任务执行/反馈阶段关闭）
 *  - 终止语义：abort 标记 + 波次循环结局（aborted/blocked/failed/waveCapped）
 *  - 确认弹窗管理器（ConfirmManager per-run：待确认弹窗随 run 生灭，abort 连带 abortAll）
 *
 * 接口即状态迁移：abort() / terminate() / terminalReason() / enableTokens() …
 * Orchestrator 经 activeSession 持有当前会话，execute() 入口互斥保证同一时刻只有一个 run，
 * 并发串扰从"注释假设"变成"机制强制"。
 */
import type { AgentPort } from './agent-ports.js';
import type { FunctionCatalogView } from './function-catalog.js';
import { createSecurityGate } from './security-policy.js';
import { ConfirmManager } from './confirm-manager.js';
import type { ConfirmPort } from './confirm-manager.js';
import type { SubTaskResult, SubTaskPlan } from '../types.js';

/**
 * 规划提交口 —— submit_plan 工具回调在 await 期间写入的规划的唯一通道。
 * 只暴露三个动作，"复位-重提"协议从注释约定变为命名方法：
 *  - submit：submit_plan 回调写入新规划
 *  - reset：nudge/反馈前必调——只认下一次新提交，防误取历史规划
 *  - peek：读取最近提交（封装 TS 闭包窄化断言，调用方不再写 `as SubTaskPlan | null`）
 */
export interface PlanSubmission {
  submit(plan: SubTaskPlan): void;
  reset(): void;
  peek(): SubTaskPlan | null;
}

/**
 * 波次执行结局：
 *  - aborted：波内子任务被用户中止（拒确/中断；与 abort 标记并列——拒确不经 orchestrator.abort()）
 *  - blocked：依赖链断裂（前置失败，后继永不就绪）
 *  - failed：波内子任务普通执行失败
 *  - waveCapped：波数触顶仍有未执行子任务
 *  - adjustmentInvalid：波次反馈的调整规划校验（含修正）仍未通过——不沿用原计划裸奔，主动中止
 *  - securityBlocked：工具层 disable 闸命中（权限范围策略级拒绝）——不开新波、不反馈重规划，整个 run 中止
 */
export type WaveOutcome = 'aborted' | 'blocked' | 'failed' | 'waveCapped' | 'adjustmentInvalid' | 'securityBlocked';

export class RunSession {
  /**
   * 确认弹窗管理器 per-run 持有（原 Orchestrator 单例字段）：待确认弹窗是 run 级状态，
   * 与 run 同生同灭——abort() 连带 abortAll() 拒绝本 run 全部待确认弹窗，
   * 跨 run 残留（上一 run 的超时定时器/孤儿弹窗）从机制上不可能。
   * 注入缝：Orchestrator 构造函数收工厂（测试传 fake 确认器验证拒绝/超时分支）。
   */
  constructor(readonly confirmManager: ConfirmPort = new ConfirmManager()) {}

  /** 在途子 Agent 集合：并行子任务各自创建子 Agent，abort 时逐个中断 */
  readonly childAgents = new Set<AgentPort>();
  /** 已执行子任务结果（含失败），按执行顺序累积 */
  readonly results: SubTaskResult[] = [];
  /** 父 Agent 最近一次 submit_plan 提交的规划（已过 schema 校验）。经 PlanSubmission 口读写 */
  readonly submittedPlan: PlanSubmission = {
    submit: (plan) => { this.planHolder.value = plan; },
    reset: () => { this.planHolder.value = null; },
    peek: () => this.planHolder.value,
  };
  /** holder 本体私有：回调在 await 期间写入，可变 holder 规避 TS 闭包窄化恒 null */
  private planHolder: { value: SubTaskPlan | null } = { value: null };
  /** 用户已确认的规划（一等状态）：与 submittedPlan holder 分离——holder 是"父Agent 最近提交了什么"
   *  （确认循环内的过程量，reset-重提），confirmed 是"用户最终批准执行什么"（可能含确认弹窗内编辑）。
   *  确认前的多轮校验/重规划只动 holder；confirmPlan 后编排层一律以 confirmedPlan() 为准 */
  private confirmed: { plan: SubTaskPlan; modified: boolean } | null = null;
  /** 本 run 的父 Agent（规划/波次反馈/总结复用同一实例） */
  parentAgent: AgentPort | null = null;
  /** run 级安全闸（权限范围 disable 硬中断的共享信号）：全 run 所有子 Agent 的工具包装共享，
   *  任一命中置位 → 兄弟子 Agent 后续工具调用入口短路 + 波次截断（securityBlocked） */
  readonly securityGate = createSecurityGate();
  /** run 级函数目录快照（runExecute 开头建一次）：规划校验（函数名/参数）与执行展示（中文名）
   *  同源同时刻——一次 run 内函数信息一致，不随 MCP 目录中途变化而漂移 */
  catalogView: FunctionCatalogView | null = null;

  /** 规划叙事通道开关（私有）：true=父Agent文本增量走 narrative 折叠块（规划阶段）；
   *  false=走 token 正文（summaryPhase 恢复流式时关闭——同一 subscribe 贯穿全 run，不分阶段会把总结误路由进折叠块） */
  private narrative = true;

  /** 关闭规划叙事通道：summaryPhase 恢复流式前调用，总结正文不再误入折叠块 */
  closePlanningNarrative(): void { this.narrative = false; }

  /**
   * 父Agent 文本增量路由（三开关交叉的唯一判定点；orchestrator 的 subscribe 贯穿全 run，按此分流）：
   *  - 'token'：总结阶段正文流式（closePlanningNarrative 后）
   *  - 'narrative'：规划阶段折叠块
   *  - 'drop'：token 开关关闭（子任务执行/反馈阶段，防执行细节刷屏），或 submit_plan 已提交
   *    （规划提交即断流，防编造执行叙事/假总结进正文——见 memory: 父Agent编造执行叙事）
   */
  routeParentText(): 'token' | 'narrative' | 'drop' {
    if (!this.tokens) return 'drop';
    if (!this.narrative) return 'token';
    return this.planHolder.value ? 'drop' : 'narrative';
  }

  /**
   * 规划确认落点（一次 run 至多一次）：记录确认的规划与"用户是否编辑过"标记。
   * 编辑过时同步把最终规划注入父Agent 上下文（原 injectFinalPlan 内化）——用户编辑只发生在前端弹窗，
   * 父Agent 不知道；不注入它会基于过期规划生成总结/分析，脑补被删除的子任务。
   * 注入是"确认"的语义一半，不再由编排层分两处表达；空规划（用户删空后确认）不注入（L1 视同取消，无后续总结）。
   */
  confirmPlan(plan: SubTaskPlan, modified: boolean): void {
    this.confirmed = { plan, modified };
    if (modified && plan.subtasks && plan.subtasks.length > 0) {
      const planLines = plan.subtasks
        .map(st => `${st.seq}. ${st.function || st.behavior}（${st.scenario_name}/${st.ontology_name}）`)
        .join('\n');
      this.parentAgent?.state.messages.push({
        role: 'user',
        content: `用户在确认时修改了执行计划，以下为最终规划，请以此为准（被删除的子任务不再执行、总结中不要提及）：\n${planLines}`,
        timestamp: Date.now(),
      });
    }
  }

  /** 用户确认的规划（未确认/未走到确认 → null）。确认后编排层与总结阶段只读此口 */
  confirmedPlan(): SubTaskPlan | null { return this.confirmed?.plan ?? null; }
  /** 用户确认时是否编辑过规划（弹窗内改/删过子任务） */
  wasPlanModified(): boolean { return this.confirmed?.modified ?? false; }

  /** 反馈轮起点标记（父 Agent 上下文长度）：供 dropFeedbackRound 整体剔除本轮 */
  markFeedbackStart(): number { return this.parentAgent?.state.messages.length ?? 0; }
  /** 剔除本轮反馈的上下文（prompt+回复）：无调整的反馈轮是上下文垃圾，防 N 轮"继续原计划"撑爆父Agent 上下文 */
  dropFeedbackRound(mark: number): void {
    if (this.parentAgent) {
      this.parentAgent.state.messages = this.parentAgent.state.messages.slice(0, mark);
    }
  }

  private abortedFlag = false;
  /** token 流式开关：true=父 Agent 文本增量流式到聊天区（原 emitTokens 局部变量） */
  private tokens = true;
  private waveOutcome: WaveOutcome | null = null;

  /** 用户是否已请求中断本 run（orchestrator.abort() 经 activeSession 置位） */
  isAborted(): boolean { return this.abortedFlag; }

  /**
   * 中断本 run：置位标记 + 中断在途子/父 Agent + 拒绝所有待确认弹窗（abort 幂等，安全重复调用）。
   * 确认弹窗随 session 持有，abort 语义在此完整收拢（不再由 orchestrator 补一刀）。
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
    this.confirmManager.abortAll();
  }

  /** token 流式开关：规划/总结阶段开启，子任务执行/波次反馈阶段关闭（避免执行细节刷屏聊天区） */
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
      case 'adjustmentInvalid': return '波次反馈的调整规划校验未通过，为避免后续子任务缺失中继数据继续执行，已主动中止';
      case 'securityBlocked': return this.securityGate.violation ?? '行为已被安全管控禁用（权限范围 disable），任务已中止';
      default: return null;
    }
  }

  /** run 结束释放 Agent 引用（MCP 连接由 AgentFactory.closeAll() 统一释放） */
  release(): void {
    this.childAgents.clear();
    this.parentAgent = null;
  }
}
