/**
 * Orchestrator —— 编排父/子 Agent 的完整执行循环。
 *
 * 流程:
 *  ① 父Agent 规划 → submit_plan 提交子任务列表（PlanningPhase）
 *  ② 按依赖拓扑分波 → 波内无确认子任务并行、需确认子任务串行（WavePhase）
 *  ③ 每个子任务: OntologyGateway → 组装指令 → 子Agent 执行
 *  ④ 安全管控弹窗 → 用户确认（波内串行，避免单弹窗冲突）
 *  ⑤ 工具调用失败重试 3 次（复用实例自纠）
 *  ⑥ 每波结果一次反馈父Agent → 继续/调整/提前终止
 *  ⑦ 无论成功/失败/中断，父Agent 统一生成最终总结（SummaryPhase）
 *
 * run 级状态（父/子 Agent 引用、submittedPlan、results、abort 标记、波次结局、token 开关）
 * 全部收拢在 RunSession 深 module；Orchestrator 单例只持有 activeSession 指针，
 * execute() 入口互斥保证同一时刻只有一个 run（并发串扰从"注释假设"变为"机制强制"）。
 */

import type { AgentFactoryPort, OntologyGatewayPort } from './agent-ports.js';
import { getLastAssistantMessage } from '../utils/text-utils.js';
import { validatePlanStructure, validateSeqConflicts, topologicalSort } from './plan-validation.js';
import { buildRelayStructureHint, emitWaveFailures, enrichPlanDisplay } from './plan-presentation.js';
import { ConfirmManager } from './confirm-manager.js';
import type { ConfirmPort } from './confirm-manager.js';
import { SubtaskRunner, isChildAborted } from './subtask-runner.js';
import { PlanGate } from './plan-gate.js';
import type { PlanRepairCtx } from './plan-gate.js';
import { WaveExecutor } from './wave-executor.js';
import { RunSession } from './run-session.js';
import { FunctionCatalog } from './function-catalog.js';
import type { FunctionCatalogView } from './function-catalog.js';
import { createEventChannel } from './event-channel.js';
import type { EventChannel } from './event-channel.js';
import type { AgentPort } from './agent-ports.js';
import { runPlanningPhase } from './planning-phase.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, SubTask, SSEEvent, ConversationScope,
} from '../types.js';

// 规划阶段已抽至 planning-phase.ts（宪法 II 单文件 ≤500 行）；此处 re-export 保持既有
// import 路径（orchestrator.test.ts 等）不破——规划确认策略与阶段产物同属该阶段的概念。
export { planNeedsConfirm, MAX_PLAN_ROUNDS } from './planning-phase.js';
export type { PlanningOutcome } from './planning-phase.js';

