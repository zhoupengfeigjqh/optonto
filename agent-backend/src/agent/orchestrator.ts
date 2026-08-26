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
import { validateBehaviorNames, validateFunctionNames, validateAllParams, validateAllConstraints, validatePlanStructure, validateSeqConflicts, topologicalSort } from './plan-validation.js';
import type { InvalidTaskName } from './plan-validation.js';
import { isParamValueEmpty, renderParamStructure, unwrapParamValues, validateParamStructure, type ParamSpec } from './param-contract.js';
import { ConfirmManager } from './confirm-manager.js';
import type { ConfirmPort } from './confirm-manager.js';
import { SubtaskRunner, isChildAborted } from './subtask-runner.js';
import { RunSession } from './run-session.js';
import { FunctionCatalog } from './function-catalog.js';
import type { FunctionCatalogView } from './function-catalog.js';
import { createEventChannel, entryDisplay } from './event-channel.js';
import type { EventChannel } from './event-channel.js';
import type { AgentPort } from './agent-port.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, BehaviorMeta, SubTask, SSEEvent, SkillContext, SkillSelection,
} from '../types.js';

const MAX_ROUNDS = 50;
const MAX_PLAN_ROUNDS = 3; // 规划确认"拒绝并重规划"的最大轮数，防止无限循环
const MAX_PARALLEL = 5; // 波内并行子任务上限：避免就绪任务过多时并发打爆 LLM/MCP
const PARENT_PROMPT_TIMEOUT = 180_000; // 父Agent 单次 LLM 调用超时（规划/反馈/总结），防 API 挂起拖死整个 run

/**
 * 规划是否需要确认弹窗：仅多步任务需要。
 * 单步任务跳过规划确认——只读无副作用直接执行；写操作由子任务的安全管控弹窗兜底
 * （避免"规划确认 + 安全确认"双弹窗，单步没有"整体执行路径"可供用户审阅）。
 */
export function planNeedsConfirm(plan: SubTaskPlan): boolean {
  return plan.subtasks.length > 1;
}

/** 规划修复上下文：nudge 父Agent 所需三件套 + run 级函数目录快照打包，替代 4-5 参穿透 */
interface PlanRepairCtx {
  parentAgent: AgentPort;
  submittedPlan: { value: SubTaskPlan | null };
  emit: EventChannel;
  catalog: FunctionCatalogView;
}

