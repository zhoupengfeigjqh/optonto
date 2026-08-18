/**
 * 参数契约 —— 「必填 / 类型 / 缺值」判定的单一权威 module。
 * 计划期结构校验（plan-validation）、执行期缺值硬检查（agent-factory scopeToOntology）、
 * 子 Agent 指令渲染（subtask-runner buildInstruction）、中继结构提示（orchestrator runWaveFeedback）
 * 都从这里取判定，不再各自重复实现。
 * 校验口径：必填 key 齐全 + 包装 type 与声明一致 + 已填非空 value 的真实类型递归比对
 * （array/object 沿 items/properties 递归进内部，错误带路径）；value 留空放行，由子 Agent / 中继补。
 */
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { BehaviorMeta } from '../types.js';

/** 行为声明中的单个参数（可能只有部分字段；items/properties 承载 array/object 的内部结构声明） */
export interface ParamSpec {
  type?: string;
  required?: boolean;
  description?: string;
  display_name?: string;
  example?: unknown;
  value?: unknown;
  /** array 参数的项结构声明（项为 object 时带 properties） */
  items?: ParamSpec;
  /** object 参数的字段结构声明 */
  properties?: Record<string, ParamSpec>;
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

/** value 实际类型的简短名（报错文案用） */
function jsTypeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ─── 递归值校验（TypeBox 引擎） ─────────────────────────────────────
// 声明 spec → TypeBox schema 递归编译，校验交给 Value.Errors（成熟库保证嵌套语义，错误自带路径）。
// 与 core-backend 执行期的 jsonschema 校验是同一形式体系（TypeBox 即 JSON Schema 生成器），
// 规划期拦的错和执行期会报的错语义对齐。

/** 递归深度上限：防病态声明无限嵌套；超限后按 Unknown（不校验内部）处理 */
const MAX_DECL_DEPTH = 5;
/** 单个参数最多报出的值错误数：大数组全错时不刷爆 nudge 上下文 */
const MAX_VALUE_ERRORS = 3;

/**
 * 声明 spec → TypeBox schema 递归编译。返回 null = 未知/未声明 type，无比对依据（跳过，MCP schema 兜底）。
 * 类型映射与历史口径一致：string/enum→string，integer/int→Integer，number/float→Number，boolean，array，object。
 * object 未声明 properties → Type.Object({})（只查"是对象"，多余字段放行——声明可能不全）；
 * array 未声明 items → Type.Array(Unknown)（只查"是数组"）。
 */
function declaredSpecToSchema(spec: ParamSpec, depth = 0): TSchema | null {
  if (depth > MAX_DECL_DEPTH) return Type.Unknown();
  switch (spec.type) {
    case 'string':
    case 'enum':
      return Type.String();
    case 'integer':
    case 'int':
      return Type.Integer();
    case 'number':
    case 'float':
      return Type.Number();
    case 'boolean':
      return Type.Boolean();
    case 'array': {
      const itemSchema = spec.items && typeof spec.items === 'object'
        ? declaredSpecToSchema(spec.items, depth + 1) : null;
      return Type.Array(itemSchema ?? Type.Unknown());
    }
    case 'object': {
      const props = spec.properties;
      if (!props || typeof props !== 'object') return Type.Object({});
      const fields: Record<string, TSchema> = {};
      for (const [k, v] of Object.entries(props)) {
        if (!v || typeof v !== 'object') continue;
        const fs = declaredSpecToSchema(v, depth + 1) ?? Type.Unknown();
        fields[k] = v.required ? fs : Type.Optional(fs);
      }
      return Type.Object(fields);
    }
    default:
      return null;
  }
}

/** TypeBox 错误路径 "/0/arrivalQuantity" → "[0].arrivalQuantity"（拼在参数名后展示） */
function formatValuePath(path: string): string {
  return path.split('/').filter(Boolean)
    .map(seg => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`)).join('');
}

/**
 * 已填非空 value 对声明 spec 的递归校验。array/object 沿 items/properties 深入，错误带路径。
 * 返回错误列表（空 = 通过）。调用前已剥嵌套包装（unwrapParamValue），故比对的是纯值。
 */
function validateValueAgainstDecl(value: unknown, spec: ParamSpec, prefix: string): string[] {
  const schema = declaredSpecToSchema(spec);
  if (!schema) return [];
  const errs = [...Value.Errors(schema, value)];
  // TypeBox 对缺失必填字段报双错（Expected required property + Expected X，后者 value=undefined），去重留前者
  const missingPaths = new Set(errs.filter(e => e.message === 'Expected required property').map(e => e.path));
  const filtered = errs.filter(e =>
    e.message === 'Expected required property' || !(e.value === undefined && missingPaths.has(e.path)));
  const out: string[] = [];
  for (const e of filtered.slice(0, MAX_VALUE_ERRORS)) {
    const path = formatValuePath(e.path);
    if (e.message === 'Expected required property') {
      out.push(`${prefix}${path} 缺少必填字段`);
      continue;
    }
    // 顶层错误用声明原文 type（如 enum/int），嵌套错误取 TypeBox 报出的类型名
    const m = /^Expected (.+)$/.exec(e.message);
    const declared = e.path === '' ? (spec.type ?? m?.[1]) : (m?.[1] ?? spec.type);
    const shown = JSON.stringify(e.value) ?? String(e.value);
    out.push(`${prefix}${path} 声明类型 ${declared}，实际填入值 ${shown.length > 40 ? shown.slice(0, 40) + '…' : shown}（${jsTypeName(e.value)}），请按声明类型修正`);
  }
  if (filtered.length > MAX_VALUE_ERRORS) {
    out.push(`${prefix} 共 ${filtered.length} 处类型错误，仅列出前 ${MAX_VALUE_ERRORS} 处`);
  }
  return out;
}

// ─── 参数结构 sketch 渲染（中继提示用） ─────────────────────────────
// 与递归校验遍历同一份声明：父 Agent 填值时看到的结构，和校验器判错时依据的结构是同一张图。

/**
 * 把声明参数渲染为紧凑结构 sketch（每行一条）。array 展开"数组项结构"、object 展开"字段结构"，递归；
 * 标量单行。filled 传入时标注填充状态（当前未填/已填），供中继提示父 Agent 哪些参数等它填。
 */
export function renderParamStructure(key: string, spec: ParamSpec, opts: { filled?: boolean } = {}, indent = '', depth = 0): string[] {
  const reqMark = spec.required ? '（必填）' : '';
  const label = spec.description || spec.display_name || '';
  const desc = label ? ` — ${label}` : '';
  const example = spec.example !== undefined && spec.example !== '' ? `，示例 ${spec.example}` : '';
  const filled = opts.filled === undefined ? '' : opts.filled ? '，已填' : '，当前未填';
  const head = `${indent}${key}: ${spec.type ?? 'any'}${reqMark}${desc}${example}${filled}`;
  if (depth >= MAX_DECL_DEPTH) return [head];
  if (spec.type === 'array' && spec.items?.type === 'object' && spec.items.properties) {
    const lines = [`${head}，数组项结构：`];
    for (const [ik, iv] of Object.entries(spec.items.properties)) {
      lines.push(...renderParamStructure(ik, iv, {}, indent + '  · ', depth + 1));
    }
    return lines;
  }
  if (spec.type === 'object' && spec.properties && typeof spec.properties === 'object') {
    const lines = [`${head}，字段结构：`];
    for (const [pk, pv] of Object.entries(spec.properties)) {
      lines.push(...renderParamStructure(pk, pv, {}, indent + '  · ', depth + 1));
    }
    return lines;
  }
  return [head];
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
    // 已填非空值对声明的递归类型比对（空值放行：缺值由子 Agent 按 SKILL.md 补 / 波次反馈中继填）。
    // 不限 required——可选参数填了错类型同样是错。array/object 沿 items/properties 递归进内部，
    // 错误带路径（如 purchaseRecordSet[0].arrivalQuantity）；比对前先剥嵌套 {value} 包装（真实中继产物）。
    if (s.type && !isParamValueEmpty(p)) {
      const value = unwrapParamValue((p as ParamSpec).value);
      errors.push(...validateValueAgainstDecl(value, s, `子任务${seq}(${name}) 参数 ${key}`));
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

/** 递归剥任意层级的 {value} 包装：数组逐项、对象逐字段；真实业务对象（非纯包装）原样保留。 */
function deepUnwrap(v: any): any {
  if (Array.isArray(v)) return v.map(deepUnwrap);
  if (v && typeof v === 'object') {
    if (isParamWrapper(v)) return deepUnwrap(v.value);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = deepUnwrap(v[k]);
    return out;
  }
  return v;
}

/** 单值版深展开：递归值校验前剥数组项/对象字段里的嵌套 {value} 包装（真实中继产物）。 */
export function unwrapParamValue(v: unknown): unknown {
  return deepUnwrap(v);
}

/**
 * 把计划期参数结构 `{key: {type/required/description/value}}` 深展开为纯值 `{key: value}`。
 * 递归处理数组项与嵌套对象：只剥离"带 value 键的包装对象"，真实业务对象原样保留。
 * 函数子任务绕过 LLM 直连 MCP，若不展开，函数收到的是 dict 而非纯值（历史教训见 tool-subtask-param-unwrap）。
 */
export function unwrapParamValues(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = deepUnwrap(v);
  return out;
}
