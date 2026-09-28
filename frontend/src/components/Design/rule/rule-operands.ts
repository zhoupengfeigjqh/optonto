/**
 * 规则操作数纯逻辑（自 RuleTable.tsx 抽取，行为不变）。
 *
 * 操作数类型：value(字面值)/valueSet(字面值集)/instance(实例)/instanceSet(实例集)/function(函数)
 * 旧名兼容：concept→instance、set→instanceSet（存量 yaml 打开设计器时映射，保存时写新名，自然迁移）
 * 与视图分离后可直接单测字面值解析/存储↔编辑形态转换。
 */

export function _label(v: any, k: string): string {
  return v?.display_name || v?.description || k;
}

export function getReturnFields(funcs: any[], funcName: string | undefined): { label: string; value: string }[] {
  if (!funcName) return [];
  const fn = funcs.find(f => f.name === funcName);
  if (!fn?.response) return [];
  const props = fn.response?.result?.properties || fn.response?.properties || {};
  return Object.entries(props).map(([k, v]: [string, any]) => ({
    label: `${_label(v, k)}（${v?.type || 'any'}）`,
    value: k,
  }));
}

export function normalizeOperandType(t: any): string {
  if (t === 'concept') return 'instance';
  if (t === 'set') return 'instanceSet';
  return t || '';
}

export const SET_OPERAND_TYPES = ['instanceSet', 'valueSet'];
export const SET_OPERATORS = ['in', 'not in'];

export type LiteralParseResult = { ok: true; node: any } | { ok: false; error: string };

/**
 * A2 字面值解析：引号语法输入 → 类型化存储节点 {type:'value', valueType, value?}
 * - string：必须引号包裹（'有效'/"有效"），存储不带引号；'' = 空串
 * - number/integer：裸写数字；boolean：true/false
 * - 空输入 = 空值节点：valueType 与左侧类型一致、value 为 null（左侧类型未知时 valueType 为 null；操作符是否允许由调用方校验）
 * - expectedType 为左侧操作数类型，传 null 表示未知（宁漏勿拦，按输入形态推断）
 */
export function parseLiteralInput(rawIn: any, expectedType: string | null): LiteralParseResult {
  const raw = rawIn === undefined || rawIn === null ? '' : String(rawIn).trim();
  if (raw === '') return { ok: true, node: { type: 'value', valueType: expectedType || 'null', value: null } };
  const isQuoted = (q: string) => raw.length >= 2 && raw.startsWith(q) && raw.endsWith(q);
  if (isQuoted("'") || isQuoted('"')) {
    if (expectedType && expectedType !== 'string') {
      return { ok: false, error: `左侧为 ${expectedType} 类型，字面值${expectedType === 'boolean' ? '请写 true/false' : '请直接写数字'}，不要加引号` };
    }
    return { ok: true, node: { type: 'value', valueType: 'string', value: raw.slice(1, -1) } };
  }
  if (raw === 'true' || raw === 'false') {
    if (expectedType && expectedType !== 'boolean') return { ok: false, error: `左侧为 ${expectedType} 类型，但输入的是布尔值 ${raw}` };
    return { ok: true, node: { type: 'value', valueType: 'boolean', value: raw === 'true' } };
  }
  if (/^-?\d+$/.test(raw)) {
    if (expectedType === 'string') return { ok: false, error: `左侧为 string 类型，字面值需用引号包裹，如 '${raw}'` };
    if (expectedType === 'boolean') return { ok: false, error: `左侧为 boolean 类型，字面值请写 true/false` };
    // 左侧为 number 时按 number 存（整数是 number 的子集）；未知时按 integer
    return { ok: true, node: { type: 'value', valueType: expectedType === 'number' ? 'number' : 'integer', value: Number(raw) } };
  }
  if (/^-?\d*\.\d+$/.test(raw)) {
    if (expectedType === 'integer') return { ok: false, error: `左侧为 integer 类型，字面值不能带小数` };
    if (expectedType === 'string') return { ok: false, error: `左侧为 string 类型，字面值需用引号包裹，如 '${raw}'` };
    if (expectedType === 'boolean') return { ok: false, error: `左侧为 boolean 类型，字面值请写 true/false` };
    return { ok: true, node: { type: 'value', valueType: 'number', value: Number(raw) } };
  }
  if (expectedType === 'string') return { ok: false, error: `string 字面值需用引号包裹，如 '${raw}'` };
  if (expectedType) return { ok: false, error: `左侧为 ${expectedType} 类型，无法识别的字面值「${raw}」` };
  // 类型未知：宁漏勿拦，按 string 原文接受
  return { ok: true, node: { type: 'value', valueType: 'string', value: raw } };
}

