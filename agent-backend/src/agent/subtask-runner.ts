/**
 * 子任务执行器 —— 单个子任务的完整执行：安全确认 → 指令组装 → 子Agent 重试 → 结果提取。
 * childAgent 通过 createChildAgent 工厂注入，测试时可用 fake 替换 pi-agent，
 * 确定性验证重试 / 安全门 / 中断逻辑。
 */
import { randomUUID } from 'node:crypto';
import { contentToText, toolResultToText } from './text-utils.js';
import type { SubTask, BehaviorMeta, SkillContext, SubTaskResult, ExecutionEntry, SSEEvent } from '../types.js';
import type { ConfirmManager } from './confirm-manager.js';

const MAX_RETRIES = 3;

export interface SubtaskRunnerDeps {
  confirmManager: ConfirmManager;
  createChildAgent: (context: SkillContext, primaryBehavior: string, opId: string) => Promise<any>;
  /** 当前子 Agent 引用（供外层 abort() 中断在途子 Agent） */
  childAgentRef: { current: any | null };
}

/**
 * 检测子 Agent 是否被用户中断。
 * pi-agent-core 的中断不会让 prompt() 抛错，而是正常 resolve：
 * 最后一条 assistant 消息 stopReason='aborted'，且 state.errorMessage 含 'abort'。
 */
export function isChildAborted(agent: any): boolean {
  const err = agent.state?.errorMessage;
  if (err && /abort/i.test(err)) return true;
  const msgs: any[] = agent.state?.messages ?? [];
  const last = msgs[msgs.length - 1];
  return !!(last && last.role === 'assistant' && last.stopReason === 'aborted');
}

export class SubtaskRunner {
  constructor(private deps: SubtaskRunnerDeps) {}

  /** 执行单个子任务 */
  async run(
    subTask: SubTask, meta: BehaviorMeta,
    context: SkillContext,
    sendEvent: (e: SSEEvent) => void, pushEntry: (e: ExecutionEntry) => void,
  ): Promise<SubTaskResult> {
    // 安全管控（含参数审核）。写操作一律强制确认：有 securities 登记用登记内容，未登记用通用提示。
    const auditContent = meta.security?.audit_content || '此行为是写操作，请确认执行';
    if (meta.security || meta.isWrite) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'running', detail: auditContent, params: subTask.params });
      const confirmResult = await this.deps.confirmManager.requestConfirm(subTask.behavior, auditContent, subTask.params, sendEvent);
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
    const childAgent = await this.deps.createChildAgent(context, subTask.behavior, opId);
    this.deps.childAgentRef.current = childAgent;
    // 订阅事件都会携带当前 run 的 abort signal；被中断时最后一条事件（agent_end）必能看到 signal.aborted。
    // 用它覆盖"工具调用进行中"场景——该场景最后一条消息的 stopReason 不是 'aborted'，isChildAborted 会漏判。
    let userAborted = false;
    // toolCallId → { 显示名, 展示参数 }。
    // start 事件带 args 可推导行为名/参数，end 事件不带 args，靠 toolCallId 桥接，
    // 保证 start/end 同名、同参数，前端 running→done 去重匹配不破、参数不被覆盖成空。
    const toolDisplayNames = new Map<string, { name: string; params: any }>();
    childAgent.subscribe((event: any, signal: AbortSignal) => {
      if (signal?.aborted) userAborted = true;
      if (event.type === 'tool_execution_start') {
        const displayName = this.describeToolCall(event.toolName, event.args);
        // 行为/函数调用只展示传入的 params（去掉 behavior_name/function_name 包装层）
        const displayParams = (event.toolName === 'executeOntoBehavior' || event.toolName === 'executeOntoFunction')
          ? (event.args?.params ?? event.args)
          : event.args;
        toolDisplayNames.set(event.toolCallId, { name: displayName, params: displayParams });
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: displayName, status: 'running', params: displayParams, source: 'child' });
      } else if (event.type === 'tool_execution_end') {
        const text = toolResultToText(event.result?.content);
        if (event.isError) anyToolError = true;
        const display = toolDisplayNames.get(event.toolCallId);
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: display?.name || event.toolName, status: 'done', params: display?.params, result: text, source: 'child' });
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
        if (userAborted || isChildAborted(childAgent)) {
          this.deps.childAgentRef.current = null;
          return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '用户中断执行', summary: '', aborted: true };
        }
        const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior, anyToolError);
        if (result.success) { this.deps.childAgentRef.current = null; return result; }
        // 仅工具调用真实失败才重试（瞬态错误，配合 op_key 幂等安全）；
        // LLM 自报失败（如查询结果为空、结果不符合预期）不重试，直接按失败返回，避免"换着法子空转"。
        if (!anyToolError) {
          this.deps.childAgentRef.current = null;
          return {
            seq: subTask.seq, behavior: subTask.behavior, success: false,
            error: result.summary || '执行未成功', summary: result.summary,
          };
        }
        lastError = result.error || result.summary || '执行失败';
      } catch (e: any) {
        if (e.name === 'AbortError' || (e.message && e.message.includes('abort'))) {
          this.deps.childAgentRef.current = null;
          return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '用户中断执行', summary: '', aborted: true };
        }
        lastError = e.message;
      }

      if (attempt < MAX_RETRIES - 1) {
        pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: `重试 ${attempt + 1}/${MAX_RETRIES}`, status: 'running', detail: lastError });
      }
    }

    this.deps.childAgentRef.current = null;
    return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: `重试 ${MAX_RETRIES} 次后失败: ${lastError}`, summary: '' };
  }

  /** 工具调用的显示名：行为/函数调用直接显示其名称（如 QueryInventory），其余工具显示工具名。 */
  private describeToolCall(toolName: string, args: any): string {
    if (toolName === 'executeOntoBehavior' && args?.behavior_name) return args.behavior_name;
    if (toolName === 'executeOntoFunction' && args?.function_name) return args.function_name;
    return toolName;
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

    if (meta.security || meta.isWrite) {
      text += `\n### 安全管控\n本行为的安全管控已由系统在用户侧完成确认，请直接执行，无需再向用户询问。\n审核内容: ${meta.security?.audit_content || '写操作确认'}\n`;
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

  /** 提取子任务执行结果（双信号：最后状态标记 + 任意工具报错） */
  private extractResult(messages: any[], seq: number, behavior: string, toolErrored = false): SubTaskResult {
    const last = [...messages].reverse().find((m: any) => m.role === 'assistant' && !m.errorMessage);
    const content = last ? contentToText(last.content) : '';
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
