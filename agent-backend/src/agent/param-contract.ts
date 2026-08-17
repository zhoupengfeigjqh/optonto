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

/** 单个参数的「结构」校验：必填 key 齐全 + 类型匹配。返回错误列表。
 *  第一参改为「已声明的参数结构对象」（行为 params 或本体函数 params），复用同一判定，避免函数/行为各写一套。 */
export function validateParamStructure(declared: Record<string, any>, provided: Record<string, any>, seq: number, name: string): string[] {
  const errors: string[] = [];
  for (const [key, spec] of Object.entries(declared || {})) {
    const s = spec as ParamSpec;
    const p = provided[key];
    if (!p || typeof p !== 'object') {
      if (s.required) errors.push(`子任务${seq}(${name}) 缺少必填参数 ${key}`);
      continue;
    }
    if (s.required && s.type && (p as ParamSpec).type && (p as ParamSpec).type !== s.type) {
      errors.push(`子任务${seq}(${name}) 参数 ${key} 类型应为 ${s.type}，实际 ${(p as ParamSpec).type}`);
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

// ─── 参数深展开（函数子任务直连 MCP 前用） ─────────────────────────────

/** 计划期参数包装的合法键集：{type/required/description/value}。真实 LLM 波次反馈中继会把
 *  包装递归嵌套进数组项（`purchaseRecordSet: [{arrivalTime: {value:"2026-09-01"}, ...}]`），
 *  只靠"带 value 键"这一特征即可安全剥离，而不会误伤业务字段（本域业务数据无 value 键）。 */
const PARAM_WRAPPER_KEYS = new Set(['type', 'required', 'description', 'value']);

/** 判断一个对象是否为计划期参数包装（含 value 键且其余键都在包装键集内，兼容单键 {value} 与四键 {type/required/description/value}）。 */
function isParamWrapper(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'value' in v
    && Object.keys(v).every(k => PARAM_WRAPPER_KEYS.has(k));
}

/**
 * 把计划期参数结构 `{key: {type/required/description/value}}` 深展开为纯值 `{key: value}`。
 * 递归处理数组项与嵌套对象：只剥离"带 value 键的包装对象"，真实业务对象原样保留。
 * 函数子任务绕过 LLM 直连 MCP，若不展开，函数收到的是 dict 而非纯值（历史教训见 tool-subtask-param-unwrap）。
 */
export function unwrapParamValues(params: Record<string, any>): Record<string, any> {
  const deep = (v: any): any => {
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === 'object') {
      if (isParamWrapper(v)) return deep(v.value);
      const out: Record<string, any> = {};
      for (const k of Object.keys(v)) out[k] = deep(v[k]);
      return out;
    }
    return v;
  };
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = deep(v);
  return out;
}
