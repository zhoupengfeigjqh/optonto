/**
 * 子任务执行器 —— 单个子任务的完整执行统一入口（行为与函数子任务同口）：
 *  - 行为子任务：安全确认 → 指令组装 → 子Agent 重试 → 结果提取（+ 起止执行记录）
 *  - 函数子任务：确定性直连调用（无子 Agent LLM、无安全确认、无规则，+ 起止执行记录）
 * childAgent 通过 createChildAgent 工厂注入，测试时可用 fake 替换 pi-agent，
 * 确定性验证重试 / 安全门 / 中断逻辑。
 */
import { contentToText, toolResultToText } from '../utils/text-utils.js';
import { parseResultStatus, stripResultStatus } from './result-protocol.js';
import { isParamValueEmpty, unwrapParamValue, unwrapParamValues } from './param-contract.js';
import type { AgentPort } from './agent-ports.js';
import type { SecurityGate } from './security-policy.js';
import { bareBehaviorName } from './tool-catalog.js';
import { buildSubtaskPolicy, needsSecurityConfirm } from './execution-policy.js';
import type { LegalCalls, SubtaskInfoPort, SubtaskPolicy } from './execution-policy.js';
import type { SubTask, BehaviorMeta, SkillContext, SubTaskResult } from '../types.js';
import type { ConfirmPort } from './confirm-manager.js';
import type { EventChannel } from './event-channel.js';
import { entryDisplay, ToolCallBridge } from './event-channel.js';

/** LLM 调用异常（prompt() 抛错：API/网络瞬态错误）时的最大重试次数。工具报错不在此列——由内层自纠（≤2 次 rethrow）与预算（第 3 次 terminate）处理。 */
const MAX_LLM_EXCEPTION_RETRIES = 2;

export interface SubtaskRunnerDeps {
  confirmManager: ConfirmPort;
  /** 创建子 Agent：policy 由 buildSubtaskPolicy 一处派生的完整策略对象（不存在半设防形态） */
  createChildAgent: (context: SkillContext, policy: SubtaskPolicy) => Promise<AgentPort>;
  /** 在途子 Agent 集合（供外层 abort() 中断所有并行子 Agent） */
  childAgents: Set<AgentPort>;
  /** 子任务元数据查询口（策略派生 + 工具调用展示的全部元数据投影，orchestrator 一次性接线） */
  info: SubtaskInfoPort;
  /** run 级安全闸（全 run 共享）：工具层 disable 命中置位后，本 runner 据此返回 securityViolation 失败 */
  securityGate: SecurityGate;
  /** 直连调用函数/MCP 工具（函数子任务确定性执行，不经子 Agent LLM）。返回 MCP 结果文本与是否出错。 */
  callFunctionTool: (functionName: string, ontologyId: number, params: Record<string, any>) => Promise<{ text: string; isError: boolean }>;
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

  /**
   * 执行单个子任务（统一入口）：函数子任务直连，行为子任务走子 Agent。
   * meta 仅行为子任务需要（波次调度三分类时已取，透传避免二次查询）；函数子任务传 null。
   * 行为子任务的起止执行记录在此统一打（函数路径在 runFunctionEntry 内自打，两条路径同一形态）。
   */
  async run(subTask: SubTask, meta: BehaviorMeta | null, emit: EventChannel): Promise<SubTaskResult> {
    if (subTask.function) return this.runFunctionEntry(subTask, emit);
    // 子 Agent 上下文直接取子任务自身字段：多个子任务可指向不同本体
    const context: SkillContext = {
      scenario_name: subTask.scenario_name,
      scenario_id: subTask.scenario_id ?? 0,
      ontology_name: subTask.ontology_name,
      ontology_id: subTask.ontology_id,
    };
    // 展示三元组（中文（英文）/纯中文/描述）与执行记录同源于 entryDisplay
    const display = entryDisplay(meta!.display_name, subTask.behavior, subTask.description);
    emit.entry({ type: 'subtask_start', name: subTask.behavior, status: 'running', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq, ...display });
    const result = await this.runBehavior(subTask, meta!, context, emit, display);
    emit.entry({ type: 'subtask_done', name: subTask.behavior, status: result.success ? 'done' : 'failed', detail: `${subTask.behavior}｜子任务 ${subTask.seq}`, result: result.summary, source: 'child', seq: subTask.seq, ...display });
    return result;
  }

