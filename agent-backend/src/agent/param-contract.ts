/**
 * 参数契约 —— 「必填 / 类型 / 缺值」判定的单一权威 module。
 * 计划期结构校验（plan-validation）、执行期缺值硬检查（agent-factory scopeToOntology）、
 * 子 Agent 指令渲染（subtask-runner buildInstruction）都从这里取判定，不再各自重复实现。
 * 校验口径：只查"结构"（必填 key + 类型），value 缺失由子 Agent 按 SKILL.md 补。
 */
import type { BehaviorMeta } from '../types.js';

/** 行为声明中的单个参数（可能只有 type/required/description/value 之一） */
export interface ParamSpec {
  type?: string;
  required?: boolean;
  description?: string;
  value?: unknown;
}

/** 从行为元信息提取必填参数名列表 */
export function requiredParamNames(meta: BehaviorMeta): string[] {
  return Object.entries(meta.params || {})
    .filter(([, s]) => (s as ParamSpec)?.required)
    .map(([k]) => k);
}

/** 参数值是否为空（缺失/未填/空串）。兼容标量值与结构化 { value } 两种形态。 */
export function isParamValueEmpty(param: unknown): boolean {
  if (param === undefined || param === null) return true;
  if (typeof param === 'object') {
    const v = (param as ParamSpec).value;
    return v === undefined || v === null || String(v).trim() === '';
  }
  return String(param).trim() === '';
}

/** 单个行为参数的「结构」校验：必填 key 齐全 + 类型匹配。返回错误列表。 */
export function validateParamStructure(meta: BehaviorMeta, provided: Record<string, any>, seq: number, behavior: string): string[] {
  const errors: string[] = [];
  const declared = meta.params || {};
  for (const [key, spec] of Object.entries(declared)) {
    const s = spec as ParamSpec;
    const p = provided[key];
    if (!p || typeof p !== 'object') {
      if (s.required) errors.push(`子任务${seq}(${behavior}) 缺少必填参数 ${key}`);
      continue;
    }
    if (s.required && s.type && (p as ParamSpec).type && (p as ParamSpec).type !== s.type) {
      errors.push(`子任务${seq}(${behavior}) 参数 ${key} 类型应为 ${s.type}，实际 ${(p as ParamSpec).type}`);
    }
  }
  return errors;
}

/** 渲染单个参数（子 Agent 指令展示用）。标量值直接显示，结构化参数取 value。 */
export function renderParam(key: string, param: unknown): string {
  const isObj = typeof param === 'object' && param !== null;
  const p = isObj ? (param as ParamSpec) : {};
  const pType = isObj ? (p.type || 'any') : 'any';
  const pRequired = isObj && p.required ? '* ' : '  ';
  const pDesc = isObj ? (p.description || '') : '';
  const pVal = isObj
    ? (p.value !== undefined && p.value !== '' ? `✅ ${p.value}` : '← 待补充')
    : `✅ ${param}`;
  return `  ${pRequired}${key}: ${pType} — ${pDesc} ${pVal}`;
}
