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

import { randomUUID } from 'node:crypto';
import { AgentFactory } from './agent-factory.js';
import { OntologyGateway } from '../services/ontology-gateway.js';
import { contentToText, toolResultToText } from './text-utils.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, BehaviorMeta, SubTask, SSEEvent, ExecutionEntry, SkillContext, SkillSelection,
} from '../types.js';

const MAX_RETRIES = 3;
const MAX_ROUNDS = 20;
const CONFIRM_TIMEOUT = 60000;
const MAX_PLAN_ROUNDS = 3; // 规划确认"拒绝并重规划"的最大轮数，防止无限循环

// ─── ConfirmManager ──────────────────────────

/** 确认结果来源：用户主动操作 / 超时 / 中断 */
export interface ConfirmResult {
  approved: boolean;
  params?: Record<string, any>;
  reason?: 'user' | 'timeout' | 'abort';
}

export interface PlanConfirmResult {
  approved: boolean;
  plan?: SubTaskPlan;
  /** 拒绝时的动作：退出 or 让父Agent重规划 */
  rejectAction?: 'exit' | 'replan';
  /** 拒绝并重规划时用户附带的具体建议 */
  suggestion?: string;
  reason?: 'user' | 'timeout' | 'abort';
}

export class ConfirmManager {
  private pending = new Map<string, {
    resolve: (v: ConfirmResult) => void;
    timer: NodeJS.Timeout;
  }>();
  private planPending = new Map<string, {
    resolve: (v: PlanConfirmResult) => void;
    timer: NodeJS.Timeout;
  }>();

