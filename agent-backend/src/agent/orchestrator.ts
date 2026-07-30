/**
 * Orchestrator — 编排父/子 Agent 的完整执行循环。
 *
 * 流程:
 *  ① 父Agent 规划 → JSON 子任务列表
 *  ② 按依赖排序 → 逐任务执行
 *  ③ 每个子任务: OntologyGateway → 组装指令 → 子Agent 执行
 *  ④ 安全管控弹窗 → 用户确认
 *  ⑤ 工具调用失败重试 3 次
 *  ⑥ 结果反馈父Agent → 继续/调整
 */

import { randomUUID } from 'node:crypto';
import { AgentFactory } from './agent-factory.js';
import { OntologyGateway } from '../services/ontology-gateway.js';
import { SkillLoader } from '../services/skill-loader.js';
import type {
  ThreadMessage, SubTaskPlan, SubTaskResult, BehaviorMeta, SubTask, SSEEvent, ExecutionEntry, SkillContext,
} from '../types.js';

const MAX_RETRIES = 3;
const MAX_SUBTASKS = 10;
const MAX_ROUNDS = 20;
const CONFIRM_TIMEOUT = 60000;

// ─── ConfirmManager ──────────────────────────

export class ConfirmManager {
  private pending = new Map<string, {
    resolve: (v: boolean) => void;
    timer: NodeJS.Timeout;
  }>();

  async requestConfirm(behavior: string, content: string, sendEvent: (e: SSEEvent) => void): Promise<boolean> {
    const confirmId = randomUUID();
    sendEvent({ type: 'confirm', confirmId, behavior, content } as any);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(confirmId); resolve(false); }, CONFIRM_TIMEOUT);
      this.pending.set(confirmId, { resolve, timer });
    });
  }

  handleConfirm(confirmId: string, approved: boolean): void {
    const entry = this.pending.get(confirmId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(confirmId);
    entry.resolve(approved);
  }
}

// ─── Orchestrator ────────────────────────────

export class Orchestrator {
  private confirmManager = new ConfirmManager();
  private currentChildAgent: any = null;

