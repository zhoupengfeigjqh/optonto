"""行为工具发布：行为名即工具名，schema 含约束编译，scope 剥离。

（原名 `facade.py`，2026-10-02 更名——"facade" 是设计模式名、无领域含义；本模块职责是
**把本体行为发布成一等 MCP 工具**并缓存条目，故名 `behavior_tools`。）

迁自 core-backend mcp_server_sse.py 的行为工具段 + ontologies.py 聚合端点的
tool_name 全局命名逻辑（**工具名 = 行为裸名，不带本体前缀**：与本体函数口径一致，
本体归属由调用参数 ontology_id 决定）——命名权威从 core 聚合端点上移到本服务
（运行面自包含，core 执行归零）。

**就绪发布（契约 ⑥，2026-10-02）**：只发布**已映射（就绪）**的行为——工具清单即对 LLM 的
可调用承诺，未就绪即违约（此前未配映射的行为也照发，实测 33 个行为工具里 25 个一调就失败）。
未就绪者从发布面剔除（设计器仍可见）、按本体记一条告警，被调用时给"尚未就绪"专用报错；
规划面（agent）按 mcp-shared 同一判据拒绝——两侧同源，避免"能规划、挂不上"。
"""

import logging

from mcp.types import Tool

import data_store
from tool_contract import (
    CATEGORY_BEHAVIOR, params_to_input_schema, ready_behavior_names, related_concepts,
    with_ontology_context,
)

logger = logging.getLogger(__name__)

_BEHAVIOR_CACHE: dict = {"fingerprint": None, "tools": [], "entries": {}, "unready": {}}


def _behavior_concept_names(behavior: dict) -> list[str]:
    """行为关联概念（唯一）：新格式为标量 concept；旧数据 related_concepts 数组读时兼容。"""
    concept = behavior.get("concept")
    if concept:
        return [concept]
    legacy = behavior.get("related_concepts")
    return list(legacy) if isinstance(legacy, list) else []


def load_behavior_tools(force: bool = False) -> list[Tool]:
    """直读 .data 聚合所有本体行为并转成 Tool（与 ontology-mcp 函数工具共用指纹语义）。"""
    fingerprint = data_store.ontology_market_fingerprint()
    if not force and _BEHAVIOR_CACHE["fingerprint"] is not None and _BEHAVIOR_CACHE["fingerprint"] == fingerprint:
        return _BEHAVIOR_CACHE["tools"]

    entries_raw: list[dict] = []
    unready_raw: list[dict] = []
    for onto in data_store.list_all_ontologies():
        oid = onto.get("id")
        sc_name, on_name = onto.get("scenario_name"), onto.get("ontology_name")
        if oid is None or not sc_name or not on_name:
            continue
        try:
            data = data_store.load_ontology_data(sc_name, on_name)
        except Exception:
            continue
        # 契约 ⑥：只发布**就绪**（已映射）的行为；未就绪者剔除并留痕（含清单，供调用期专用报错）
        ready = ready_behavior_names(data)
        skipped: list[str] = []
        for behavior in data.get("behaviors") or []:
            if not isinstance(behavior, dict) or not behavior.get("name"):
                continue
            if behavior["name"] not in ready:
                skipped.append(behavior["name"])
                unready_raw.append({
                    "ontology_id": oid, "ontology_name": on_name,
                    "scenario_id": onto.get("scenario_id"), "scenario_name": sc_name,
                    "name": behavior["name"], "display_name": behavior.get("display_name"),
                })
                continue
            schema, conflicts = params_to_input_schema(
                behavior.get("params"), related_concepts(data, _behavior_concept_names(behavior)))
            if conflicts:
                # 冲突是"同名属性约束不一致、已取先扫到的"——必须留痕，否则约束静默劣化无从发现
                logger.warning("行为 %s 的属性约束冲突（已取先扫到的）: %s",
                               behavior["name"], "；".join(conflicts))
            entries_raw.append({
                "ontology_id": oid,
                "ontology_name": on_name,
                "scenario_id": onto.get("scenario_id"),
                "scenario_name": sc_name,
                "name": behavior["name"],
                "display_name": behavior.get("display_name"),
                "description": behavior.get("description"),
                "op_type": behavior.get("op_type"),
                "inputSchema": schema,
            })
        if skipped:
            # 本体级一行（未映射的本体常常整批未就绪，逐行为一条会刷屏）；这些行为在设计器仍可见
            logger.warning("本体「%s」有 %d 个行为未就绪（未完成数据引擎映射），未发布为工具: %s",
                           on_name, len(skipped), "、".join(skipped))

    # 工具名 = 行为裸名（不带本体前缀）：跨本体重名在工具名维度无法共存，且 entries 字典会互相覆盖
    # 造成静默路由到错误本体 —— 记录错误并保留先出现者（确定性），由设计侧改名解决。
    tools: list[Tool] = []
    entries: dict[str, dict] = {}
    for entry in entries_raw:
        tool_name = entry["name"]
        if tool_name in entries:
            logger.error(
                "行为工具名跨本体重名：%s 已由本体「%s」注册，本体「%s」的同名行为未注册（请改名）",
                tool_name, entries[tool_name].get("ontology_name"), entry.get("ontology_name"),
            )
            continue
        desc_parts = [p for p in (entry.get("display_name"), entry.get("description")) if p]
        desc = "：".join(desc_parts) if desc_parts else tool_name
        if entry.get("ontology_name"):
            desc = f"{desc}（本体「{entry['ontology_name']}」）"
        tools.append(Tool(
            name=tool_name,
            description=desc,
            inputSchema=with_ontology_context(entry["inputSchema"], entry, CATEGORY_BEHAVIOR),
        ))
        entry["tool_name"] = tool_name
        entries[tool_name] = entry

    # 未就绪名单（调用期据此把"未就绪"与"未知工具"分开报）；**已发布者优先**——同名行为在
    # 别的本体已就绪时，该名字就是已知工具，不算未就绪
    unready: dict[str, dict] = {}
    for item in unready_raw:
        unready.setdefault(item["name"], item)
    for name in list(unready):
        if name in entries:
            unready.pop(name)

    _BEHAVIOR_CACHE.update(fingerprint=fingerprint, tools=tools, entries=entries, unready=unready)
    return _BEHAVIOR_CACHE["tools"]


def behavior_entries() -> dict[str, dict]:
    """tool_name → 聚合条目（含裸行为名 name 与 ontology_id）。"""
    load_behavior_tools()
    return _BEHAVIOR_CACHE["entries"]


def unready_behavior(name: str) -> dict | None:
    """未就绪行为（已从发布面剔除）的条目；不存在 → None。

    调用期用它区分"行为存在但未就绪"与"未知工具"——契约 ⑥：报错也要指向病根，不能把
    "设计还没做完"报成"这个工具不存在"。
    """
    load_behavior_tools()
    return _BEHAVIOR_CACHE["unready"].get(name)