const MAX_ROUNDS = 50; // 波次执行的最大轮数（依赖成环等异常结构下的兜底，防无限循环）
const PARENT_PROMPT_TIMEOUT = 180_000; // 父Agent 单次 LLM 调用超时（规划/反馈/总结），防 API 挂起拖死整个 run

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  /** 确认弹窗属 run 级状态（RunSession 持有）；构造注入的是工厂——每个 run 一份新确认器 */
  private readonly createConfirmManager: () => ConfirmPort;
  /** 当前活动 run 的会话（execute 入口互斥，同一时刻只有一个） */
  private activeSession: RunSession | null = null;
  /** 函数目录（三源合一）：规划校验的函数名/参数声明单一事实源 */
  private functionCatalog: FunctionCatalog;
  /** 规划闸门：初始/调整规划的完整校验链 + 修复循环（深 module，脱离 execute() 全路径可测） */
  private planGate: PlanGate;
  /** 波次执行：一波就绪子任务的三分类调度 + 限流 + 安全闸截断 */
  private waveExecutor: WaveExecutor;

  constructor(
    private agentFactory: AgentFactoryPort,
    private ontologyGateway: OntologyGatewayPort,
    createConfirmManager?: () => ConfirmPort, // 注入缝：测试可传 fake 确认器工厂验证拒绝/超时分支
    private parentPromptTimeoutMs = PARENT_PROMPT_TIMEOUT, // 注入缝：测试可缩短超时验证挂起兜底（默认 180s 不变）
  ) {
    this.createConfirmManager = createConfirmManager ?? (() => new ConfirmManager());
    this.functionCatalog = new FunctionCatalog(ontologyGateway, () => agentFactory.getMountableToolCatalog());
    this.planGate = new PlanGate({ gateway: ontologyGateway, promptParent: (agent, text) => this.parentPrompt(agent, text) });
    this.waveExecutor = new WaveExecutor({ gateway: ontologyGateway });
  }

  /**
   * 路由回调：用户答复安全管控弹窗 → 转发当前活动 run 的确认器。
   * 返回是否命中：无活动 run 或 confirmId 已失效（超时/中断/已答复）时为 false，
   * 路由层据此回 404 —— 不能让"没生效"伪装成"已确认"（2026-10-05 C3）。
   */
  handleConfirm(confirmId: string, approved: boolean): boolean {
    return this.activeSession?.confirmManager.handleConfirm(confirmId, approved) ?? false;
  }
  /** 路由回调：用户答复规划确认弹窗（同上语义） */
  handlePlanConfirm(confirmId: string, approved: boolean, plan?: SubTaskPlan, opts?: { rejectAction?: 'exit' | 'replan'; suggestion?: string }): boolean {
    return this.activeSession?.confirmManager.handlePlanConfirm(confirmId, approved, plan, opts) ?? false;
  }

  /** 测试/内部观测用：当前是否有 run 在执行 */
  hasActiveRun(): boolean { return this.activeSession !== null; }

  /**
   * 中断当前 run，**带归属校验**（2026-10-05，agent 环节审查 M8）。
   *
   * 此前 `/abort` 无任何寻址，直接 `abort()` 当前活动 run——多标签页/多用户场景下
   * A 会话的中断请求会打断 B 会话正在跑的任务（全局可变状态暴露为 HTTP 语义）。
   * 现要求调用方带上自己的 threadId，与当前 run 不一致即拒绝。
   *
   * 返回是否真的中断 + 未中断的原因，由路由映射为合适的 HTTP 码：
   * - `no_active_run`：当前没有执行中的任务（如已完成或已中断）
   * - `thread_mismatch`：该任务属于其他会话，不允许跨会话中断
   */
  abortRun(threadId?: string): { aborted: boolean; reason?: 'no_active_run' | 'thread_mismatch' } {
    const s = this.activeSession;
    if (!s) return { aborted: false, reason: 'no_active_run' };
    // 双方都带了 threadId 才比对（未提供时保持原行为，兼容旧调用方）
    if (threadId !== undefined && s.threadId !== undefined && s.threadId !== threadId) {
      return { aborted: false, reason: 'thread_mismatch' };
    }
    s.abort();
    return { aborted: true };
  }

  /** 当前活动 run 所属的线程 id（无活动 run 时为 undefined；供诊断/测试用） */
  activeThreadId(): string | undefined { return this.activeSession?.threadId; }

  /** 每个 run 独立的子任务执行器（childAgents 集合随 session 走，abort 寻址不串 run） */
  private createSubtaskRunner(session: RunSession): SubtaskRunner {
    // 未登记告警的去重集合（run 级）：同一行为在一次 run 内只提示一次，避免并行子任务刷屏
    const warnedUnregistered = new Set<string>();
    return new SubtaskRunner({
      confirmManager: session.confirmManager,
      createChildAgent: (ctx, policy) => this.agentFactory.createChildAgent(ctx, policy),
      childAgents: session.childAgents,
      // 子任务元数据查询口：策略派生（禁用集合）与工具调用展示（中文名）的全部投影，一次性接线
      info: {
        behaviorTitle: (scenario, ontology, behaviorName) =>
          this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).title || '',
        functionTitle: (scenario, ontology, functionName) =>
          session.catalogView?.functionInfo(scenario, ontology, functionName)?.title ?? '',
        // 工具层 disable 闸数据源：securities 登记的 scope（恒数组）；无登记（旧本体回退）视为 everyone 放行。
        // 【可观测化 2026-10-05】无登记即"该行为的 disable 权限设置不生效"——属兜底放行而非显式配置，
        // 一旦有人误以为已禁用（登记 action_name 拼错 / 漏登记）会静默失效，故每次 run 提示一次。
        // 注意与 BehaviorMeta.unavailable 区分：这里是**元数据可用但未登记**（数据缺失，走默认放行）；
        // unavailable 是**元数据读不到**（系统故障，已在 SubtaskRunner 就地拒绝执行）。
        behaviorScope: (scenario, ontology, behaviorName) => {
          const meta = this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName);
          if (!meta.unavailable && !meta.security) {
            const key = `${scenario}/${ontology}/${behaviorName}`;
            if (!warnedUnregistered.has(key)) {
              warnedUnregistered.add(key);
              console.warn(`[security] 行为 ${behaviorName}（${key}）在 securities 中无登记，其「权限范围」设置不生效（按 everyone 放行）。若本意是禁用该行为，请在「安全」页签登记并将权限范围设为 disable`);
            }
            return ['everyone'];
          }
          return meta.security?.scope ?? ['everyone'];
        },
      },
      // run 级共享安全闸：工具层 disable 命中置位 → 本 run 所有子任务停摆（securityBlocked）
      securityGate: session.securityGate,
      // 函数子任务确定性直连（不经子 Agent LLM）：统一入口 runner.run 的函数路径
      callFunctionTool: (f, oid, p) => this.agentFactory.callFunctionTool(f, oid, p),
    });
  }

  /**
   * 带超时的父Agent prompt（守卫改进点2）。
   * 超时即中断父Agent（abort 幂等）并抛错，由 runExecute 的统一 catch 兜底，
   * 避免：① LLM API 挂起时整个 run 无限等待；② 裸异常穿透 runExecute 丢失"残留副作用点破"。
   */
  private async parentPrompt(agent: AgentPort, text: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        agent.prompt(text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // 中断失败必须留痕：父 Agent 挂起时 abort 失败意味着请求可能仍在占用 LLM 配额，
            // 空 catch 会让"超时了但请求没停"这件事完全不可见（宪法 IX 故障可观测）
            try { agent.abort(); } catch (e) { console.warn('[orchestrator] 父Agent 超时后 interrupt 失败（请求可能仍在进行）:', e); }
            reject(new Error('父Agent 响应超时'));
          }, this.parentPromptTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 中断当前执行：置位 run 级 abort 标记 + 中断在途的子/父 Agent + 拒绝所有待确认弹窗（session.abort 一步收拢）。
   * 覆盖：子任务执行、安全管控弹窗、规划确认弹窗、父Agent 规划/反馈阶段。
   */
  abort(): void {
    this.activeSession?.abort();
  }

  async execute(
    message: string,
    scope: ConversationScope,
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
    /** 本 run 所属线程 id（供 /abort 归属校验，见 RunSession.threadId） */
    threadId?: string,
  ): Promise<string> {
    // 单 run 互斥：此前并发 execute 会互相覆盖单例字段（abort 误杀两个 run），入口直接拒绝
    if (this.activeSession) {
      const msg = '⚠️ 已有任务正在执行中，请等待其完成或先中断后再发起。';
      sendEvent({ type: 'error', message: msg });
      sendEvent({ type: 'done' });
      return msg;
    }
    const session = new RunSession(this.createConfirmManager());
    session.threadId = threadId;
    this.activeSession = session;
    try {
      return await this.runExecute(session, message, scope, history, sendEvent);
    } finally {
      // 编排结束（无论成功/失败/中断）释放 run 引用与 MCP 连接，避免跨子任务累积泄漏
      this.activeSession = null;
      session.release();
      await this.agentFactory.closeAll();
    }
  }

  /**
   * 主循环编排：规划 → 分波执行 → 总结。三个阶段各自为独立方法，
   * run 级状态经 RunSession 流转；全流程异常由 catch 兜底（点破残留副作用后正常收尾）。
   */
  private async runExecute(
    session: RunSession,
    message: string,
    scope: ConversationScope,
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    const emit = createEventChannel(sendEvent);
    // run 级函数目录快照：规划校验与执行展示同源同时刻（建快照是一次 async MCP 目录读取，
    // 之后全 run 同步复用，不再每次校验各自 view()）
    session.catalogView = await this.functionCatalog.view();
    // 本体范围允许集（硬闸锚点）：通用模式为空集——父 Agent 未挂 submit_plan，永远不会有规划进入校验链
    const allowedOntologyIds = new Set(scope.contexts.map(c => c.ontology_id));
    try {
      // 阶段1 已抽至 planning-phase.ts（该阶段 6 条终结路径的判定与事件序列都在那里）
      const planned = await runPlanningPhase(
        {
          agentFactory: this.agentFactory,
          planGate: this.planGate,
          parentPrompt: (agent, text) => this.parentPrompt(agent, text),
          enrichPlanDisplay: (plan, catalog) => this.enrichPlanDisplay(plan, catalog),
        },
        { session, message, scope, allowedOntologyIds, history, emit },
      );
      if ('reply' in planned) return planned.reply;
      const pending = await this.wavePhase(session, planned.plan, allowedOntologyIds, emit);
      return await this.summaryPhase(session, pending, emit);
    } catch (e: any) {
      // 守卫兜底：父Agent 处理异常（LLM 错误 / 超时 / 不可用）。
      // 不复用父Agent 生成总结，用罐头文案点破残留副作用后正常收尾：
      // 返回字符串 → SSE 路由会把本轮对话写回 thread 历史（此前异常路径会丢历史）。
      console.error(`[orchestrator] 执行异常: ${e?.stack || e}`);
      const results = session.results;
      const executedList = results.length > 0
        ? results.map(r => `- 子任务 ${r.seq}（${r.task}）: ${r.success ? '成功' : `失败 - ${r.error || '未知原因'}`}`).join('\n')
        : '（无子任务执行完成）';
      const successCount = results.filter(r => r.success).length;
      const residualNote = successCount > 0
        ? `\n注意：已成功的 ${successCount} 个子任务产生的写入（如有）仍然生效、不会被自动回滚，请手动核查。`
        : '';
      const msg = `⚠️ 执行中断：处理异常（${e?.message || '未知错误'}）。\n已执行的子任务：\n${executedList}${residualNote}`;
      sendEvent({ type: 'error', message: msg });
      sendEvent({ type: 'done' });
      return msg;
    }
  }

  // ─── 阶段2：分波执行（WavePhase） ─────────────

  /**
   * 按依赖拓扑分波并行执行子任务，每波完成后按需反馈父Agent（数据中继/调整/提前终止）。
   * 结局经 session.terminate() 标记（aborted/blocked/failed/waveCapped），返回剩余待执行列表（总结阶段用）。
   */
  private async wavePhase(
    session: RunSession,
    plan: SubTaskPlan,
    allowedOntologyIds: ReadonlySet<number>,
    emit: EventChannel,
  ): Promise<SubTask[]> {
    session.disableTokens(); // 子任务执行和反馈不流到聊天区，避免重复
    const runner = this.createSubtaskRunner(session);
    const planCtx: PlanRepairCtx = { parentAgent: session.parentAgent!, submittedPlan: session.submittedPlan, emit, catalog: session.catalogView!, allowedOntologyIds };
    let pending = topologicalSort(plan.subtasks);

    for (let wave = 0; wave < MAX_ROUNDS; wave++) {
      if (session.isAborted()) break;
      if (pending.length === 0) break;

      // 本波可并行子任务 = 依赖已全部成功执行（或无依赖）的就绪集
      const ready: SubTask[] = [];
      for (const st of pending) {
        const depFailed = (st.depends_on || []).some(dep => !session.results.find(r => r.seq === dep && r.success));
        if (depFailed) continue; // 依赖已失败，其后继永不满足
        ready.push(st);
      }
      // 无可执行子任务（其余全部依赖已失败）→ 依赖链断裂，终止
      if (ready.length === 0) { session.terminate('blocked'); break; }

      // 执行本波：无确认子任务并行（MAX_PARALLEL 限流分块），需确认子任务逐个串行（前端单弹窗）
      const waveResults = await this.waveExecutor.runBatch(ready, emit, runner, session.securityGate);
      session.results.push(...waveResults);

      // 已执行子任务移出待执行列表
      const executedSeqs = new Set(waveResults.map(r => r.seq));
      pending = pending.filter(st => !executedSeqs.has(st.seq));

      // 工具层 disable 闸命中（run 级共享 gate 置位）→ 安全管控中断：
      // 不开新波、不反馈重规划，整个 run 以 securityBlocked 收尾（先于普通失败分支判定）。
      if (session.securityGate.violation) {
        emitWaveFailures(waveResults, emit);
        session.terminate('securityBlocked');
        break;
      }

      // 波内任一子任务失败/被中断 → 终止（同波其余子任务已随 Promise.all 完成，结果保留）
      if (session.isAborted()) break;
      const waveFailed = waveResults.find(r => !r.success);
      if (waveFailed) {
        emitWaveFailures(waveResults, emit);
        // 波内任一中止（拒确/中断）→ 用户中止；否则为普通执行失败。二者必须分开记，
        // 否则普通失败会被下方 waveCapped 判定误报成"波数触顶"。
        session.terminate(waveResults.some(r => !r.success && r.aborted) ? 'aborted' : 'failed');
        break;
      }

      // 每波完成后是否反馈父Agent（数据传播/调整/提前终止以波为单位）：
      // - 本波已是最后一批（pending 空）→ 不反馈（无后续子任务可中继/调整，现状即如此）
      // - 中间波：仅当存在后续子任务 depends_on 本波结果（需数据中继/调整）才反馈父Agent；
      //   无跨波依赖（且能走到这里 = 本波全部成功）→ 直接进入下一波，省一次父Agent LLM 调用。
      if (pending.length > 0) {
        const waveNeedsRelay = pending.some(st => (st.depends_on || []).some(dep => executedSeqs.has(dep)));
        if (!waveNeedsRelay) {
          emit.entry({ type: 'subtask_done', name: '本波无数据依赖', status: 'done', detail: `子任务 ${waveResults.map(r => r.seq).join('、')} 全部成功，直接进入下一波`, source: 'parent' });
        } else {
          const adjusted = await this.runWaveFeedback(session, waveResults, session.results, planCtx, pending);
          if (session.isIncomplete()) break; // 反馈期间被中断 / 调整规划校验失败被主动中止 → 终止执行
          if (adjusted) pending = adjusted;
        }
      }
    }

    // 波数上限触顶：循环自然退出但仍有未执行子任务 → 视同未完成（改进点1），
    // 杜绝"报全部成功却静默吞掉末尾子任务"。
    if (pending.length > 0 && !session.isIncomplete()) {
      session.terminate('waveCapped');
    }
    return pending;
  }

  // ─── 阶段3：总结（SummaryPhase） ─────────────

  /** 无论成功/失败/中断，父Agent 统一生成最终总结（含残留副作用点破），发 done 终结事件。 */
  private async summaryPhase(
    session: RunSession,
    pending: SubTask[],
    emit: EventChannel,
  ): Promise<string> {
    const results = session.results;
    let finalSummary = '执行完成';
    if (results.length > 0 || session.isIncomplete()) {
      const parentAgent = session.parentAgent!;
      const allSuccess = results.length > 0 && results.every(r => r.success);
      if (isChildAborted(parentAgent)) {
        // 父Agent 在反馈/调整阶段被打断，不能再复用其生成总结 → 罐头文案，无流式，显式发送
        finalSummary = '任务已被用户中断。';
        emit.raw({ type: 'token', token: `\n\n${finalSummary}` });
      } else {
        // 恢复流式：让父Agent 生成的最终总结逐字输出（token 流式在执行阶段被关闭）。
        // 同时关闭规划叙事通道——同一 subscribe 贯穿全 run，不关会把总结误路由进折叠块
        session.closePlanningNarrative();
        session.enableTokens();
        // 最终总结也是一次父Agent LLM 调用，发进行中信号点亮前端"处理中"转圈，
        // 消除"子任务全完成 → 总结首字流式"之间的静默空窗（镜像 runWaveFeedback 的 feedback 事件）。
        emit.raw({ type: 'feedback', status: 'running' });
        const reason = session.terminalReason(pending.length);
        if (allSuccess && reason === null) {
          // 带上全量结果：末子任务跳过了中间分析，总结必须自包含
          const resultsText = results.map(r => `- 子任务 ${r.seq}（${r.task}）: ${r.summary}`).join('\n');
          await this.parentPrompt(parentAgent,`所有子任务已执行完毕。\n各子任务结果：\n${resultsText}\n\n请给用户一个简洁、完整的最终总结（包括执行结果、关键数据和后续建议）。`);
          finalSummary = getLastAssistantMessage(parentAgent.state.messages) || '执行完成';
        } else {
          const outcomeSummary = results.length > 0
            ? results.map(r =>
                `- 子任务 ${r.seq}（${r.task}）: ${r.success ? '成功' : `失败 - ${r.error || '未知原因'}`}`,
              ).join('\n')
            : '（无子任务成功执行）';
          await this.parentPrompt(parentAgent,`任务未全部完成（${reason}）。\n已执行的子任务结果：\n${outcomeSummary}\n\n请给用户一个简洁的最终说明，并严格遵守以下要求：\n1. 总结已完成的操作与结果，说明终止/失败的原因\n2. 【残留副作用必须点破】若之前的子任务已产生持久化写入（如创建/更新/删除了采购单、库存等实体），必须明确列出这些【已生效】的写操作及其实体ID/编号，并说明任务终止后它们【仍然存在、不会被自动回滚】\n3. 针对上述残留状态，给出具体的后续处理建议（例如：重新发起剩余操作 / 取消或冲销已创建的记录 / 检查状态是否正常）\n4. 给出后续建议`);
          finalSummary = getLastAssistantMessage(parentAgent.state.messages) || '执行未完成';
        }
        emit.raw({ type: 'feedback', status: 'done' });
      }
    } else {
      // 无子任务执行（罕见）：直接显式发送默认文案
      emit.raw({ type: 'token', token: `\n\n${finalSummary}` });
    }
    // 最终总结同时写入执行记录：单波任务（最后一波不跑 runWaveFeedback）执行记录里也能看到父Agent总结
    emit.entry({ type: 'subtask_done', name: '父Agent执行总结', status: 'done', result: finalSummary, source: 'parent' });
    emit.raw({ type: 'done' });
    return finalSummary;
  }

  // ─── 波次反馈 ──────────────────────

  /**
   * 每波完成后的父Agent 反馈：喂整波结果，做数据传播/规划调整/提前终止。
   * 返回调整后的待执行列表；null = 未产生调整，沿用当前 pending。
   */
  private async runWaveFeedback(
    session: RunSession,
    waveResults: SubTaskResult[],
    allResults: SubTaskResult[],
    ctx: PlanRepairCtx,
    pending: SubTask[],
  ): Promise<SubTask[] | null> {
    // 反馈父Agent 深入分析整波结果并决定后续计划（此 LLM 调用耗时秒级，先发分析中提示，避免用户以为已结束）
    ctx.emit.raw({ type: 'feedback', status: 'running' });
    ctx.submittedPlan.reset(); // 只识别本次分析中新提交的调整规划，避免误取历史规划
    const feedbackStart = session.markFeedbackStart(); // 方案B：记录反馈轮起点，无调整则整体剔除
    const waveList = waveResults.map(r => `- 子任务 ${r.seq}（${r.task}）: ${r.summary}`).join('\n');
    const structureHint = this.buildRelayStructureHint(waveResults, pending, session.catalogView!);
    await this.parentPrompt(ctx.parentAgent,`本波次已执行完毕，共 ${waveResults.length} 个子任务。

【执行结果】
${waveList}

请分析：
1. 各结果是否符合预期？有无异常或风险？
2. 后续未开始的子任务是否需要本次结果中的数据（如查询结果和计算结果）？
3. 【提前终止判断】后续未开始的子任务是否仍有必要执行？若某些或全部子任务已失去意义（例如订单已显示取消，则无需再入库/查询后续步骤），请调用 submit_plan 提交【剔除这些子任务】的调整规划；若要结束整个流程，可提交空 subtasks 的规划，让流程提前结束，避免执行无意义的操作。

数据传播（必须）
1. 若后续子任务的 params 或 guidance 依赖本次产生的新数据（如A生成订单号，B需使用），即使本次执行完全正常，也必须调用 submit_plan 提交调整后的规划，将数据填入对应字段。
2. 部分后续依赖对的子任务无法自行查询这些数据，只能由你中继传递，请高度重视！
3. 填入值时严格保持参数声明的类型，例如：integer → 填数字，不填字符串；array → 填数组
4. 调整规划只需列出未执行的子任务；已完成的子任务不必重复列出（即使列出也会被系统自动忽略）。
5. 仅当所有后续子任务均不依赖本次结果、且无需调整时，才可直接说明"继续执行原计划"，无需调用 submit_plan。${structureHint}`);
    ctx.emit.raw({ type: 'feedback', status: 'done' });
    if (session.isAborted()) return null; // 反馈期间被中断 → 外层终止执行

    // 提取父Agent的分析结果推送到前端执行记录
    const analysisText = getLastAssistantMessage(ctx.parentAgent.state.messages);
    const adjusted = ctx.submittedPlan.peek();
    let analysisDetail = `本波次子任务 ${waveResults.map(r => r.seq).join('、')} 分析完成`;

    let nextPending: SubTask[] | null = null;
    if (adjusted && Array.isArray(adjusted.subtasks)) {
      // L3: 执行中调整规划 → 与初始规划同等的校验链（seq冲突/行为名/函数名/参数/依赖），静默修正，不再弹窗用户确认。
      // 父 Agent 提交空规划或"只含已执行子任务"的规划 = 提前终止后续流程（nextPending 会被置空）。
      // 已执行上下文提前算出：dep 指向已执行子任务合法（调整规划常只含剩余子任务）；
      // seq 防冒名依据：已执行 seq → 任务名（seq 相同但任务名不同 = 新任务冒名，会被下方 filter 静默吞掉）。
      const executedSeqs = new Set(allResults.map(r => r.seq));
      const validated = await this.planGate.validateAdjustment(adjusted, ctx, {
        seqs: executedSeqs,
        tasks: new Map(allResults.map(r => [r.seq, r.task] as const)),
      });
      if (validated) {
        // 调整后的规划是权威全集：剔除已执行，重新拓扑排序；为空则提前终止。
        nextPending = topologicalSort(validated.subtasks.filter(st => !executedSeqs.has(st.seq)));
        analysisDetail = nextPending.length === 0
          ? `本波次已提前终止后续流程`
          : `本波次已调整后续计划`;
      } else {
        // 校验（含 nudge 修正）仍未通过 → 不沿用原计划让下游带空参数裸奔：主动中止，总结阶段点破残留副作用
        session.terminate('adjustmentInvalid');
        analysisDetail = `本波次调整规划校验失败，流程已中止（避免后续子任务缺失中继数据继续执行）`;
      }
    }

    // 方案B：本轮反馈未产生调整 → prompt + 回复 是上下文垃圾，整体剔除，
    // 避免父Agent 上下文被 N 个"继续执行原计划"撑爆。有调整则保留（分析有价值）。
    if (!adjusted || !adjusted.subtasks || adjusted.subtasks.length === 0) {
      session.dropFeedbackRound(feedbackStart);
    }
    ctx.emit.entry({ type: 'subtask_done', name: '子任务结果分析', status: 'done', detail: analysisDetail, result: analysisText, source: 'parent' });
    return nextPending;
  }

  /**
   * 中继结构参考（委托 plan-presentation：纯渲染，取权威参数声明）
   */
  private buildRelayStructureHint(waveResults: SubTaskResult[], pending: SubTask[], catalog: FunctionCatalogView): string {
    return buildRelayStructureHint(this.ontologyGateway, catalog, waveResults, pending);
  }

  /**
   * 给规划补展示字段（委托 plan-presentation）
   */
  private enrichPlanDisplay(plan: SubTaskPlan, catalog: FunctionCatalogView): SubTaskPlan {
    return enrichPlanDisplay(this.ontologyGateway, catalog, plan);
  }

}