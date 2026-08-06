/**
 * 子任务执行器 —— 单个子任务的完整执行：安全确认 → 指令组装 → 子Agent 重试 → 结果提取。
 * childAgent 通过 createChildAgent 工厂注入，测试时可用 fake 替换 pi-agent，
 * 确定性验证重试 / 安全门 / 中断逻辑。
 */
import { randomUUID } from 'node:crypto';
import { contentToText, toolResultToText } from './text-utils.js';
import { parseResultStatus, stripResultStatus } from './result-protocol.js';
import { requiredParamNames, renderParam } from './param-contract.js';
import type { AgentPort } from './agent-port.js';
import type { SubTask, BehaviorMeta, SkillContext, SubTaskResult, ExecutionEntry, SSEEvent } from '../types.js';
import type { ConfirmManager } from './confirm-manager.js';

const MAX_RETRIES = 3;

export interface SubtaskRunnerDeps {
  confirmManager: ConfirmManager;
  createChildAgent: (context: SkillContext, primaryBehavior: string, opId: string, requiredParams?: string[]) => Promise<AgentPort>;
  /** 在途子 Agent 集合（供外层 abort() 中断所有并行子 Agent） */
  childAgents: Set<AgentPort>;
  /** 按 (scenario, ontology, behavior) 解析行为中文名 display_name（工具调用展示用） */
  getBehaviorDisplayName: (scenario: string, ontology: string, behaviorName: string) => string;
  /** 按 (scenario, ontology, function) 解析函数中文名 display_name（工具调用展示用） */
  getFunctionDisplayName: (scenario: string, ontology: string, functionName: string) => string;
}

/**
 * 检测子 Agent 是否被用户中断。
 * pi-agent-core 的中断不会让 prompt() 抛错，而是正常 resolve：
 * 最后一条 assistant 消息 stopReason='aborted'，且 state.errorMessage 含 'abort'。
 */
