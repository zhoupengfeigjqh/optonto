/**
 * 子任务执行策略 —— createChildAgent 的全部执行面配置收拢为一个完整策略对象（单一派生点）。
 *
 * 改造前 createChildAgent 拖 5 个可选参数（requiredParamsMap / errorBudget / legalCalls / security），
 * 缺省语义各不相同（不传 = 闸关 / 无预算 / 白名单封死），"半设防子 Agent"整类 bug 编译器不报错。
 * 现在：策略由 buildSubtaskPolicy 一处派生（输入 = 子任务 + 主行为 meta + 元数据查询口 + run 级安全闸），
 * createChildAgent(context, policy) 二参完备——要么全有，要么编译不过。
 *
 * 派生规则（四件套同源）：
 * - legalCalls：主行为 + 规则关联行为/函数 + 父 Agent 指定的 related_functions（legalCallNames 单一事实源）
 * - requiredParamsMap：所有合法行为的必填参数名表（主行为取 meta，补充行为走 info.behaviorParams）
 * - security.disabled：合法清单内 scope 含 disable 的行为集合（值带 display_name，报错文案用）
 * - errorBudget：每子任务一份新预算（连续报错上限熔断）
 */
import { legalCallNames } from './legal-calls.js';
import type { LegalCalls } from './legal-calls.js';
import { requiredParamNames } from './param-contract.js';
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
  /** 按 (scenario, ontology, behavior) 解析行为参数结构（必填表派生 / 规则取数接口渲染用） */
  behaviorParams(scenario: string, ontology: string, behaviorName: string): Record<string, any>;
  /** 按 (scenario, ontology, behavior) 解析权限范围 scope（恒数组；disable 禁用集合数据源） */
  behaviorScope(scenario: string, ontology: string, behaviorName: string): string[];
}

/**
 * 子任务执行策略 —— createChildAgent 的完整输入。
 * 四件套一次派生、整体传递：合法清单（白名单闸+挂载过滤）、必填表（闸3）、
 * 安全上下文（闸0/闸1：禁用集合 + run 级共享闸）、报错预算（熔断）。
 */
export interface SubtaskPolicy {
  legalCalls: LegalCalls;
  requiredParamsMap: Record<string, string[]>;
  errorBudget: ToolErrorBudget;
  security: ChildSecurityCtx;
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

  // 必填参数名表（所有合法行为）：凡 executeOntoBehavior 调用按 behavior_name 查表，缺失即拒
  const requiredParamsMap: Record<string, string[]> = {};
  for (const bn of legalCalls.behaviors) {
    requiredParamsMap[bn] = bn === subTask.behavior
      ? requiredParamNames(meta)
      : requiredParamNames({ params: info.behaviorParams(subTask.scenario_name, subTask.ontology_name, bn) });
  }

  // 禁用集合（闸1 输入）：合法清单内 scope 含 disable 的行为（含主行为与规则补充行为）。
  // 主行为 display_name 取 meta，补充行为走 info.behaviorDisplayName。
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
    requiredParamsMap,
    errorBudget: createToolErrorBudget(),
    security: { disabled, gate },
  };
}
