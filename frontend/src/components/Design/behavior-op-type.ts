/**
 * 行为操作类型推导 —— 前端**唯一实现**。
 *
 * 与后端 `services._resolve_op_type`、agent 端 `ontology-gateway` 的 `isWrite` 同一口径：
 * `op_type` 是唯一权威来源（引擎唯一形态 = MCP，已无 method 语义可推导）；
 * 显式值 `command` / `query` 以其为准，空或非法值一律按**读（query）**处理。
 *
 * 此前该判据在 `SecurityTable`（本地函数）与 `RuleTable` / `rule-logic`（直接比较
 * `op_type === 'query'`）三处各写一遍，其中直接比较的口径与后端不一致（空值被排除），
 * 导致「数据补充」漏掉后端认定的 query 行为。本模块收口该判据，杜绝再次漂移。
 */
import type { Behavior } from '@/api/client';

export type OpType = 'command' | 'query';

/** 推导操作类型；`derived=true` 表示未显式声明、由空值推导为 query（供 UI 标注「（推导）」）。 */
export function resolveOpType(behavior: Pick<Behavior, 'op_type'>): { type: OpType; derived: boolean } {
  if (behavior?.op_type === 'command' || behavior?.op_type === 'query') {
    return { type: behavior.op_type, derived: false };
  }
  return { type: 'query', derived: true };
}

/** 是否写行为（command）——与后端「写行为必须显式 command」同口径。 */
export function isWriteBehavior(behavior: Pick<Behavior, 'op_type'>): boolean {
  return resolveOpType(behavior).type === 'command';
}