  async requestConfirm(behavior: string, content: string, params: Record<string, any> | undefined, sendEvent: (e: SSEEvent) => void): Promise<ConfirmResult> {
    const confirmId = randomUUID();
    sendEvent({ type: 'confirm', confirmId, behavior, content, params } as any);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(confirmId); resolve({ approved: false, reason: 'timeout' }); }, CONFIRM_TIMEOUT);
      this.pending.set(confirmId, { resolve, timer });
    });
  }

  handleConfirm(confirmId: string, approved: boolean, params?: Record<string, any>): void {
    const entry = this.pending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(confirmId);
    entry.resolve({ approved, params, reason: 'user' });
  }

  async requestPlanConfirm(plan: SubTaskPlan, sendEvent: (e: SSEEvent) => void): Promise<PlanConfirmResult> {
    const confirmId = randomUUID();
    sendEvent({ type: 'plan_confirm', confirmId, plan } as any);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.planPending.delete(confirmId); resolve({ approved: false, reason: 'timeout' }); }, CONFIRM_TIMEOUT);
      this.planPending.set(confirmId, { resolve, timer });
    });
  }

  handlePlanConfirm(confirmId: string, approved: boolean, plan?: SubTaskPlan, opts?: { rejectAction?: 'exit' | 'replan'; suggestion?: string }): void {
    const entry = this.planPending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.planPending.delete(confirmId);
    entry.resolve({ approved, plan, ...opts, reason: 'user' });
  }

  /**
   * 中断：立即拒绝所有待确认的规划/安全管控弹窗（reason='abort'）。
   * 注：ConfirmManager 与 Orchestrator 同属单例，假定同一时刻只有一个活动对话。
   */
  abortAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ approved: false, reason: 'abort' });
    }
    for (const [id, entry] of this.planPending) {
      clearTimeout(entry.timer);
      this.planPending.delete(id);
      entry.resolve({ approved: false, reason: 'abort' });
    }
  }
}

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  private confirmManager = new ConfirmManager();
  private currentChildAgent: any = null;
  private currentParentAgent: any = null;
  /** 当前 run 的中断标记（单例假定时序，同 execute 的生命周期内有效） */
  private activeAbortHolder: { aborted: boolean } | null = null;

  constructor(
    private agentFactory: AgentFactory,
    private ontologyGateway: OntologyGateway,
  ) {}

  getConfirmManager(): ConfirmManager { return this.confirmManager; }

  /**
   * 中断当前执行：置位 run 级 abort 标记 + 中断在途的子/父 Agent + 拒绝所有待确认弹窗。
   * 覆盖：子任务执行、安全管控弹窗、规划确认弹窗、父Agent 规划/反馈阶段。
   */
  abort(): void {
    if (this.activeAbortHolder) this.activeAbortHolder.aborted = true;
    if (this.currentChildAgent) {
      try { this.currentChildAgent.abort(); } catch {}
      this.currentChildAgent = null;
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
    const pushEntry = (entry: ExecutionEntry) => sendEvent({ type: 'exec_entry', entry } as any);

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
    if (this.activeAbortHolder?.aborted || this.isChildAborted(parentAgent)) {
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
        sendEvent({ type: 'error', message: '规划格式异常，请重新描述需求或重试。' });
        sendEvent({ type: 'done' });
        return '无法生成执行计划，请重新描述需求或重试。';
      }
      if (lastMsg) {
        sendEvent({ type: 'done' });
        return lastMsg;
      }
      sendEvent({ type: 'error', message: '无法生成执行计划，请重新描述需求或重试。' });
      sendEvent({ type: 'done' });
      return '无法生成执行计划，请重新描述需求或重试。';
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
        sendEvent({ type: 'error', message: '无法生成有效的执行计划' });
        return '无法生成有效的执行计划，请重新描述需求。';
      }
      plan = validated;

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
      const parentAborted = this.isChildAborted(parentAgent);
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
      if (!this.isChildAborted(parentAgent)) {
        await parentAgent.prompt(`用户确认的规划中没有任何子任务（可能已在确认时全部删除），尚未执行任何子任务。请用一两句话简短确认已取消。`);
      }
      const reply = this.getLastAssistantMessage(parentAgent.state.messages) || '规划为空，已取消执行';
      sendEvent({ type: 'done' });
      return reply;
    }

    // 结构校验：依赖存在性 / 无自引用 / 无环（纯代码，不弹窗，兜底前端已做的校验）
    const structureErrors = this.validatePlanStructure(plan);
    if (structureErrors.length > 0) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划结构校验', status: 'failed', detail: structureErrors.join('；'), source: 'parent' });
      sendEvent({ type: 'error', message: `规划结构不合法：${structureErrors.join('；')}` });
      sendEvent({ type: 'done' });
      return '规划结构不合法，请重新发起。';
    }
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划结构校验', status: 'done', detail: '依赖关系合法', source: 'parent' });

    // 确认通过且结构合法后，用【最终规划】输出执行记录与聊天区摘要（用户编辑过则展示编辑后的版本）
    if (planModified) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
    }
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '规划已确认', status: 'done', source: 'parent' });
    sendEvent({ type: 'plan_received', plan } as any);
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
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: `依赖子任务${subTask.depends_on}未成功执行`, status: 'failed', detail: '前置依赖失败，任务终止', source: 'child' });
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

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: subTask.behavior, status: 'running', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child' });
      // 聊天区域显示"正在执行"
      sendEvent({ type: 'token', token: `\n**子任务 ${subTask.seq}：${subTask.behavior} 正在执行...**\n` });

      const result = await this.runSubTask(subTask, meta, childContext, sendEvent, pushEntry);
      results.push(result);
      // 已执行的子任务从待执行列表移除，下一轮直接消费 pending[0]
      pending = pending.filter(st => st.seq !== subTask.seq);

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, result: result.summary, source: 'child' });

      if (result.success) {
        sendEvent({ type: 'token', token: `\n${result.summary}\n` });
        sendEvent({ type: 'token', token: `✅ **子任务 ${subTask.seq} ${subTask.behavior}**\n` });

        const isLast = pending.length === 0; // 本子任务是最后一个（无后续子任务可调整，跳过中间分析）
        if (!isLast) {
          // 反馈父Agent 深入分析结果并决定后续计划
          submittedPlan.value = null; // 只识别本次分析中新提交的调整规划，避免误取历史规划
          await parentAgent.prompt(`子任务 ${subTask.seq}（${subTask.behavior}）执行完毕。

【执行结果】
${result.summary}

请简要分析：
1. 结果是否符合预期？有无异常或风险？
2. 对后续子任务有何影响？

若结果正常、无需调整，直接简要说明"继续执行原计划"即可，不要调用 submit_plan。
仅当结果出现异常、需要修改后续子任务时，才调用 submit_plan 提交调整后的规划。`);
          if (this.activeAbortHolder?.aborted) { aborted = true; break; } // 反馈期间被中断 → 终止执行
          // 提取父Agent的分析结果推送到前端执行记录
          const analysisText = this.getLastAssistantMessage(parentAgent.state.messages);
          // 显式断言：submit_plan 工具回调可能在上一个 await 期间写入了新规划，
          // TS 闭包窄化无法感知，需还原为可空类型
          const adjusted = submittedPlan.value as SubTaskPlan | null;
          let analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 分析完成`;
          if (adjusted && adjusted.subtasks && adjusted.subtasks.length > 0) {
            // L3: 执行中调整规划 → 行为名校验（静默修正一次，不再弹窗用户确认）
            const validated = await this.validateBehaviors(adjusted, parentAgent, submittedPlan, pushEntry);
            if (validated) {
              analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 已调整后续计划`;
              // 调整后的规划是权威全集：剔除已执行，重新拓扑排序。
              // 被丢弃的子任务从待执行列表消失；新依赖关系重新生效。
              const executedSeqs = new Set(results.map(r => r.seq));
              pending = this.topologicalSort(validated.subtasks.filter(st => !executedSeqs.has(st.seq)));
            } else {
              analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 调整规划无效，沿用原计划`;
            }
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
      if (this.isChildAborted(parentAgent)) {
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
        const reason = aborted ? '任务被用户中断或拒绝' : (blocked ? '存在前置依赖未完成' : '存在子任务执行失败');
        await parentAgent.prompt(`任务未全部完成（${reason}）。\n已执行的子任务结果：\n${outcomeSummary}\n\n请给用户一个简洁的最终说明：总结已完成的操作与结果、说明终止/失败的原因，并给出后续建议。`);
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
    const invalid: { sub: SubTask; valid: string[] }[] = [];
    for (const st of plan.subtasks) {
      const names = this.ontologyGateway.getBehaviorNames(st.scenario_name, st.ontology_name);
      if (!names.includes(st.behavior)) invalid.push({ sub: st, valid: names });
    }
    if (invalid.length === 0) return plan;

    const invalidNames = invalid.map(iv => `子任务${iv.sub.seq}: ${iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、');
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名校验', status: 'failed', detail: `不存在的 behavior: ${invalidNames}`, source: 'parent' });
    const allValid = [...new Set(invalid.flatMap(iv => iv.valid))].join(', ');
    submittedPlan.value = null; // 只认本次修正后的新提交
    await parentAgent.prompt(`以下子任务的 behavior 名称不在其所属场景/本体的行为集合中：${invalidNames}。\n合法行为有：${allValid}。\n请重新调用 submit_plan 工具提交修正后的规划。`);
    // 显式断言：submit_plan 回调可能在上一个 await 期间写入了新规划，TS 闭包窄化无法感知
    const corrected = submittedPlan.value as SubTaskPlan | null;
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    const stillInvalid: { sub: SubTask; valid: string[] }[] = [];
    for (const st of corrected.subtasks) {
      const names = this.ontologyGateway.getBehaviorNames(st.scenario_name, st.ontology_name);
      if (!names.includes(st.behavior)) stillInvalid.push({ sub: st, valid: names });
    }
    if (stillInvalid.length > 0) return null;
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名已修正', status: 'done', source: 'parent' });
    return corrected;
  }

  /** 校验规划结构：依赖存在性 / 无自引用 / 无环。返回错误列表（空数组 = 通过）。 */
  private validatePlanStructure(plan: SubTaskPlan): string[] {
    const errors: string[] = [];
    const seqs = new Set(plan.subtasks.map(st => st.seq));
    for (const st of plan.subtasks) {
      if (!st.depends_on || st.depends_on.length === 0) continue;
      for (const dep of st.depends_on) {
        if (dep === st.seq) errors.push(`子任务 ${st.seq} 不能依赖自身`);
        else if (!seqs.has(dep)) errors.push(`子任务 ${st.seq} 依赖的子任务 ${dep} 不存在（可能已被删除）`);
      }
    }
    // 环检测（DFS 三色标记：0 未访问 / 1 访问中 / 2 已访问）
    const color = new Map<number, 0 | 1 | 2>();
    const visit = (seq: number): boolean => {
      const c = color.get(seq) ?? 0;
      if (c === 1) return true;
      if (c === 2) return false;
      color.set(seq, 1);
      const st = plan.subtasks.find(s => s.seq === seq);
      if (st?.depends_on) {
        for (const d of st.depends_on) if (visit(d)) return true;
      }
      color.set(seq, 2);
      return false;
    };
    for (const st of plan.subtasks) {
      if (visit(st.seq)) { errors.push('子任务依赖关系存在循环，请调整依赖设置'); break; }
    }
    return errors;
  }

  /**
   * 检测子 Agent 是否被用户中断。
   * pi-agent-core 的中断不会让 prompt() 抛错，而是正常 resolve：
   * 最后一条 assistant 消息 stopReason='aborted'，且 state.errorMessage 含 'abort'。
   */
  private isChildAborted(agent: any): boolean {
    const err = agent.state?.errorMessage;
    if (err && /abort/i.test(err)) return true;
    const msgs: any[] = agent.state?.messages ?? [];
    const last = msgs[msgs.length - 1];
    return !!(last && last.role === 'assistant' && last.stopReason === 'aborted');
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

  /** 执行单个子任务 */
  private async runSubTask(
    subTask: SubTask, meta: BehaviorMeta,
    context: SkillContext,
    sendEvent: (e: SSEEvent) => void, pushEntry: (e: ExecutionEntry) => void,
  ): Promise<SubTaskResult> {
    // 安全管控（含参数审核）
    if (meta.security) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'running', detail: meta.security.audit_content, params: subTask.params });
      const confirmResult = await this.confirmManager.requestConfirm(subTask.behavior, meta.security.audit_content, subTask.params, sendEvent);
      if (!confirmResult.approved) {
        const aborted = confirmResult.reason !== 'timeout'; // 用户拒绝/中断 → aborted；超时 → 常规失败
        return {
          seq: subTask.seq, behavior: subTask.behavior, success: false,
          error: confirmResult.reason === 'timeout' ? '安全管控确认超时'
            : confirmResult.reason === 'abort' ? '用户中断'
            : '用户拒绝安全管控',
          summary: '',
          aborted,
        };
      }
      if (confirmResult.params) {
        subTask.params = confirmResult.params;
      }
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'done', detail: '用户已确认', params: subTask.params });
    }

    // 组装指令（subTask.params 可能已被用户确认时修改）
    const instruction = this.buildInstruction(subTask, meta);
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_input', name: subTask.behavior, status: 'running', detail: instruction, params: subTask.params, source: 'child' });
    let lastError = '';
    // 记录本次子任务期间【任意一次】工具执行是否报错（isError）。
    // 用累积而非"最近一次"：子任务可能多次调工具，中间失败后最后成功也会被判失败。
    let anyToolError = false;

    // 复用同一个子 Agent 实例做重试：失败原因、工具结果保留在上下文中，LLM 能自纠
    // opId 每子任务一个、跨重试稳定：主行为写操作带 op_key 走后端幂等，重试不重复执行
    const opId = randomUUID();
    const childAgent = await this.agentFactory.createChildAgent(context, subTask.behavior, opId);
    this.currentChildAgent = childAgent;
    // 订阅事件都会携带当前 run 的 abort signal；被中断时最后一条事件（agent_end）必能看到 signal.aborted。
    // 用它覆盖"工具调用进行中"场景——该场景最后一条消息的 stopReason 不是 'aborted'，isChildAborted 会漏判。
    let userAborted = false;
    childAgent.subscribe((event: any, signal: AbortSignal) => {
      if (signal?.aborted) userAborted = true;
      if (event.type === 'tool_execution_start') {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: event.toolName, status: 'running', params: event.args, source: 'child' });
      } else if (event.type === 'tool_execution_end') {
        const text = toolResultToText(event.result?.content);
        if (event.isError) anyToolError = true;
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: event.toolName, status: 'done', result: text, source: 'child' });
      }
    });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      anyToolError = false; // 每次重试重置工具错误信号
      try {
        // 首次传入完整指令；重试时指令已在上下文中，只需让 LLM 参考上次过程自纠
        await childAgent.prompt(attempt === 0
          ? instruction
          : `你上一次执行失败了（${lastError}）。\n请参考上一次的执行过程和工具结果，分析失败原因，修正参数或执行方式后重新执行，并输出最终结果。`);
        // pi-agent-core 的中断不会让 prompt() 抛错，而是正常 resolve（最后一条消息 stopReason='aborted'）。
        // 必须显式检测，否则中断会被 extractResult 误判为成功、或走重试逻辑重新执行。
        if (userAborted || this.isChildAborted(childAgent)) {
          this.currentChildAgent = null;
          return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '用户中断执行', summary: '', aborted: true };
        }
        const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior, anyToolError);
        if (result.success) { this.currentChildAgent = null; return result; }
        // 仅工具调用真实失败才重试（瞬态错误，配合 op_key 幂等安全）；
        // LLM 自报失败（如查询结果为空、结果不符合预期）不重试，直接按失败返回，避免"换着法子空转"。
        if (!anyToolError) {
          this.currentChildAgent = null;
          return {
            seq: subTask.seq, behavior: subTask.behavior, success: false,
            error: result.summary || '执行未成功', summary: result.summary,
          };
        }
        lastError = result.error || result.summary || '执行失败';
      } catch (e: any) {
        if (e.name === 'AbortError' || (e.message && e.message.includes('abort'))) {
          this.currentChildAgent = null;
          return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '用户中断执行', summary: '', aborted: true };
        }
        lastError = e.message;
      }

      if (attempt < MAX_RETRIES - 1) {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: `重试 ${attempt + 1}/${MAX_RETRIES}`, status: 'running', detail: lastError });
      }
    }

    this.currentChildAgent = null;
    return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: `重试 ${MAX_RETRIES} 次后失败: ${lastError}`, summary: '' };
  }

  /** 组装子任务指令 */
  private buildInstruction(subTask: SubTask, meta: BehaviorMeta): string {
    let text = `## 子任务 ${subTask.seq}\n`;
    text += `描述: ${subTask.description}\n`;
    text += `行为: ${subTask.behavior}\n`;
    text += `场景: ${subTask.scenario_name}\n`;
    text += `本体: ${subTask.ontology_name}\n`;
    text += `本体ID: ${subTask.ontology_id}\n`;
    if (subTask.guidance) {
      text += `\n### 执行指导\n${subTask.guidance}\n`;
    }

    text += `\n### 参数\n`;
    const rawParams = subTask.params || {};
    const paramKeys = Object.keys(rawParams);
    if (paramKeys.length > 0) {
      paramKeys.forEach(k => {
        const p = rawParams[k] || {};
        const pType = typeof p === 'object' ? (p.type || 'any') : 'any';
        const pRequired = typeof p === 'object' && p.required ? '* ' : '  ';
        const pDesc = typeof p === 'object' ? (p.description || '') : '';
        const pVal = typeof p === 'object' ? (p.value !== undefined && p.value !== '' ? `✅ ${p.value}` : '← 待补充') : `✅ ${p}`;
        text += `  ${pRequired}${k}: ${pType} — ${pDesc} ${pVal}\n`;
      });
    } else {
      text += `  （父 Agent 未提供详细参数）\n`;
    }

    if (meta.preRules.length > 0) {
      text += `\n### 前置规则（执行前必须全部验证通过）\n`;
      meta.preRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) text += `  需要接口: ${r.data_supplements.join(', ')}\n`;
      });
    }

    if (meta.security) {
      text += `\n### 安全管控\n本行为的安全管控已由系统在用户侧完成确认，请直接执行，无需再向用户询问。\n审核内容: ${meta.security.audit_content}\n`;
    }

    if (meta.postRules.length > 0) {
      text += `\n### 后置规则（执行后进行推理验证）\n`;
      meta.postRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) text += `  需要接口: ${r.data_supplements.join(', ')}\n`;
      });
    }

    if (meta.concepts.length > 0) {
      text += `\n### 关联概念属性\n`;
      meta.concepts.forEach(c => {
        text += `  ${c.name} (${c.display_name}): ${c.attributes.map(a => a.name).join(', ')}\n`;
      });
    }

    return text;
  }

  /** 提取子任务执行结果 */
  private extractResult(messages: any[], seq: number, behavior: string, toolErrored = false): SubTaskResult {
    const last = [...messages].reverse().find((m: any) => m.role === 'assistant' && !m.errorMessage);
    const content = last ? contentToText(last.content) : '';
    // 双信号判定：
    //   ① 取【状态】标记的【最后一个】为准（子 Agent 回复可能多次出现，最后一个是最终结论）
    //   ② 本次子任务期间任意一次工具调用真实报错（isError）→ 失败（堵住 LLM 幻觉 / 漏写标记）
    const statusMatches = content.match(/【状态】(成功|失败)/g) || [];
    const statusFailed = statusMatches.length > 0 && statusMatches[statusMatches.length - 1] === '【状态】失败';
    const success = !statusFailed && !toolErrored;
    return {
      seq, behavior,
      success,
      summary: content.replace(/【状态】(成功|失败)/g, '').trim(),
    };
  }

}
