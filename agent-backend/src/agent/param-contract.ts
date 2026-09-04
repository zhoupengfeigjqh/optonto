/**
 * 参数契约 —— 规划期参数校验与参数包装的单一权威 module。
 *
 * 形态已定（2026-09 facade 化改造）：core 端把行为/函数参数声明 + 概念属性约束
 * （enum/pattern/min/max/必填 minLength）确定性编译为一等 MCP 工具的 inputSchema，
 * 执行期由 harness 按 schema 校验。本 module 只保留两类职责：
 *  1. 规划期校验：把同一份编译 schema 转 TypeBox，对计划期参数（{type/required/description/value}
 *     包装形态）做"必填 key 齐全 + 已填值合规"校验（validateParamsAgainstSchema）。
 *     规划期语义：必填 key 须在，value 允许留空（待子 Agent 补 / 波次反馈中继填）——
 *     故值校验前剥空值、顶层 required 全降级可选；嵌套 required 保留（填了半截的对象仍是错）。
 *  2. 参数包装深展开（unwrapParamValue(s)）：函数直连 MCP / 值校验前剥 {value} 包装。
 * 子 Agent 指令渲染（renderParamStructure sketch）供中继提示与 PlanGate nudge 共用。
 */
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/** 行为/函数声明中的单个参数（items/properties 承载 array/object 的内部结构声明） */
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

/** 递归深度上限：防病态声明无限嵌套；超限后按 Unknown（不校验内部）处理 */
const MAX_DECL_DEPTH = 5;
/** 单个子任务最多报出的值错误数：大数组全错时不刷爆 nudge 上下文 */
const MAX_VALUE_ERRORS = 3;

// ─── JSON Schema → TypeBox（规划期校验引擎适配） ─────────────────────
// Value.Errors 只认 TypeBox schema（带 Kind 符号），core 编译产物是原生 JSON Schema，
// 这里做确定性转换：类型/必填/嵌套 items·properties/约束关键字（enum/pattern/minimum/maximum/minLength）全覆盖。

/** 数值范围关键字提取（minimum/maximum 仅对 number/integer 生效） */
function rangeOpts(schema: any): { minimum?: number; maximum?: number } {
  const opts: { minimum?: number; maximum?: number } = {};
  if (typeof schema?.minimum === 'number') opts.minimum = schema.minimum;
  if (typeof schema?.maximum === 'number') opts.maximum = schema.maximum;
  return opts;
}

/**
 * JSON Schema → TypeBox schema 递归编译。
 * dropRequired：本层 object 的 required 全部降级为 Optional（规划期顶层语义：必填 key 在即可，值可留空）；
 * 嵌套层不传（填了半截的数组项/对象，缺必填字段仍是错）。
 * 未识别/无 type → Unknown（无比对依据，放行）。
 */
export function jsonSchemaToTypeBox(schema: any, depth = 0, dropRequired = false): TSchema {
  if (!schema || typeof schema !== 'object' || depth > MAX_DECL_DEPTH) return Type.Unknown();
  if (schema.const !== undefined) return Type.Literal(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return Type.Union(schema.enum.map((v: any) => Type.Literal(v)));
  }
  switch (schema.type) {
    case 'string': {
      const opts: { pattern?: string; minLength?: number } = {};
      if (typeof schema.pattern === 'string' && schema.pattern) opts.pattern = schema.pattern;
      if (typeof schema.minLength === 'number') opts.minLength = schema.minLength;
      return Type.String(opts);
    }
    case 'integer': return Type.Integer(rangeOpts(schema));
    case 'number': return Type.Number(rangeOpts(schema));
    case 'boolean': return Type.Boolean();
    case 'array':
      return Type.Array(jsonSchemaToTypeBox(schema.items ?? {}, depth + 1));
    case 'object': {
      const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
      const required = new Set<string>(dropRequired ? [] : (Array.isArray(schema.required) ? schema.required.map(String) : []));
      const fields: Record<string, TSchema> = {};
      for (const [k, v] of Object.entries(props)) {
        const fs = jsonSchemaToTypeBox(v, depth + 1);
        fields[k] = required.has(k) ? fs : Type.Optional(fs);
      }
      return Type.Object(fields);
    }
    default:
      return Type.Unknown();
  }
}

