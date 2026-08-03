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

// ─── ConfirmManager ──────────────────────────

/** 确认结果来源：用户主动操作 or 超时 */
export interface ConfirmResult {
  approved: boolean;
  params?: Record<string, any>;
  reason?: 'user' | 'timeout';
}

export interface PlanConfirmResult {
  approved: boolean;
  plan?: SubTaskPlan;
  reason?: 'user' | 'timeout';
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

  handlePlanConfirm(confirmId: string, approved: boolean, plan?: SubTaskPlan): void {
    const entry = this.planPending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.planPending.delete(confirmId);
    entry.resolve({ approved, plan, reason: 'user' });
  }
}

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  private confirmManager = new ConfirmManager();
  private currentChildAgent: any = null;

  constructor(
    private agentFactory: AgentFactory,
    private ontologyGateway: OntologyGateway,
  ) {}

  getConfirmManager(): ConfirmManager { return this.confirmManager; }

  /** 中断当前子 Agent 执行 */
  abort(): void {
    if (this.currentChildAgent) {
      try { this.currentChildAgent.abort(); } catch {}
      this.currentChildAgent = null;
    }
  }

  async execute(
    message: string,
    skills: SkillSelection[],
    history: ThreadMessage[],
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    try {
      return await this.runExecute(message, skills, history, sendEvent);
    } finally {
      // 编排结束（无论成功/失败/中断）释放 MCP 连接，避免跨子任务累积泄漏
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
    parentAgent.subscribe((event: any) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta' && emitTokens) {
        sendEvent({ type: 'token', token: event.assistantMessageEvent.delta });
      }
    });

    let plan: SubTaskPlan | null = null;

    // 单轮 prompt：判断是否需要加载技能，然后直接回答或通过 submit_plan 提交规划
    await parentAgent.prompt(`${message}`);

