/**
 * 规则设计（`rules[].rule_design`）的纯函数（spec 007）。
 *
 * 设计期表达：把关联函数的判断条件组合成可读逻辑，**运行期不消费**。
 * 本模块不引 React，便于单测；字段路径口径与 `core-backend/services/rule_design.py` 逐项一致，
 * 运算符矩阵与后端 `schemas.RULE_OPERATOR_ARITY` / `RULE_OPERATOR_FIELD_TYPES` 同源。
 */
import type {
  RuleCondition, RuleConditionGroup, RuleDesign, RuleOperator,
} from '@/api/design';

export type { RuleCondition, RuleConditionGroup, RuleDesign, RuleOperator };

/** 设计约束（与后端 `services/rule_design.py` 常量一致，改一处必须同改另一侧） */
export const MAX_GROUPS = 5;
export const MAX_CONDITIONS_PER_GROUP = 5;
export const MAX_MESSAGE_LEN = 30;

export interface OperatorMeta {
  code: RuleOperator;
  label: string;
  /** 取值个数：-1 = 至少 1 个；0 = 无取值；其余为精确个数 */
  arity: number;
  /** 适用字段类型（undefined = 不限；字段未声明 type 时同样不限） */
  types?: string[];
}

/** 运算符全集（顺序即下拉顺序；后端同集合） */
export const OPERATOR_META: OperatorMeta[] = [
  { code: 'eq', label: '等于', arity: 1 },
  { code: 'ne', label: '不等于', arity: 1 },
  { code: 'gt', label: '大于', arity: 1, types: ['number', 'integer'] },
  { code: 'gte', label: '大于等于', arity: 1, types: ['number', 'integer'] },
  { code: 'lt', label: '小于', arity: 1, types: ['number', 'integer'] },
  { code: 'lte', label: '小于等于', arity: 1, types: ['number', 'integer'] },
  { code: 'between', label: '介于', arity: 2, types: ['number', 'integer'] },
  { code: 'contains', label: '包含', arity: 1, types: ['string', 'array'] },
  { code: 'not_contains', label: '不包含', arity: 1, types: ['string', 'array'] },
  { code: 'starts_with', label: '开头是', arity: 1, types: ['string'] },
  { code: 'ends_with', label: '结尾是', arity: 1, types: ['string'] },
  { code: 'matches', label: '匹配正则', arity: 1, types: ['string'] },
  { code: 'in', label: '属于', arity: -1, types: ['string', 'number', 'integer'] },
  { code: 'not_in', label: '不属于', arity: -1, types: ['string', 'number', 'integer'] },
  { code: 'empty', label: '为空', arity: 0 },
  { code: 'not_empty', label: '非空', arity: 0 },
];

const OPERATOR_BY_CODE = new Map<string, OperatorMeta>(OPERATOR_META.map(o => [o.code, o]));

export function operatorMeta(code: string | undefined): OperatorMeta | undefined {
  return code ? OPERATOR_BY_CODE.get(code) : undefined;
}

/** 某字段类型可用的运算符（未声明类型 = 全集） */
export function operatorsForType(type?: string): OperatorMeta[] {
  if (!type) return OPERATOR_META;
  return OPERATOR_META.filter(o => !o.types || o.types.includes(type));
}

/** 返回结构的顶层属性映射（本体函数为扁平映射；公共函数为 JSON Schema 包裹） */
export function responseProperties(response?: Record<string, any> | null): Record<string, any> {
  if (!response || typeof response !== 'object') return {};
  const props = response.properties;
  if (response.type === 'object' && props && typeof props === 'object') return props;
  return response;
}

/** 弹窗可选的关联函数（含返回结构，用于派生字段下拉） */
export interface RuleFunctionOption {
  name: string;
  title?: string;
  type?: string;
  origin?: 'ontology' | 'common';
  response?: Record<string, any>;
}

export interface FieldOption {
  /** 相对统一信封 data 的路径（`a.b` / `items[].c`） */
  path: string;
  /** 字段中文名（缺省回退字段名） */
  label: string;
  type: string;
  /** 下钻深度（仅用于展示缩进） */
  depth: number;
  /** 是否为数组元素层的容器（无自有叶子语义，仅用于分组展示） */
  isGroup: boolean;
}

