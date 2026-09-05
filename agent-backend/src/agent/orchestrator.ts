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
import { getLastAssistantMessage, toolResultToText } from '../utils/text-utils.js';
import { PARENT_TOOL_LABELS } from './tool-catalog.js';
import { validatePlanStructure, validateSeqConflicts, validateOntologyScope, topologicalSort, looksLikePlanClaim } from './plan-validation.js';
import { isParamValueEmpty, renderParamStructure, type ParamSpec } from './param-contract.js';
import { ConfirmManager } from './confirm-manager.js';
import type { ConfirmPort } from './confirm-manager.js';
import { SubtaskRunner, isChildAborted } from './subtask-runner.js';
import { PlanGate } from './plan-gate.js';
import type { PlanRepairCtx } from './plan-gate.js';
import { WaveExecutor } from './wave-executor.js';
import { RunSession } from './run-session.js';
import { FunctionCatalog } from './function-catalog.js';
import type { FunctionCatalogView } from './function-catalog.js';
import { createEventChannel, ToolCallBridge } from './event-channel.js';
import type { EventChannel } from './event-channel.js';
import type { AgentPort } from './agent-ports.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, SubTask, SSEEvent, ConversationScope,
} from '../types.js';

const MAX_ROUNDS = 50;
const MAX_PLAN_ROUNDS = 3; // 规划确认"拒绝并重规划"的最大轮数，防止无限循环
const PARENT_PROMPT_TIMEOUT = 180_000; // 父Agent 单次 LLM 调用超时（规划/反馈/总结），防 API 挂起拖死整个 run

/**
 * 规划是否需要确认弹窗：仅多步任务需要。
 * 单步任务跳过规划确认——只读无副作用直接执行；写操作由子任务的安全管控弹窗兜底
 * （避免"规划确认 + 安全确认"双弹窗，单步没有"整体执行路径"可供用户审阅）。
 */
export function planNeedsConfirm(plan: SubTaskPlan): boolean {
  return plan.subtasks.length > 1;
}