  /** 执行单个函数子任务：确定性直连调用 MCP 函数（无子 Agent LLM、无安全确认、无规则）。 */
  private async runFunctionEntry(subTask: SubTask, emit: EventChannel): Promise<SubTaskResult> {
    const functionName = subTask.function!;
    // 中文名走元数据查询口（三源含其他MCP工具），无则空串由 entryDisplay 兜底子任务描述
    const fnDisplay = this.deps.info.functionDisplayName(subTask.scenario_name, subTask.ontology_name, functionName);
    const display = entryDisplay(fnDisplay, functionName, subTask.description);

    // 直连执行前深展开计划期 {type/required/description/value} 包装为纯值（真实 LLM 中继会把包装递归嵌套进数组项）
    const args = unwrapParamValues(subTask.params || {});

    emit.entry({ type: 'subtask_start', name: functionName, status: 'running', detail: `${functionName}｜子任务 ${subTask.seq}`, params: subTask.params, source: 'child', seq: subTask.seq, ...display });
    emit.entry({ type: 'tool_call', name: functionName, status: 'running', params: args, source: 'child', seq: subTask.seq, ...display });

    const { text, isError } = await this.deps.callFunctionTool(functionName, subTask.ontology_id, args);

    emit.entry({ type: 'tool_call', name: functionName, status: isError ? 'failed' : 'done', params: args, result: text, source: 'child', seq: subTask.seq, ...display });

    if (isError) {
      emit.entry({ type: 'subtask_done', name: functionName, status: 'failed', detail: `${functionName}｜子任务 ${subTask.seq}`, result: text, source: 'child', seq: subTask.seq, ...display });
      return { seq: subTask.seq, task: functionName, success: false, error: `❌ 函数执行失败：${text}`, summary: '' };
    }

    emit.entry({ type: 'subtask_done', name: functionName, status: 'done', detail: `${functionName}｜子任务 ${subTask.seq}`, result: text, source: 'child', seq: subTask.seq, ...display });
    // summary 直接放函数原始结果 JSON——它是 L0 波次反馈中继给后续子任务的一等值
    return { seq: subTask.seq, task: functionName, success: true, summary: text };
  }

