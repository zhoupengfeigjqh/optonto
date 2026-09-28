/**
 * 映射页纯 helper（自 DataEngineTable.tsx 抽取，行为不变）。
 *
 * 三组职责：
 * 1. 字段拍平：schema/params 结构 → 路径列表或 路径→类型 映射（供映射下拉消费）；
 * 2. 结构推导：JSON Schema → 平台 params 结构；真实响应样本 → 字段结构（试调提取）；
 * 3. 表格与弹窗的判据/表单初值：目标接口是否已设置、映射是否类型不符、连接测试表单初值等。
 * 均为纯函数，与视图解耦后可直接单测。
 */
import type { DataEngine, TargetApiConfig } from '@/api/client';

export const emptyTarget: TargetApiConfig = {
  data_source_name: '', api_name: '', url: '', method: '',
  params: {}, response: {},
};

/** 拍平为「路径 → 类型」，覆盖 object 嵌套与 array/array[object] 元素（路径带 [*]） */
export function flattenFieldTypes(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      result[path] = v;
    } else if (typeof v === 'object' && v !== null) {
      const t = (v as any).type || 'string';
      result[path] = t;
      if (t === 'object' && (v as any).properties) {
        Object.assign(result, flattenFieldTypes((v as any).properties, path));
      } else if (t === 'array' && (v as any).items) {
        if ((v as any).items.type === 'object' && (v as any).items.properties) {
          Object.assign(result, flattenFieldTypes((v as any).items.properties, path + '[*]'));
        } else {
          result[path + '[*]'] = (v as any).items.type || 'string';
        }
      } else if (t === 'array[object]' && (v as any).items?.properties) {
        Object.assign(result, flattenFieldTypes((v as any).items.properties, path + '[*]'));
      }
    }
  }
  return result;
}

/** 拍平为字段路径列表（保序，供映射下拉按顺序展示） */
export function flattenFields(obj: Record<string, unknown>, prefix = ''): string[] {
  const result: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      result.push(path);
    } else if (typeof v === 'object' && v !== null) {
      const t = (v as any).type || 'string';
      result.push(path);
      if (t === 'object' && (v as any).properties) {
        result.push(...flattenFields((v as any).properties, path));
      } else if (t === 'array' && (v as any).items) {
        if ((v as any).items.type === 'object' && (v as any).items.properties) {
          result.push(...flattenFields((v as any).items.properties, path + '[*]'));
        } else {
          result.push(path + '[*]');
        }
      } else if (t === 'array[object]' && (v as any).items?.properties) {
        result.push(...flattenFields((v as any).items.properties, path + '[*]'));
      }
    }
  }
  return result;
}

/**
 * JSON Schema → 平台 params/response 结构（{field: {type, description, required, properties/items}}）。
 * 映射页"自动提取 schema"：inputSchema/outputSchema 直接转，映射弹窗的 flattenFields/flattenFieldTypes 原样消费。
 */
export function schemaToParams(schema: Record<string, any> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object') return out;
  const props = schema.properties || {};
  const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];
  for (const [k, v] of Object.entries(props)) {
    out[k] = convertNode(v as Record<string, any>, requiredList.includes(k));
  }
  return out;
}

function convertNode(node: Record<string, any>, required: boolean): Record<string, unknown> {
  const t = node?.type || 'string';
  const out: Record<string, unknown> = { type: t };
  if (required) out.required = true;
  if (node?.description) out.description = node.description;
  if (t === 'object' && node?.properties) {
    out.properties = schemaToParams(node);
  } else if (t === 'array' && node?.items) {
    out.items = node.items.type === 'object' && node.items.properties
      ? { type: 'object', properties: schemaToParams(node.items) }
      : { type: node.items.type || 'string' };
  }
  return out;
}

/** 试调提取：从真实响应样本反推字段结构（值 → type），与 schemaToParams 同形态 */
export function inferFromSample(sample: unknown): Record<string, unknown> {
  if (sample === null || sample === undefined || typeof sample !== 'object') return {};
  const src = Array.isArray(sample) ? (sample[0] ?? {}) : sample;
  if (typeof src !== 'object' || src === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    out[k] = inferNode(v);
  }
  return out;
}

function inferNode(v: unknown): Record<string, unknown> {
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  if (Array.isArray(v)) {
    const first = v[0];
    return first && typeof first === 'object'
      ? { type: 'array', items: { type: 'object', properties: inferFromSample(first) } }
      : { type: 'array', items: { type: typeof first === 'number' ? 'number' : 'string' } };
  }
  if (v !== null && typeof v === 'object') return { type: 'object', properties: inferFromSample(v) };
  return { type: 'string' };
}