/** TypeBox 错误路径 "/0/arrivalQuantity" → "[0].arrivalQuantity"（拼在参数名后展示） */
export function formatValuePath(path: string): string {
  return path.split('/').filter(Boolean)
    .map(seg => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`)).join('');
}

/** 单条 TypeBox 错误 → 中文明细（按失败节点的 schema 关键字分类，与历史校验文案口径一致） */
function formatValueError(e: { schema: any; value: any; message: string }): string {
  const s = e.schema ?? {};
  const shown = JSON.stringify(e.value) ?? String(e.value);
  const short = shown.length > 40 ? shown.slice(0, 40) + '…' : shown;
  if (e.message === 'Expected required property') return '缺少必填字段';
  // enum 编译为 Union(Literal...) → 失败节点 anyOf 每项带 const
  const enumVals: any[] | undefined = Array.isArray(s.enum) ? s.enum
    : (Array.isArray(s.anyOf) && s.anyOf.every((x: any) => x && x.const !== undefined)
      ? s.anyOf.map((x: any) => x.const) : undefined);
  if (enumVals) return `值 ${short} 不在枚举值 [${enumVals.join(' / ')}] 内`;
  if (typeof s.pattern === 'string') return `值 ${short} 不匹配模式 ${s.pattern}`;
  if (typeof s.minimum === 'number' && typeof e.value === 'number' && e.value < s.minimum) {
    return `值 ${e.value} 低于最小值 ${s.minimum}（取值范围 ${s.minimum} ~ ${typeof s.maximum === 'number' ? s.maximum : '+∞'}）`;
  }
  if (typeof s.maximum === 'number' && typeof e.value === 'number' && e.value > s.maximum) {
    return `值 ${e.value} 高于最大值 ${s.maximum}（取值范围 ${typeof s.minimum === 'number' ? s.minimum : '-∞'} ~ ${s.maximum}）`;
  }
  if (typeof s.minLength === 'number') return `值不能为空`;
  return `声明类型 ${s.type ?? '?'}，实际填入值 ${short}（${jsTypeName(e.value)}），请按声明类型修正`;
}

/**
 * 规划期参数校验（行为/函数统一入口）：对编译 schema 跑「必填 key 齐全 + 已填值合规」。
 * schema = core 编译的 MCP 工具 inputSchema（scope/ontology_id 已由挂载目录剥离；此处再防御性跳过）。
 * provided = 子任务 params（计划期包装形态 {key: {type/required/description/value}}）。
 * 校验口径：
 *  - 结构：schema.required 的 key 必须在 provided 中（且为包装对象）；包装自报 type 与声明不一致报错。
 *  - 值：剥包装、剔空值后对 schema 跑 TypeBox Value.Errors（顶层 required 降级可选——留空待补不是错；
 *    enum/pattern/minimum/maximum/minLength 全覆盖，嵌套 array/object 递归带路径）。
 * 返回错误列表（空 = 通过）。
 */
export function validateParamsAgainstSchema(schema: any, provided: Record<string, any>, seq: number, name: string): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') return errors;
  const props: Record<string, any> = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const keys = Object.keys(props).filter(k => k !== 'ontology_id' && k !== 'scope');
  const required = (Array.isArray(schema.required) ? schema.required.map(String) : [])
    .filter((k: string) => keys.includes(k));

  // 结构：必填 key 齐全 + 包装自报 type 与声明一致
  for (const key of keys) {
    const p = provided?.[key];
    const isWrapper = !!p && typeof p === 'object';
    if (required.includes(key) && !isWrapper) {
      errors.push(`子任务${seq}(${name}) 缺少必填参数 ${key}`);
      continue;
    }
    const declaredType = isWrapper ? (p as ParamSpec).type : undefined;
    const schemaType = props[key]?.type;
    if (required.includes(key) && schemaType && declaredType && declaredType !== schemaType) {
      errors.push(`子任务${seq}(${name}) 参数 ${key} 类型应为 ${schemaType}，实际 ${declaredType}`);
    }
  }

  // 值：剥包装取已填非空值，组装纯值对象
  const values: Record<string, any> = {};
  for (const key of keys) {
    const p = provided?.[key];
    if (isParamValueEmpty(p)) continue; // 空值放行：缺值由子 Agent 补 / 波次反馈中继填
    values[key] = unwrapParamValue(p && typeof p === 'object' ? (p as ParamSpec).value : p);
  }
  if (Object.keys(values).length === 0) return errors;

  const valueProps: Record<string, any> = {};
  for (const key of keys) valueProps[key] = props[key];
  const tb = jsonSchemaToTypeBox({ type: 'object', properties: valueProps, required: [] }, 0);
  const errs = [...Value.Errors(tb, values)];
  // TypeBox 对缺失必填字段报双错（Expected required property + Expected X，后者 value=undefined），去重留前者
  const missingPaths = new Set(errs.filter(e => e.message === 'Expected required property').map(e => e.path));
  const filtered = errs.filter(e =>
    e.message === 'Expected required property' || !(e.value === undefined && missingPaths.has(e.path)));
  for (const e of filtered.slice(0, MAX_VALUE_ERRORS)) {
    // 顶层路径 "/qty" → "qty"，嵌套 "/purchaseRecordSet/0/qty" → "purchaseRecordSet[0].qty"
    const path = formatValuePath(e.path).replace(/^\./, '');
    errors.push(`子任务${seq}(${name}) 参数 ${path} ${formatValueError(e)}`);
  }
  if (filtered.length > MAX_VALUE_ERRORS) {
    errors.push(`子任务${seq}(${name}) 共 ${filtered.length} 处值错误，仅列出前 ${MAX_VALUE_ERRORS} 处`);
  }
  return errors;
}

// ─── 参数结构 sketch 渲染（中继提示 / PlanGate nudge 用） ─────────────────────────────
// 与校验遍历同一份声明：父 Agent 填值时看到的结构，和校验器判错时依据的结构是同一张图。

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

// ─── 参数深展开（函数子任务直连 MCP 前 / 值校验前用） ─────────────────────────────

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
