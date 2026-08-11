/**
 * 子任务执行器 —— 单个子任务的完整执行：安全确认 → 指令组装 → 子Agent 重试 → 结果提取。
 * childAgent 通过 createChildAgent 工厂注入，测试时可用 fake 替换 pi-agent，
 * 确定性验证重试 / 安全门 / 中断逻辑。
 */
import { contentToText, toolResultToText } from './text-utils.js';
import { parseResultStatus, stripResultStatus } from './result-protocol.js';
import { requiredParamNames, renderParam } from './param-contract.js';
import { createToolErrorBudget } from './error-budget.js';
import type { ToolErrorBudget } from './error-budget.js';
import type { AgentPort } from './agent-port.js';
import { COMMON_FUNCTION_NAMES } from './agent-factory.js';
import type { SubTask, BehaviorMeta, SkillContext, SubTaskResult, ExecutionEntry, SSEEvent } from '../types.js';
import type { ConfirmManager } from './confirm-manager.js';

/** LLM 调用异常（prompt() 抛错：API/网络瞬态错误）时的最大重试次数。工具报错不在此列——由内层自纠（≤2 次 rethrow）与预算（第 3 次 terminate）处理。 */
const MAX_LLM_EXCEPTION_RETRIES = 2;

export interface SubtaskRunnerDeps {
  confirmManager: ConfirmManager;
  createChildAgent: (context: SkillContext, primaryBehavior: string, requiredParams?: string[], errorBudget?: ToolErrorBudget) => Promise<AgentPort>;
  /** 在途子 Agent 集合（供外层 abort() 中断所有并行子 Agent） */
  childAgents: Set<AgentPort>;
  /** 按 (scenario, ontology, behavior) 解析行为中文名 display_name（工具调用展示用） */
  getBehaviorDisplayName: (scenario: string, ontology: string, behaviorName: string) => string;
  /** 按 (scenario, ontology, function) 解析函数中文名 display_name（工具调用展示用） */
  getFunctionDisplayName: (scenario: string, ontology: string, functionName: string) => string;
  /** 按 (scenario, ontology, behavior) 解析行为参数结构（规则取数接口 data_supplements 渲染用） */
  getBehaviorParams: (scenario: string, ontology: string, behaviorName: string) => Record<string, any>;
  /** 按 (scenario, ontology, function) 解析本体函数参数结构（规则关联函数渲染用）；共享函数返回 null */
  getFunctionParams: (scenario: string, ontology: string, functionName: string) => Record<string, any> | null;
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
      pushEntry({ time: new Date().toLocaleTimeString(), type: 'security_confirm', name: subTask.behavior, status: 'done', detail: '用户已确认', params: subTask.params, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
    }

    // 组装指令（参数在规划确认/数据传播阶段已定死，安全确认只做批准/拒绝，不改参数）
    const instruction = this.buildInstruction(subTask, meta);
    pushEntry({ time: new Date().toLocaleTimeString(), type: 'subtask_input', name: subTask.behavior, status: 'running', detail: instruction, params: subTask.params, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
    let lastError = '';

    // 复用同一个子 Agent 实例：失败原因、工具结果保留在上下文中（异常重试时参考）
    // 主行为必填参数名（来自行为元信息）：工具层硬检查用，缺失则拒绝执行
    const requiredParams = requiredParamNames(meta);
    // 工具报错预算：连续报错达上限即中断（pi-agent 内层循环被 terminate 停住），不再无限试错
    const errorBudget = createToolErrorBudget();
    const childAgent = await this.deps.createChildAgent(context, subTask.behavior, requiredParams, errorBudget);
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
          const display = toolDisplayNames.get(event.toolCallId);
          const called = this.resolveCalledDisplay(subTask, event.toolName, event.args);
          const entryDisplay = called.display ? `${called.display}（${called.name}）` : undefined;
          pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: display?.name || event.toolName, status: 'done', params: display?.params, result: text, source: 'child', seq: subTask.seq, displayName: entryDisplay, displayLabel: called.display || undefined, description: subTask.description });
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
            return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '⏹ 用户中断执行', summary: '', aborted: true };
          }
          // 工具连续报错达上限：pi-agent 内层循环已被 terminate 停住，直接判失败收尾。
          // 记为失败+明确原因（不置 aborted —— aborted 语义是用户中断/拒绝）。
          if (errorBudget.exceeded) {
            return {
              seq: subTask.seq, behavior: subTask.behavior, success: false,
              error: `⏹ 子任务连续报错已达 ${errorBudget.limit} 次，已中断执行（不再重试）`, summary: '',
            };
          }
          // 结果以 LLM 的【状态】标记为准：内层自纠（工具报错→修正→成功）算成功，不再被"途中报过错"判失败
          const result = this.extractResult(childAgent.state.messages, subTask.seq, subTask.behavior);
          if (result.success) { return result; }
          // LLM 自报失败（前置规则未过、必填参数无法获取等）直接返回，不重试、不整轮重做
          return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: result.summary || '❌ 执行未成功', summary: result.summary };
        } catch (e: any) {
          if (e.name === 'AbortError' || (e.message && e.message.includes('abort'))) {
            return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: '⏹ 用户中断执行', summary: '', aborted: true };
          }
          // 仅 prompt() 抛异常（LLM/传输层）才走重试；工具层报错已被预算与内层覆盖，不会走到这里
          lastError = e.message;
          if (attempt < MAX_LLM_EXCEPTION_RETRIES) {
            pushEntry({ time: new Date().toLocaleTimeString(), type: 'tool_call', name: `LLM 异常重试 ${attempt + 1}/${MAX_LLM_EXCEPTION_RETRIES}`, status: 'running', detail: lastError, source: 'child', seq: subTask.seq, ...this.displayInfo(subTask, meta) });
          }
        }
      }

      return { seq: subTask.seq, behavior: subTask.behavior, success: false, error: `❌ 执行失败（LLM 调用异常，重试${MAX_LLM_EXCEPTION_RETRIES}次后）: ${lastError}`, summary: '' };
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
        if (r.data_supplements?.length) {
          text += `  需要接口: ${r.data_supplements.join(', ')}\n`;
          text += `${this.renderSupplementApis(r.data_supplements, subTask.scenario_name, subTask.ontology_name)}\n`;
        }
        if (r.related_functions?.length) {
          text += `  关联函数: ${r.related_functions.join(', ')}\n`;
          text += `${this.renderRelatedFunctions(r.related_functions, subTask.scenario_name, subTask.ontology_name)}\n`;
        }
      });
    }

    // if (meta.security || meta.isWrite) {
    //   text += `\n### 安全管控\n本行为的安全管控已由系统在用户侧完成确认，请直接执行，无需再向用户询问。\n审核内容: ${meta.security?.audit_content || '写操作确认'}\n`;
    // }
    if (meta.security || meta.isWrite) {
      text += `\n### 安全管控\n本行为的安全管控已由系统在用户侧完成确认，请直接执行，无需再向用户询问。\n`;
    }

    if (meta.postRules.length > 0) {
      text += `\n### 后置规则（执行后进行推理验证）\n`;
      meta.postRules.forEach(r => {
        text += `[${r.name}] ${r.description}\n`;
        if (r.rule_detail) text += `  配置: ${JSON.stringify(r.rule_detail)}\n`;
        if (r.data_supplements?.length) {
          text += `  需要接口: ${r.data_supplements.join(', ')}\n`;
          text += `${this.renderSupplementApis(r.data_supplements, subTask.scenario_name, subTask.ontology_name)}\n`;
        }
        if (r.related_functions?.length) {
          text += `  关联函数: ${r.related_functions.join(', ')}\n`;
          text += `${this.renderRelatedFunctions(r.related_functions, subTask.scenario_name, subTask.ontology_name)}\n`;
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

    // 合法行为列表：本子任务唯一可调用的行为/函数范围。
    // 主行为 + 规则关联行为（data_supplements 取数接口）+ 两类函数：
    //   ① 规则声明的 related_functions —— 本体函数，经 executeOntoFunction 调用；
    //   ② 公共函数（时间工具等直接 MCP 工具）—— 不经 executeOntoFunction，若不并入列表会被"未列出一律不得调用"误伤。
    // 无规则时列表只有主行为 + 公共函数——子 Agent 无查询类依据，从源头杜绝臆造行为名。
    const allRules = [...meta.preRules, ...meta.postRules];
    const ruleBehaviors = allRules.flatMap(r => r.data_supplements || []);
    // 规则声明的关联函数，剔除已在公共函数行的（公共函数是直接 MCP 工具，不经 executeOntoFunction）
    const ruleFunctions = allRules
      .flatMap(r => r.related_functions || [])
      .filter((f: string) => !COMMON_FUNCTION_NAMES.includes(f));
    text += `\n### 本子任务合法行为列表（只能调用以下行为/函数，严禁调用未列出的）\n`;
    text += `- 主行为: ${subTask.behavior}\n`;
    text += `- 规则关联行为: ${[...new Set(ruleBehaviors.filter(b => b !== subTask.behavior))].join('、') || '（无）'}\n`;
    text += `- 关联函数（规则声明，经 executeOntoFunction 调用）: ${[...new Set(ruleFunctions)].join('、') || '（无）'}\n`;
    text += `- 公共函数（直接 MCP 工具，不经 executeOntoFunction）: ${COMMON_FUNCTION_NAMES.join('、')}\n`;

    return text;
  }

  /**
   * 渲染单个参数结构对象为缩进行：`key: type（必填/可选）— 名称，示例: xxx`。
   * 行为 params 与本体函数 params 结构一致（type/required/display_name/description/example），共用此方法。
   */
  private renderParamSpecs(params: Record<string, any>, indent: string): string {
    const lines: string[] = [];
    for (const k of Object.keys(params)) {
      const spec = params[k] && typeof params[k] === 'object' ? params[k] : {};
      const type = spec.type || 'any';
      const req = spec.required ? '必填' : '可选';
      const label = spec.display_name || spec.description || '';
      const example = spec.example !== undefined && spec.example !== '' ? `，示例: ${spec.example}` : '';
      lines.push(`${indent}${k}: ${type}（${req}）— ${label}${example}`);
    }
    return lines.join('\n');
  }

  /**
   * 渲染规则取数接口（data_supplements）对应查询行为的参数结构。
   * 子 Agent 只知道要调哪个查询行为、不知道传什么参数，这里把行为的 params 声明拼进指令，
   * 让它有权威依据取值，不再靠猜。无参数声明的行为兜底给一行提示。
   */
  private renderSupplementApis(apis: string[], scenario: string, ontology: string): string {
    const lines: string[] = [];
    for (const api of apis) {
      if (!api) continue;
      const params = this.deps.getBehaviorParams(scenario, ontology, api);
      const keys = params && typeof params === 'object' ? Object.keys(params) : [];
      if (keys.length === 0) {
        lines.push(`  ${api}（未声明参数）`);
        continue;
      }
      lines.push(`  ${api} 参数:`);
      lines.push(this.renderParamSpecs(params, '    '));
    }
    return lines.join('\n');
  }

  /**
   * 渲染规则关联函数（related_functions）。
   * 共享函数是直接 MCP 工具，参数在工具 schema 可见，只标注"共享函数"；
   * 本体函数走 executeOntoFunction 包装、参数不可见，需把 functions[].params 结构渲染出来（与规则一致）。
   */
  private renderRelatedFunctions(funcs: string[], scenario: string, ontology: string): string {
    const lines: string[] = [];
    for (const fn of funcs) {
      if (!fn) continue;
      const params = this.deps.getFunctionParams(scenario, ontology, fn);
      if (params === null) {
        lines.push(`  ${fn}（共享函数，参数见工具定义）`);
        continue;
      }
      const keys = Object.keys(params);
      if (keys.length === 0) {
        lines.push(`  ${fn}（无参数）`);
        continue;
      }
      lines.push(`  ${fn} 参数:`);
      lines.push(this.renderParamSpecs(params, '    '));
    }
    return lines.join('\n');
  }

  /** 提取子任务执行结果：以 LLM 回复末尾的【状态】标记为准。工具报错已由内层自纠/预算兜底，不再额外判失败。 */
  private extractResult(messages: any[], seq: number, behavior: string): SubTaskResult {
    const last = [...messages].reverse().find((m: any) => m.role === 'assistant' && !m.errorMessage);
    const content = last ? contentToText(last.content) : '';
    const { failed } = parseResultStatus(content);
    const success = !failed;
    return {
      seq, behavior,
      success,
      summary: stripResultStatus(content),
    };
  }
}