/** 返回结构 → 可选字段（含嵌套对象与数组元素层） */
export function flattenResponseFields(response?: Record<string, any> | null): FieldOption[] {
  const out: FieldOption[] = [];
  const walk = (props: Record<string, any> | undefined, prefix: string, depth: number) => {
    if (!props || typeof props !== 'object') return;
    Object.entries(props).forEach(([name, node]) => {
      if (!node || typeof node !== 'object') return;
      const path = prefix ? `${prefix}.${name}` : name;
      const isArrayObject = node.type === 'array'
        && !!node.items && typeof node.items === 'object' && !!node.items.properties;
      out.push({
        path,
        label: typeof node.title === 'string' && node.title ? node.title : name,
        type: typeof node.type === 'string' ? node.type : '',
        depth,
        isGroup: isArrayObject,
      });
      if (node.properties && typeof node.properties === 'object') {
        walk(node.properties, path, depth + 1);
      }
      if (isArrayObject) {
        walk(node.items.properties, `${path}[]`, depth + 1);
      }
    });
  };
  walk(responseProperties(response), '', 0);
  return out;
}

export function findFieldOption(
  response: Record<string, any> | null | undefined,
  path: string | undefined,
): FieldOption | undefined {
  if (!path) return undefined;
  return flattenResponseFields(response).find(f => f.path === path);
}

/** 按字段类型给合理默认值：布尔 true / 数值 0 / 其余空白 */
export function defaultValueForType(type?: string): string {
  if (type === 'boolean') return 'true';
  if (type === 'number' || type === 'integer') return '0';
  return '';
}

/** 按运算符取值个数给默认取值 */
export function defaultValuesFor(meta: OperatorMeta | undefined, type?: string): string[] {
  if (!meta || meta.arity === 0) return [];
  if (meta.arity === 2) return [defaultValueForType(type) || '0', defaultValueForType(type) || '0'];
  if (meta.arity === -1) return [defaultValueForType(type)];
  return [defaultValueForType(type)];
}

/** 新增条件的默认值：首个可用字段 + 该类型首个运算符 + 合理默认取值 */
export function defaultCondition(
  fnName: string,
  response?: Record<string, any> | null,
): RuleCondition {
  const fields = flattenResponseFields(response);
  const leaf = fields.find(f => !f.isGroup) || fields[0];
  const operators = operatorsForType(leaf?.type);
  const meta = operators[0];
  return {
    function: fnName,
    field: leaf?.path || '',
    operator: meta?.code || '',
    values: defaultValuesFor(meta, leaf?.type),
  };
}

/** 新增一条规则设计的初始结构（1 组 1 条条件） */
export function defaultDesign(
  fnName: string,
  response?: Record<string, any> | null,
): RuleDesign {
  return {
    combine: 'and',
    groups: [{ combine: 'and', conditions: [defaultCondition(fnName, response)] }],
    pass_message: '',
    fail_message: '',
  };
}

/** 表格列摘要：`2组 · 3条件`（未设计 → ''） */
export function designSummary(design?: RuleDesign | null): string {
  if (!design || !Array.isArray(design.groups) || design.groups.length === 0) return '';
  const count = design.groups.reduce((n, g) => n + ((g.conditions || []).length), 0);
  return `${design.groups.length}组 · ${count}条件`;
}

/** 表达式摘要（Tooltip 用）：`(A AND B) OR (C)` */
export function designExpression(
  design: RuleDesign | null | undefined,
  labelOf: (condition: RuleCondition) => string,
): string {
  if (!design || !design.groups?.length) return '未设计';
  const join = (combine: string, parts: string[]) => parts.join(` ${combine === 'or' ? 'OR' : 'AND'} `);
  const groups = design.groups.map(g => {
    const body = join(g.combine || 'and', (g.conditions || []).map(labelOf));
    return `(${body})`;
  });
  return join(design.combine || 'and', groups);
}

/** 码点计数（与后端 Python `len` 同口径） */
export function charCount(text: string | undefined): number {
  return Array.from(text || '').length;
}

/** 按码点截断 */
export function truncateChars(text: string, max: number = MAX_MESSAGE_LEN): string {
  const chars = Array.from(text || '');
  return chars.length > max ? chars.slice(0, max).join('') : (text || '');
}

export interface DesignContext {
  /** 该规则的关联函数（条件函数只能从中选） */
  relatedFunctions: string[];
  /** 取某函数的返回结构（本体函数 / 公共函数） */
  responseOf: (fnName: string) => Record<string, any> | null | undefined;
}

export interface DesignValidation {
  ok: boolean;
  /** 第一条错误（用于 message 提示） */
  message: string;
  /** 行内错误：`g{i}` 组级、`g{i}c{j}` 条件级 */
  errors: Record<string, string>;
}

/**
 * 弹窗保存前校验（与后端 `validate_rule_design` 同口径；值内容允许空白，只校验个数）。
 */
