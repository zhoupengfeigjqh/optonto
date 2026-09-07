"""行为 facade：行为名即工具名，schema 含约束编译，scope 剥离。

迁自 core-backend mcp_server_sse.py 的行为工具段 + ontologies.py 聚合端点的
tool_name 全局命名逻辑（裸名优先，跨本体重名加 onto{ontology_id}__ 前缀）——
命名权威从 core 聚合端点上移到本服务（运行面自包含，core 执行归零）。
"""

from mcp.types import Tool

from mcp_shared import loaders
from mcp_shared.schema_compile import params_to_input_schema, related_concepts, with_function_scope

_BEHAVIOR_CACHE: dict = {"fingerprint": None, "tools": [], "entries": {}}


def load_behavior_tools(force: bool = False) -> list[Tool]:
    """直读 .data 聚合所有本体行为并转成 Tool（与 ontology-mcp 函数工具共用 mtime 指纹语义）。"""
    fingerprint = loaders.ontology_fingerprint()
    if not force and _BEHAVIOR_CACHE["fingerprint"] is not None and _BEHAVIOR_CACHE["fingerprint"] == fingerprint:
        return _BEHAVIOR_CACHE["tools"]

    entries_raw: list[dict] = []
    for onto in loaders.list_all_ontologies():
        oid = onto.get("id")
        sc_name, on_name = onto.get("scenario_name"), onto.get("ontology_name")
        if oid is None or not sc_name or not on_name:
            continue
        try:
            data = loaders.load_ontology_data(sc_name, on_name)
        except Exception:
            continue
        for b in data.get("behaviors") or []:
            if not isinstance(b, dict) or not b.get("name"):
                continue
            schema, _conflicts = params_to_input_schema(
                b.get("params"), related_concepts(data, b.get("related_concepts")))
            entries_raw.append({
                "ontology_id": oid,
                "ontology_name": on_name,
                "scenario_id": onto.get("scenario_id"),
                "scenario_name": sc_name,
                "name": b["name"],
                "display_name": b.get("display_name"),
                "description": b.get("description"),
                "op_type": b.get("op_type"),
                "inputSchema": schema,
            })

    # 全局命名：裸名优先，跨本体重名的冲突方加 onto{ontology_id}__ 前缀（避免中文字符进工具名）
    name_count: dict[str, int] = {}
    for e in entries_raw:
        name_count[e["name"]] = name_count.get(e["name"], 0) + 1

    tools: list[Tool] = []
    entries: dict[str, dict] = {}
    for e in entries_raw:
        tool_name = e["name"] if name_count[e["name"]] == 1 else f"onto{e['ontology_id']}__{e['name']}"
        desc_parts = [p for p in (e.get("display_name"), e.get("description")) if p]
        desc = "：".join(desc_parts) if desc_parts else tool_name
        if e.get("ontology_name"):
            desc = f"{desc}（本体「{e['ontology_name']}」）"
        tools.append(Tool(
            name=tool_name,
            description=desc,
            inputSchema=with_function_scope(e["inputSchema"], e, category="本体行为"),
        ))
        e["tool_name"] = tool_name
        entries[tool_name] = e

    _BEHAVIOR_CACHE.update(fingerprint=fingerprint, tools=tools, entries=entries)
    return _BEHAVIOR_CACHE["tools"]


def behavior_entries() -> dict[str, dict]:
    """tool_name → 聚合条目（含裸行为名 name 与 ontology_id）。"""
    load_behavior_tools()
    return _BEHAVIOR_CACHE["entries"]