//     await parentAgent.prompt(`用户: ${message}
// 先判断需求类型：
// - 问候/寒暄 → 直接文字回复；
// - 本体/场景结构查询 → 直接调用相关 MCP 工具回答，不要提交规划；
// - 业务数据查询或执行操作 → 先调用 load_skill加载好需要的技能（可能是多个），再调用 submit_plan 提交子任务规划。`);
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

    // 校验：提交规划前必须已加载全部选中技能（prompt 是软约束，这里硬兜底）。
    // 缺技能就规划，behavior 名/参数结构可能基于不完整知识，靠这个闭环补齐（最多修正 1 次）。
    if (skills.length > 0 && loadedSkillNames.length < skills.length) {
      const missing = skills.filter(s => !loadedSkillNames.includes(s.name)).map(s => s.name).join('、');
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '技能加载校验', status: 'failed', detail: `规划前未加载技能: ${missing}`, source: 'parent' });
      submittedPlan.value = null; // 只认补齐后重新提交的规划
      await parentAgent.prompt(`你提交规划前尚未加载全部选中技能的完整知识。缺失：${missing}。\n请先用 load_skill 补齐这些技能，全部加载完成后重新调用 submit_plan 提交规划。`);
      const reloaded = submittedPlan.value as SubTaskPlan | null;
      if (!reloaded || !reloaded.subtasks || reloaded.subtasks.length === 0 || skills.some(s => !loadedSkillNames.includes(s.name))) {
        sendEvent({ type: 'error', message: '技能加载不完整，无法生成有效规划' });
        sendEvent({ type: 'done' });
        return '技能加载不完整，无法生成有效规划，请重试。';
      }
      plan = reloaded;
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '技能加载完成', status: 'done', detail: `已补齐 ${missing}`, source: 'parent' });
    }

    // 校验 behavior 名称合法性（最多修正 1 次）
    const invalid: { sub: SubTask; valid: string[] }[] = [];
    for (const st of plan.subtasks) {
      const names = this.ontologyGateway.getBehaviorNames(st.scenario_name, st.ontology_name);
      if (!names.includes(st.behavior)) invalid.push({ sub: st, valid: names });
    }
    if (invalid.length > 0) {
      const invalidNames = invalid.map(iv => `子任务${iv.sub.seq}: ${iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、');
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名校验', status: 'failed', detail: `不存在的 behavior: ${invalidNames}`, source: 'parent' });
      const allValid = [...new Set(invalid.flatMap(iv => iv.valid))].join(', ');
      submittedPlan.value = null; // 只认本次修正后的新提交
      await parentAgent.prompt(`以下子任务的 behavior 名称不在其所属场景/本体的行为集合中：${invalidNames}。\n合法行为有：${allValid}。\n请重新调用 submit_plan 工具提交修正后的规划。`);
      // 显式断言：submit_plan 回调可能在上一个 await 期间写入了新规划，TS 闭包窄化无法感知
      const corrected = submittedPlan.value as SubTaskPlan | null;
      if (corrected && corrected.subtasks && corrected.subtasks.length > 0) {
        const stillInvalid: { sub: SubTask; valid: string[] }[] = [];
        for (const st of corrected.subtasks) {
          const names = this.ontologyGateway.getBehaviorNames(st.scenario_name, st.ontology_name);
          if (!names.includes(st.behavior)) stillInvalid.push({ sub: st, valid: names });
        }
        if (stillInvalid.length === 0) {
          plan = corrected;
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名已修正', status: 'done', source: 'parent' });
        } else {
          const stillNames = stillInvalid.map(iv => `${iv.sub.behavior}(${iv.sub.scenario_name}/${iv.sub.ontology_name})`).join('、');
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '行为名修正失败', status: 'failed', detail: `仍有非法行为: ${stillNames}`, source: 'parent' });
          sendEvent({ type: 'error', message: '无法生成有效的执行计划' });
          return '无法生成有效的执行计划，请重新描述需求。';
        }
      } else if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) {
        sendEvent({ type: 'error', message: '行为名修正失败，无法继续执行' });
        return '行为名修正失败，无法继续执行';
      }
    }

    sendEvent({ type: 'plan_received', plan } as any);
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '父Agent规划完成', status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
    sendEvent({ type: 'token', token: `✅ 校验通过：${plan.subtasks.length} 个行为名称合法\n` });

    // 聊天区显示简洁规划摘要
    const planSummary = plan.subtasks
      .sort((a, b) => a.seq - b.seq)
      .map(st => `${st.seq}. ${st.behavior} — ${st.description}（${st.scenario_name} / ${st.ontology_name}）`)
      .join('\n');
    sendEvent({ type: 'token', token: `\n📋 执行计划\n${planSummary}\n` });

    // ── 规划确认（弹窗让用户审核规划） ──
    const planConfirm = await this.confirmManager.requestPlanConfirm(plan, sendEvent);
    if (!planConfirm.approved) {
      const reasonText = planConfirm.reason === 'timeout' ? '规划确认超时' : '用户拒绝执行规划';
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划审核', status: 'failed', detail: reasonText, source: 'parent' });
      // 用户拒绝/超时 → 父Agent 给一两句极简收尾说明（emitTokens 仍为 true，回复会流式显示）
      await parentAgent.prompt(`用户拒绝了本次执行计划（${reasonText}），尚未执行任何子任务。请用一两句话简短确认已取消，并提示用户可如何调整后重新发起。`);
      const reply = this.getLastAssistantMessage(parentAgent.state.messages)
        || (planConfirm.reason === 'timeout' ? '规划确认超时，已取消执行' : '用户已拒绝执行规划');
      sendEvent({ type: 'done' });
      return reply;
    }
    if (planConfirm.plan) {
      plan = planConfirm.plan;
      sendEvent({ type: 'plan_received', plan } as any);
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '规划已修改', status: 'done', detail: `用户修改了规划，共 ${plan.subtasks.length} 个子任务`, source: 'parent' });
    }
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '规划已确认', status: 'done', source: 'parent' });

    // ── 阶段2：按依赖顺序执行子任务，每完成一个反馈父Agent ──
    emitTokens = false; // 子任务执行和反馈不流到聊天区，避免重复
    const sorted = this.topologicalSort(plan.subtasks);
    const results: SubTaskResult[] = [];
    let aborted = false;
    let blocked = false; // 依赖未满足导致执行终止

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const currentIdx = results.length;
      if (currentIdx >= sorted.length) break;
      const subTask = sorted[currentIdx];

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

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: subTask.behavior, status: 'running', detail: subTask.description, params: subTask.params, source: 'child' });
      // 聊天区域显示"正在执行"
      sendEvent({ type: 'token', token: `\n**子任务 ${subTask.seq}：${subTask.behavior} 正在执行...**\n` });

      const result = await this.runSubTask(subTask, meta, childContext, sendEvent, pushEntry);
      results.push(result);

      const shortStatus = result.success ? '✅ 执行完成' : '❌ 执行失败';
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: `${shortStatus} — ${result.summary.slice(0, 80)}`, result: result.summary, source: 'child' });

      if (result.success) {
        sendEvent({ type: 'token', token: `\n${result.summary}\n` });
        sendEvent({ type: 'token', token: `✅ **子任务 ${subTask.seq} ${subTask.behavior}**\n` });

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
        // 提取父Agent的分析结果推送到前端执行记录
        const analysisText = this.getLastAssistantMessage(parentAgent.state.messages);
        // 显式断言：submit_plan 工具回调可能在上一个 await 期间写入了新规划，
        // TS 闭包窄化无法感知，需还原为可空类型
        const adjusted = submittedPlan.value as SubTaskPlan | null;
        let analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 分析完成`;
        if (adjusted && adjusted.subtasks && adjusted.subtasks.length > 0) {
          analysisDetail = `子任务 ${subTask.seq} ${subTask.behavior} 已调整后续计划`;
          for (const adjSubtasks of adjusted.subtasks) {
            if (!results.find(r => r.seq === adjSubtasks.seq)) {
              const idx = sorted.findIndex(s => s.seq === adjSubtasks.seq);
              if (idx >= 0) sorted[idx] = adjSubtasks;
              else sorted.push(adjSubtasks);
            }
          }
        }
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '子任务结果分析', status: 'done', detail: analysisDetail, result: analysisText, source: 'parent' });
      } else {
        aborted = !!(result.error?.includes('中断') || result.error?.includes('拒绝'));
        sendEvent({ type: 'token', token: `\r📋 **子任务 ${subTask.seq} ${subTask.behavior}** ❌ ${result.error}\n` });
        break;
      }
    }

    // 无论成功/失败/中断，父Agent 统一生成最终总结
    let finalSummary = '执行完成';
    if (results.length > 0 || aborted || blocked) {
      const allSuccess = results.length > 0 && results.every(r => r.success);
      if (allSuccess && !aborted && !blocked) {
        await parentAgent.prompt(`所有子任务已执行完毕。请给用户一个简洁、完整的最终总结（包括执行结果、关键数据和后续建议）。`);
      } else {
        const outcomeSummary = results.length > 0
          ? results.map(r =>
              `- 子任务 ${r.seq}（${r.behavior}）: ${r.success ? '成功' : `失败 - ${r.error || '未知原因'}`}`,
            ).join('\n')
          : '（无子任务成功执行）';
        const reason = aborted ? '任务被用户中断或拒绝' : (blocked ? '存在前置依赖未完成' : '存在子任务执行失败');
        await parentAgent.prompt(`任务未全部完成（${reason}）。\n已执行的子任务结果：\n${outcomeSummary}\n\n请给用户一个简洁的最终说明：总结已完成的操作与结果、说明终止/失败的原因，并给出后续建议。`);
      }
      finalSummary = this.getLastAssistantMessage(parentAgent.state.messages) || (allSuccess ? '执行完成' : '执行未完成');
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
        return {
          seq: subTask.seq, behavior: subTask.behavior, success: false,
          error: confirmResult.reason === 'timeout' ? '安全管控确认超时' : '用户拒绝安全管控',
          summary: '',
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
    // 记录最近一次工具执行是否报错（isError），用于双信号判定子任务成败
    let lastToolError = false;

    // 复用同一个子 Agent 实例做重试：失败原因、工具结果保留在上下文中，LLM 能自纠
    const childAgent = await this.agentFactory.createChildAgent(context);
    this.currentChildAgent = childAgent;
    childAgent.subscribe((event: any) => {
      if (event.type === 'tool_execution_start') {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: event.toolName, status: 'running', params: event.args, source: 'child' });
      } else if (event.type === 'tool_execution_end') {
        const text = toolResultToText(event.result?.content);
        lastToolError = !!event.isError;
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: event.toolName, status: 'done', result: text, source: 'child' });
      }
    });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      lastToolError = false; // 每次重试重置工具错误信号
      try {
        // 首次传入完整指令；重试时指令已在上下文中，只需让 LLM 参考上次过程自纠
        await childAgent.prompt(attempt === 0
          ? instruction
          : `你上一次执行失败了（${lastError}）。\n请参考上一次的执行过程和工具结果，分析失败原因，修正参数或执行方式后重新执行，并输出最终结果。`);
        const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior, lastToolError);
        if (result.success) return result;
        lastError = result.error || (result.summary ? result.summary.slice(0, 200) : '') || '执行失败';
      } catch (e: any) {
        if (e.name === 'AbortError' || (e.message && e.message.includes('abort'))) {
          this.currentChildAgent = null;
          return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '用户中断执行', summary: '' };
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
    //   ① 文字标记明确写【状态】失败 → 失败
    //   ② 文字未写失败，但最近一次工具调用真实报错 → 失败（堵住 LLM 幻觉 / 漏写标记）
    const statusMatch = content.match(/【状态】(成功|失败)/);
    const statusFailed = statusMatch ? statusMatch[1] === '失败' : false;
    const success = !statusFailed && !toolErrored;
    return {
      seq, behavior,
      success,
      summary: content.replace(/【状态】(成功|失败)/, '').trim().slice(0, 2000),
    };
  }

}