export function isChildAborted(agent: AgentPort): boolean {
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
    // 中文可读内容：行为说明 + 将写入/修改/删除的数据（参数中文名+值），避免只给 id 等无语义内容
    const confirmContent = this.buildSecurityContent(subTask, auditContent);
    if (meta.security || meta.isWrite) {
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'running', detail: confirmContent, params: subTask.params, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
      const confirmResult = await this.deps.confirmManager.requestConfirm(subTask.behavior, confirmContent, subTask.params, sendEvent);
      if (!confirmResult.approved) {
        const aborted = confirmResult.reason !== 'timeout'; // 用户拒绝/中断 → aborted；超时 → 常规失败
        return {
          seq: subTask.seq, behavior: subTask.behavior, success: false,
          error: confirmResult.reason === 'timeout' ? '⏱ 安全确认超时'
            : confirmResult.reason === 'abort' ? '⏹ 用户中断'
            : '🔒 安全确认被拒绝',
          summary: '',
          aborted,
        };
      }
      if (confirmResult.params) {
        subTask.params = confirmResult.params;
      }
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'done', detail: '用户已确认', params: subTask.params, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
    }

    // 组装指令（subTask.params 可能已被用户确认时修改）
    const instruction = this.buildInstruction(subTask, meta);
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_input', name: subTask.behavior, status: 'running', detail: instruction, params: subTask.params, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
    let lastError = '';
    // 记录本次子任务期间【任意一次】工具执行是否报错（isError）。
    // 用累积而非"最近一次"：子任务可能多次调工具，中间失败后最后成功也会被判失败。
    let anyToolError = false;

    // 复用同一个子 Agent 实例做重试：失败原因、工具结果保留在上下文中，LLM 能自纠
    // opId 每子任务一个、跨重试稳定：主行为写操作带 op_key 走后端幂等，重试不重复执行
    const opId = randomUUID();
    // 主行为必填参数名（来自行为元信息）：工具层硬检查用，缺失则拒绝执行
    const requiredParams = requiredParamNames(meta);
    const childAgent = await this.deps.createChildAgent(context, subTask.behavior, opId, requiredParams);
    this.deps.childAgents.add(childAgent);
    try {
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
          // 行为/函数调用都显示被调对象的中文（英文）；其它工具保留原名
          const called = this.resolveCalledDisplay(subTask, event.toolName, event.args);
          const entryDisplay = called.display ? `${called.display}（${called.name}）` : undefined;
          toolDisplayNames.set(event.toolCallId, { name: displayName, params: displayParams });
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: displayName, status: 'running', params: displayParams, source: 'child', seq: subTask.seq, displayName: entryDisplay, displayLabel: called.display || undefined, description: subTask.description });
        } else if (event.type === 'tool_execution_end') {
          const text = toolResultToText(event.result?.content);
          if (event.isError) anyToolError = true;
          const display = toolDisplayNames.get(event.toolCallId);
          const called = this.resolveCalledDisplay(subTask, event.toolName, event.args);
          const entryDisplay = called.display ? `${called.display}（${called.name}）` : undefined;
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: display?.name || event.toolName, status: 'done', params: display?.params, result: text, source: 'child', seq: subTask.seq, displayName: entryDisplay, displayLabel: called.display || undefined, description: subTask.description });
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
            return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '⏹ 用户中断执行', summary: '', aborted: true };
          }
          const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior, anyToolError);
          if (result.success) { return result; }
          // 仅工具调用真实失败才重试（瞬态错误，配合 op_key 幂等安全）；
          // LLM 自报失败（如查询结果为空、结果不符合预期）不重试，直接按失败返回，避免"换着法子空转"。
          if (!anyToolError) {
            return {
              seq: subTask.seq, behavior: subTask.behavior, success: false,
              error: result.summary || '❌ 执行未成功', summary: result.summary,
            };
          }
          lastError = result.error || result.summary || '执行失败';
        } catch (e: any) {
          if (e.name === 'AbortError' || (e.message && e.message.includes('abort'))) {
            return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '⏹ 用户中断执行', summary: '', aborted: true };
          }
          lastError = e.message;
        }

        if (attempt < MAX_RETRIES - 1) {
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: `重试 ${attempt + 1}/${MAX_RETRIES}`, status: 'running', detail: lastError, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
        }
      }

      return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: `❌ 执行失败（重试${MAX_RETRIES}次后）: ${lastError}`, summary: '' };
    } finally {
      this.deps.childAgents.delete(childAgent);
    }
  }

  /** 组装安全确认弹窗的中文可读内容：行为说明 + 将写入/修改/删除的数据（参数中文名+值）。 */
  private buildSecurityContent(subTask: SubTask, auditContent: string): string {
    const lines: string[] = [];
    lines.push(`【行为】${subTask.behavior}`);
    if (subTask.description) lines.push(`【说明】${subTask.description}`);
    if (auditContent && auditContent !== '此行为是写操作，请确认执行') lines.push(`【审核要求】${auditContent}`);
    const rawParams = subTask.params || {};
    const keys = Object.keys(rawParams);
    if (keys.length > 0) {
      lines.push(`【本次将写入/修改/删除的数据】`);
      keys.forEach(k => {
        const p = rawParams[k];
        const spec = p !== null && typeof p === 'object' ? p : null;
        const name = spec?.description || k;
        const val = spec ? (spec.value ?? '') : String(p ?? '');
        lines.push(`  - ${name}（${k}）: ${val === '' ? '（待补充）' : val}`);
      });
    }
    return lines.join('\n');
  }

  /**
   * 子任务展示信息三元组：
   *  - displayName：中文（英文），执行记录侧面板用，如 创建采购记录（CreatePurchaseRecord）
   *  - displayLabel：纯中文（display_name 或 description），聊天区用
   *  - description：子任务描述（父 Agent 生成），聊天区标题副行用
   */
  private displayInfo(subTask: SubTask, meta: BehaviorMeta) {
    return {
      displayName: `${meta.display_name || subTask.description}（${subTask.behavior}）`,
      displayLabel: meta.display_name || subTask.description,
      description: subTask.description,
    };
  }

  /**
   * 解析被调对象的中文名（工具调用展示用）：
   *  executeOntoBehavior → 被调行为的中文 display_name；executeOntoFunction → 函数中文 display_name；
   *  其它工具无中文映射 → 返回空（前端用工具原名兜底）。
   */
  private resolveCalledDisplay(subTask: SubTask, toolName: string, args: any): { name: string; display: string } {
    if (toolName === 'executeOntoBehavior' && args?.behavior_name) {
      return {
        name: args.behavior_name,
        display: this.deps.getBehaviorDisplayName(subTask.scenario_name, subTask.ontology_name, args.behavior_name),
      };
    }
    if (toolName === 'executeOntoFunction' && args?.function_name) {
      return {
        name: args.function_name,
        display: this.deps.getFunctionDisplayName(subTask.scenario_name, subTask.ontology_name, args.function_name),
      };
    }
    return { name: '', display: '' };
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
      paramKeys.forEach(k => { text += `${renderParam(k, rawParams[k])}\n`; });
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
    const { failed } = parseResultStatus(content);
    const success = !failed && !toolErrored;
    return {
      seq, behavior,
      success,
      summary: stripResultStatus(content),
    };
  }
}
