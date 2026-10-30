/**
 * 阶段1：规划（PlanningPhase）——自 `orchestrator.ts` 抽取。
 *
 * 抽取动因（2026-10-05，宪法 II 单文件 ≤500 行）：本阶段原为 239 行、内含 6 条
 * 终结路径（中断 / 直答 / 虚假声明拦截 / 校验失败 / 用户拒绝 / 确认通过），
 * 与 Orchestrator 的其余三阶段（分波执行 / 总结 / 波次反馈）挤在一个文件里既超行数上限，
 * 又让"规划期的事件序列"必须读全文才能确认。抽成独立函数后：
 *  - Orchestrator 只剩编排与阶段衔接；
 *  - 本文件可脱离 execute() 全路径直接测试（传入 fake session / emit 即可）。
 *
 * ## 本阶段的不变量（改动时务必保持）
 *
 * 1. **`endPlanning` 是所有 `{reply}` 终结路径的唯一出口**：`error` / `token` 尾巴 / `done`
 *    三者在此一处在场，任何早退都不可能漏发 `done`（历史漂移：校验链首失败漏发 done、
 *    链中失败却发，前端事件序列不一致）。
 * 2. **重规划必须重新过闸**：重规划产生的新规划同样要过 `planGate` 校验与用户确认，
 *    否则「二次规划」将成为绕过确认的后门。
 * 3. **单步任务跳过规划确认**：只读无副作用；写操作由子任务的安全管控弹窗兜底
 *    （避免"规划确认 + 安全确认"双弹窗，单步没有"整体执行路径"可供用户审阅）。
 * 4. **本体范围在此兜底**：确认弹窗里用户可手改 `ontology_id` 到范围外本体，
 *    `planGate` 的 nudge 链已在确认前跑完，这里只判定不修复。
 */
import type { AgentFactoryPort, AgentPort } from './agent-ports.js';
import { getLastAssistantMessage, toolResultToText } from '../utils/text-utils.js';
import { PARENT_TOOL_LABELS } from './tool-catalog.js';
import {
  validatePlanStructure, validateSeqConflicts, validateOntologyScope, looksLikePlanClaim,
} from './plan-validation.js';
import { isChildAborted } from './subtask-runner.js';
import type { PlanGate, PlanRepairCtx } from './plan-gate.js';
import type { FunctionCatalogView } from './function-catalog.js';
import type { RunSession } from './run-session.js';
import { ToolCallBridge } from './event-channel.js';
import type { EventChannel } from './event-channel.js';
import type {
  ThreadMessage, SubTaskPlan, ConversationScope,
} from '../types.js';

/** 规划确认"拒绝并重规划"的最大轮数，防止无限循环 */
export const MAX_PLAN_ROUNDS = 3;

/**
 * 规划是否需要确认弹窗：仅多步任务需要。
 * 单步任务跳过规划确认——只读无副作用直接执行；写操作由子任务的安全管控弹窗兜底
 * （避免"规划确认 + 安全确认"双弹窗，单步没有"整体执行路径"可供用户审阅）。
 */
export function planNeedsConfirm(plan: SubTaskPlan): boolean {
  return plan.subtasks.length > 1;
}

/** 规划阶段产物：拿到确认后的最终规划，或直接终结本轮的回复文案 */
export type PlanningOutcome = { plan: SubTaskPlan } | { reply: string };

/**
 * 本阶段所需的外部能力（由 Orchestrator 注入）。
 * 全部是本阶段**只读使用**或**纯回调**的依赖——不暴露 Orchestrator 自身，
 * 保证本文件可在测试里用 fake 实现而不构造整个编排器。
 */
export interface PlanningDeps {
  agentFactory: AgentFactoryPort;
  planGate: PlanGate;
  /** 给父 Agent 发 prompt（带超时与中断兜底，由 Orchestrator 提供） */
  parentPrompt: (agent: AgentPort, text: string) => Promise<void>;
  /** 给规划补展示字段（行为中文名），纯展示不参与校验 */
  enrichPlanDisplay: (plan: SubTaskPlan, catalog: FunctionCatalogView) => SubTaskPlan;
  /** 重规划轮数上限（默认 MAX_PLAN_ROUNDS；测试可注入更小值） */
  maxPlanRounds?: number;
}

