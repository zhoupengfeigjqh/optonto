"""行为索引：行为名 → 归属与就绪状态（**不再发布 MCP 工具**）。

2026-10-19 方案 B（语义收敛，用户拍板）：数据引擎执行服务降为**零工具执行底座**
（`transport=none`）——它对 Agent 的唯一行为工具面是「自建发布」（core 编译清单、
门面只做转发）。本模块因此只保留 REST 入口需要的两件事：

- 已就绪行为 → 归属条目（`/call-behavior` 的归属一致性校验与报错文案）；
- 未就绪行为 → 条目（把"没配映射"与"工具名写错"分开报，错误也要指向病根）。

就绪判据仍是 ``mcp-shared/tool_contract.ready_behavior_names``（与 core 发布面同源，
**勿单边改动**）。工具 schema 编译不再在这里做：唯一实现是 ``mcp-shared/tool_contract``，
由 core 的自建发布面使用——本服务不发布工具，就不该再有一份发布逻辑。

（原名 ``behavior_tools.py``：职责曾是"把本体行为发布成一等 MCP 工具"，工具面下线后
改名，避免名字继续承诺一件已不存在的事。）
"""

import logging

import data_store
from tool_contract import ready_behavior_names

logger = logging.getLogger(__name__)

# 缓存三件：指纹（mtime 组合）、已就绪条目、未就绪名单
_BEHAVIOR_CACHE: dict = {"fingerprint": None, "entries": {}, "unready": {}}


def load_behavior_index(force: bool = False) -> dict[str, dict]:
    """（重新）构建 行为名 → 归属条目，只收录**已就绪**行为；返回 entries。

    指纹未变时直接复用缓存（生产环境每次调用都会读一次，热加载语义与 8006 同口径）。
    """
    fingerprint = data_store.ontology_market_fingerprint()
    if not force and _BEHAVIOR_CACHE["fingerprint"] is not None \
            and _BEHAVIOR_CACHE["fingerprint"] == fingerprint:
        return _BEHAVIOR_CACHE["entries"]

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
        # 契约 ⑥：只把**已就绪**（已映射）的行为记为可路由；未就绪者留痕供报错区分
        ready = ready_behavior_names(data)
        skipped: list[str] = []
        for behavior in data.get("behaviors") or []:
            if not isinstance(behavior, dict) or not behavior.get("name"):
                continue
            name = behavior["name"]
            if name not in ready:
                skipped.append(name)
                unready_raw.append({
                    "ontology_id": oid, "ontology_name": on_name,
                    "scenario_id": onto.get("scenario_id"), "scenario_name": sc_name,
                    "name": name, "display_name": behavior.get("display_name"),
                })
                continue
            entries_raw.append({
                "ontology_id": oid,
                "ontology_name": on_name,
                "scenario_id": onto.get("scenario_id"),
                "scenario_name": sc_name,
                "name": name,
                "display_name": behavior.get("display_name"),
                "description": behavior.get("description"),
                "op_type": behavior.get("op_type"),
            })
        if skipped:
            # 本体级一行（未映射的本体常常整批未就绪，逐行为一条会刷屏）；设计器仍可见这些行为
            logger.warning("本体「%s」有 %d 个行为未就绪（未完成数据引擎映射），不可路由: %s",
                           on_name, len(skipped), "、".join(skipped))

    # 行为名跨本体重名：名字维度无法共存，entries 互相覆盖会静默路由到错误本体 →
    # 记 ERROR 并保留先出现者（确定性），由设计侧改名解决。
    entries: dict[str, dict] = {}
    for entry in entries_raw:
        name = entry["name"]
        if name in entries:
            logger.error(
                "行为名跨本体重名：%s 已由本体「%s」注册，本体「%s」的同名行为未注册（请改名）",
                name, entries[name].get("ontology_name"), entry.get("ontology_name"),
            )
            continue
        entries[name] = entry

    # 未就绪名单：**已就绪者优先**——同名行为在别的本体已就绪时，该名字就是可路由的，不算未就绪
    unready: dict[str, dict] = {}
    for item in unready_raw:
        unready.setdefault(item["name"], item)
    for name in list(unready):
        if name in entries:
            unready.pop(name)

    _BEHAVIOR_CACHE.update(fingerprint=fingerprint, entries=entries, unready=unready)
    return entries


def behavior_entries() -> dict[str, dict]:
    """行为名 → 归属条目（只含已就绪行为；供 REST 入口做归属校验）。"""
    load_behavior_index()
    return _BEHAVIOR_CACHE["entries"]


def unready_behavior(name: str) -> dict | None:
    """未就绪行为的条目；不存在 → None。

    调用期用它区分"行为存在但没配映射"与"行为名写错"——报错必须指向病根。
    """
    load_behavior_index()
    return _BEHAVIOR_CACHE["unready"].get(name)
