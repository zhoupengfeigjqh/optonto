"""CRUD API for behaviors within an ontology."""

from fastapi import APIRouter

from dependencies import get_ontology_names
from schemas import BehaviorItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index

router = APIRouter(prefix="/api/ontologies/{ontology_id}/behaviors", tags=["行为"])


@router.get("")
async def list_behaviors(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.behaviors


@router.post("", status_code=201)
async def create_behavior(ontology_id: int, item: BehaviorItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.behaviors, item.name, "行为")

    data.behaviors.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{behavior_name}")
async def update_behavior(ontology_id: int, behavior_name: str, item: BehaviorItem):
    """Update a behavior."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.behaviors, behavior_name, "行为")
    ensure_unique(data.behaviors, item.name, "行为", exclude_name=behavior_name)

    data.behaviors[idx] = item
    # 行为改名联动：数据引擎按 behavior_name 挂接，同步换名防悬空
    if item.name != behavior_name:
        for de in data.data_engines:
            if de.behavior_name == behavior_name:
                de.behavior_name = item.name
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{behavior_name}")
async def delete_behavior(ontology_id: int, behavior_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.behaviors, behavior_name, "行为")

    data.behaviors.pop(idx)
    # 级联清理：删除挂在该行为上的数据引擎（引擎按 behavior_name 引用，行为没了引擎即悬空）
    data.data_engines = [de for de in data.data_engines if de.behavior_name != behavior_name]
    save_ontology_data(sc_name, on_name, data)
    return {"message": "行为已删除"}


# ─── Behavior Call ────────────────────────────────────────────────────────────

@router.post("/{behavior_name}/call")
async def call_behavior_endpoint(ontology_id: int, behavior_name: str, body: dict):
    """Call a behavior — 降级转发 data-engine-mcp（core 运行期执行归零，消灭双执行路径）。

    执行实现已迁至 data-engine-mcp executor（唯一形态 MCP）；
    状态码与 detail 原样透传（下游 4xx/5xx 保持错误形态，isError 语义不破坏）。
    """
    from services.runtime_forward import DATA_ENGINE_MCP_URL, forward_call
    return await forward_call(
        DATA_ENGINE_MCP_URL, "/call-behavior",
        {"ontology_id": ontology_id, "behavior_name": behavior_name, "params": body.get("params", {})},
        "data-engine-mcp",
    )
