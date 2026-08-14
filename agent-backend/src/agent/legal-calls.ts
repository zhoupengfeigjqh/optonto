/**
 * 子 Agent 合法调用集合 —— 「本子任务能调哪些 behavior / function」的单一事实源。
 * 机制（scopeToOntology 白名单闸门）与文案（buildInstruction 合法行为列表）都从这里取值，
 * 避免两份各写一遍导致漂移（历史教训：父 Agent 边界曾因提示词与机制脱节而双重执行）。
 *
 * 语义（与父 Agent 工具边界同源，见 agent-factory.ts）：
 * - 行为（executeOntoBehavior 白名单）：主行为 + 前置/后置规则声明的 data_supplements。
 *   data_supplements 是规则取数接口，【约定只读】（前提已文档化；若未来需要防御，
 *   可在建集合时用 getBehaviorMeta(...).isWrite 过滤写行为）。
 * - 函数（executeOntoFunction 白名单）：规则声明的 related_functions 剔除公共函数
 *   （公共函数是直接 MCP 工具，不经 executeOntoFunction，故不在本集合）。
 * - 公共函数与新增 MCP 工具不在此集合：它们不承载 behavior/function 名，不受白名单闸门约束。
 */
import type { BehaviorMeta } from '../types.js';
import { COMMON_FUNCTION_NAMES } from './agent-factory.js';

/** 子 Agent 合法调用名集合（executeOntoBehavior / executeOntoFunction 白名单） */
export interface LegalCalls {
  /** 合法 behavior_name 集合 */
  behaviors: string[];
  /** 合法 function_name 集合 */
  functions: string[];
}

/** 从行为元信息 + 主行为名提取合法调用集合。去重、剔除空项。 */
export function legalCallNames(meta: BehaviorMeta, primaryBehavior: string): LegalCalls {
  const allRules = [...meta.preRules, ...meta.postRules];
  const ruleBehaviors = allRules.flatMap(r => r.data_supplements || []);
  const ruleFunctions = allRules
    .flatMap(r => r.related_functions || [])
    .filter(f => !COMMON_FUNCTION_NAMES.includes(f));
  return {
    behaviors: [...new Set([primaryBehavior, ...ruleBehaviors].filter(Boolean))],
    functions: [...new Set(ruleFunctions.filter(Boolean))],
  };
}
