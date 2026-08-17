/**
 * Orchestrator — 编排父/子 Agent 的完整执行循环。
 *
 * 流程:
 *  ① 父Agent 规划 → submit_plan 提交子任务列表
 *  ② 按依赖拓扑分波 → 波内无确认子任务并行、需确认子任务串行
 *  ③ 每个子任务: OntologyGateway → 组装指令 → 子Agent 执行
 *  ④ 安全管控弹窗 → 用户确认（波内串行，避免单弹窗冲突）
 *  ⑤ 工具调用失败重试 3 次（复用实例自纠）
 *  ⑥ 每波结果一次反馈父Agent → 继续/调整/提前终止
 *  ⑦ 无论成功/失败/中断，父Agent 统一生成最终总结
 */

import type { AgentFactoryPort, OntologyGatewayPort } from './agent-ports.js';
import { getLastAssistantMessage } from './text-utils.js';
import { validateBehaviorNames, validateFunctionNames, validateParamsStructure, validatePlanStructure, topologicalSort } from './plan-validation.js';
import type { InvalidBehavior } from './plan-validation.js';
import { unwrapParamValues } from './param-contract.js';
import { ConfirmManager } from './confirm-manager.js';
import { SubtaskRunner, isChildAborted } from './subtask-runner.js';
import type { AgentPort } from './agent-port.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, BehaviorMeta, SubTask, SSEEvent, ExecutionEntry, SkillContext, SkillSelection,
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

/** 事件通道：SSE 直发 + 执行记录推送的统一出口（二者同源于 sendEvent，避免双通道各自穿线） */
interface EventChannel {
  raw: (e: SSEEvent) => void;
  entry: (e: ExecutionEntry) => void;
}