  /** 执行单个行为子任务：安全确认 → 指令组装 → 子Agent 重试 → 结果提取。 */
  private async runBehavior(
    subTask: SubTask, meta: BehaviorMeta,
    context: SkillContext,
    emit: EventChannel,
    display: ReturnType<typeof entryDisplay>,
  ): Promise<SubTaskResult> {
    const pushEntry = emit.entry;
    // 安全管控（含参数审核）。判定单一事实源 needsSecurityConfirm：有 securities 登记按 confirm（false=显式关闭），
    // 无登记时写操作默认强制确认；有登记用登记内容，未登记/无内容用通用提示。
    const auditContent = meta.security?.confirm_content || '此行为是写操作，请确认执行';
    // 中文可读内容：行为说明 + 将写入/修改/删除的数据（参数中文名+值），避免只给 id 等无语义内容
    const confirmContent = this.buildSecurityContent(subTask, auditContent);
    if (needsSecurityConfirm(meta)) {
      emit.entry({ type: 'security_confirm', name: subTask.behavior, status: 'running', detail: confirmContent, params: subTask.params, source: 'child', seq: subTask.seq, ...display });
      const confirmResult = await this.deps.confirmManager.requestConfirm(subTask.behavior, confirmContent, subTask.params, emit);
      if (!confirmResult.approved) {
        const aborted = confirmResult.reason !== 'timeout'; // 用户拒绝/中断 → aborted；超时 → 常规失败
        return {
          seq: subTask.seq, task: subTask.behavior, success: false,
          error: confirmResult.reason === 'timeout' ? '⏱ 安全确认超时'
            : confirmResult.reason === 'abort' ? '⏹ 用户中断'
            : '🔒 安全确认被拒绝',
          summary: '',
          aborted,
        };
      }
      emit.entry({ type: 'security_confirm', name: subTask.behavior, status: 'done', detail: '用户已确认', params: subTask.params, source: 'child', seq: subTask.seq, ...display });
    }

    // 组装指令（参数在规划确认/数据传播阶段已定死，安全确认只做批准/拒绝，不改参数）
    // 执行策略一处派生：合法清单（子 Agent 挂载过滤）、禁用集合、报错预算
    const policy = buildSubtaskPolicy(subTask, meta, this.deps.info, this.deps.securityGate);
    const instruction = this.buildInstruction(subTask, meta);
    emit.entry({ type: 'subtask_input', name: subTask.behavior, status: 'running', detail: instruction, params: subTask.params, source: 'child', seq: subTask.seq, ...display });
    let lastError = '';

    // 复用同一个子 Agent 实例：失败原因、工具结果保留在上下文中（异常重试时参考）
    const childAgent = await this.deps.createChildAgent(context, policy);
    this.deps.childAgents.add(childAgent);
    try {
      // 订阅事件都会携带当前 run 的 abort signal；被中断时最后一条事件（agent_end）必能看到 signal.aborted。
      // 用它覆盖"工具调用进行中"场景——该场景最后一条消息的 stopReason 不是 'aborted'，isChildAborted 会漏判。
      let userAborted = false;
      // start/end 参数配对走 ToolCallBridge（与父 Agent 侧同一模式）
      const toolCallParams = new ToolCallBridge();
      childAgent.subscribe((event: any, signal: AbortSignal) => {
        if (signal?.aborted) userAborted = true;
        if (event.type === 'tool_execution_start') {
          // 行为/函数都是一等工具：参数即 event.args（不再有 behavior_name 包装层）
          toolCallParams.hold(event.toolCallId, event.args);
          // 行为/函数调用都显示被调对象的中文（英文）；其它工具保留原名（无中文映射 → undefined，前端用工具原名兜底）
          const called = this.resolveCalledDisplay(subTask, event.toolName, policy.legalCalls);
          const calledDisplay = called.display ? `${called.display}（${called.name}）` : undefined;
          pushEntry({ type: 'tool_call', name: event.toolName, status: 'running', params: event.args, source: 'child', seq: subTask.seq, displayName: calledDisplay, displayLabel: called.display || undefined, description: subTask.description });
        } else if (event.type === 'tool_execution_end') {
          const text = toolResultToText(event.result?.content);
          const called = this.resolveCalledDisplay(subTask, event.toolName, policy.legalCalls);
          const calledDisplay = called.display ? `${called.display}（${called.name}）` : undefined;
          pushEntry({ type: 'tool_call', name: event.toolName, status: 'done', params: toolCallParams.take(event.toolCallId), result: text, source: 'child', seq: subTask.seq, displayName: calledDisplay, displayLabel: called.display || undefined, description: subTask.description });
        }
      });

      // 瘦身后的重试模型：
      // - 工具报错：完全交给内层——前 2 次 rethrow 让 LLM 自纠，第 3 次 terminate 停循环（预算兜底），
      //   不再做"整轮重做"（重放历史有重复写入副作用）。
      // - LLM 调用异常（prompt() 抛错，如 API/网络瞬态错误）：内层处理不到，这里最多重试几次。
      for (let attempt = 0; attempt <= MAX_LLM_EXCEPTION_RETRIES; attempt++) {
        try {
          // 首次传入完整指令；异常重试时指令已在上下文中，只需让 LLM 参考已有过程重跑
          await childAgent.prompt(attempt === 0
            ? instruction
            : `你上一次执行时 LLM 调用异常（${lastError}）。\n请参考已有的执行过程，重新执行本子任务并输出最终结果。`);
          // pi-agent-core 的中断不会让 prompt() 抛错，而是正常 resolve（最后一条消息 stopReason='aborted'）。
          // 必须显式检测，否则中断会被 extractResult 误判为成功。
          if (userAborted || isChildAborted(childAgent)) {
            return { seq: subTask.seq, task: subTask.behavior, success: false, error: '⏹ 用户中断执行', summary: '', aborted: true };
          }
          // 工具层 disable 闸命中（run 级共享 gate 置位）：先于预算/结果解析判定。
          // 返回 securityViolation 失败——orchestrator 据此以 securityBlocked 中断整个 run（区别于常规失败/用户中断）。
          if (this.deps.securityGate.violation) {
            return {
              seq: subTask.seq, task: subTask.behavior, success: false,
              error: this.deps.securityGate.violation, summary: '', securityViolation: true,
            };
          }
          // 工具连续报错达上限：pi-agent 内层循环已被 terminate 停住，直接判失败收尾。
          // 记为失败+明确原因（不置 aborted —— aborted 语义是用户中断/拒绝）。
          if (policy.errorBudget.exceeded) {
            return {
              seq: subTask.seq, task: subTask.behavior, success: false,
              error: `⏹ 子任务连续报错已达 ${policy.errorBudget.limit} 次，已中断执行（不再重试）`, summary: '',
            };
          }
          // 结果以 LLM 的【状态】标记为准：内层自纠（工具报错→修正→成功）算成功，不再被"途中报过错"判失败
          const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior);
          if (result.success) { return result; }
          // LLM 自报失败（前置规则未过、必填参数无法获取等）直接返回，不重试、不整轮重做
          return { seq: subTask.seq, task: subTask.behavior, success: false, error: result.summary || '❌ 执行未成功', summary: result.summary };
        } catch (e: any) {
          if (e.name === 'AbortError' || (e.message && e.message.includes('abort'))) {
            return { seq: subTask.seq, task: subTask.behavior, success: false, error: '⏹ 用户中断执行', summary: '', aborted: true };
          }
          // 仅 prompt() 抛异常（LLM/传输层）才走重试；工具层报错已被预算与内层覆盖，不会走到这里
          lastError = e.message;
          if (attempt < MAX_LLM_EXCEPTION_RETRIES) {
            pushEntry({ type: 'tool_call', name: `LLM 异常重试 ${attempt + 1}/${MAX_LLM_EXCEPTION_RETRIES}`, status: 'running', detail: lastError, source: 'child', seq: subTask.seq, ...display });
          }
        }
      }

      return { seq: subTask.seq, task: subTask.behavior, success: false, error: `❌ 执行失败（LLM 调用异常，重试${MAX_LLM_EXCEPTION_RETRIES}次后）: ${lastError}`, summary: '' };
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
      lines.push(`【本次将更新的数据】`);
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
   * 解析被调对象的中文名（工具调用展示用）：
   *  行为工具（facade，工具名 = 裸名或 onto{id}__ 前缀名）→ 被调行为的中文 display_name；
   *  本体函数（工具名=函数名）→ 函数中文 display_name；其它工具无中文映射 → 返回空（前端用工具原名兜底）。
   */
  private resolveCalledDisplay(subTask: SubTask, toolName: string, legal: LegalCalls): { name: string; display: string } {
    // 前缀剥离：跨本体重名行为工具带 onto{ontology_id}__ 前缀，裸名才是 legal.behaviors / gateway 的匹配键
    const bare = bareBehaviorName(toolName);
    if (legal.behaviors.includes(bare)) {
      return {
        name: bare,
        display: this.deps.info.behaviorDisplayName(subTask.scenario_name, subTask.ontology_name, bare),
      };
    }
    // 本体函数是一等工具（函数名即工具名），用合法函数名判定是函数而非公共函数/新增 MCP
    if (legal.functions.includes(toolName)) {
      return {
        name: toolName,
        display: this.deps.info.functionDisplayName(subTask.scenario_name, subTask.ontology_name, toolName),
      };
    }
    return { name: '', display: '' };
  }

  /** 组装子任务指令（可调用范围由挂载过滤保证——与策略同源，见 buildSubtaskPolicy/createChildAgent） */
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

    text += `\n### 参数（值如下；结构与约束以各工具 schema 为准，必填/枚举/模式/取值范围由 schema 承载）\n`;
    const rawParams = subTask.params || {};
    const paramKeys = Object.keys(rawParams);
    if (paramKeys.length > 0) {
      paramKeys.forEach(k => {
        const shown = isParamValueEmpty(rawParams[k])
          ? '（待补充）'
          : JSON.stringify(unwrapParamValue(
              rawParams[k] && typeof rawParams[k] === 'object' ? rawParams[k].value : rawParams[k]));
        text += `  - ${k}: ${shown}\n`;
      });
    } else {
      text += `  （父 Agent 未提供详细参数）\n`;
    }

    if (meta.preRules.length > 0) {
      text += `\n### 前置规则（执行前必须全部验证通过）\n`;
      meta.preRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) {
          text += `  需要接口: ${r.data_supplements.join(', ')}（已挂载为同名工具，参数以其 schema 为准）\n`;
        }
        if (r.related_functions?.length) {
          text += `  关联函数: ${r.related_functions.join(', ')}\n`;
        }
      });
    }

    if (needsSecurityConfirm(meta)) {
      text += `\n### 安全管控\n本行为的安全管控已由系统在用户侧完成确认，请直接执行，无需再向用户询问。\n`;
    }

    if (meta.postRules.length > 0) {
      text += `\n### 后置规则（执行后进行推理验证）\n`;
      meta.postRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) {
          text += `  需要接口: ${r.data_supplements.join(', ')}（已挂载为同名工具，参数以其 schema 为准）\n`;
        }
        if (r.related_functions?.length) {
          text += `  关联函数: ${r.related_functions.join(', ')}\n`;
        }
      });
    }

    // 关联概念属性：仅当存在规则时渲染（规则可能引用概念属性用于验证/推理）；
    // 无规则的纯操作子任务渲染属性名只会诱导"查证"冲动，属噪音。
    if (meta.concepts.length > 0 && (meta.preRules.length > 0 || meta.postRules.length > 0)) {
      text += `\n### 关联概念属性\n`;
      meta.concepts.forEach(c => {
        text += `  ${c.name} (${c.display_name}): ${c.attributes.map(a => a.name).join(', ')}\n`;
      });
    }

    // 可调用范围：挂载期过滤即白名单（同源 policy.legalCalls）——子 Agent 只看得见这些工具，
    // 文案不再列名单（列出反而与机制双写漂移）；未挂载的行为/函数物理上不可调用。
    text += `\n### 可调用范围\n`;
    text += `主行为 ${subTask.behavior} 与规则关联行为/函数已挂载为你的工具（工具名即行为名/函数名）；只能调用已挂载的工具，严禁编造工具名。\n`;

    return text;
  }

  /** 提取子任务执行结果：以 LLM 回复末尾的【状态】标记为准。工具报错已由内层自纠/预算兜底，不再额外判失败。 */
  private extractResult(messages: any[], seq: number, task: string): SubTaskResult {
    const last = [...messages].reverse().find((m: any) => m.role === 'assistant' && !m.errorMessage);
    const content = last ? contentToText(last.content) : '';
    const { failed, found } = parseResultStatus(content);
    const success = !failed;
    // 无状态标记（found=false）→ 判失败：结果无法确认，不甩 LLM 原文（可能是"成功完成xxx"但漏打标记，易割裂）
    const summary = found ? stripResultStatus(content) : '结果无法确认：未按协议输出状态标记';
    return {
      seq, task,
      success,
      summary,
    };
  }
}
