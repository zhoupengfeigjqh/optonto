/**
 * 子任务执行策略 —— createChildAgent 的全部执行面配置收拢为一个完整策略对象（单一派生点）。
 *
 * 改造前 createChildAgent 拖多个可选参数（errorBudget / legalCalls / security 等），
 * 缺省语义各不相同（不传 = 闸关 / 无预算 / 白名单封死），"半设防子 Agent"整类 bug 编译器不报错。
 * 现在：策略由 buildSubtaskPolicy 一处派生（输入 = 子任务 + 主行为 meta + 元数据查询口 + run 级安全闸），
 * createChildAgent(context, policy) 二参完备——要么全有，要么编译不过。
 *
 * 派生规则（三件套同源）：
 * - legalCalls：主行为 + 规则关联行为/函数 + 父 Agent 指定的 related_functions（本文件 legalCallNames 私有化，
 *   唯一调用点即 buildSubtaskPolicy——"能调什么"与"怎么设防"同生同灭，不允许脱离策略对象单独取集合）。
 *   语义（2026-09 facade 化后）：子 Agent 挂载期过滤的唯一依据——行为工具按 scope.name 裸名匹配
 *   legalCalls.behaviors，函数工具按工具名匹配 legalCalls.functions；未挂载即不可调用，机制即白名单。
 *   参数合法性不再由运行期闸门负责：行为/函数工具的 inputSchema（core 编译，含约束）由 harness 校验。
 *   data_supplements 是规则取数接口，【约定只读】（前提已文档化；若未来需要防御，
 *   可在建集合时用 getBehaviorMeta(...).isWrite 过滤写行为）。
 *   公共函数不再恒挂全部——按「规则声明或父 Agent 指定」的并集挂载；
 *   新增 MCP 工具不在集合内：不承载 behavior/function 名，需父 Agent 经 related_functions 显式指定才挂载。
 * - security.disabled：合法清单内 scope 含 disable 的行为集合（值带 display_name，报错文案用）
 * - errorBudget：每子任务一份新预算（连续报错上限熔断）
 *
 * needsSecurityConfirm 也同居此文件（原 security-policy.ts）：它是"要不要弹确认窗"的执行面判定，
 * 与 disable 闸（运行面硬中断）不同层——确认在调度/指令侧，disable 在工具侧。
 */
import { createToolErrorBudget } from './error-budget.js';
import type { ToolErrorBudget } from './error-budget.js';
import type { ChildSecurityCtx, SecurityGate } from './security-policy.js';
import type { SubTask, BehaviorMeta } from '../types.js';

/**
 * 子任务元数据查询口 —— 策略派生与子任务展示所需的全部本体/函数元数据投影。
 * orchestrator 一次性接线（gateway + run 级函数目录快照），SubtaskRunner 不再逐字段声明查询 lambda。
 */
export interface SubtaskInfoPort {
  /** 按 (scenario, ontology, behavior) 解析行为中文名 display_name（工具调用展示 / disable 报错文案用） */
  behaviorDisplayName(scenario: string, ontology: string, behaviorName: string): string;
  /** 按 (scenario, ontology, function) 解析函数中文名 display_name（工具调用展示用） */
  functionDisplayName(scenario: string, ontology: string, functionName: string): string;
  /** 按 (scenario, ontology, behavior) 解析权限范围 scope（恒数组；disable 禁用集合数据源） */
  behaviorScope(scenario: string, ontology: string, behaviorName: string): string[];
}

/**
 * 子任务执行策略 —— createChildAgent 的完整输入。
 * 三件套一次派生、整体传递：合法清单（挂载过滤）、安全上下文（闸0/闸1：禁用集合 + run 级共享闸）、报错预算（熔断）。
 */
export interface SubtaskPolicy {
  legalCalls: LegalCalls;
  errorBudget: ToolErrorBudget;
  security: ChildSecurityCtx;
}

/** 子 Agent 合法调用名集合（行为工具挂载集合 + 函数工具挂载集合） */
export interface LegalCalls {
  /** 合法 behavior_name 集合 */
  behaviors: string[];
  /** 合法 function_name 集合（本体函数 + 公共函数，函数名 = 工具名） */
  functions: string[];
}

/**
 * 人工确认判定（单一事实源）：subtask-runner 确认弹窗 / 子任务指令安全注记 / orchestrator 串行调度 三处共用。
 * 有 securities 登记 → 按登记的 confirm（confirm:false 显式关闭，覆盖写操作强制确认）；
 * 无登记 → 写操作（isWrite）默认强制确认，读操作不确认。
 */
export function needsSecurityConfirm(meta: BehaviorMeta): boolean {
  return meta.security ? meta.security.confirm : meta.isWrite;
}

/**
 * 从行为元信息 + 主行为名 + 父 Agent 指定的 related_functions 提取合法调用集合（私有：唯一调用点 buildSubtaskPolicy）。
 * 去重、剔除空项。函数集合 = 规则声明的 related_functions（含公共函数）∪ 父 Agent 补充的 related_functions，
 * 二者取并集，保证规则验证所需函数永远在列，父 Agent 又能额外注入统计/计算函数。
 */
function legalCallNames(meta: BehaviorMeta, primaryBehavior: string, parentRelatedFunctions: string[] = []): LegalCalls {
  const allRules = [...meta.preRules, ...meta.postRules];
  const ruleBehaviors = allRules.flatMap(r => r.data_supplements || []);
  const ruleFunctions = allRules.flatMap(r => r.related_functions || []);
  return {
    behaviors: [...new Set([primaryBehavior, ...ruleBehaviors].filter(Boolean))],
    functions: [...new Set([...ruleFunctions, ...parentRelatedFunctions].filter(Boolean))],
  };
}

/**
 * 从子任务与主行为 meta 派生完整执行策略。
 * 子任务启动时新鲜计算（gateway mtime 缓存保证规划确认后改禁也能拦）；执行中不追热更新。
 * gate 由调用方（run 级）传入共享实例——一个 run 所有子任务的策略指向同一道闸。
 */
export function buildSubtaskPolicy(
  subTask: SubTask,
  meta: BehaviorMeta,
  info: SubtaskInfoPort,
  gate: SecurityGate,
): SubtaskPolicy {
  const legalCalls = legalCallNames(meta, subTask.behavior, subTask.related_functions);

  // 禁用集合（闸1 输入）：合法清单内 scope 含 disable 的行为（含主行为与规则补充行为）。
  // 键为行为裸名（与行为工具 scope.name const 同口径）；主行为 display_name 取 meta，补充行为走 info.behaviorDisplayName。
  const disabled = new Map<string, string>();
  for (const bn of legalCalls.behaviors) {
    if (info.behaviorScope(subTask.scenario_name, subTask.ontology_name, bn).includes('disable')) {
      disabled.set(bn, bn === subTask.behavior
        ? (meta.display_name || '')
        : info.behaviorDisplayName(subTask.scenario_name, subTask.ontology_name, bn));
    }
  }

  return {
    legalCalls,
    errorBudget: createToolErrorBudget(),
    security: { disabled, gate },
  };
}