/** 字面值集解析：`[...]` 语法，元素按 parseLiteralInput 逐个解析，同型（number/integer 混合归一为 number），非空 */
export function parseLiteralSetInput(rawIn: any, expectedType: string | null): LiteralParseResult {
  const raw = rawIn === undefined || rawIn === null ? '' : String(rawIn).trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) {
    return { ok: false, error: `字面值集需用方括号包裹，如 ['有效', '无效'] 或 [1, 2, 3]` };
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) return { ok: false, error: '字面值集不能为空集 []' };
  // 按顶层逗号切分（引号内的逗号不切）
  const tokens: string[] = [];
  let cur = ''; let quote = '';
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === ',') { tokens.push(cur); cur = ''; continue; }
    cur += ch;
  }
  tokens.push(cur);
  const values: any[] = [];
  const types = new Set<string>();
  for (const tok of tokens) {
    if (!tok.trim()) return { ok: false, error: '字面值集存在空元素（多余的逗号？）' };
    const r = parseLiteralInput(tok, expectedType);
    if (!r.ok) return r;
    if (r.node.value === null || r.node.value === undefined) return { ok: false, error: '字面值集不允许空元素' };
    types.add(r.node.valueType);
    values.push(r.node.value);
  }
  let elementType = '';
  if (types.size === 1) elementType = [...types][0];
  else if ([...types].every(t => t === 'number' || t === 'integer')) elementType = 'number';
  else return { ok: false, error: `字面值集元素类型不一致（${[...types].join('、')}）` };
  return { ok: true, node: { type: 'valueSet', elementType, value: values } };
}

/** 存储形态 → 编辑框文本：typed 字面值还原引号语法；null 值 → 空框；存量无 valueType 的原文显示 */
export function literalNodeToText(node: any): string {
  if (node.valueType === undefined) return node.value !== undefined && node.value !== null ? String(node.value) : '';
  if (node.value === null || node.value === undefined) return '';
  if (node.valueType === 'string') return `'${node.value}'`;
  return String(node.value);
}

export function literalSetNodeToText(node: any): string {
  const vals = Array.isArray(node.value) ? node.value : [];
  if (node.elementType === 'string') return `[${vals.map((v: any) => `'${v}'`).join(', ')}]`;
  return `[${vals.join(', ')}]`;
}

/** 存储形态 → 编辑形态：旧类型名映射新名；typed 字面值/字面值集 → 输入框文本 */
export function storageToEditing(cfg: any): any {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const clone = JSON.parse(JSON.stringify(cfg));
  const conditions = clone?.if?.conditions;
  if (!Array.isArray(conditions)) return clone;
  for (const c of conditions) {
    for (const side of ['left', 'right'] as const) {
      const op = c?.[side];
      if (!op || typeof op !== 'object') continue;
      // 存量语义修复：in/not in 右侧的 concept 实为集合语义 → instanceSet
      if (side === 'right' && normalizeOperandType(op.type) === 'instance' && SET_OPERATORS.includes(c?.operator)) {
        op.type = 'instanceSet';
      } else {
        op.type = normalizeOperandType(op.type);
      }
      if (op.type === 'value' && 'valueType' in op) { const text = literalNodeToText(op); delete op.valueType; op.value = text; }
      if (op.type === 'valueSet' && 'elementType' in op) { const text = literalSetNodeToText(op); delete op.elementType; op.value = text; }
    }
  }
  return clone;
}

// ─── 共享操作数编辑器（左/右侧共用）的选项常量 ─────────────────────────────

export const OPERAND_TYPE_OPTIONS_LEFT = [
  { label: '实例', value: 'instance' },
  { label: '函数', value: 'function' },
];
export const OPERAND_TYPE_OPTIONS_RIGHT = [
  { label: '字面值', value: 'value' },
  { label: '字面值集', value: 'valueSet' },
  { label: '实例', value: 'instance' },
  { label: '实例集', value: 'instanceSet' },
  { label: '函数', value: 'function' },
];
