/**
 * id 口径 —— **数字字符串**（``"1"``，不是 1）。
 *
 * 平台内 id（scenario_id / ontology_id）全部以字符串读写、比较、传参：
 *   - core：``repositories.metadata.normalize_id``
 *   - 运行面：``mcp-shared/tool_contract.normalize_id``
 *   - agent：本文件
 * 三处规则必须一致（归一后即严格相等比较）。字符串化避免 "1" / 1 混型导致的
 * 静默过滤失败（``Set.has(1)`` 在 ``Set<"1">`` 上恒 false，且不报错）。
 */

/** 任意来源 → 数字字符串；空值/非法 → undefined（调用方决定报错还是跳过）。 */
export function normalizeId(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : undefined;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? undefined : text;
  }
  return undefined;
}

/** id 等价判定（两侧归一后比较）：1 / "1" / " 1 " 等价。 */
export function sameId(a: unknown, b: unknown): boolean {
  const left = normalizeId(a);
  const right = normalizeId(b);
  return left !== undefined && left === right;
}