/** 规划修复上下文：nudge 父Agent 所需三件套打包，替代 4-5 参穿透 */
interface PlanRepairCtx {
  parentAgent: AgentPort;
  submittedPlan: { value: SubTaskPlan | null };
  emit: EventChannel;
}

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  private confirmManager: ConfirmManager;
  /** 在途子 Agent 集合：并行子任务各自创建子 Agent，abort 时需逐个中断 */
  private childAgentSet = new Set<AgentPort>();
  private currentParentAgent: AgentPort | null = null;
  /** 当前 run 的中断标记（单例假定时序，同 execute 的生命周期内有效） */
  private activeAbortHolder: { aborted: boolean } | null = null;
  private subtaskRunner: SubtaskRunner;

  constructor(
    private agentFactory: AgentFactoryPort,
    private ontologyGateway: OntologyGatewayPort,
    confirmManager?: ConfirmManager, // 注入缝：测试可传 fake 确认器验证拒绝/超时分支
    private parentPromptTimeoutMs = PARENT_PROMPT_TIMEOUT, // 注入缝：测试可缩短超时验证挂起兜底（默认 180s 不变）
  ) {
    this.confirmManager = confirmManager ?? new ConfirmManager();
    this.subtaskRunner = new SubtaskRunner({
      confirmManager: this.confirmManager,
      createChildAgent: (ctx, pb, rp, budget, legalCalls) => this.agentFactory.createChildAgent(ctx, pb, rp, budget, legalCalls),
      childAgents: this.childAgentSet,
      getBehaviorDisplayName: (scenario, ontology, behaviorName) =>
        this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).display_name || '',
      getFunctionDisplayName: (scenario, ontology, functionName) =>
        this.ontologyGateway.getFunctionMeta(scenario, ontology, functionName).display_name || '',
      getBehaviorParams: (scenario, ontology, behaviorName) =>
        this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).params || {},
    });
  }

  getConfirmManager(): ConfirmManager { return this.confirmManager; }

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
    if (this.activeAbortHolder) this.activeAbortHolder.aborted = true;
    for (const agent of this.childAgentSet) {
      try { agent.abort(); } catch {}
    }
    this.childAgentSet.clear();
    if (this.currentParentAgent) {
      try { this.currentParentAgent.abort(); } catch {}
      this.currentParentAgent = null;
    }
    this.confirmManager.abortAll();
  }

  async execute(
    message: string,
    skills: SkillSelection[],
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    const abortHolder = { aborted: false };
    this.activeAbortHolder = abortHolder;
    try {
      return await this.runExecute(message, skills, history, sendEvent);
    } finally {
      // 编排结束（无论成功/失败/中断）释放 MCP 连接，避免跨子任务累积泄漏
      if (this.activeAbortHolder === abortHolder) this.activeAbortHolder = null;
      this.currentParentAgent = null;
      await this.agentFactory.closeAll();
    }
  }

  private async runExecute(
    message: string,
    skills: SkillSelection[],
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    const pushEntry = (entry: ExecutionEntry) => sendEvent({ type: 'exec_entry', entry });
    const emit: EventChannel = { raw: sendEvent, entry: pushEntry };

    // ── 阶段1：父Agent 规划 ──
    const loadedSkillNames: string[] = [];
    // 记录父 Agent 最近一次通过 submit_plan 工具提交的规划（已通过 schema 校验）。
    // 用可变 holder 对象而非局部变量，避免 TS 闭包窄化导致穿过 await 后类型恒为 null。
    const submittedPlan: { value: SubTaskPlan | null } = { value: null };
    let emitTokens = true;
    const parentAgent = await this.agentFactory.createParentAgent(
      skills, history,
      (name: string) => {
        if (!loadedSkillNames.includes(name)) loadedSkillNames.push(name);
        sendEvent({ type: 'token', token: `\n📖 已加载技能：${name}\n` });
      },
      (plan) => { submittedPlan.value = plan; },
    );
    this.currentParentAgent = parentAgent;
    parentAgent.subscribe((event: any) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta' && emitTokens) {
        sendEvent({ type: 'token', token: event.assistantMessageEvent.delta });
      }
    });
    // 规划修复上下文：nudge 父Agent/波次反馈共用的三件套
    const planCtx: PlanRepairCtx = { parentAgent, submittedPlan, emit };

    let plan: SubTaskPlan | null = null;

    // 全流程异常守卫（改进点2）：父Agent 不可用 / LLM 异常 / 超时 → 统一 catch 兜底，
    // 必须走到终结事件并点破"已生效的写操作不会被自动回滚"，不把裸异常抛给 SSE 路由。
    const results: SubTaskResult[] = [];
    try {

    // 单轮 prompt：判断是否需要加载技能，然后直接回答或通过 submit_plan 提交规划
    await this.parentPrompt(parentAgent,`${message}`);
    // 规划阶段被中断 → 干净退出（父Agent 已中断，无规划可言）
    if (this.activeAbortHolder?.aborted || isChildAborted(parentAgent)) {
      sendEvent({ type: 'token', token: '\n⏹ 已中断\n' });
      sendEvent({ type: 'done' });
      return '已中断';
    }
    // 规划只来自 submit_plan 工具（schema 校验），不再用正则从文本抓取，避免误判
    plan = submittedPlan.value;
    if (plan && (!plan.subtasks || plan.subtasks.length === 0)) {
      plan = null;
    }

    if (!plan || !plan.subtasks || plan.subtasks.length === 0) {
      const lastMsg = getLastAssistantMessage(parentAgent.state.messages);
      // 保护：模型若违反约束把规划写成 JSON 文本，不当作回答返回。
      // 正则只认 "subtasks" key（不锚定 {），避免嵌套 JSON 导致漏判。
      // 注意：error 需先于 done 发送（前端遇到 done 即 break，同批到达时会跳过 error）
      if (lastMsg && /"subtasks"\s*:/.test(lastMsg)) {
        const msg = '⚠️ 无法生成执行计划：规划格式异常，请重新描述需求。';
        sendEvent({ type: 'error', message: msg });
        sendEvent({ type: 'done' });
        return msg;
      }
      if (lastMsg) {
        sendEvent({ type: 'done' });
        return lastMsg;
      }
      const msg = '⚠️ 无法生成执行计划，请重新描述需求。';
      sendEvent({ type: 'error', message: msg });
      sendEvent({ type: 'done' });
      return msg;
    }

    // ── 规划确认循环（支持"拒绝并重规划"） ──
    // 每轮：行为名校验（静默修正一次）→ 弹窗确认；用户可确认 / 拒绝并重规划 / 拒绝并退出。
    // 重规划产生的新规划同样要过行为名校验与用户确认，避免"二次规划绕过确认"。
    let confirmedPlan: SubTaskPlan | null = null;
    let planModified = false;
    let exitReason = '用户拒绝执行规划';

    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      // 校验 behavior 名称合法性（每轮都做；非法时提示父Agent 自动修正，最多修正 1 次）
      const validated = await this.validateBehaviors(plan, planCtx);
      if (!validated) {
        sendEvent({ type: 'error', message: '⚠️ 规划校验失败：无法生成有效的执行计划' });
        return '⚠️ 规划校验失败：无法生成有效的执行计划，请重新描述需求。';
      }
      plan = validated;

      // 参数结构校验（必填参数 key 齐全 + 类型匹配）：非法时 nudge 父Agent 修正一次，不再直接失败
      const paramValidated = await this.validateParams(plan, planCtx);
      if (!paramValidated) {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '参数结构修正失败', status: 'failed', source: 'parent' });
        sendEvent({ type: 'error', message: '⚠️ 规划校验失败：参数结构不合法，修正失败' });
        sendEvent({ type: 'done' });
        return '⚠️ 规划校验失败：参数结构不合法，修正失败，请重新描述需求。';
      }
      plan = paramValidated;

      if (round === 0) {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '父Agent规划完成', status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
        sendEvent({ type: 'token', token: `✅ 校验通过：${plan.subtasks.length} 个行为名称合法\n` });
      } else {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: `已按建议重新规划（第 ${round + 1} 轮）`, status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
      }

      // 单步任务：跳过规划确认，直接执行。
      // 只读无副作用；写操作由子任务的安全管控弹窗兜底（避免"规划确认+安全确认"双弹窗）。
      if (!planNeedsConfirm(plan)) {
        confirmedPlan = plan;
        break;
      }

      const planConfirm = await this.confirmManager.requestPlanConfirm(this.enrichPlanDisplay(plan), sendEvent);

      if (planConfirm.approved) {
        if (planConfirm.plan) { plan = planConfirm.plan; planModified = true; }
        confirmedPlan = plan;
        break;
      }

      // 拒绝并重规划：把用户建议带给父Agent，重新生成规划后回到下一轮确认
      if (planConfirm.rejectAction === 'replan') {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划审核', status: 'failed', detail: '用户拒绝并要求重新规划', source: 'parent' });
        if (round >= MAX_PLAN_ROUNDS - 1) {
          exitReason = '重规划次数已达上限';
          break;
        }
        submittedPlan.value = null; // 只认本次重规划的新提交
        await this.parentPrompt(parentAgent,`用户拒绝了本次执行计划，并给出调整建议：\n${planConfirm.suggestion || '（用户未提供具体建议，请结合用户意图自行判断需要调整的地方）'}\n请重新调用 submit_plan 工具提交调整后的规划。`);
        const replanned = submittedPlan.value as SubTaskPlan | null;
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
      // 用户拒绝/超时/重规划失败 → 父Agent 一两句极简收尾（emitTokens 仍为 true，回复会流式显示）
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划审核', status: 'failed', detail: exitReason, source: 'parent' });
      const parentAborted = isChildAborted(parentAgent);
      if (!parentAborted) {
        await this.parentPrompt(parentAgent,`用户取消了本次执行计划（${exitReason}），尚未执行任何子任务。请用一两句话简短确认已取消，并提示用户可如何调整后重新发起。`);
      }
      const reply = getLastAssistantMessage(parentAgent.state.messages)
        || (exitReason === '规划确认超时' ? '规划确认超时，已取消执行'
          : exitReason === '用户中断' ? '已中断'
          : '用户已拒绝执行规划');
      sendEvent({ type: 'done' });
      return reply;
    }

    plan = confirmedPlan;
    // L1: 用户把规划删空后确认 → 视同取消，避免"执行完成"但零执行
    if (!plan.subtasks || plan.subtasks.length === 0) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划为空', status: 'failed', detail: '用户确认的规划中没有任何子任务，已取消执行', source: 'parent' });
      if (!isChildAborted(parentAgent)) {
        await this.parentPrompt(parentAgent,`用户确认的规划中没有任何子任务（可能已在确认时全部删除），尚未执行任何子任务。请用一两句话简短确认已取消。`);
      }
      const reply = getLastAssistantMessage(parentAgent.state.messages) || '规划为空，已取消执行';
      sendEvent({ type: 'done' });
      return reply;
    }

    // 结构校验：依赖存在性 / 无自引用 / 无环（纯代码，不弹窗，兜底前端已做的校验）
    const structureErrors = validatePlanStructure(plan);
    if (structureErrors.length > 0) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划结构校验', status: 'failed', detail: structureErrors.join('；'), source: 'parent' });
      const msg = '规划结构不合法，请重新发起。';
      sendEvent({ type: 'error', message: `⚠️ 规划校验失败：规划结构不合法（${structureErrors.join('；')}）` });
      sendEvent({ type: 'done' });
      return msg;
    }
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划结构校验', status: 'done', detail: '依赖关系合法', source: 'parent' });

    // 确认通过且结构合法后，用【最终规划】输出执行记录与聊天区摘要（用户编辑过则展示编辑后的版本）
    if (planModified) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
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
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '规划已确认', status: 'done', source: 'parent' });
    sendEvent({ type: 'plan_received', plan: this.enrichPlanDisplay(plan) });
    const planSummary = plan.subtasks
      .sort((a, b) => a.seq - b.seq)
      .map(st => `${st.seq}. ${st.function || st.behavior} — ${st.description}（${st.scenario_name} / ${st.ontology_name}）`)
      .join('\n');
    sendEvent({ type: 'token', token: `\n📋 执行计划\n${planSummary}\n` });

    // ── 阶段2：按依赖拓扑分波并行执行子任务，每波完成后一次反馈父Agent ──
    emitTokens = false; // 子任务执行和反馈不流到聊天区，避免重复
    let pending = topologicalSort(plan.subtasks);
    let aborted = false;
    let blocked = false; // 依赖未满足导致执行终止
    let failed = false; // 波内子任务执行失败导致终止（非用户中断）
    let waveCapped = false; // 波数上限触顶，仍有未执行子任务

    for (let wave = 0; wave < MAX_ROUNDS; wave++) {
      if (this.activeAbortHolder?.aborted) { aborted = true; break; }
      if (pending.length === 0) break;

      // 本波可并行子任务 = 依赖已全部成功执行（或无依赖）的就绪集
      const ready: SubTask[] = [];
      for (const st of pending) {
        const depFailed = (st.depends_on || []).some(dep => !results.find(r => r.seq === dep && r.success));
        if (depFailed) continue; // 依赖已失败，其后继永不满足
        ready.push(st);
      }
      // 无可执行子任务（其余全部依赖已失败）→ 依赖链断裂，终止
      if (ready.length === 0) { blocked = true; break; }

      // 执行本波：无确认子任务并行（MAX_PARALLEL 限流分块），需确认子任务逐个串行（前端单弹窗）
      const waveResults = await this.runBatch(ready, emit);
      results.push(...waveResults);

      // 已执行子任务移出待执行列表
      const executedSeqs = new Set(waveResults.map(r => r.seq));
      pending = pending.filter(st => !executedSeqs.has(st.seq));

      // 波内任一子任务失败/被中断 → 终止（同波其余子任务已随 Promise.all 完成，结果保留）
      if (this.activeAbortHolder?.aborted) { aborted = true; break; }
      const waveFailed = waveResults.find(r => !r.success);
      if (waveFailed) {
        for (const r of waveResults) {
          if (!r.success) sendEvent({ type: 'token', token: `\r📋 **子任务 ${r.seq} ${r.behavior}** ❌ ${r.error}\n` });
        }
        // 波内任一中止（拒确/中断）→ 用户中止；否则为普通执行失败。二者必须分开记，
        // 否则普通失败会被下方 waveCapped 判定误报成"波数触顶"。
        if (waveResults.some(r => !r.success && r.aborted)) aborted = true;
        else failed = true;
        break;
      }

      // 每波完成后是否反馈父Agent（数据传播/调整/提前终止以波为单位）：
      // - 本波已是最后一批（pending 空）→ 不反馈（无后续子任务可中继/调整，现状即如此）
      // - 中间波：仅当存在后续子任务 depends_on 本波结果（需数据中继/调整）才反馈父Agent；
      //   无跨波依赖（且能走到这里 = 本波全部成功）→ 直接进入下一波，省一次父Agent LLM 调用。
      if (pending.length > 0) {
        const waveNeedsRelay = pending.some(st => (st.depends_on || []).some(dep => executedSeqs.has(dep)));
        if (!waveNeedsRelay) {
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '本波无数据依赖', status: 'done', detail: `子任务 ${waveResults.map(r => r.seq).join('、')} 全部成功，直接进入下一波`, source: 'parent' });
        } else {
          const adjusted = await this.runWaveFeedback(waveResults, results, planCtx);
          if (this.activeAbortHolder?.aborted) { aborted = true; break; } // 反馈期间被中断 → 终止执行
          if (adjusted) pending = adjusted;
        }
      }
    }

    // 波数上限触顶：循环自然退出但仍有未执行子任务 → 视同未完成（改进点1），
    // 杜绝"报全部成功却静默吞掉末尾子任务"。
    if (pending.length > 0 && !aborted && !blocked && !failed) {
      waveCapped = true;
    }

    // 无论成功/失败/中断，父Agent 统一生成最终总结
    let finalSummary = '执行完成';
    if (results.length > 0 || aborted || blocked || failed || waveCapped) {
      const allSuccess = results.length > 0 && results.every(r => r.success);
      if (isChildAborted(parentAgent)) {
        // 父Agent 在反馈/调整阶段被打断，不能再复用其生成总结 → 罐头文案，无流式，显式发送
        finalSummary = '任务已被用户中断。';
        sendEvent({ type: 'token', token: `\n\n${finalSummary}` });
      } else {
        // 恢复流式：让父Agent 生成的最终总结逐字输出（emitTokens 在执行阶段被置 false）
        emitTokens = true;
        // 最终总结也是一次父Agent LLM 调用，发进行中信号点亮前端"处理中"转圈，
        // 消除"子任务全完成 → 总结首字流式"之间的静默空窗（镜像 runWaveFeedback 的 feedback 事件）。
        emit.raw({ type: 'feedback', status: 'running' });
        if (allSuccess && !aborted && !blocked && !failed && !waveCapped) {
          // 带上全量结果：末子任务跳过了中间分析，总结必须自包含
          const resultsText = results.map(r => `- 子任务 ${r.seq}（${r.behavior}）: ${r.summary}`).join('\n');
          await this.parentPrompt(parentAgent,`所有子任务已执行完毕。\n各子任务结果：\n${resultsText}\n\n请给用户一个简洁、完整的最终总结（包括执行结果、关键数据和后续建议）。`);
          finalSummary = getLastAssistantMessage(parentAgent.state.messages) || '执行完成';
        } else {
          const outcomeSummary = results.length > 0
            ? results.map(r =>
                `- 子任务 ${r.seq}（${r.behavior}）: ${r.success ? '成功' : `失败 - ${r.error || '未知原因'}`}`,
              ).join('\n')
            : '（无子任务成功执行）';
          const reason = aborted ? '任务已被用户中断'
            : (failed ? '存在子任务执行失败'
            : (blocked ? '因前置依赖未完成而终止'
            : `执行波数已达上限，仍有 ${pending.length} 个子任务未执行`));
          await this.parentPrompt(parentAgent,`任务未全部完成（${reason}）。\n已执行的子任务结果：\n${outcomeSummary}\n\n请给用户一个简洁的最终说明，并严格遵守以下要求：\n1. 总结已完成的操作与结果，说明终止/失败的原因\n2. 【残留副作用必须点破】若之前的子任务已产生持久化写入（如创建/更新/删除了采购单、库存等实体），必须明确列出这些【已生效】的写操作及其实体ID/编号，并说明任务终止后它们【仍然存在、不会被自动回滚】\n3. 针对上述残留状态，给出具体的后续处理建议（例如：重新发起剩余操作 / 取消或冲销已创建的记录 / 检查状态是否正常）\n4. 给出后续建议`);
          finalSummary = getLastAssistantMessage(parentAgent.state.messages) || '执行未完成';
        }
        emit.raw({ type: 'feedback', status: 'done' });
      }
    } else {
      // 无子任务执行（罕见）：直接显式发送默认文案
      sendEvent({ type: 'token', token: `\n\n${finalSummary}` });
    }
    // 最终总结同时写入执行记录：单波任务（最后一波不跑 runWaveFeedback）执行记录里也能看到父Agent总结
    emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '父Agent执行总结', status: 'done', result: finalSummary, source: 'parent' });
    sendEvent({ type: 'done' });
    return finalSummary;
    } catch (e: any) {
      // 守卫兜底：父Agent 处理异常（LLM 错误 / 超时 / 不可用）。
      // 不复用父Agent 生成总结，用罐头文案点破残留副作用后正常收尾：
      // 返回字符串 → SSE 路由会把本轮对话写回 thread 历史（此前异常路径会丢历史）。
      console.error(`[orchestrator] 执行异常: ${e?.stack || e}`);
      const executedList = results.length > 0
        ? results.map(r => `- 子任务 ${r.seq}（${r.behavior}）: ${r.success ? '成功' : `失败 - ${r.error || '未知原因'}`}`).join('\n')
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

  /**
   * 执行一波子任务。
   * 无确认子任务（读操作）并行，按 MAX_PARALLEL 限流分块避免并发打爆 LLM/MCP；
   * 需确认子任务（写操作/security）逐个串行——前端 confirmModal 是单状态，并行弹多个确认窗会互相覆盖。
   */
  private async runBatch(
    batch: SubTask[],
    emit: EventChannel,
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
    results.push(...await Promise.all(functions.map(st => this.runFunctionEntry(st, emit))));
    // 并行分块：每块内 Promise.all 并发执行
    for (let i = 0; i < plain.length; i += MAX_PARALLEL) {
      const chunk = plain.slice(i, i + MAX_PARALLEL);
      const chunkResults = await Promise.all(chunk.map(({ st, meta }) => this.runSubtaskEntry(st, meta, emit)));
      results.push(...chunkResults);
    }
    // 需确认子任务串行执行
    for (const { st, meta } of secured) {
      results.push(await this.runSubtaskEntry(st, meta, emit));
    }
    return results;
  }

  /** 执行单个子任务：组装上下文 → 记录起止执行记录 → 交给 SubtaskRunner。 */
  private async runSubtaskEntry(
    subTask: SubTask,
    meta: BehaviorMeta,
    emit: EventChannel,
  ): Promise<SubTaskResult> {
    // 子 Agent 上下文直接取子任务自身字段：多个子任务可指向不同本体
    const childContext: SkillContext = {
      scenario_name: subTask.scenario_name,
      scenario_id: subTask.scenario_id ?? 0,
      ontology_name: subTask.ontology_name,
      ontology_id: subTask.ontology_id,
    };

    emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: subTask.behavior, status: 'running', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq, displayName: `${meta.display_name || subTask.description}（${subTask.behavior}）`, displayLabel: meta.display_name || subTask.description, description: subTask.description });

    const result = await this.subtaskRunner.run(subTask, meta, childContext, emit.raw, emit.entry);

    emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, result: result.summary, source: 'child', seq: subTask.seq, displayName: `${meta.display_name || subTask.description}（${subTask.behavior}）`, displayLabel: meta.display_name || subTask.description, description: subTask.description });
    return result;
  }

  /** 执行单个函数子任务：确定性直连调用 MCP 函数（无子 Agent LLM、无安全确认、无规则）。 */
  private async runFunctionEntry(
    subTask: SubTask,
    emit: EventChannel,
  ): Promise<SubTaskResult> {
    const functionName = subTask.function!;
    const fnMeta = this.ontologyGateway.getFunctionMeta(subTask.scenario_name, subTask.ontology_name, functionName);
    const displayLabel = fnMeta.display_name || subTask.description;
    const displayName = `${displayLabel}（${functionName}）`;

    // 直连执行前深展开计划期 {type/required/description/value} 包装为纯值（真实 LLM 中继会把包装递归嵌套进数组项）
    const args = unwrapParamValues(subTask.params || {});

    emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: functionName, status: 'running', detail: `${functionName}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq, displayName, displayLabel, description: subTask.description });
    emit.entry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: functionName, status: 'running', params: args, source: 'child', seq: subTask.seq, displayName, displayLabel, description: subTask.description });

    const { text, isError } = await this.agentFactory.callFunctionTool(functionName, subTask.ontology_id, args);

    emit.entry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: functionName, status: isError ? 'failed' : 'done', params: args, result: text, source: 'child', seq: subTask.seq, displayName, displayLabel, description: subTask.description });

    if (isError) {
      emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: functionName, status: 'failed', detail: `${functionName}｜子任务 ${subTask.seq}`, result: text, source: 'child', seq: subTask.seq, displayName, displayLabel, description: subTask.description });
      return { seq: subTask.seq, behavior: functionName, success: false, error: `❌ 函数执行失败：${text}`, summary: '' };
    }

    emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: functionName, status: 'done', detail: `${functionName}｜子任务 ${subTask.seq}`, result: text, source: 'child', seq: subTask.seq, displayName, displayLabel, description: subTask.description });
    // summary 直接放函数原始结果 JSON——它是 L0 波次反馈中继给后续子任务的一等值
    return { seq: subTask.seq, behavior: functionName, success: true, summary: text };
  }

  /**
   * 每波完成后的父Agent 反馈：喂整波结果，做数据传播/规划调整/提前终止。
   * 返回调整后的待执行列表；null = 未产生调整，沿用当前 pending。
   */
  private async runWaveFeedback(
    waveResults: SubTaskResult[],
    allResults: SubTaskResult[],
    ctx: PlanRepairCtx,
  ): Promise<SubTask[] | null> {
    // 反馈父Agent 深入分析整波结果并决定后续计划（此 LLM 调用耗时秒级，先发分析中提示，避免用户以为已结束）
    ctx.emit.raw({ type: 'feedback', status: 'running' });
    ctx.submittedPlan.value = null; // 只识别本次分析中新提交的调整规划，避免误取历史规划
    const feedbackStart = ctx.parentAgent.state.messages.length; // 方案B：记录反馈轮起点，无调整则整体剔除
    const waveList = waveResults.map(r => `- 子任务 ${r.seq}（${r.behavior}）: ${r.summary}`).join('\n');
    await this.parentPrompt(ctx.parentAgent,`本波次已执行完毕，共 ${waveResults.length} 个子任务。

【执行结果】
${waveList}

请分析：
1. 各结果是否符合预期？有无异常或风险？
2. 后续未开始的子任务是否需要本次结果中的数据（如新生成的 ID、主键、状态、计算结果等）？
3. 【提前终止判断】后续未开始的子任务是否仍有必要执行？若某些或全部子任务已失去意义（例如订单已显示取消，则无需再入库/查询后续步骤），请调用 submit_plan 提交【剔除这些子任务】的调整规划；若要结束整个流程，可提交只包含【已执行子任务】的规划或空 subtasks，让流程提前结束，避免执行无意义的操作。

【数据传播（必须）】
若后续未开始的某个子任务的 params 或 guidance 依赖本次结果中产生的新数据（例：子任务 A 生成订单号、子任务 B 需要该订单号），即使本次结果完全正常，也**必须调用 submit_plan** 提交调整后的规划，把数据填入对应子任务的 params / guidance。此类新数据后续子任务无法自行查询到，只能靠你中继。
只有当所有后续子任务都不依赖本次结果、且无需任何调整时，才直接简要说明"继续执行原计划"，不要调用 submit_plan。`);
    ctx.emit.raw({ type: 'feedback', status: 'done' });
    if (this.activeAbortHolder?.aborted) return null; // 反馈期间被中断 → 外层终止执行

    // 提取父Agent的分析结果推送到前端执行记录
    const analysisText = getLastAssistantMessage(ctx.parentAgent.state.messages);
    // 显式断言：submit_plan 工具回调可能在上一个 await 期间写入了新规划，
    // TS 闭包窄化无法感知，需还原为可空类型
    const adjusted = ctx.submittedPlan.value as SubTaskPlan | null;
    let analysisDetail = `本波次子任务 ${waveResults.map(r => r.seq).join('、')} 分析完成`;

    let nextPending: SubTask[] | null = null;
    if (adjusted && Array.isArray(adjusted.subtasks)) {
      // L3: 执行中调整规划 → 与初始规划同等的三道校验（行为名/参数结构/依赖），静默修正，不再弹窗用户确认。
      // 父 Agent 提交空规划或"只含已执行子任务"的规划 = 提前终止后续流程（nextPending 会被置空）。
      const validatedB = await this.validateBehaviors(adjusted, ctx);
      if (validatedB) {
        const validatedP = await this.validateParams(validatedB, ctx);
        if (validatedP) {
          // 依赖校验也带 nudge（与行为名/参数一致）
          const validatedD = await this.validatePlanDeps(validatedP, ctx);
          if (validatedD) {
            // 调整后的规划是权威全集：剔除已执行，重新拓扑排序；为空则提前终止。
            const executedSeqs = new Set(allResults.map(r => r.seq));
            nextPending = topologicalSort(validatedD.subtasks.filter(st => !executedSeqs.has(st.seq)));
            analysisDetail = nextPending.length === 0
              ? `本波次已提前终止后续流程`
              : `本波次已调整后续计划`;
          } else {
            analysisDetail = `本波次调整规划依赖不合法，沿用原计划`;
          }
        } else {
          analysisDetail = `本波次调整规划参数不合法，沿用原计划`;
        }
      } else {
        analysisDetail = `本波次调整规划无效，沿用原计划`;
      }
    }

    // 方案B：本轮反馈未产生调整 → prompt + 回复 是上下文垃圾，整体剔除，
    // 避免父Agent 上下文被 N 个"继续执行原计划"撑爆。有调整则保留（分析有价值）。
    if (!adjusted || !adjusted.subtasks || adjusted.subtasks.length === 0) {
      ctx.parentAgent.state.messages = ctx.parentAgent.state.messages.slice(0, feedbackStart);
    }
    ctx.emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '子任务结果分析', status: 'done', detail: analysisDetail, result: analysisText, source: 'parent' });
    return nextPending;
  }

  /** 校验子任务行为/函数名合法性；非法时提示父Agent 自动修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateBehaviors(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: '行为/函数名校验',
      doneLabel: '行为/函数名已修正',
      detailOf: (p) => `不存在的 behavior/function: ${this.behaviorInvalid(p).map(iv => `子任务${iv.sub.seq}: ${iv.sub.function || iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、')}`,
      isClean: (p) => this.behaviorInvalid(p).length === 0,
      nudge: (p) => {
        const invalid = this.behaviorInvalid(p);
        const allValid = [...new Set(invalid.flatMap(iv => iv.valid))].join(', ');
        return `以下子任务的名称（behavior 或 function）不在其所属场景/本体的合法集合中：${invalid.map(iv => `子任务${iv.sub.seq}: ${iv.sub.function || iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、')}。\n合法名称有：${allValid}。\n请重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /** 参数结构校验：必填参数 key 齐全 + 类型匹配；非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateParams(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: '参数结构校验',
      doneLabel: '参数结构已修正',
      detailOf: (p) => validateParamsStructure(this.ontologyGateway, p).join('；'),
      isClean: (p) => validateParamsStructure(this.ontologyGateway, p).length === 0,
      nudge: (p) => `以下子任务的参数结构不合法，缺少必填参数：\n${validateParamsStructure(this.ontologyGateway, p).join('；')}\n\n请先重新加载相关技能（load_skill）获取每个行为的完整参数结构，确保每个子任务的 params 包含该行为声明的【全部必填参数】（type/required/description/value 齐全，用户已提供的填入 value，缺失的留空字符串），保持行为与整体规划不变，然后重新调用 submit_plan 提交修正后的规划。`,
    });
  }

  /** 依赖结构校验（无自引用/无悬空依赖/无环）：非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validatePlanDeps(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: '依赖结构校验',
      doneLabel: '依赖结构已修正',
      detailOf: (p) => validatePlanStructure(p).join('；'),
      isClean: (p) => validatePlanStructure(p).length === 0,
      nudge: (p) => `以下子任务的依赖关系不合法：\n${validatePlanStructure(p).join('；')}\n\n请重新检查 depends_on（不能依赖自身、不能引用不存在的子任务、不能形成循环依赖），保持行为与参数不变，然后重新调用 submit_plan 提交修正后的规划。`,
    });
  }

  /** 非法行为/函数名列表（子任务 + 合法名提示），供行为/函数名校验的 detail/nudge 共用。 */
  private behaviorInvalid(plan: SubTaskPlan): InvalidBehavior[] {
    return [
      ...validateBehaviorNames(this.ontologyGateway, plan),
      ...validateFunctionNames(this.ontologyGateway, plan),
    ];
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

    ctx.emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: opts.label, status: 'failed', detail: opts.detailOf(plan), source: 'parent' });
    ctx.submittedPlan.value = null; // 只认本次修正后的新提交
    await this.parentPrompt(ctx.parentAgent,opts.nudge(plan));
    // 显式断言：submit_plan 回调可能在上一个 await 期间写入了新规划，TS 闭包窄化无法感知
    const corrected = ctx.submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    if (!opts.isClean(corrected)) return null;
    ctx.emit.entry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: opts.doneLabel, status: 'done', source: 'parent' });
    return corrected;
  }

  /**
   * 给规划补展示字段：每个子任务附加行为中文名 display_name，供前端弹窗可读展示。
   * 纯展示用途，不参与结构校验；行为名已在确认前经 validateBehaviors 校验存在，getBehaviorMeta 不会抛错。
   */
  private enrichPlanDisplay(plan: SubTaskPlan): SubTaskPlan {
    return {
      ...plan,
      subtasks: plan.subtasks.map(st => ({
        ...st,
        display_name: st.function
          ? (this.ontologyGateway.getFunctionMeta(st.scenario_name, st.ontology_name, st.function).display_name || '')
          : (this.ontologyGateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior).display_name || ''),
      })),
    };
  }

}
