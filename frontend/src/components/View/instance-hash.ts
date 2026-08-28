/**
 * 实例身份哈希 —— 实例视图去重合并的唯一依据。
 *
 * 成立前提：查询结果经后端 _translate_output 输出映射，字段统一为本体属性名；
 * 每个概念只有唯一查询入口（API query 行为）→ 同概念行结构恒定 → 同实例必同形。
 * 归一化只保留两条：键排序（防拼键顺序差异）、剔除 null/undefined 键（缺失与空值不拆）。
 */

/** cyrb53 字符串哈希（同步、无依赖），输出 16 位 hex。 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function normalizeValue(v: any): any {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const arr = v.map(normalizeValue).filter(x => x !== undefined);
    return arr;
  }
  if (typeof v === 'object') return normalizeRow(v);
  return v;
}

/** 归一化一行：键排序 + 剔除空值键（递归）。 */
export function normalizeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(row).sort()) {
    const nv = normalizeValue(row[k]);
    if (nv !== undefined) out[k] = nv;
  }
  return out;
}

/**
 * 实例键 = 概念名:哈希。概念前缀保证不同概念同形行不合并。
 * 空行（归一化后无字段）返回 null —— 调用方丢弃，不入图。
 */
export function instanceKey(conceptName: string, row: Record<string, any>): string | null {
  const norm = normalizeRow(row);
  if (Object.keys(norm).length === 0) return null;
  return `${conceptName}:${cyrb53(JSON.stringify(norm))}`;
}
