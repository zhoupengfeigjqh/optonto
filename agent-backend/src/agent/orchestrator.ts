/**
 * Orchestrator — 编排父/子 Agent 的完整执行循环。
 *
 * 流程:
 *  ① 父Agent 规划 → submit_plan 提交子任务列表
 *  ② 按依赖排序 → 逐任务执行
 *  ③ 每个子任务: OntologyGateway → 组装指令 → 子Agent 执行
 *  ④ 安全管控弹窗 → 用户确认
 *  ⑤ 工具调用失败重试 3 次（复用实例自纠）
 *  ⑥ 结果反馈父Agent → 继续/调整
 *  ⑦ 无论成功/失败/中断，父Agent 统一生成最终总结
 */

import { AgentFactory } from './agent-factory.js';
import { OntologyGateway } from '../services/ontology-gateway.js';
import { contentToText } from './text-utils.js';
import { validateBehaviorNames, validateParamsStructure, validatePlanStructure } from './plan-validation.js';
import { ConfirmManager } from './confirm-manager.js';
import { SubtaskRunner, isChildAborted } from './subtask-runner.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, BehaviorMeta, SubTask, SSEEvent, ExecutionEntry, SkillContext, SkillSelection,
} from '../types.js';

const MAX_ROUNDS = 20;
const MAX_PLAN_ROUNDS = 3; // 规划确认"拒绝并重规划"的最大轮数，防止无限循环

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  private confirmManager = new ConfirmManager();
  private childAgentRef: { current: any | null } = { current: null };
  private currentParentAgent: any = null;
  /** 当前 run 的中断标记（单例假定时序，同 execute 的生命周期内有效） */
  private activeAbortHolder: { aborted: boolean } | null = null;
  private subtaskRunner: SubtaskRunner;

  constructor(
    private agentFactory: AgentFactory,
    private ontologyGateway: OntologyGateway,
  ) {
    this.subtaskRunner = new SubtaskRunner({
      confirmManager: this.confirmManager,
      createChildAgent: (ctx, pb, oid, rp) => this.agentFactory.createChildAgent(ctx, pb, oid, rp),
      childAgentRef: this.childAgentRef,
    });
  }

  getConfirmManager(): ConfirmManager { return this.confirmManager; }

  /**
   * 中断当前执行：置位 run 级 abort 标记 + 中断在途的子/父 Agent + 拒绝所有待确认弹窗。
   * 覆盖：子任务执行、安全管控弹窗、规划确认弹窗、父Agent 规划/反馈阶段。
   */
  abort(): void {
    if (this.activeAbortHolder) this.activeAbortHolder.aborted = true;
    if (this.childAgentRef.current) {
      try { this.childAgentRef.current.abort(); } catch {}
      this.childAgentRef.current = null;
    }
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

    let plan: SubTaskPlan | null = null;

    // 单轮 prompt：判断是否需要加载技能，然后直接回答或通过 submit_plan 提交规划
    await parentAgent.prompt(`${message}`);
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
      const lastMsg = this.getLastAssistantMessage(parentAgent.state.messages);
      // 保护：模型若违反约束把规划写成 JSON 文本，不当作回答返回。
      // 正则只认 "subtasks" key（不锚定 {），避免嵌套 JSON 导致漏判。
      // 注意：error 需先于 done 发送（前端遇到 done 即 break，同批到达时会跳过 error）
      if (lastMsg && /"subtasks"\s*:/.test(lastMsg)) {
        sendEvent({ type: 'error', message: '⚠️ 无法生成执行计划：规划格式异常，请重新描述需求。' });
        sendEvent({ type: 'done' });
        return '⚠️ 无法生成执行计划：规划格式异常，请重新描述需求。';
      }
      if (lastMsg) {
        sendEvent({ type: 'done' });
        return lastMsg;
      }
      sendEvent({ type: 'error', message: '⚠️ 无法生成执行计划，请重新描述需求。' });
      sendEvent({ type: 'done' });
      return '⚠️ 无法生成执行计划，请重新描述需求。';
    }

    // ── 规划确认循环（支持"拒绝并重规划"） ──
    // 每轮：行为名校验（静默修正一次）→ 弹窗确认；用户可确认 / 拒绝并重规划 / 拒绝并退出。
    // 重规划产生的新规划同样要过行为名校验与用户确认，避免"二次规划绕过确认"。
    let confirmedPlan: SubTaskPlan | null = null;
    let planModified = false;
    let exitReason = '用户拒绝执行规划';

    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      // 校验 behavior 名称合法性（每轮都做；非法时提示父Agent 自动修正，最多修正 1 次）
      const validated = await this.validateBehaviors(plan, parentAgent, submittedPlan, pushEntry);
      if (!validated) {
        sendEvent({ type: 'error', message: '⚠️ 规划校验失败：无法生成有效的执行计划' });
        return '⚠️ 规划校验失败：无法生成有效的执行计划，请重新描述需求。';
      }
      plan = validated;

      // 参数结构校验（必填参数 key 齐全 + 类型匹配）：非法时 nudge 父Agent 修正一次，不再直接失败
      const paramValidated = await this.validateParams(plan, parentAgent, submittedPlan, pushEntry);
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

      const planConfirm = await this.confirmManager.requestPlanConfirm(plan, sendEvent);

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
        await parentAgent.prompt(`用户拒绝了本次执行计划，并给出调整建议：\n${planConfirm.suggestion || '（用户未提供具体建议，请结合用户意图自行判断需要调整的地方）'}\n请重新调用 submit_plan 工具提交调整后的规划。`);
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
        await parentAgent.prompt(`用户取消了本次执行计划（${exitReason}），尚未执行任何子任务。请用一两句话简短确认已取消，并提示用户可如何调整后重新发起。`);
      }
      const reply = this.getLastAssistantMessage(parentAgent.state.messages)
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
        await parentAgent.prompt(`用户确认的规划中没有任何子任务（可能已在确认时全部删除），尚未执行任何子任务。请用一两句话简短确认已取消。`);
      }
      const reply = this.getLastAssistantMessage(parentAgent.state.messages) || '规划为空，已取消执行';
      sendEvent({ type: 'done' });
      return reply;
    }

    // 结构校验：依赖存在性 / 无自引用 / 无环（纯代码，不弹窗，兜底前端已做的校验）
    const structureErrors = validatePlanStructure(plan);
    if (structureErrors.length > 0) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划结构校验', status: 'failed', detail: structureErrors.join('；'), source: 'parent' });
      sendEvent({ type: 'error', message: `⚠️ 规划校验失败：规划结构不合法（${structureErrors.join('；')}）` });
      sendEvent({ type: 'done' });
      return '规划结构不合法，请重新发起。';
    }
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划结构校验', status: 'done', detail: '依赖关系合法', source: 'parent' });

    // 确认通过且结构合法后，用【最终规划】输出执行记录与聊天区摘要（用户编辑过则展示编辑后的版本）
    if (planModified) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
      // 用户编辑只同步给前端，父Agent 不知道。把最终规划注入其上下文，
      // 否则父Agent 会基于过期规划生成总结/分析，脑补被删除的子任务。
      const finalPlanText = plan.subtasks
        .map(st => `${st.seq}. ${st.behavior}（${st.scenario_name}/${st.ontology_name}）`)
        .join('\n');
      parentAgent.state.messages.push({
        role: 'user',
        content: `用户在确认时修改了执行计划，以下为最终规划，请以此为准（被删除的子任务不再执行、总结中不要提及）：\n${finalPlanText}`,
        timestamp: Date.now(),
      });
    }
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '规划已确认', status: 'done', source: 'parent' });
    sendEvent({ type: 'plan_received', plan });
    const planSummary = plan.subtasks
      .sort((a, b) => a.seq - b.seq)
      .map(st => `${st.seq}. ${st.behavior} — ${st.description}（${st.scenario_name} / ${st.ontology_name}）`)
      .join('\n');
    sendEvent({ type: 'token', token: `\n📋 执行计划\n${planSummary}\n` });

    // ── 阶段2：按依赖顺序执行子任务，每完成一个反馈父Agent ──
    emitTokens = false; // 子任务执行和反馈不流到聊天区，避免重复
    let pending = this.topologicalSort(plan.subtasks);
    const results: SubTaskResult[] = [];
    let aborted = false;
    let blocked = false; // 依赖未满足导致执行终止

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.activeAbortHolder?.aborted) { aborted = true; break; }
      if (pending.length === 0) break;
      const subTask = pending[0];

      // 检查依赖：前置依赖未成功则终止执行（依赖已失败，不存在"等待完成"的可能）
      if (subTask.depends_on) {
        let depFailed = false;
        for (const dep of subTask.depends_on) {
          if (!results.find(r => r.seq === dep && r.success)) { depFailed = true; break; }
        }
        if (depFailed) {
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: `依赖子任务${subTask.depends_on}未成功执行`, status: 'failed', detail: '前置依赖失败，任务终止', source: 'child', seq: subTask.seq });
          blocked = true;
          break;
        }
      }

      // 提取元信息
      const meta = this.ontologyGateway.getBehaviorMeta(subTask.scenario_name, subTask.ontology_name, subTask.behavior);

      // 子 Agent 上下文直接取子任务自身字段：多个子任务可指向不同本体，
      const childContext: SkillContext = {
        scenario_name: subTask.scenario_name,
        scenario_id: subTask.scenario_id ?? 0,
        ontology_name: subTask.ontology_name,
        ontology_id: subTask.ontology_id,
      };

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: subTask.behavior, status: 'running', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq });

      const result = await this.subtaskRunner.run(subTask, meta, childContext, sendEvent, pushEntry);
      results.push(result);
      // 已执行的子任务从待执行列表移除，下一轮直接消费 pending[0]
      pending = pending.filter(st => st.seq !== subTask.seq);

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, result: result.summary, source: 'child', seq: subTask.seq });

      if (result.success) {
        const isLast = pending.length === 0; // 本子任务是最后一个（无后续子任务可调整，跳过中间分析）
        if (!isLast) {
          // 反馈父Agent 深入分析结果并决定后续计划
          submittedPlan.value = null; // 只识别本次分析中新提交的调整规划，避免误取历史规划
          const feedbackStart = parentAgent.state.messages.length; // 方案B：记录反馈轮起点，无调整则整体剔除
          await parentAgent.prompt(`子任务 ${subTask.seq}（${subTask.behavior}）执行完毕。

【执行结果】
${result.summary}

请分析：
1. 结果是否符合预期？有无异常或风险？
2. 后续子任务是否需要本次结果中的数据（如新生成的 ID、主键、状态等）？
3. 【提前终止判断】后续子任务是否仍有必要执行？若当前结果已使某些或全部后续子任务失去意义（例如订单已显示取消，则无需再入库/查询后续步骤），请在调整规划中删除这些失去意义的子任务（只保留仍有必要的），让流程提前结束，避免执行无意义的操作。

【数据传播（必须）】
若后续某个子任务的 params 或 guidance 依赖本次结果中产生的新数据（例：子任务 A 生成订单号、子任务 B 需要该订单号），即使本次结果完全正常，也**必须调用 submit_plan** 提交调整后的规划，把数据填入对应子任务的 params / guidance。此类新数据后续子任务无法自行查询到，只能靠你中继。
只有当所有后续子任务都不依赖本次结果、且无需任何调整时，才直接简要说明"继续执行原计划"，不要调用 submit_plan。`);
          if (this.activeAbortHolder?.aborted) { aborted = true; break; } // 反馈期间被中断 → 终止执行
          // 提取父Agent的分析结果推送到前端执行记录
          const analysisText = this.getLastAssistantMessage(parentAgent.state.messages);
          // 显式断言：submit_plan 工具回调可能在上一个 await 期间写入了新规划，
          // TS 闭包窄化无法感知，需还原为可空类型
          const adjusted = submittedPlan.value as SubTaskPlan | null;
          let analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 分析完成`;
          if (adjusted && adjusted.subtasks && adjusted.subtasks.length > 0) {
            // L3: 执行中调整规划 → 与初始规划同等的三道校验（行为名/参数结构/依赖），静默修正，不再弹窗用户确认
            const validatedB = await this.validateBehaviors(adjusted, parentAgent, submittedPlan, pushEntry);
            if (validatedB) {
              const validatedP = await this.validateParams(validatedB, parentAgent, submittedPlan, pushEntry);
              if (validatedP) {
                // 依赖校验也带 nudge（与行为名/参数一致）
                const validatedD = await this.validatePlanDeps(validatedP, parentAgent, submittedPlan, pushEntry);
                if (validatedD) {
                  analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 已调整后续计划`;
                  // 调整后的规划是权威全集：剔除已执行，重新拓扑排序。
                  // 被丢弃的子任务从待执行列表消失；新依赖关系重新生效。
                  const executedSeqs = new Set(results.map(r => r.seq));
                  pending = this.topologicalSort(validatedD.subtasks.filter(st => !executedSeqs.has(st.seq)));
                } else {
                  analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 调整规划依赖不合法，沿用原计划`;
                }
              } else {
                analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 调整规划参数不合法，沿用原计划`;
              }
            } else {
              analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 调整规划无效，沿用原计划`;
            }
          }
          // 方案B：本轮反馈未产生调整 → prompt + 回复 是上下文垃圾，整体剔除，
          // 避免父Agent 上下文被 N 个"继续执行原计划"撑爆。有调整则保留（分析有价值）。
          if (!adjusted || !adjusted.subtasks || adjusted.subtasks.length === 0) {
            parentAgent.state.messages = parentAgent.state.messages.slice(0, feedbackStart);
          }
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '子任务结果分析', status: 'done', detail: analysisDetail, result: analysisText, source: 'parent' });
        } else {
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '子任务结果分析', status: 'done', detail: '最后一个子任务，直接进入最终总结', source: 'parent' });
        }
      } else {
        aborted = result.aborted === true; // L5: 结构化标志替代字符串匹配
        sendEvent({ type: 'token', token: `\r📋 **子任务 ${subTask.seq} ${subTask.behavior}** ❌ ${result.error}\n` });
        break;
      }
    }

    // 无论成功/失败/中断，父Agent 统一生成最终总结
    let finalSummary = '执行完成';
    if (results.length > 0 || aborted || blocked) {
      const allSuccess = results.length > 0 && results.every(r => r.success);
      if (isChildAborted(parentAgent)) {
        // 父Agent 在反馈/调整阶段被打断，不能再复用其生成总结
        finalSummary = '任务已被用户中断。';
      } else if (allSuccess && !aborted && !blocked) {
        // 带上全量结果：末子任务跳过了中间分析，总结必须自包含
        const resultsText = results.map(r => `- 子任务 ${r.seq}（${r.behavior}）: ${r.summary}`).join('\n');
        await parentAgent.prompt(`所有子任务已执行完毕。\n各子任务结果：\n${resultsText}\n\n请给用户一个简洁、完整的最终总结（包括执行结果、关键数据和后续建议）。`);
        finalSummary = this.getLastAssistantMessage(parentAgent.state.messages) || '执行完成';
      } else {
        const outcomeSummary = results.length > 0
          ? results.map(r =>
              `- 子任务 ${r.seq}（${r.behavior}）: ${r.success ? '成功' : `失败 - ${r.error || '未知原因'}`}`,
            ).join('\n')
          : '（无子任务成功执行）';
        const reason = aborted ? '任务已被用户中断' : (blocked ? '因前置依赖未完成而终止' : '存在子任务执行失败');
        await parentAgent.prompt(`任务未全部完成（${reason}）。\n已执行的子任务结果：\n${outcomeSummary}\n\n请给用户一个简洁的最终说明，并严格遵守以下要求：\n1. 总结已完成的操作与结果，说明终止/失败的原因\n2. 【残留副作用必须点破】若之前的子任务已产生持久化写入（如创建/更新/删除了采购单、库存等实体），必须明确列出这些【已生效】的写操作及其实体ID/编号，并说明任务终止后它们【仍然存在、不会被自动回滚】\n3. 针对上述残留状态，给出具体的后续处理建议（例如：重新发起剩余操作 / 取消或冲销已创建的记录 / 检查状态是否正常）\n4. 给出后续建议`);
        finalSummary = this.getLastAssistantMessage(parentAgent.state.messages) || '执行未完成';
      }
    }
    sendEvent({ type: 'token', token: `\n\n${finalSummary}` });
    sendEvent({ type: 'done' });
    return finalSummary;
  }

  /** 按 depends_on 拓扑排序 */
  private topologicalSort(subtasks: SubTask[]): SubTask[] {
    const sorted: SubTask[] = [];
    const visited = new Set<number>();
    const visit = (seq: number) => {
      if (visited.has(seq)) return;
      visited.add(seq);
      const st = subtasks.find(s => s.seq === seq);
      if (!st) return;
      if (st.depends_on) for (const d of st.depends_on) visit(d);
      sorted.push(st);
    };
    for (const st of subtasks) visit(st.seq);
    return sorted;
  }

  /** 校验子任务行为名合法性；非法时提示父Agent 自动修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateBehaviors(
    plan: SubTaskPlan,
    parentAgent: any,
    submittedPlan: { value: SubTaskPlan | null },
    pushEntry: (e: ExecutionEntry) => void,
  ): Promise<SubTaskPlan | null> {
    const invalid = validateBehaviorNames(this.ontologyGateway, plan);
    if (invalid.length === 0) return plan;

    const invalidNames = invalid.map(iv => `子任务${iv.sub.seq}: ${iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、');
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名校验', status: 'failed', detail: `不存在的 behavior: ${invalidNames}`, source: 'parent' });
    const allValid = [...new Set(invalid.flatMap(iv => iv.valid))].join(', ');
    submittedPlan.value = null; // 只认本次修正后的新提交
    await parentAgent.prompt(`以下子任务的 behavior 名称不在其所属场景/本体的行为集合中：${invalidNames}。\n合法行为有：${allValid}。\n请重新调用 submit_plan 工具提交修正后的规划。`);
    // 显式断言：submit_plan 回调可能在上一个 await 期间写入了新规划，TS 闭包窄化无法感知
    const corrected = submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    if (validateBehaviorNames(this.ontologyGateway, corrected).length > 0) return null;
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名已修正', status: 'done', source: 'parent' });
    return corrected;
  }

  /** 参数结构校验：必填参数 key 齐全 + 类型匹配；非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validateParams(
    plan: SubTaskPlan,
    parentAgent: any,
    submittedPlan: { value: SubTaskPlan | null },
    pushEntry: (e: ExecutionEntry) => void,
  ): Promise<SubTaskPlan | null> {
    const firstErrors = validateParamsStructure(this.ontologyGateway, plan);
    if (firstErrors.length === 0) return plan;

    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '参数结构校验', status: 'failed', detail: firstErrors.join('；'), source: 'parent' });
    submittedPlan.value = null; // 只认本次修正后的新提交
    await parentAgent.prompt(`以下子任务的参数结构不合法，缺少必填参数：\n${firstErrors.join('；')}\n\n请先重新加载相关技能（load_skill）获取每个行为的完整参数结构，确保每个子任务的 params 包含该行为声明的【全部必填参数】（type/required/description/value 齐全，用户已提供的填入 value，缺失的留空字符串），保持行为与整体规划不变，然后重新调用 submit_plan 提交修正后的规划。`);
    const corrected = submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    if (validateParamsStructure(this.ontologyGateway, corrected).length > 0) return null;
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '参数结构已修正', status: 'done', source: 'parent' });
    return corrected;
  }

  /** 依赖结构校验（无自引用/无悬空依赖/无环）：非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  private async validatePlanDeps(
    plan: SubTaskPlan,
    parentAgent: any,
    submittedPlan: { value: SubTaskPlan | null },
    pushEntry: (e: ExecutionEntry) => void,
  ): Promise<SubTaskPlan | null> {
    const firstErrors = validatePlanStructure(plan);
    if (firstErrors.length === 0) return plan;

    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '依赖结构校验', status: 'failed', detail: firstErrors.join('；'), source: 'parent' });
    submittedPlan.value = null; // 只认本次修正后的新提交
    await parentAgent.prompt(`以下子任务的依赖关系不合法：\n${firstErrors.join('；')}\n\n请重新检查 depends_on（不能依赖自身、不能引用不存在的子任务、不能形成循环依赖），保持行为与参数不变，然后重新调用 submit_plan 提交修正后的规划。`);
    const corrected = submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    if (validatePlanStructure(corrected).length > 0) return null;
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '依赖结构已修正', status: 'done', source: 'parent' });
    return corrected;
  }

  private getLastAssistantMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && !m.errorMessage) {
        return contentToText(m.content);
      }
    }
    return '';
  }

}
