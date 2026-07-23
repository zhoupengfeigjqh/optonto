"""CRUD API for behaviors within an ontology."""

import httpx
from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import BehaviorItem
from services import load_ontology_data, save_ontology_data

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

    if any(b.name == item.name for b in data.behaviors):
        raise HTTPException(status_code=400, detail="行为名称已存在")

    data.behaviors.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{behavior_name}")
async def update_behavior(ontology_id: int, behavior_name: str, item: BehaviorItem):
    """Update a behavior."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, b in enumerate(data.behaviors) if b.name == behavior_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="行为不存在")

    if item.name != behavior_name and any(b.name == item.name for b in data.behaviors):
        raise HTTPException(status_code=400, detail="行为名称已存在")

    data.behaviors[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{behavior_name}")
async def delete_behavior(ontology_id: int, behavior_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, b in enumerate(data.behaviors) if b.name == behavior_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="行为不存在")

    data.behaviors.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "行为已删除"}


# ─── Behavior Call ────────────────────────────────────────────────────────────

@router.post("/{behavior_name}/call")
async def call_behavior_endpoint(ontology_id: int, behavior_name: str, body: dict):
    """Call a behavior. API type routes through data engine, SQL type executes SQL query."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    params = body.get("params", {})

    # Check if this behavior has a SQL data engine
    de = next((d for d in data.data_engines if d.behavior_name == behavior_name), None)
    if de and de.engine_type == "SQL":
        # Route to SQL execution
        from routers.data_engines import _execute_sql
        return await _execute_sql(sc_name, on_name, de, params)

    try:
        from services.data_engine import call_behavior
        return await call_behavior(data, behavior_name, params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.ConnectError:
        raise HTTPException(status_code=400, detail="无法连接，请检查 URL 是否正确")
    except httpx.TimeoutException:
        raise HTTPException(status_code=408, detail="请求超时")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"调用失败: {str(e)}")