/** 规划阶段产物：拿到确认后的最终规划，或直接终结本轮的回复文案 */
type PlanningOutcome = { plan: SubTaskPlan } | { reply: string };

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  private confirmManager: ConfirmPort;
  /** 当前活动 run 的会话（execute 入口互斥，同一时刻只有一个） */
  private activeSession: RunSession | null = null;
  /** 函数目录（三源合一）：规划校验的函数名/参数声明单一事实源 */
  private functionCatalog: FunctionCatalog;

  constructor(
    private agentFactory: AgentFactoryPort,
    private ontologyGateway: OntologyGatewayPort,
    confirmManager?: ConfirmPort, // 注入缝：测试可传 fake 确认器验证拒绝/超时分支
    private parentPromptTimeoutMs = PARENT_PROMPT_TIMEOUT, // 注入缝：测试可缩短超时验证挂起兜底（默认 180s 不变）
  ) {
    this.confirmManager = confirmManager ?? new ConfirmManager();
    this.functionCatalog = new FunctionCatalog(ontologyGateway, () => agentFactory.getMountableToolCatalog());
  }

  getConfirmManager(): ConfirmPort { return this.confirmManager; }

  /** 测试/内部观测用：当前是否有 run 在执行 */
  hasActiveRun(): boolean { return this.activeSession !== null; }

  /** 每个 run 独立的子任务执行器（childAgents 集合随 session 走，abort 寻址不串 run） */
  private createSubtaskRunner(session: RunSession): SubtaskRunner {
    return new SubtaskRunner({
      confirmManager: this.confirmManager,
      createChildAgent: (ctx, rpMap, budget, legalCalls) => this.agentFactory.createChildAgent(ctx, rpMap, budget, legalCalls),
      childAgents: session.childAgents,
      getBehaviorDisplayName: (scenario, ontology, behaviorName) =>
        this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).display_name || '',
      getFunctionDisplayName: (scenario, ontology, functionName) =>
        session.catalogView?.functionInfo(scenario, ontology, functionName)?.displayName ?? '',
      getBehaviorParams: (scenario, ontology, behaviorName) =>
        this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).params || {},
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
            try { agent.abort(); } catch {}
            reject(new Error('父Agent 响应超时'));
          }, this.parentPromptTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 中断当前执行：置位 run 级 abort 标记 + 中断在途的子/父 Agent + 拒绝所有待确认弹窗。
   * 覆盖：子任务执行、安全管控弹窗、规划确认弹窗、父Agent 规划/反馈阶段。
   */
  abort(): void {
    this.activeSession?.abort();
    this.confirmManager.abortAll();
  }

  async execute(
    message: string,
    skills: SkillSelection[],
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    // 单 run 互斥：此前并发 execute 会互相覆盖单例字段（abort 误杀两个 run），入口直接拒绝
    if (this.activeSession) {
      const msg = '⚠️ 已有任务正在执行中，请等待其完成或先中断后再发起。';
      sendEvent({ type: 'error', message: msg });
      sendEvent({ type: 'done' });
      return msg;
    }
    const session = new RunSession();
    this.activeSession = session;
    try {
      return await this.runExecute(session, message, skills, history, sendEvent);
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
    skills: SkillSelection[],
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    const emit = createEventChannel(sendEvent);
    // run 级函数目录快照：规划校验与执行展示同源同时刻（建快照是一次 async MCP 目录读取，
    // 之后全 run 同步复用，不再每次校验各自 view()）
    session.catalogView = await this.functionCatalog.view();
    try {
      const planned = await this.planningPhase(session, message, skills, history, emit);
      if ('reply' in planned) return planned.reply;
      const pending = await this.wavePhase(session, planned.plan, emit);
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

  // ─── 阶段1：规划（PlanningPhase） ─────────────

  /**
   * 父Agent 规划 → 校验（行为名/参数结构，各带 1 次静默修正）→ 规划确认弹窗（支持拒绝并重规划）
   * → 依赖结构校验 → 输出最终规划。返回 { plan } 进入执行阶段，或 { reply } 直接终结本轮。
   */
  private async planningPhase(
    session: RunSession,
    message: string,
    skills: SkillSelection[],
    history: ThreadMessage[],
    emit: EventChannel,
  ): Promise<PlanningOutcome> {
    const loadedSkillNames: string[] = [];
    const parentAgent = await this.agentFactory.createParentAgent(
      skills, history,
      (name: string) => {
        if (!loadedSkillNames.includes(name)) loadedSkillNames.push(name);
        emit.raw({ type: 'token', token: `\n📖 已加载技能：${name}\n` });
      },
      (plan) => { session.submittedPlan.value = plan; },
    );
    session.parentAgent = parentAgent;
    parentAgent.subscribe((event: any) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta' && session.tokensEnabled()) {
        // 此 subscribe 贯穿整个 run（规划/反馈/总结共用同一父Agent），按阶段分流：
        // 规划阶段 → narrative 折叠块（submit_plan 提交后即断流，防编造执行叙事/假总结进正文）；
        // 总结阶段（summaryPhase 已置 planningNarrative=false）→ token 正文。反馈阶段 tokens 关闭，不到这里。
        if (!session.planningNarrative) {
          emit.raw({ type: 'token', token: event.assistantMessageEvent.delta });
          return;
        }
        if (session.submittedPlan.value) return;
        emit.raw({ type: 'narrative', token: event.assistantMessageEvent.delta });
      }
    });
    // 规划修复上下文：nudge 父Agent/波次反馈共用的三件套
    const planCtx: PlanRepairCtx = { parentAgent, submittedPlan: session.submittedPlan, emit, catalog: session.catalogView! };

    // 单轮 prompt：判断是否需要加载技能，然后直接回答或通过 submit_plan 提交规划
    await this.parentPrompt(parentAgent,`${message}`);
    // 规划阶段被中断 → 干净退出（父Agent 已中断，无规划可言）
    if (session.isAborted() || isChildAborted(parentAgent)) {
      emit.raw({ type: 'narrative_end', outcome: 'aborted' });
      emit.raw({ type: 'token', token: '\n⏹ 已中断\n' });
      emit.raw({ type: 'done' });
      return { reply: '已中断' };
    }
    // 规划只来自 submit_plan 工具（schema 校验），不再用正则从文本抓取，避免误判
    let plan = session.submittedPlan.value;
    if (plan && (!plan.subtasks || plan.subtasks.length === 0)) {
      plan = null;
    }

    if (!plan || !plan.subtasks || plan.subtasks.length === 0) {
      const lastMsg = getLastAssistantMessage(parentAgent.state.messages);
      if (lastMsg) {
        // 直答路径：叙事块里的流式内容就是正式回答——通知前端撤块，全文回流正文（UI 与历史一致）
        emit.raw({ type: 'narrative_end', outcome: 'answer' });
        // 结束语仅是 UI 提示：只发前端展示，不进返回值/历史——否则历史里每条直答都以它结尾，
        // 模型会鹦鹉学舌自己说一遍，叠加后端追加变成两遍
        emit.raw({ type: 'token', token: lastMsg });
        emit.raw({ type: 'token', token: '\n\n---\n本次回答已结束，您可以根据上述内容开展进一步对话。' });
        emit.raw({ type: 'done' });
        return { reply: lastMsg };
      }
      const msg = '⚠️ 无法生成执行计划，请重新描述需求。';
      emit.raw({ type: 'narrative_end', outcome: 'answer' });
      emit.raw({ type: 'error', message: msg });
      emit.raw({ type: 'done' });
      return { reply: msg };
    }

    // 规划路径：叙事块定格为"规划思考过程"（默认折叠留存），正文只放结构化规划与结论
    emit.raw({ type: 'narrative_end', outcome: 'plan' });

    // ── 规划确认循环（支持"拒绝并重规划"） ──
    // 每轮：行为名校验（静默修正一次）→ 弹窗确认；用户可确认 / 拒绝并重规划 / 拒绝并退出。
    // 重规划产生的新规划同样要过行为名校验与用户确认，避免"二次规划绕过确认"。
    let confirmedPlan: SubTaskPlan | null = null;
    let planModified = false;
    let exitReason = '用户拒绝执行规划';

    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      // seq 冲突校验（链首）：规划内 seq 唯一；非法时提示父Agent 修正（最多 1 次）
      const validSeqs = await this.validateTaskSeqs(plan, planCtx);
      if (!validSeqs) {
        emit.raw({ type: 'error', message: '⚠️ 规划校验失败：无法生成有效的执行计划' });
        return { reply: '⚠️ 规划校验失败：无法生成有效的执行计划，请重新描述需求。' };
      }
      plan = validSeqs;

      // 名称合法性校验（每轮都做；先行为后函数，非法时各类分别提示父Agent 自动修正，各最多修正 1 次）
      const validNamed = await this.validateTaskBehaviorNames(plan, planCtx);
      const validNamedF = validNamed ? await this.validateTaskFunctionNames(validNamed, planCtx) : null;
      if (!validNamedF) {
        emit.raw({ type: 'error', message: '⚠️ 规划校验失败：无法生成有效的执行计划' });
        return { reply: '⚠️ 规划校验失败：无法生成有效的执行计划，请重新描述需求。' };
      }
      plan = validNamedF;

      // 参数结构校验（必填参数 key 齐全 + 类型匹配）：非法时 nudge 父Agent 修正一次，不再直接失败
      const paramValidated = await this.validateTaskParams(plan, planCtx);
      if (!paramValidated) {
        emit.entry({ type: 'subtask_done', name: '参数结构修正失败', status: 'failed', source: 'parent' });
        emit.raw({ type: 'error', message: '⚠️ 规划校验失败：参数结构不合法，修正失败' });
        emit.raw({ type: 'done' });
        return { reply: '⚠️ 规划校验失败：参数结构不合法，修正失败，请重新描述需求。' };
      }
      plan = paramValidated;

      // 约束校验（校验链尾）：取值范围违例 → 直接中断报错提交明细；枚举/匹配模式违例 → nudge 修正一次，复验仍不过判失败
      const constraintChecked = await this.validateTaskConstraints(plan, planCtx);
      if (!constraintChecked.plan) {
        const reason = constraintChecked.fatalReason ?? '参数值不满足枚举/匹配模式约束，修正失败';
        emit.raw({ type: 'error', message: `⚠️ ${reason}` });
        emit.raw({ type: 'done' });
        return { reply: `⚠️ ${reason}` };
      }
      plan = constraintChecked.plan;

      if (round === 0) {
        emit.entry({ type: 'subtask_start', name: '父Agent规划完成', status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
        emit.raw({ type: 'token', token: `✅ 校验通过：${plan.subtasks.length} 个行为名称合法\n` });
      } else {
        emit.entry({ type: 'subtask_start', name: `已按建议重新规划（第 ${round + 1} 轮）`, status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
      }

      // 单步任务：跳过规划确认，直接执行。
      // 只读无副作用；写操作由子任务的安全管控弹窗兜底（避免"规划确认+安全确认"双弹窗）。
      if (!planNeedsConfirm(plan)) {
        confirmedPlan = plan;
        break;
      }

      // 校验修复轮可能让叙事块重新流入（repairPlan 清零 submittedPlan 后断流解除），
      // 确认弹窗前幂等定格一次，前端转圈不残留
      emit.raw({ type: 'narrative_end', outcome: 'plan' });
      const planConfirm = await this.confirmManager.requestPlanConfirm(this.enrichPlanDisplay(plan, session.catalogView!), emit);

      if (planConfirm.approved) {
        if (planConfirm.plan) { plan = planConfirm.plan; planModified = true; }
        confirmedPlan = plan;
        break;
      }

      // 拒绝并重规划：把用户建议带给父Agent，重新生成规划后回到下一轮确认
      if (planConfirm.rejectAction === 'replan') {
        emit.entry({ type: 'subtask_done', name: '规划审核', status: 'failed', detail: '用户拒绝并要求重新规划', source: 'parent' });
        if (round >= MAX_PLAN_ROUNDS - 1) {
          exitReason = '重规划次数已达上限';
          break;
        }
        session.submittedPlan.value = null; // 只认本次重规划的新提交
        await this.parentPrompt(parentAgent,`用户拒绝了本次执行计划，并给出调整建议：\n${planConfirm.suggestion || '（用户未提供具体建议，请结合用户意图自行判断需要调整的地方）'}\n请重新调用 submit_plan 工具提交调整后的规划。`);
        const replanned = session.submittedPlan.value as SubTaskPlan | null;
        if (replanned && replanned.subtasks && replanned.subtasks.length > 0) {
          plan = replanned;
          continue;
        }
        exitReason = '重规划未生成有效规划';
        break;
      }

      // 拒绝并退出 / 超时 / 中断
      exitReason = planConfirm.reason === 'timeout' ? '规划确认超时'
        : planConfirm.reason === 'abort' ? '用户中断'
        : '用户拒绝执行规划';
      break;
    }

    if (!confirmedPlan) {
      // 用户拒绝/超时/重规划失败 → 父Agent 一两句极简收尾（token 流式仍开启，回复会流式显示）
      emit.entry({ type: 'subtask_done', name: '规划审核', status: 'failed', detail: exitReason, source: 'parent' });
      const parentAborted = isChildAborted(parentAgent);
      if (!parentAborted) {
        await this.parentPrompt(parentAgent,`用户取消了本次执行计划（${exitReason}），尚未执行任何子任务。请用一两句话简短确认已取消，并提示用户可如何调整后重新发起。`);
      }
      const reply = getLastAssistantMessage(parentAgent.state.messages)
        || (exitReason === '规划确认超时' ? '规划确认超时，已取消执行'
          : exitReason === '用户中断' ? '已中断'
          : '用户已拒绝执行规划');
      emit.raw({ type: 'done' });
      return { reply };
    }

    plan = confirmedPlan;
    // L1: 用户把规划删空后确认 → 视同取消，避免"执行完成"但零执行
    if (!plan.subtasks || plan.subtasks.length === 0) {
      emit.entry({ type: 'subtask_done', name: '规划为空', status: 'failed', detail: '用户确认的规划中没有任何子任务，已取消执行', source: 'parent' });
      if (!isChildAborted(parentAgent)) {
        await this.parentPrompt(parentAgent,`用户确认的规划中没有任何子任务（可能已在确认时全部删除），尚未执行任何子任务。请用一两句话简短确认已取消。`);
      }
      const reply = getLastAssistantMessage(parentAgent.state.messages) || '规划为空，已取消执行';
      emit.raw({ type: 'done' });
      return { reply };
    }

    // 结构校验：依赖存在性 / 无自引用 / 无环 / seq 唯一（纯代码，不弹窗，兜底前端已做的校验——用户编辑可绕过上方各闸）
    const structureErrors = [...validatePlanStructure(plan), ...validateSeqConflicts(plan)];
    if (structureErrors.length > 0) {
      emit.entry({ type: 'subtask_done', name: '规划结构校验', status: 'failed', detail: structureErrors.join('；'), source: 'parent' });
      const msg = '规划结构不合法，请重新发起。';
      emit.raw({ type: 'error', message: `⚠️ 规划校验失败：规划结构不合法（${structureErrors.join('；')}）` });
      emit.raw({ type: 'done' });
      return { reply: msg };
    }
    emit.entry({ type: 'subtask_done', name: '规划结构校验', status: 'done', detail: '依赖关系合法', source: 'parent' });

    // 确认通过且结构合法后，用【最终规划】输出执行记录与聊天区摘要（用户编辑过则展示编辑后的版本）
    if (planModified) {
      emit.entry({ type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
      // 用户编辑只同步给前端，父Agent 不知道。把最终规划注入其上下文，
      // 否则父Agent 会基于过期规划生成总结/分析，脑补被删除的子任务。
      const finalPlanText = plan.subtasks
        .map(st => `${st.seq}. ${st.function || st.behavior}（${st.scenario_name}/${st.ontology_name}）`)
        .join('\n');
      parentAgent.state.messages.push({
        role: 'user',
        content: `用户在确认时修改了执行计划，以下为最终规划，请以此为准（被删除的子任务不再执行、总结中不要提及）：\n${finalPlanText}`,
        timestamp: Date.now(),
      });
    }
    emit.entry({ type: 'subtask_start', name: '规划已确认', status: 'done', source: 'parent' });
    emit.raw({ type: 'narrative_end', outcome: 'plan' }); // 单步任务无弹窗路径也在此定格叙事块（幂等）
    emit.raw({ type: 'plan_received', plan: this.enrichPlanDisplay(plan, session.catalogView!) });
    const planSummary = plan.subtasks
      .sort((a, b) => a.seq - b.seq)
      .map(st => `${st.seq}. ${st.function || st.behavior} — ${st.description}（${st.scenario_name} / ${st.ontology_name}）`)
      .join('\n');
    emit.raw({ type: 'token', token: `\n📋 执行计划\n${planSummary}\n` });
    return { plan };
  }

  // ─── 阶段2：分波执行（WavePhase） ─────────────

  /**
   * 按依赖拓扑分波并行执行子任务，每波完成后按需反馈父Agent（数据中继/调整/提前终止）。
   * 结局经 session.terminate() 标记（aborted/blocked/failed/waveCapped），返回剩余待执行列表（总结阶段用）。
   */
  private async wavePhase(
    session: RunSession,
    plan: SubTaskPlan,
    emit: EventChannel,
  ): Promise<SubTask[]> {
    session.disableTokens(); // 子任务执行和反馈不流到聊天区，避免重复
    const runner = this.createSubtaskRunner(session);
    const planCtx: PlanRepairCtx = { parentAgent: session.parentAgent!, submittedPlan: session.submittedPlan, emit, catalog: session.catalogView! };
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
      const waveResults = await this.runBatch(ready, emit, runner, session.catalogView!);
      session.results.push(...waveResults);

      // 已执行子任务移出待执行列表
      const executedSeqs = new Set(waveResults.map(r => r.seq));
      pending = pending.filter(st => !executedSeqs.has(st.seq));

      // 波内任一子任务失败/被中断 → 终止（同波其余子任务已随 Promise.all 完成，结果保留）
      if (session.isAborted()) break;
      const waveFailed = waveResults.find(r => !r.success);
      if (waveFailed) {
        for (const r of waveResults) {
          if (!r.success) emit.raw({ type: 'token', token: `\r📋 **子任务 ${r.seq} ${r.task}** ❌ ${r.error}\n` });
        }
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
        session.planningNarrative = false;
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

  // ─── 子任务执行 ────────────────────────────

  /**
   * 执行一波子任务。
   * 无确认子任务（读操作）并行，按 MAX_PARALLEL 限流分块避免并发打爆 LLM/MCP；
   * 需确认子任务（写操作/security）逐个串行——前端 confirmModal 是单状态，并行弹多个确认窗会互相覆盖。
   */
  private async runBatch(
    batch: SubTask[],
    emit: EventChannel,
    runner: SubtaskRunner,
    catalog: FunctionCatalogView,
  ): Promise<SubTaskResult[]> {
    const secured: { st: SubTask; meta: BehaviorMeta }[] = [];
    const plain: { st: SubTask; meta: BehaviorMeta }[] = [];
    const functions: SubTask[] = [];
    for (const st of batch) {
      if (st.function) { functions.push(st); continue; }
      const meta = this.ontologyGateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior);
      (meta.security || meta.isWrite ? secured : plain).push({ st, meta });
    }

    const results: SubTaskResult[] = [];
    // 函数子任务：确定性直连调用（无 LLM、无安全确认、无规则），与行为子任务并行
    results.push(...await Promise.all(functions.map(st => this.runFunctionEntry(st, emit, catalog))));
    // 并行分块：每块内 Promise.all 并发执行
    for (let i = 0; i < plain.length; i += MAX_PARALLEL) {
      const chunk = plain.slice(i, i + MAX_PARALLEL);
      const chunkResults = await Promise.all(chunk.map(({ st, meta }) => this.runSubtaskEntry(st, meta, emit, runner)));
      results.push(...chunkResults);
    }
    // 需确认子任务串行执行
    for (const { st, meta } of secured) {
      results.push(await this.runSubtaskEntry(st, meta, emit, runner));
    }
    return results;
  }

  /** 执行单个子任务：组装上下文 → 记录起止执行记录 → 交给 SubtaskRunner。 */
  private async runSubtaskEntry(
    subTask: SubTask,
    meta: BehaviorMeta,
    emit: EventChannel,
    runner: SubtaskRunner,
  ): Promise<SubTaskResult> {
    // 子 Agent 上下文直接取子任务自身字段：多个子任务可指向不同本体
    const childContext: SkillContext = {
      scenario_name: subTask.scenario_name,
      scenario_id: subTask.scenario_id ?? 0,
      ontology_name: subTask.ontology_name,
      ontology_id: subTask.ontology_id,
    };
    // 展示三元组（中文（英文）/纯中文/描述）与 SubtaskRunner 内部记录同源于 entryDisplay
    const display = entryDisplay(meta.display_name, subTask.behavior, subTask.description);

    emit.entry({ type: 'subtask_start', name: subTask.behavior, status: 'running', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq, ...display });

    const result = await runner.run(subTask, meta, childContext, emit);

    emit.entry({ type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, result: result.summary, source: 'child', seq: subTask.seq, ...display });
    return result;
  }

  /** 执行单个函数子任务：确定性直连调用 MCP 函数（无子 Agent LLM、无安全确认、无规则）。 */
  private async runFunctionEntry(
    subTask: SubTask,
    emit: EventChannel,
    catalog: FunctionCatalogView,
  ): Promise<SubTaskResult> {
    const functionName = subTask.function!;
    // 中文名走 run 级目录快照（三源含其他MCP工具），无则空串由 entryDisplay 兜底子任务描述
    const fnDisplay = catalog.functionInfo(subTask.scenario_name, subTask.ontology_name, functionName)?.displayName ?? '';
    const display = entryDisplay(fnDisplay, functionName, subTask.description);

    // 直连执行前深展开计划期 {type/required/description/value} 包装为纯值（真实 LLM 中继会把包装递归嵌套进数组项）
    const args = unwrapParamValues(subTask.params || {});

    emit.entry({ type: 'subtask_start', name: functionName, status: 'running', detail: `${functionName}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq, ...display });
    emit.entry({ type: 'tool_call', name: functionName, status: 'running', params: args, source: 'child', seq: subTask.seq, ...display });

    const { text, isError } = await this.agentFactory.callFunctionTool(functionName, subTask.ontology_id, args);

    emit.entry({ type: 'tool_call', name: functionName, status: isError ? 'failed' : 'done', params: args, result: text, source: 'child', seq: subTask.seq, ...display });

    if (isError) {
      emit.entry({ type: 'subtask_done', name: functionName, status: 'failed', detail: `${functionName}｜子任务 ${subTask.seq}`, result: text, source: 'child', seq: subTask.seq, ...display });
      return { seq: subTask.seq, task: functionName, success: false, error: `❌ 函数执行失败：${text}`, summary: '' };
    }

    emit.entry({ type: 'subtask_done', name: functionName, status: 'done', detail: `${functionName}｜子任务 ${subTask.seq}`, result: text, source: 'child', seq: subTask.seq, ...display });
    // summary 直接放函数原始结果 JSON——它是 L0 波次反馈中继给后续子任务的一等值
    return { seq: subTask.seq, task: functionName, success: true, summary: text };
  }

  // ─── 波次反馈与规划校验 ──────────────────────

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
    ctx.submittedPlan.value = null; // 只识别本次分析中新提交的调整规划，避免误取历史规划
    const feedbackStart = ctx.parentAgent.state.messages.length; // 方案B：记录反馈轮起点，无调整则整体剔除
    const waveList = waveResults.map(r => `- 子任务 ${r.seq}（${r.task}）: ${r.summary}`).join('\n');
    const structureHint = await this.buildRelayStructureHint(waveResults, pending, session.catalogView!);
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
    // 显式断言：submit_plan 工具回调可能在上一个 await 期间写入了新规划，
    // TS 闭包窄化无法感知，需还原为可空类型
    const adjusted = ctx.submittedPlan.value as SubTaskPlan | null;
    let analysisDetail = `本波次子任务 ${waveResults.map(r => r.seq).join('、')} 分析完成`;

    let nextPending: SubTask[] | null = null;
    if (adjusted && Array.isArray(adjusted.subtasks)) {
      // L3: 执行中调整规划 → 与初始规划同等的校验链（seq冲突/行为名/函数名/参数/依赖），静默修正，不再弹窗用户确认。
      // 父 Agent 提交空规划或"只含已执行子任务"的规划 = 提前终止后续流程（nextPending 会被置空）。
      // 已执行 seq 集合提前算出：依赖校验视其为合法（调整规划常只含剩余子任务，depends_on 引用已执行前序）。
      const executedSeqs = new Set(allResults.map(r => r.seq));
      // seq 防冒名依据：已执行 seq → 任务名（seq 相同但任务名不同 = 新任务冒名，会被下方 filter 静默吞掉）
      const executedTasks = new Map(allResults.map(r => [r.seq, r.task] as const));
      const validatedS = await this.validateTaskSeqs(adjusted, ctx, executedTasks);
      const validatedB = validatedS ? await this.validateTaskBehaviorNames(validatedS, ctx) : null;
      const validatedF = validatedB ? await this.validateTaskFunctionNames(validatedB, ctx) : null;
      const validatedP = validatedF ? await this.validateTaskParams(validatedF, ctx) : null;
      // 约束校验：取值范围违例 → 硬中断（fatalReason 带明细）；枚举/匹配模式违例 → nudge 修正一次，复验仍不过 → null
      const constraintChecked: { plan: SubTaskPlan | null; fatalReason?: string } = validatedP ? await this.validateTaskConstraints(validatedP, ctx) : { plan: null };
      const validatedC = constraintChecked.plan;
      // 依赖校验也带 nudge（与行为名/参数一致）
      const validatedD = validatedC ? await this.validatePlanDeps(validatedC, ctx, executedSeqs) : null;
      if (validatedD) {
        // 调整后的规划是权威全集：剔除已执行，重新拓扑排序；为空则提前终止。
        nextPending = topologicalSort(validatedD.subtasks.filter(st => !executedSeqs.has(st.seq)));
        analysisDetail = nextPending.length === 0
          ? `本波次已提前终止后续流程`
          : `本波次已调整后续计划`;
      } else {
        // 校验（含 nudge 修正）仍未通过 → 不沿用原计划让下游带空参数裸奔：主动中止，总结阶段点破残留副作用
        session.terminate('adjustmentInvalid');
        analysisDetail = constraintChecked.fatalReason
          ? `本波次调整规划已中止：${constraintChecked.fatalReason}`
          : `本波次调整规划校验失败，流程已中止（避免后续子任务缺失中继数据继续执行）`;
      }
    }

    // 方案B：本轮反馈未产生调整 → prompt + 回复 是上下文垃圾，整体剔除，
    // 避免父Agent 上下文被 N 个"继续执行原计划"撑爆。有调整则保留（分析有价值）。
    if (!adjusted || !adjusted.subtasks || adjusted.subtasks.length === 0) {
      ctx.parentAgent.state.messages = ctx.parentAgent.state.messages.slice(0, feedbackStart);
    }
    ctx.emit.entry({ type: 'subtask_done', name: '子任务结果分析', status: 'done', detail: analysisDetail, result: analysisText, source: 'parent' });
    return nextPending;
  }

  /**
   * 中继结构参考（硬编码取数，无 LLM 选择空间）：找出直接依赖本波结果的后续子任务，
   * 从权威声明现取其 array/object 参数结构，渲染成 sketch 附进中继 prompt。
   * 单一事实源：函数走 FunctionCatalog 三源、行为走 gateway 行为声明——与中继后的
   * 参数校验器消费同一份声明，填值依据和判错依据严格一致；不靠父 Agent 记忆/抄写。
   * 无声明源（functionParams 返回 null）或全部参数都是标量 → 返回空串（prompt 不加段）。
   */
  private async buildRelayStructureHint(waveResults: SubTaskResult[], pending: SubTask[], catalog: FunctionCatalogView): Promise<string> {
    const waveSeqs = new Set(waveResults.map(r => r.seq));
    // 只取直接依赖本波的子任务：跨代依赖到后续波次中继时再填，不超前
    const dependents = pending.filter(st => (st.depends_on || []).some(d => waveSeqs.has(d)));
    if (dependents.length === 0) return '';
    const blocks: string[] = [];
    for (const st of dependents) {
      const declared = st.function
        ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.params ?? null)
        : this.ontologyGateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior)?.params;
      if (!declared) continue; // 无声明源 → 跳过（与校验器"无声明跳过、MCP schema 兜底"口径一致）
      const lines: string[] = [];
      for (const [key, spec] of Object.entries(declared)) {
        const s = spec as ParamSpec;
        if (s?.type !== 'array' && s?.type !== 'object') continue; // 标量无内部结构，不需要提示
        lines.push(...renderParamStructure(key, s, { filled: !isParamValueEmpty(st.params?.[key]) }));
      }
      if (lines.length > 0) blocks.push(`子任务${st.seq}（${st.function || st.behavior}）：\n${lines.join('\n')}`);
    }
    if (blocks.length === 0) return '';
    return `\n\n【待填参数结构参考】（以下子任务依赖本波结果，其 array/object 参数严格按此结构填纯值，数组项/对象字段直接填值即可，不要再包 {type/value} 等包装）\n${blocks.join('\n')}`;
  }

  /** seq 冲突校验（校验链首）：规划内 seq 唯一 + 反馈路径防"新任务冒名已执行 seq"。非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateTaskSeqs(plan: SubTaskPlan, ctx: PlanRepairCtx, executedTasks?: ReadonlyMap<number, string>): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: 'seq 冲突校验',
      doneLabel: 'seq 冲突已修正',
      detailOf: (p) => validateSeqConflicts(p, executedTasks).join('；'),
      isClean: (p) => validateSeqConflicts(p, executedTasks).length === 0,
      nudge: (p) => `以下子任务的 seq 不合法：\n${validateSeqConflicts(p, executedTasks).join('；')}\n\n请重新分配 seq：规划内不得重复；新增子任务不得占用已执行子任务的 seq（改用未占用的 seq），保持其余内容不变，然后重新调用 submit_plan 工具提交修正后的规划。`,
    });
  }

  /** 校验行为子任务的行为名合法性（gateway 花名册，按子任务所属本体过滤）；非法时提示父Agent 自动修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateTaskBehaviorNames(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    const invalidOf = (p: SubTaskPlan): InvalidTaskName[] => validateBehaviorNames(this.ontologyGateway, p);
    return this.repairPlan(plan, ctx, {
      label: '行为名校验',
      doneLabel: '行为名已修正',
      detailOf: (p) => `不存在的 behavior: ${invalidOf(p).map(iv => `子任务${iv.sub.seq}: ${iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、')}`,
      isClean: (p) => invalidOf(p).length === 0,
      nudge: (p) => {
        const invalid = invalidOf(p);
        // 按子任务分行列各自的合法名单（不合并成总表）：跨本体规划中合并名单会导致父 Agent
        // 跨本体误选、白白浪费唯一的修正机会；valid 为空（本体无行为/yaml缺失）时给删除或换本体的出口
        const lines = invalid.map(iv => {
          const head = `- 子任务${iv.sub.seq}（${iv.sub.behavior}，${iv.sub.scenario_name}/${iv.sub.ontology_name}）`;
          return iv.valid.length > 0
            ? `${head}，合法行为名有：${iv.valid.join('、')}`
            : `${head}，该本体下没有任何合法行为名——请检查 scenario_name/ontology_name 是否填错，或删除该子任务`;
        });
        return `以下子任务的 behavior 不在其所属场景/本体的合法集合中：\n${lines.join('\n')}\n请严格按各子任务对应的合法名单修正（严禁跨子任务借用名单），保持其余子任务不变，然后重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /** 校验函数子任务的函数名合法性（FunctionCatalog 三源合一：本体函数按本体过滤 ∪ 公共函数 ∪ 其他MCP工具）；非法时提示父Agent 自动修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateTaskFunctionNames(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    const catalog = ctx.catalog; // run 级快照（session.catalogView），与执行展示同源同时刻
    const invalidOf = (p: SubTaskPlan): InvalidTaskName[] => validateFunctionNames(catalog, p);
    return this.repairPlan(plan, ctx, {
      label: '函数名校验',
      doneLabel: '函数名已修正',
      detailOf: (p) => `不存在的 function: ${invalidOf(p).map(iv => `子任务${iv.sub.seq}: ${iv.sub.function}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、')}`,
      isClean: (p) => invalidOf(p).length === 0,
      nudge: (p) => {
        const invalid = invalidOf(p);
        // 按子任务分行列各自的合法名单（不合并成总表），与行为校验同构；valid 为空时给出口
        const lines = invalid.map(iv => {
          const head = `- 子任务${iv.sub.seq}（${iv.sub.function}，${iv.sub.scenario_name}/${iv.sub.ontology_name}）`;
          return iv.valid.length > 0
            ? `${head}，合法函数名有：${iv.valid.join('、')}`
            : `${head}，没有可用的合法函数名——请检查 scenario_name/ontology_name 是否填错，或删除该子任务`;
        });
        return `以下子任务的 function 不在合法函数集合中：\n${lines.join('\n')}\n请严格按各子任务对应的合法名单修正（严禁跨子任务借用名单；公共函数与其他MCP工具为全局工具，任何子任务都可用），保持其余子任务不变，然后重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /** 参数结构校验：必填参数 key 齐全 + 类型匹配；非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateTaskParams(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    const catalog = ctx.catalog; // run 级快照（session.catalogView）
    return this.repairPlan(plan, ctx, {
      label: '参数结构校验',
      doneLabel: '参数结构已修正',
      detailOf: (p) => validateAllParams(this.ontologyGateway, catalog, p).join('；'),
      isClean: (p) => validateAllParams(this.ontologyGateway, catalog, p).length === 0,
      nudge: (p) => {
        // 逐子任务取声明源并校验（与 validateAllParams 同口径：行为→gateway 行为声明，函数→catalog 三源），
        // 按子任务分组输出：错误清单 + 声明结构 sketch。sketch 用中继提示同款 renderParamStructure——
        // 父 Agent 修正时看到的结构 = 校验器判错的依据 = 中继填值的依据（单一事实源），不再让它绕路 load_skill。
        const blocks: string[] = [];
        for (const st of p.subtasks) {
          const declared = st.function
            ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.params ?? null)
            : this.ontologyGateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior)?.params;
          if (!declared) continue; // 无声明源 → 该校验器本就跳过（MCP 工具 schema 兜底）
          const errs = validateParamStructure(declared, st.params || {}, st.seq, st.function || st.behavior);
          if (errs.length === 0) continue; // 只给有错子任务出块
          const sketch = Object.entries(declared)
            .flatMap(([k, s]) => renderParamStructure(k, s as ParamSpec, {}, '  '));
          blocks.push(`- 子任务${st.seq}（${st.function || st.behavior}，${st.scenario_name}/${st.ontology_name}）\n  错误：\n${errs.map(e => `  · ${e}`).join('\n')}\n  参数声明结构（请严格按此修正）：\n${sketch.join('\n')}`);
        }
        return `以下子任务的参数不合法：\n${blocks.join('\n\n')}\n\n请逐项修正：必填参数 key 齐全（type/required/description/value 四键）、type 与 value 的类型与声明一致、缺失值留空字符串；保持行为与整体规划不变，然后重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /**
   * 约束校验（校验链尾，声明源 = 关联概念属性 constraint 回溯）：
   * - 取值范围（number/integer 的 min/max，为空不查）：违例**直接中断报错**，不 nudge、不修复，
   *   fatalReason 携带明细提交给用户（2026-08-25 拍板：范围违例是数据可信度问题，不让 LLM 自修）。
   * - 枚举/匹配模式：违例不中断，nudge 父 Agent 修正一次，复验仍不过返回失败。
   * 返回 { plan, fatalReason? }（plan = null 时：有 fatalReason = 范围硬中断，无 = 枚举/模式修正失败）。
   */
  private async validateTaskConstraints(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<{ plan: SubTaskPlan | null; fatalReason?: string }> {
    const rangeFatal = (rangeErrors: string[]): string => {
      ctx.emit.entry({ type: 'subtask_done', name: '取值范围校验', status: 'failed', detail: rangeErrors.join('；'), source: 'parent' });
      return `参数值超出取值范围：${rangeErrors.join('；')}`;
    };

    const first = validateAllConstraints(this.ontologyGateway, plan);
    if (first.rangeErrors.length > 0) return { plan: null, fatalReason: rangeFatal(first.rangeErrors) };

    const firstErrors = [...first.enumErrors, ...first.patternErrors];
    if (firstErrors.length === 0) return { plan };

    // 违例不硬停：明细（含合法枚举清单/正则原文/路径/填值）带给父 Agent，修正一次
    ctx.emit.entry({ type: 'subtask_done', name: '枚举/匹配模式校验', status: 'failed', detail: firstErrors.join('；'), source: 'parent' });
    ctx.submittedPlan.value = null; // 只认本次修正后的新提交
    await this.parentPrompt(ctx.parentAgent,
      `以下子任务的参数值违反声明的约束：\n${firstErrors.map(e => `· ${e}`).join('\n')}\n\n请逐项修正：枚举值必须改选为消息中列出的合法枚举值之一；不匹配模式的请将值转换为目标格式（如日期补零、去除多余空格/符号等）。保持行为与整体规划不变，然后重新调用 submit_plan 工具提交修正后的规划。`);
    // 显式断言：submit_plan 回调可能在上一个 await 期间写入了新规划，TS 闭包窄化无法感知
    const corrected = ctx.submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return { plan: null };

    const again = validateAllConstraints(this.ontologyGateway, corrected);
    if (again.rangeErrors.length > 0) return { plan: null, fatalReason: rangeFatal(again.rangeErrors) };
    if (again.enumErrors.length > 0 || again.patternErrors.length > 0) return { plan: null };
    ctx.emit.entry({ type: 'subtask_done', name: '枚举/匹配模式已修正', status: 'done', source: 'parent' });
    return { plan: corrected };
  }

  /**
   * 依赖结构校验（无自引用/无悬空依赖/无环）：非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。
   * executedSeqs：波次反馈中继路径传入已执行成功的 seq——dep 指向已执行子任务是合法的（"已完成"≠"不存在"），
   * 中继调整规划常只含剩余子任务，depends_on 仍引用前序已执行 seq。
   */
  private async validatePlanDeps(plan: SubTaskPlan, ctx: PlanRepairCtx, executedSeqs: ReadonlySet<number> = new Set()): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: '依赖结构校验',
      doneLabel: '依赖结构已修正',
      detailOf: (p) => validatePlanStructure(p, executedSeqs).join('；'),
      isClean: (p) => validatePlanStructure(p, executedSeqs).length === 0,
      nudge: (p) => `以下子任务的依赖关系不合法：\n${validatePlanStructure(p, executedSeqs).join('；')}\n\n请重新检查 depends_on（不能依赖自身、不能引用不存在的子任务、不能形成循环依赖；指向已执行完成的子任务是允许的），保持行为与参数不变，然后重新调用 submit_plan 提交修正后的规划。`,
    });
  }

  /**
   * 规划修复循环：跑校验器 → 有错则 pushEntry + 复位 holder + nudge 父Agent（最多1次）→ 复验。
   * 三个 nudge（行为名/参数/依赖）共用此骨架，只差校验器与提示文案。
   * 返回修正后的规划；无法修正（复验仍有错 / 父Agent 未重提）返回 null。
   */
  private async repairPlan(
    plan: SubTaskPlan,
    ctx: PlanRepairCtx,
    opts: {
      label: string;
      doneLabel: string;
      detailOf: (p: SubTaskPlan) => string;
      isClean: (p: SubTaskPlan) => boolean;
      nudge: (p: SubTaskPlan) => string;
    },
  ): Promise<SubTaskPlan | null> {
    if (opts.isClean(plan)) return plan;

    ctx.emit.entry({ type: 'subtask_done', name: opts.label, status: 'failed', detail: opts.detailOf(plan), source: 'parent' });
    ctx.submittedPlan.value = null; // 只认本次修正后的新提交
    await this.parentPrompt(ctx.parentAgent,opts.nudge(plan));
    // 显式断言：submit_plan 回调可能在上一个 await 期间写入了新规划，TS 闭包窄化无法感知
    const corrected = ctx.submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    if (!opts.isClean(corrected)) return null;
    ctx.emit.entry({ type: 'subtask_done', name: opts.doneLabel, status: 'done', source: 'parent' });
    return corrected;
  }

  /**
   * 给规划补展示字段：每个子任务附加行为中文名 display_name，供前端弹窗可读展示。
   * 纯展示用途，不参与结构校验；行为/函数名已在确认前经 validateTaskBehaviorNames / validateTaskFunctionNames 校验存在，getBehaviorMeta 不会抛错。
   */
  private enrichPlanDisplay(plan: SubTaskPlan, catalog: FunctionCatalogView): SubTaskPlan {
    return {
      ...plan,
      subtasks: plan.subtasks.map(st => ({
        ...st,
        display_name: st.function
          ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.displayName ?? '')
          : (this.ontologyGateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior).display_name || ''),
      })),
    };
  }

}