/** 规划阶段产物：拿到确认后的最终规划，或直接终结本轮的回复文案 */
type PlanningOutcome = { plan: SubTaskPlan } | { reply: string };

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

  /** 路由回调：用户答复安全管控弹窗 → 转发当前活动 run 的确认器（无活动 run 时 id 必然对不上，静默丢弃） */
  handleConfirm(confirmId: string, approved: boolean): void {
    this.activeSession?.confirmManager.handleConfirm(confirmId, approved);
  }
  /** 路由回调：用户答复规划确认弹窗（同上） */
  handlePlanConfirm(confirmId: string, approved: boolean, plan?: SubTaskPlan, opts?: { rejectAction?: 'exit' | 'replan'; suggestion?: string }): void {
    this.activeSession?.confirmManager.handlePlanConfirm(confirmId, approved, plan, opts);
  }

  /** 测试/内部观测用：当前是否有 run 在执行 */
  hasActiveRun(): boolean { return this.activeSession !== null; }

  /** 每个 run 独立的子任务执行器（childAgents 集合随 session 走，abort 寻址不串 run） */
  private createSubtaskRunner(session: RunSession): SubtaskRunner {
    return new SubtaskRunner({
      confirmManager: session.confirmManager,
      createChildAgent: (ctx, policy) => this.agentFactory.createChildAgent(ctx, policy),
      childAgents: session.childAgents,
      // 子任务元数据查询口：策略派生（禁用集合）与工具调用展示（中文名）的全部投影，一次性接线
      info: {
        behaviorDisplayName: (scenario, ontology, behaviorName) =>
          this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).display_name || '',
        functionDisplayName: (scenario, ontology, functionName) =>
          session.catalogView?.functionInfo(scenario, ontology, functionName)?.displayName ?? '',
        // 工具层 disable 闸数据源：securities 登记的 scope（恒数组）；无登记（旧本体回退）视为 everyone 放行
        behaviorScope: (scenario, ontology, behaviorName) =>
          this.ontologyGateway.getBehaviorMeta(scenario, ontology, behaviorName).security?.scope ?? ['everyone'],
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
  ): Promise<string> {
    // 单 run 互斥：此前并发 execute 会互相覆盖单例字段（abort 误杀两个 run），入口直接拒绝
    if (this.activeSession) {
      const msg = '⚠️ 已有任务正在执行中，请等待其完成或先中断后再发起。';
      sendEvent({ type: 'error', message: msg });
      sendEvent({ type: 'done' });
      return msg;
    }
    const session = new RunSession(this.createConfirmManager());
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
      const planned = await this.planningPhase(session, message, scope, allowedOntologyIds, history, emit);
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

  // ─── 阶段1：规划（PlanningPhase） ─────────────

  /**
   * planningPhase 所有 {reply} 终结路径的统一出口：error / token 尾巴 / done 在此一处在场，
   * 任何早退都不可能漏发 done（历史漂移：校验链首失败漏发 done，链中失败却发，前端事件序列不一致）。
   * narrative_end 定格与留痕 entry 因各路径语义不同（aborted/answer/plan），留在调用点。
   */
  private endPlanning(
    emit: EventChannel,
    end: { reply: string; error?: string; tokens?: string[] },
  ): PlanningOutcome {
    if (end.error) emit.raw({ type: 'error', message: end.error });
    for (const token of end.tokens ?? []) emit.raw({ type: 'token', token });
    emit.raw({ type: 'done' });
    return { reply: end.reply };
  }

  /**
   * 父Agent 规划 → 校验（行为名/参数结构，各带 1 次静默修正）→ 规划确认弹窗（支持拒绝并重规划）
   * → 依赖结构校验 → 输出最终规划。返回 { plan } 进入执行阶段，或 { reply } 直接终结本轮。
   */
  private async planningPhase(
    session: RunSession,
    message: string,
    scope: ConversationScope,
    allowedOntologyIds: ReadonlySet<number>,
    history: ThreadMessage[],
    emit: EventChannel,
  ): Promise<PlanningOutcome> {
    const loadedSkillNames: string[] = [];
    const parentAgent = await this.agentFactory.createParentAgent(
      scope, history,
      (name: string) => {
        if (!loadedSkillNames.includes(name)) loadedSkillNames.push(name);
        emit.raw({ type: 'token', token: `\n📖 已加载技能：${name}\n` });
      },
      (plan) => session.submittedPlan.submit(plan),
    );
    session.parentAgent = parentAgent;
    // 父Agent 工具调用留痕（执行记录）：load_skill 仅完成时推一条（不带 SKILL 全文，只记技能名）；
    // list* 本体查询 running→done 成对推（结果不截断）。submit_plan / listAllMcpFunctions 不推——
    // 规划有 plan_confirm/plan_received 专属通道，目录查询按约定不展示。
    // start/end 参数配对走 ToolCallBridge（与子 Agent 侧同一模式）。
    const parentToolCalls = new ToolCallBridge();
    parentAgent.subscribe((event: any) => {
      if (event.type === 'tool_execution_start') {
        if (event.toolName === 'load_skill') {
          parentToolCalls.hold(event.toolCallId, event.args); // 暂存技能名，end 时推
          return;
        }
        const label = PARENT_TOOL_LABELS[event.toolName];
        if (!label) return;
        parentToolCalls.hold(event.toolCallId, event.args);
        emit.entry({ type: 'tool_call', name: event.toolName, status: 'running', params: event.args, source: 'parent', displayName: `${label}（${event.toolName}）`, displayLabel: label });
        return;
      }
      if (event.type === 'tool_execution_end') {
        const held = parentToolCalls.take(event.toolCallId);
        if (event.toolName === 'load_skill') {
          const skillName = held?.skill_name ?? '';
          emit.entry({ type: 'tool_call', name: 'load_skill', status: 'done', source: 'parent', displayName: '加载技能知识（load_skill）', displayLabel: '加载技能知识', detail: `已加载技能：${skillName}` });
          return;
        }
        const label = PARENT_TOOL_LABELS[event.toolName];
        if (!label) return;
        emit.entry({ type: 'tool_call', name: event.toolName, status: 'done', params: held, result: toolResultToText(event.result?.content), source: 'parent', displayName: `${label}（${event.toolName}）`, displayLabel: label });
        return;
      }
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        // 此 subscribe 贯穿整个 run（规划/反馈/总结共用同一父Agent），文本增量按 session 路由判定分流：
        // 规划阶段 → narrative 折叠块（submit_plan 提交后即断流，防编造执行叙事/假总结进正文）；
        // 总结阶段 → token 正文；反馈/执行阶段 → 丢弃（tokens 关闭）。
        const route = session.routeParentText();
        if (route === 'drop') return;
        emit.raw({ type: route, token: event.assistantMessageEvent.delta });
      }
    });
    // 规划修复上下文：nudge 父Agent/波次反馈共用的三件套 + 本体范围允许集（PlanGate 硬闸锚点）
    const planCtx: PlanRepairCtx = { parentAgent, submittedPlan: session.submittedPlan, emit, catalog: session.catalogView!, allowedOntologyIds };

    // 单轮 prompt：判断是否需要加载技能，然后直接回答或通过 submit_plan 提交规划
    await this.parentPrompt(parentAgent,`${message}`);
    // 规划阶段被中断 → 干净退出（父Agent 已中断，无规划可言）
    if (session.isAborted() || isChildAborted(parentAgent)) {
      emit.raw({ type: 'narrative_end', outcome: 'aborted' });
      return this.endPlanning(emit, { reply: '已中断', tokens: ['\n⏹ 已中断\n'] });
    }
    // 规划只来自 submit_plan 工具（schema 校验），不再用正则从文本抓取，避免误判
    let plan = session.submittedPlan.peek();
    if (plan && (!plan.subtasks || plan.subtasks.length === 0)) {
      plan = null;
    }

    if (!plan) {
      // 言行不一闸：文本声称"已提交规划/即将开始执行"但工具回调为空（submit_plan 调用未生效）。
      // 只在此"无规划"分支评估，正常路径零影响。命中 → nudge 一次自救（复用修复循环思路）：
      // 自救后拿到规划 → 落入下方正常校验链；自救后改为诚实直答 → 走直答路径；
      // 自救后仍声称已提交 → 诚实报错，不把虚假声明原文转发给用户。
      let lastMsg = getLastAssistantMessage(parentAgent.state.messages);
      if (lastMsg && looksLikePlanClaim(lastMsg)) {
        emit.entry({ type: 'subtask_done', name: '规划提交校验', status: 'failed', source: 'parent', detail: '模型声称已提交规划，但系统未收到 submit_plan 工具调用，已提示其重新提交' });
        console.warn('[orchestrator] 父Agent 声称已提交规划但未调用 submit_plan，nudge 一次');
        session.submittedPlan.reset(); // 复位-重提协议（与 PlanGate poke 同一约定）
        await this.parentPrompt(parentAgent, '系统未收到你的 submit_plan 工具调用——你上一条回复声称已提交规划，但工具调用并未生效（提交是否生效以工具返回"已接收执行规划"为准）。\n若你的意图是执行，请立即调用 submit_plan 工具提交规划；若无需执行（纯咨询/元数据查询），请直接回答用户问题，不要声称已提交。');
        if (session.isAborted() || isChildAborted(parentAgent)) {
          emit.raw({ type: 'narrative_end', outcome: 'aborted' });
          return this.endPlanning(emit, { reply: '已中断', tokens: ['\n⏹ 已中断\n'] });
        }
        plan = session.submittedPlan.peek();
        if (plan && (!plan.subtasks || plan.subtasks.length === 0)) {
          plan = null;
        }
        lastMsg = getLastAssistantMessage(parentAgent.state.messages);
        if (!plan && lastMsg && looksLikePlanClaim(lastMsg)) {
          // nudge 后仍声称已提交 → 虚假声明不进聊天正文，诚实报错
          emit.entry({ type: 'subtask_done', name: '规划提交校验', status: 'failed', source: 'parent', detail: '提示后仍未收到 submit_plan 工具调用，已拦截虚假声明' });
          console.warn('[orchestrator] nudge 后父Agent 仍未调用 submit_plan，拦截虚假声明');
          const msg = '⚠️ 规划提交失败：模型未能正确调用规划工具，请重新描述需求或换个说法。';
          emit.raw({ type: 'narrative_end', outcome: 'answer' });
          return this.endPlanning(emit, { reply: msg, error: msg });
        }
      }
      if (!plan) {
        if (lastMsg) {
          // 直答路径：叙事块里的流式内容就是正式回答——通知前端撤块，全文回流正文（UI 与历史一致）
          // （言行不一闸 nudge 后改为诚实直答的，也走这里——lastMsg 已是自救后的新回答）
          emit.raw({ type: 'narrative_end', outcome: 'answer' });
          // 结束语仅是 UI 提示：只发前端展示，不进返回值/历史——否则历史里每条直答都以它结尾，
          // 模型会鹦鹉学舌自己说一遍，叠加后端追加变成两遍
          return this.endPlanning(emit, { reply: lastMsg, tokens: [lastMsg, '\n\n---\n本次回答已结束，您可以根据上述内容开展进一步对话。'] });
        }
        const msg = '⚠️ 无法生成执行计划，请重新描述需求。';
        emit.raw({ type: 'narrative_end', outcome: 'answer' });
        return this.endPlanning(emit, { reply: msg, error: msg });
      }
    }

    // 规划路径：叙事块定格为"规划思考过程"（默认折叠留存），正文只放结构化规划与结论
    emit.raw({ type: 'narrative_end', outcome: 'plan' });

    // ── 规划确认循环（支持"拒绝并重规划"） ──
    // 每轮：行为名校验（静默修正一次）→ 弹窗确认；用户可确认 / 拒绝并重规划 / 拒绝并退出。
    // 重规划产生的新规划同样要过行为名校验与用户确认，避免"二次规划绕过确认"。
    // 确认落点 = session.confirmPlan（holder 过程量与 confirmed 终态分离，确认后只读 session.confirmedPlan()）
    let exitReason = '用户拒绝执行规划';

    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      // 初始校验链（seq 冲突 → 本体范围 → 行为名 → 函数名 → 参数，各带一次静默修正；链序与判废编排唯一在 PlanGate 内）
      const validated = await this.planGate.validateInitial(plan, planCtx);
      if (!validated) {
        const msg = '⚠️ 规划校验失败：无法生成有效的执行计划';
        return this.endPlanning(emit, { reply: `${msg}，请重新描述需求。`, error: msg });
      }
      plan = validated;

      if (round === 0) {
        emit.entry({ type: 'subtask_start', name: '父Agent规划完成', status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
        emit.raw({ type: 'token', token: `✅ 校验通过：${plan.subtasks.length} 个行为名称合法\n` });
      } else {
        emit.entry({ type: 'subtask_start', name: `已按建议重新规划（第 ${round + 1} 轮）`, status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
      }

      // 单步任务：跳过规划确认，直接执行。
      // 只读无副作用；写操作由子任务的安全管控弹窗兜底（避免"规划确认+安全确认"双弹窗）。
      if (!planNeedsConfirm(plan)) {
        session.confirmPlan(plan, false);
        break;
      }

      // 校验修复轮可能让叙事块重新流入（repairPlan 清零 submittedPlan 后断流解除），
      // 确认弹窗前幂等定格一次，前端转圈不残留
      emit.raw({ type: 'narrative_end', outcome: 'plan' });
      const planConfirm = await session.confirmManager.requestPlanConfirm(this.enrichPlanDisplay(plan, session.catalogView!), emit);

      if (planConfirm.approved) {
        // 用户在弹窗内编辑过规划（planConfirm.plan 存在）→ 以编辑版为准并标记 modified
        session.confirmPlan(planConfirm.plan ?? plan, !!planConfirm.plan);
        break;
      }

      // 拒绝并重规划：把用户建议带给父Agent，重新生成规划后回到下一轮确认
      if (planConfirm.rejectAction === 'replan') {
        emit.entry({ type: 'subtask_done', name: '规划审核', status: 'failed', detail: '用户拒绝并要求重新规划', source: 'parent' });
        if (round >= MAX_PLAN_ROUNDS - 1) {
          exitReason = '重规划次数已达上限';
          break;
        }
        session.submittedPlan.reset(); // 只认本次重规划的新提交
        await this.parentPrompt(parentAgent,`用户拒绝了本次执行计划，并给出调整建议：\n${planConfirm.suggestion || '（用户未提供具体建议，请结合用户意图自行判断需要调整的地方）'}\n请重新调用 submit_plan 工具提交调整后的规划。`);
        const replanned = session.submittedPlan.peek();
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

    const confirmed = session.confirmedPlan();
    if (!confirmed) {
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
      return this.endPlanning(emit, { reply });
    }

    plan = confirmed;
    // L1: 用户把规划删空后确认 → 视同取消，避免"执行完成"但零执行
    if (!plan.subtasks || plan.subtasks.length === 0) {
      emit.entry({ type: 'subtask_done', name: '规划为空', status: 'failed', detail: '用户确认的规划中没有任何子任务，已取消执行', source: 'parent' });
      if (!isChildAborted(parentAgent)) {
        await this.parentPrompt(parentAgent,`用户确认的规划中没有任何子任务（可能已在确认时全部删除），尚未执行任何子任务。请用一两句话简短确认已取消。`);
      }
      const reply = getLastAssistantMessage(parentAgent.state.messages) || '规划为空，已取消执行';
      return this.endPlanning(emit, { reply });
    }

    // 结构校验：依赖存在性 / 无自引用 / 无环 / seq 唯一 / 本体范围（纯代码，不弹窗，兜底前端已做的校验——用户编辑可绕过上方各闸。
    // 本体范围必须在此兜底：确认弹窗里用户可手改 ontology_id 到范围外本体，PlanGate 的 nudge 链已在确认前跑完，这里只做判定不做修复）
    const scopeViolations = validateOntologyScope(plan, allowedOntologyIds);
    const structureErrors = [
      ...validatePlanStructure(plan),
      ...validateSeqConflicts(plan),
      ...scopeViolations.map(st => `子任务 ${st.seq}（${st.function || st.behavior}）的 ontology_id=${st.ontology_id} 不在本次对话本体范围内`),
    ];
    if (structureErrors.length > 0) {
      emit.entry({ type: 'subtask_done', name: '规划结构校验', status: 'failed', detail: structureErrors.join('；'), source: 'parent' });
      const msg = '规划结构不合法，请重新发起。';
      return this.endPlanning(emit, { reply: msg, error: `⚠️ 规划校验失败：规划结构不合法（${structureErrors.join('；')}）` });
    }
    emit.entry({ type: 'subtask_done', name: '规划结构校验', status: 'done', detail: '依赖关系合法', source: 'parent' });

    // 确认通过且结构合法后，用【最终规划】输出执行记录与聊天区摘要（用户编辑过则展示编辑后的版本；
    // 编辑版已随 confirmPlan 注入父Agent 上下文，此处只留痕）
    if (session.wasPlanModified()) {
      emit.entry({ type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
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
        this.emitWaveFailures(waveResults, emit);
        session.terminate('securityBlocked');
        break;
      }

      // 波内任一子任务失败/被中断 → 终止（同波其余子任务已随 Promise.all 完成，结果保留）
      if (session.isAborted()) break;
      const waveFailed = waveResults.find(r => !r.success);
      if (waveFailed) {
        this.emitWaveFailures(waveResults, emit);
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

  /** 波收尾的失败 token 渲染（securityBlocked / 普通失败两分支共用） */
  private emitWaveFailures(waveResults: SubTaskResult[], emit: EventChannel): void {
    for (const r of waveResults) {
      if (!r.success) emit.raw({ type: 'token', token: `\r📋 **子任务 ${r.seq} ${r.task}** ❌ ${r.error}\n` });
    }
  }

  /**
   * 中继结构参考（硬编码取数，无 LLM 选择空间）：找出直接依赖本波结果的后续子任务，
   * 从权威声明现取其 array/object 参数结构，渲染成 sketch 附进中继 prompt。
   * 单一事实源：函数走 FunctionCatalog 三源、行为走 gateway 行为声明——与中继后的
   * 参数校验器消费同一份声明，填值依据和判错依据严格一致；不靠父 Agent 记忆/抄写。
   * 无声明源（functionParams 返回 null）或全部参数都是标量 → 返回空串（prompt 不加段）。
   */
  private buildRelayStructureHint(waveResults: SubTaskResult[], pending: SubTask[], catalog: FunctionCatalogView): string {
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
