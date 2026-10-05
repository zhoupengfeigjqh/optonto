/**
 * 行为就绪判据（可否发布为 MCP 工具）—— 前端**唯一实现**。
 *
 * 与后端 `mcp-shared/tool_contract.is_engine_ready` 逐条同源：
 * ① `engine_type` 缺省或 `MCP`（其余类型已删除，executor 会报错）；
 * ② `target.server_url` 与 `target.tool_name` **去首尾空白后**均非空。
 *
 * 契约 ⑥：工具清单是对 LLM 的可调用承诺，"清单里有、调用必失败"就是违约。此前该判据
 * 在 MCPPublish.tsx 内联为 `e?.target?.server_url && e?.target?.tool_name`（仅真值判断，
 * 未 trim）——空白串会被前端判为就绪、后端判为未就绪，出现「能勾选、创建时 400」的漂移。
 */
export interface EngineLike {
  behavior_name?: string;
  engine_type?: string;
  target?: { server_url?: string; tool_name?: string } | null;
}

/** 单条数据引擎是否可用（映射已完成、真能调到下游）。 */
export function isEngineReady(engine: EngineLike | null | undefined): boolean {
  if (!engine || typeof engine !== 'object') return false;
  const et = engine.engine_type;
  if (et && et !== 'MCP') return false;
  const target = engine.target || {};
  return Boolean(String(target.server_url ?? '').trim() && String(target.tool_name ?? '').trim());
}

/** 就绪行为名集合（可发布为工具的行为）。 */
export function readyBehaviorNames(engines: EngineLike[] | null | undefined): Set<string> {
  const ready = new Set<string>();
  for (const engine of engines || []) {
    if (!isEngineReady(engine)) continue;
    const name = engine.behavior_name;
    if (name) ready.add(String(name));
  }
  return ready;
}