export function validateDesign(
  design: RuleDesign | null | undefined,
  ctx: DesignContext,
): DesignValidation {
  const errors: Record<string, string> = {};
  let message = '';
  const fail = (msg: string) => {
    if (!message) message = msg;
  };

  if (!design || !design.groups?.length) {
    return { ok: false, message: '请至少添加一个条件组', errors };
  }
  if (!design.combine) fail('组间组合方式非法');
  if (design.groups.length > MAX_GROUPS) {
    fail(`最多 ${MAX_GROUPS} 个条件组`);
  }

  design.groups.forEach((group, gi) => {
    const groupKey = `g${gi}`;
    if (!group.combine) {
      errors[groupKey] = '组内组合方式非法';
      fail(`条件组 ${gi + 1} 的组内组合方式非法`);
    }
    if (!group.conditions?.length) {
      errors[groupKey] = `条件组 ${gi + 1} 为空，请添加条件或删除该组`;
      fail(errors[groupKey]);
      return;
    }
    if (group.conditions.length > MAX_CONDITIONS_PER_GROUP) {
      errors[groupKey] = `条件组 ${gi + 1} 最多 ${MAX_CONDITIONS_PER_GROUP} 条条件`;
      fail(errors[groupKey]);
    }

    group.conditions.forEach((cond, ci) => {
      const key = `g${gi}c${ci}`;
      const where = `条件组 ${gi + 1} 第 ${ci + 1} 条`;
      const setError = (msg: string) => {
        errors[key] = msg;
        fail(`${where}：${msg}`);
      };

      if (!cond.function) {
        setError('请选择关联函数');
        return;
      }
      if (!ctx.relatedFunctions.includes(cond.function)) {
        setError('函数不在该规则的关联函数中');
        return;
      }
      const response = ctx.responseOf(cond.function);
      if (!cond.field) {
        setError('请选择返回字段');
        return;
      }
      const option = findFieldOption(response, cond.field);
      if (!option) {
        setError('返回字段未在函数返回结构中声明');
        return;
      }
      const meta = operatorMeta(cond.operator);
      if (!meta) {
        setError('请选择运算符');
        return;
      }
      if (meta.types && option.type && !meta.types.includes(option.type)) {
        setError(`字段类型 ${option.type} 不支持「${meta.label}」`);
        return;
      }
      const values = cond.values || [];
      if (meta.arity === 0 && values.length > 0) {
        setError(`「${meta.label}」不接受取值`);
        return;
      }
      if (meta.arity === 1 && values.length !== 1) {
        setError(`「${meta.label}」需要 1 个取值`);
        return;
      }
      if (meta.arity === 2 && values.length !== 2) {
        setError(`「${meta.label}」需要 2 个取值`);
        return;
      }
      if (meta.arity === -1 && values.length < 1) {
        setError(`「${meta.label}」至少需要 1 个取值`);
      }
    });
  });

  const pass = charCount(design.pass_message);
  const failMsg = charCount(design.fail_message);
  if (pass > MAX_MESSAGE_LEN) fail(`「条件成立」说明不能超过 ${MAX_MESSAGE_LEN} 字`);
  if (failMsg > MAX_MESSAGE_LEN) fail(`「条件不成立」说明不能超过 ${MAX_MESSAGE_LEN} 字`);

  return { ok: Object.keys(errors).length === 0 && !message, message, errors };
}

/**
 * 保存前归一：剔除空组、按运算符裁剪取值个数、文案去首尾空白。
 * 无组且无文案 → null（后端同样按 None 处理，不落盘）。
 */
export function normalizeDesign(design: RuleDesign | null | undefined): RuleDesign | null {
  if (!design) return null;
  const groups: RuleConditionGroup[] = (design.groups || [])
    .filter(g => (g.conditions || []).length > 0)
    .map(g => ({
      combine: g.combine || 'and',
      conditions: (g.conditions || []).map(c => {
        const meta = operatorMeta(c.operator);
        const values = [...(c.values || [])];
        let trimmed: string[] = [];
        if (meta && meta.arity === 0) trimmed = [];
        else if (meta && meta.arity === 2) trimmed = [values[0] || '', values[1] || ''];
        else if (meta && meta.arity === 1) trimmed = [values[0] || ''];
        else trimmed = values;
        return { function: c.function, field: c.field, operator: c.operator, values: trimmed };
      }),
    }));
  const pass = (design.pass_message || '').trim();
  const fail = (design.fail_message || '').trim();
  if (!groups.length && !pass && !fail) return null;
  return { combine: design.combine || 'and', groups, pass_message: pass, fail_message: fail };
}