/** 新建空白引擎（行为名 → 引擎占位，映射前由设计器填充 target） */
export function emptyEngine(behaviorName: string): DataEngine {
  return {
    name: behaviorName,
    display_name: '',
    behavior_name: behaviorName,
    target: { ...emptyTarget },
    input_mapping: {},
    output_mapping: {},
  };
}


// ─── 表格判据 ─────────────────────────────────────────────────────────────────

/** 目标接口是否已设置（决定「目标接口设置」按钮显示「已设置 / 编辑」）。 */
export function hasTargetEndpoint(target?: TargetApiConfig | null): boolean {
  if (!target) return false;
  return !!(target.server_url || target.tool_name || target.url || target.api_name || target.data_source_name);
}

/**
 * 目标接口是否已声明输入或输出结构。
 * 决定「智能对齐 / 智能映射」是否可用——无结构可对齐时按钮禁用。
 */
export function hasTargetSchema(target?: TargetApiConfig | null): boolean {
  if (!target) return false;
  return !!((target.params && Object.keys(target.params).length > 0)
    || (target.response && Object.keys(target.response).length > 0));
}

/** 已填充的映射条数（按钮文案「已映射 N」）；空值不计。 */
export function countMappedFields(mapping?: Record<string, string> | null): number {
  return Object.values(mapping || {}).filter(Boolean).length;
}

/**
 * 映射弹窗的类型一致性判据：本体字段类型与所选目标字段类型都存在且不同 → 界面黄色告警。
 * 未选目标字段（targetVal 为空）时不算不符。
 */
export function isTypeMismatch(ontoType: string, targetVal: string, targetType: string): boolean {
  return !!(targetVal && ontoType && targetType && ontoType !== targetType);
}

/** 目标字段中尚未被映射覆盖的字段名（映射弹窗底部的黄色遗漏提示）。 */
export function unmappedTargetFields(targetFields: string[], mapping: Record<string, string>): string[] {
  const mapped = Object.values(mapping);
  return targetFields.filter(f => !mapped.includes(f));
}


// ─── 连接测试 / 试调表单 ───────────────────────────────────────────────────────

/**
 * 「连接测试」表单初值：本体参数 → 请求参数与必填标记。
 *
 * 必填判据取自**目标**参数结构（先经输入映射换名，未映射则同名查找），
 * 而非本体参数结构：真正决定能否调用成功的是下游接口的要求。
 * 参数默认值按类型给：object → `'{}'`、array/array[object] → `'[]'`、boolean → false、其余空串。
 * 注意：标量（number 等）不产出初始值，与既有行为一致。
 */
export function buildConnectFormValues(
  ontoParams: Record<string, unknown>,
  targetParams: Record<string, unknown>,
  inputMapping: Record<string, string>,
): { params: Record<string, unknown>; required: Record<string, boolean> } {
  const required: Record<string, boolean> = {};
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ontoParams)) {
    const targetKey = inputMapping[k] || k;
    const targetSpec = targetParams[targetKey];
    if (targetSpec && typeof targetSpec === 'object') {
      required[k] = (targetSpec as any).required !== false;
    }
    if (typeof v === 'string') {
      params[k] = '';
    } else if (typeof v === 'object' && v !== null) {
      const t = (v as any).type || 'string';
      if (t === 'object') params[k] = '{}';
      else if (t === 'array' || t === 'array[object]') params[k] = '[]';
      else if (t === 'boolean') params[k] = false;
      else params[k] = '';
    }
  }
  return { params, required };
}

/** 提交前把字符串形态的 JSON 字面量还原为对象/数组；解析失败保留原字符串（不静默丢弃用户输入）。 */
export function coerceConnectParams(values: Record<string, any>): Record<string, any> {
  const parsed: Record<string, any> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try { parsed[k] = JSON.parse(v); } catch { parsed[k] = v; }
    } else {
      parsed[k] = v;
    }
  }
  return parsed;
}

/** 试调样例参数：按已提取的输入 schema 生成各类型的占位默认值；输入 JSON 非法时给空样例。 */
export function seedArgsFromParamSchema(paramsStr: string): Record<string, unknown> {
  try {
    const p = JSON.parse(paramsStr || '{}');
    return Object.fromEntries(Object.entries(p).map(([k, v]: [string, any]) => [
      k,
      v?.type === 'integer' || v?.type === 'number' ? 1
        : v?.type === 'boolean' ? false
          : v?.type === 'array' ? []
            : v?.type === 'object' ? {}
              : '',
    ]));
  } catch {
    return {};
  }
}