  constructor(
    private agentFactory: AgentFactory,
    private ontologyGateway: OntologyGateway,
    private skillLoader: SkillLoader,
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
    skillNames: string[],
    history: ThreadMessage[],
    scenario: string,
    ontology: string,
    sendEvent: (e: SSEEvent) => void,
  ): Promise<string> {
    const pushEntry = (entry: ExecutionEntry) => sendEvent({ type: 'exec_entry', entry } as any);

    // ── 阶段1：父Agent 规划（创建父 Agent，后续循环复用） ──
    // 通过 onSkillLoaded 回调收集实际加载的技能名
    const loadedSkillNames: string[] = [];
    const parentAgent = await this.agentFactory.createParentAgent(
      skillNames, history, scenario, ontology,
      (name: string) => { if (!loadedSkillNames.includes(name)) loadedSkillNames.push(name); },
    );
    let emitTokens = true;
    parentAgent.subscribe((event: any) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta' && emitTokens) {
        sendEvent({ type: 'token', token: event.assistantMessageEvent.delta });
      }
    });

    let plan: SubTaskPlan | null = null;

    // 第一轮：分析需求 + 获取规划
    await parentAgent.prompt(`用户: ${message}`);
    const hasLoaded = parentAgent.state.messages.some((m: any) => m.role === 'toolResult' || m.role === 'tool');
    if (hasLoaded) {
      emitTokens = false;
      await parentAgent.prompt(`你已了解技能内容。请根据用户需求判断：
- 如果用户只需要查询信息或了解知识，直接回答即可，不要输出 JSON
- 如果需要执行业务操作，请输出 JSON 子任务规划，behavior 必须是技能中定义的行为名称`);
    }
    let planResult = this.extractPlan(parentAgent.state.messages);
    if (planResult && planResult.subtasks && planResult.subtasks.length > 0) {
      plan = planResult;
    }

    if (!plan || !plan.subtasks || plan.subtasks.length === 0) {
      const lastMsg = this.getLastAssistantMessage(parentAgent.state.messages);
      if (lastMsg && !plan) {
        sendEvent({ type: 'done' });
        return lastMsg;
      }
      sendEvent({ type: 'error', message: '无法生成执行计划' });
      return '无法生成执行计划，请重新描述需求。';
    }

    // 如果加载了技能，从 SKILL.md frontmatter 提取上下文
    let skillContext: SkillContext | null = null;
    if (loadedSkillNames.length > 0) {
      try {
        skillContext = this.skillLoader.extractSkillContext(scenario, ontology, loadedSkillNames);
      } catch (e: any) {
        sendEvent({ type: 'error', message: `技能上下文提取失败: ${e.message}` });
        return `技能上下文提取失败: ${e.message}`;
      }
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
      await parentAgent.prompt(`以下子任务的 behavior 名称不在其所属场景/本体的行为集合中：${invalidNames}。\n合法行为有：${allValid}。\n请重新输出修正后的 JSON 规划。`);
      const corrected = this.extractPlan(parentAgent.state.messages);
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
      }
    }

    sendEvent({ type: 'plan_received', plan } as any);
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: '父Agent规划完成', status: 'done', detail: `共 ${plan.subtasks.length} 个子任务`, source: 'parent' });

    // ── 阶段2：按依赖顺序执行子任务，每完成一个反馈父Agent ──
    const sorted = this.topologicalSort(plan.subtasks);
    const results: SubTaskResult[] = [];
    let finalResponse = '';

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const currentIdx = results.length;
      if (currentIdx >= sorted.length) break;
      const subTask = sorted[currentIdx];

      // 检查依赖
      if (subTask.depends_on) {
        let depFailed = false;
        for (const dep of subTask.depends_on) {
          if (!results.find(r => r.seq === dep && r.success)) { depFailed = true; break; }
        }
        if (depFailed) {
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: `等待子任务${subTask.depends_on}完成`, status: 'failed', detail: '依赖未完成', source: 'child' });
          break;
        }
      }

      // 提取元信息
      const meta = this.ontologyGateway.getBehaviorMeta(subTask.scenario_name, subTask.ontology_name, subTask.behavior);

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_start', name: subTask.behavior, status: 'running', detail: subTask.description, params: subTask.params, source: 'child' });
      // 聊天区域显示"正在执行"
      sendEvent({ type: 'token', token: `\n**子任务 ${subTask.seq}：${subTask.behavior} 正在执行...**\n` });

      const result = await this.runSubTask(subTask, meta, skillContext!, sendEvent, pushEntry);
      results.push(result);

      pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: result.summary, result: result.summary, source: 'child' });

      if (result.success) {
        finalResponse = result.summary;
        sendEvent({ type: 'token', token: `\n✅ **子任务 ${subTask.seq} ${subTask.behavior}**\n` });

        // 反馈父Agent 评估结果，判断是否需要调整后续计划
        emitTokens = true;
        await parentAgent.prompt(`子任务 ${subTask.seq}（${subTask.behavior}）执行完毕。结果：${result.summary.slice(0, 200)}。\n请确认是否按原计划继续。如果需调整，请输出调整后的 JSON 规划。`);
        emitTokens = false;
        const adjusted = this.extractPlan(parentAgent.state.messages);
        if (adjusted && adjusted.subtasks && adjusted.subtasks.length > 0) {
          const remaining = sorted.filter(s => !results.find(r => r.seq === s.seq));
          for (const adjSubtasks of adjusted.subtasks) {
            if (!results.find(r => r.seq === adjSubtasks.seq)) {
              const idx = sorted.findIndex(s => s.seq === adjSubtasks.seq);
              if (idx >= 0) sorted[idx] = adjSubtasks;
              else sorted.push(adjSubtasks);
            }
          }
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_done', name: '父Agent调整计划', status: 'done', source: 'parent' });
        }
      } else {
        sendEvent({ type: 'token', token: `\r📋 **子任务 ${subTask.seq} ${subTask.behavior}** ❌ ${result.error}\n` });
        break;
      }
    }

    sendEvent({ type: 'token', token: `\n\n${finalResponse || '执行完成'}` });
    sendEvent({ type: 'done' });
    return finalResponse || '执行完成';
  }

  /** 从 messages 提取 JSON 规划 */
  private extractPlan(messages: any[]): SubTaskPlan | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = messages[i]?.content;
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.map((c: any) => c.text || '').join('') : '';
      const jsonMatch = text.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch { continue; }
      }
    }
    return null;
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
        const c = m.content;
        return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text || '').join('') : '';
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
    // 安全管控
    if (meta.security) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'running', detail: meta.security.audit_content });
      const approved = await this.confirmManager.requestConfirm(subTask.behavior, meta.security.audit_content, sendEvent);
      if (!approved) {
        return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '用户拒绝安全管控', summary: '' };
      }
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'done', detail: '用户已确认' });
    }

    // 组装指令
    const instruction = this.buildInstruction(subTask, meta);
    // 推送子任务输入到前端（子Agent明细面板）
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_input', name: subTask.behavior, status: 'running', detail: instruction, params: subTask.params, source: 'child' });
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const childAgent = await this.agentFactory.createChildAgent(context);
      this.currentChildAgent = childAgent;
      childAgent.subscribe((event: any) => {
        if (event.type === 'tool_execution_start') {
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: event.toolName, status: 'running', params: event.args, source: 'child' });
        } else if (event.type === 'tool_execution_end') {
          const text = event.result?.content?.map((c: any) => c.text || '').filter(Boolean).join('\n') || '';
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: event.toolName, status: 'done', result: text, source: 'child' });
        }
      });

      try {
        await childAgent.prompt(instruction);
        const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior);
        if (result.success) return result;
        lastError = result.error || '执行失败';
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
    // 执行指导
    if (subTask.guidance) {
      text += `\n### 执行指导\n${subTask.guidance}\n`;
    }

    // 参数（父 Agent 已传完整结构，含 type/required/description/value）
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

    // 前置规则
    if (meta.preRules.length > 0) {
      text += `\n### 前置规则（执行前必须全部验证通过）\n`;
      meta.preRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) text += `  需要接口: ${r.data_supplements.join(', ')}\n`;
      });
    }

    // 安全管控
    if (meta.security) {
      text += `\n### 安全管控\n需要用户确认: ${meta.security.audit_content}\n`;
    }

    // 后置规则
    if (meta.postRules.length > 0) {
      text += `\n### 后置规则（执行后进行推理验证）\n`;
      meta.postRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) text += `  需要接口: ${r.data_supplements.join(', ')}\n`;
      });
    }

    // 关联概念属性
    if (meta.concepts.length > 0) {
      text += `\n### 关联概念属性\n`;
      meta.concepts.forEach(c => {
        text += `  ${c.name} (${c.display_name}): ${c.attributes.map(a => a.name).join(', ')}\n`;
      });
    }

    return text;
  }

  /** 提取子任务执行结果 */
  private extractResult(messages: any[], seq: number, behavior: string): SubTaskResult {
    const last = [...messages].reverse().find((m: any) => m.role === 'assistant' && !m.errorMessage);
    const content = last
      ? (typeof last.content === 'string' ? last.content
          : Array.isArray(last.content) ? last.content.map((c: any) => c.text || '').join('') : '')
      : '';
    return {
      seq, behavior,
      success: !content.includes('失败') && !content.includes('错误') && !content.includes('无法') && !content.includes('缺失'),
      summary: content.slice(0, 2000),
    };
  }

}