/** 本阶段的运行上下文（run 级状态经 RunSession 流转） */
export interface PlanningArgs {
  session: RunSession;
  message: string;
  scope: ConversationScope;
  allowedOntologyIds: ReadonlySet<number>;
  history: ThreadMessage[];
  emit: EventChannel;
}

/**
 * 所有 `{reply}` 终结路径的统一出口：error / token 尾巴 / done 在此一处在场
 * （见文件头不变量 1）。`narrative_end` 定格与留痕 entry 因各路径语义不同
 * （aborted/answer/plan），留在调用点。
 */
export function endPlanning(
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
 * → 依赖结构校验 → 输出最终规划。返回 `{ plan }` 进入执行阶段，或 `{ reply }` 直接终结本轮。
 */
export async function runPlanningPhase(deps: PlanningDeps, args: PlanningArgs): Promise<PlanningOutcome> {
  const { agentFactory, planGate, parentPrompt, enrichPlanDisplay } = deps;
  const maxRounds = deps.maxPlanRounds ?? MAX_PLAN_ROUNDS;
  const { session, message, scope, allowedOntologyIds, history, emit } = args;

  const loadedSkillNames: string[] = [];
  const parentAgent = await agentFactory.createParentAgent(
    scope, history,
    (name: string) => {
      if (!loadedSkillNames.includes(name)) loadedSkillNames.push(name);
      emit.raw({ type: 'token', token: `\n📖 已加载技能：${name}\n` });
    },
    (plan) => session.submittedPlan.submit(plan),
  );
  session.parentAgent = parentAgent;
  // 父Agent 工具调用留痕（执行记录）：load_skill 仅完成时推一条（不带 SKILL 全文，只记技能名）；
  // list* 本体查询 running→done 成对推（结果不截断）。submit_plan / listPlannableFunctions 不推——
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
      emit.entry({ type: 'tool_call', name: event.toolName, status: 'running', params: event.args, source: 'parent', toolCallId: event.toolCallId, title: label });
      return;
    }
    if (event.type === 'tool_execution_end') {
      const held = parentToolCalls.take(event.toolCallId);
      if (event.toolName === 'load_skill') {
        const skillName = held?.skill_name ?? '';
        emit.entry({ type: 'tool_call', name: 'load_skill', status: 'done', source: 'parent', toolCallId: event.toolCallId, title: '加载技能知识', detail: `已加载技能：${skillName}` });
        return;
      }
      const label = PARENT_TOOL_LABELS[event.toolName];
      if (!label) return;
      emit.entry({ type: 'tool_call', name: event.toolName, status: 'done', params: held, result: toolResultToText(event.result?.content), source: 'parent', toolCallId: event.toolCallId, title: label });
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
  await parentPrompt(parentAgent, `${message}`);
  // 规划阶段被中断 → 干净退出（父Agent 已中断，无规划可言）
  if (session.isAborted() || isChildAborted(parentAgent)) {
    emit.raw({ type: 'narrative_end', outcome: 'aborted' });
    return endPlanning(emit, { reply: '已中断', tokens: ['\n⏹ 已中断\n'] });
  }
  // 规划只来自 submit_plan 工具（schema 校验），不再用正则从文本抓取，避免误判
  let plan = session.submittedPlan.peek();
  if (plan && (!plan.subtasks || plan.subtasks.length === 0)) {
    plan = null;
  }

  if (!plan) {
    const lastMsg = getLastAssistantMessage(parentAgent.state.messages);
    // 言行不一闸：文本声称"已提交规划/即将开始执行"但工具回调为空（submit_plan 调用未生效）。
    // 命中 → 直接报错，不重试，不把虚假声明原文转发给用户。
    if (lastMsg && looksLikePlanClaim(lastMsg)) {
      emit.entry({ type: 'subtask_done', name: '规划提交校验', status: 'failed', source: 'parent', detail: '模型声称已提交规划，但系统未收到 submit_plan 工具调用，已拦截虚假声明' });
      console.warn('[orchestrator] 父Agent 声称已提交规划但未调用 submit_plan，已拦截');
      const msg = '⚠️ 规划提交失败：模型未能正确调用规划工具，请重新描述需求或换个说法。';
      emit.raw({ type: 'narrative_end', outcome: 'answer' });
      return endPlanning(emit, { reply: msg, error: msg });
    }
    // 无规划、无虚假声明 → 直答路径
    if (lastMsg) {
      emit.raw({ type: 'narrative_end', outcome: 'answer' });
      return endPlanning(emit, { reply: lastMsg, tokens: [lastMsg, '\n\n---\n本次回答已结束，您可以根据上述内容开展进一步对话。'] });
    }
    const msg = '⚠️ 无法生成执行计划，请重新描述需求。';
    emit.raw({ type: 'narrative_end', outcome: 'answer' });
    return endPlanning(emit, { reply: msg, error: msg });
  }

  // 规划路径：叙事块定格为"规划思考过程"（默认折叠留存），正文只放结构化规划与结论
  emit.raw({ type: 'narrative_end', outcome: 'plan' });

  // ── 规划确认循环（支持"拒绝并重规划"） ──
  // 每轮：行为名校验（静默修正一次）→ 弹窗确认；用户可确认 / 拒绝并重规划 / 拒绝并退出。
  // 重规划产生的新规划同样要过行为名校验与用户确认，避免"二次规划绕过确认"（不变量 2）。
  // 确认落点 = session.confirmPlan（holder 过程量与 confirmed 终态分离，确认后只读 session.confirmedPlan()）
  let exitReason = '用户拒绝执行规划';

  for (let round = 0; round < maxRounds; round++) {
    // 初始校验链（seq 冲突 → 本体范围 → 行为名 → 函数名 → 参数，各带一次静默修正；链序与判废编排唯一在 PlanGate 内）
    const validated = await planGate.validateInitial(plan, planCtx);
    if (!validated) {
      const msg = '⚠️ 规划校验失败：无法生成有效的执行计划';
      return endPlanning(emit, { reply: `${msg}，请重新描述需求。`, error: msg });
    }
    plan = validated;

    if (round === 0) {
      emit.entry({ type: 'subtask_start', name: '父Agent规划完成', status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
      emit.raw({ type: 'token', token: `✅ 校验通过：${plan.subtasks.length} 个行为名称合法\n` });
    } else {
      emit.entry({ type: 'subtask_start', name: `已按建议重新规划（第 ${round + 1} 轮）`, status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
    }

    // 单步任务：跳过规划确认，直接执行（不变量 3）
    if (!planNeedsConfirm(plan)) {
      session.confirmPlan(plan, false);
      break;
    }

    // 校验修复轮可能让叙事块重新流入（repairPlan 清零 submittedPlan 后断流解除），
    // 确认弹窗前幂等定格一次，前端转圈不残留
    emit.raw({ type: 'narrative_end', outcome: 'plan' });
    const planConfirm = await session.confirmManager.requestPlanConfirm(enrichPlanDisplay(plan, session.catalogView!), emit);

    if (planConfirm.approved) {
      // 用户在弹窗内编辑过规划（planConfirm.plan 存在）→ 以编辑版为准并标记 modified
      session.confirmPlan(planConfirm.plan ?? plan, !!planConfirm.plan);
      break;
    }

    // 拒绝并重规划：把用户建议带给父Agent，重新生成规划后回到下一轮确认
    if (planConfirm.rejectAction === 'replan') {
      emit.entry({ type: 'subtask_done', name: '规划审核', status: 'failed', detail: '用户拒绝并要求重新规划', source: 'parent' });
      if (round >= maxRounds - 1) {
        exitReason = '重规划次数已达上限';
        break;
      }
      session.submittedPlan.reset(); // 只认本次重规划的新提交
      await parentPrompt(parentAgent, `用户拒绝了本次执行计划，并给出调整建议：\n${planConfirm.suggestion || '（用户未提供具体建议，请结合用户意图自行判断需要调整的地方）'}\n请重新调用 submit_plan 工具提交调整后的规划。`);
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
      await parentPrompt(parentAgent, `用户取消了本次执行计划（${exitReason}），尚未执行任何子任务。请用一两句话简短确认已取消，并提示用户可如何调整后重新发起。`);
    }
    const reply = getLastAssistantMessage(parentAgent.state.messages)
      || (exitReason === '规划确认超时' ? '规划确认超时，已取消执行'
        : exitReason === '用户中断' ? '已中断'
        : '用户已拒绝执行规划');
    return endPlanning(emit, { reply });
  }

  plan = confirmed;
  // L1: 用户把规划删空后确认 → 视同取消，避免"执行完成"但零执行
  if (!plan.subtasks || plan.subtasks.length === 0) {
    emit.entry({ type: 'subtask_done', name: '规划为空', status: 'failed', detail: '用户确认的规划中没有任何子任务，已取消执行', source: 'parent' });
    if (!isChildAborted(parentAgent)) {
      await parentPrompt(parentAgent, `用户确认的规划中没有任何子任务（可能已在确认时全部删除），尚未执行任何子任务。请用一两句话简短确认已取消。`);
    }
    const reply = getLastAssistantMessage(parentAgent.state.messages) || '规划为空，已取消执行';
    return endPlanning(emit, { reply });
  }

  // 结构校验：依赖存在性 / 无自引用 / 无环 / seq 唯一 / 本体范围（纯代码，不弹窗，兜底前端已做的校验——用户编辑可绕过上方各闸）。
  // 本体范围必须在此兜底（不变量 4）：确认弹窗里用户可手改 ontology_id 到范围外本体
  const scopeViolations = validateOntologyScope(plan, allowedOntologyIds);
  const structureErrors = [
    ...validatePlanStructure(plan),
    ...validateSeqConflicts(plan),
    ...scopeViolations.map(st => `子任务 ${st.seq}（${st.function || st.behavior}）的 ontology_id=${st.ontology_id} 不在本次对话本体范围内`),
  ];
  if (structureErrors.length > 0) {
    emit.entry({ type: 'subtask_done', name: '规划结构校验', status: 'failed', detail: structureErrors.join('；'), source: 'parent' });
    const msg = '规划结构不合法，请重新发起。';
    return endPlanning(emit, { reply: msg, error: `⚠️ 规划校验失败：规划结构不合法（${structureErrors.join('；')}）` });
  }
  emit.entry({ type: 'subtask_done', name: '规划结构校验', status: 'done', detail: '依赖关系合法', source: 'parent' });

  // 确认通过且结构合法后，用【最终规划】输出执行记录与聊天区摘要（用户编辑过则展示编辑后的版本；
  // 编辑版已随 confirmPlan 注入父Agent 上下文，此处只留痕）
  if (session.wasPlanModified()) {
    emit.entry({ type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
  }
  emit.entry({ type: 'subtask_start', name: '规划已确认', status: 'done', source: 'parent' });
  emit.raw({ type: 'narrative_end', outcome: 'plan' }); // 单步任务无弹窗路径也在此定格叙事块（幂等）
  emit.raw({ type: 'plan_received', plan: enrichPlanDisplay(plan, session.catalogView!) });
  const planSummary = plan.subtasks
    .sort((a, b) => a.seq - b.seq)
    .map(st => `${st.seq}. ${st.function || st.behavior} — ${st.description}（${st.scenario_name} / ${st.ontology_name}）`)
    .join('\n');
  emit.raw({ type: 'token', token: `\n📋 执行计划\n${planSummary}\n` });
  return { plan };
}