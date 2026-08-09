"""CRUD API for behaviors within an ontology."""

import json

import httpx
from fastapi import APIRouter, HTTPException

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
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{behavior_name}")
async def delete_behavior(ontology_id: int, behavior_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.behaviors, behavior_name, "行为")

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
        # SQL 只读（SELECT only），天然幂等，无需去重
        from services.data_engine import execute_sql
        return await execute_sql(sc_name, on_name, de, params)

    try:
        from services.data_engine import call_behavior
        result = await call_behavior(data, behavior_name, params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.ConnectError:
        raise HTTPException(status_code=400, detail="无法连接，请检查 URL 是否正确")
    except httpx.TimeoutException:
        raise HTTPException(status_code=408, detail="请求超时")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"调用失败: {str(e)}")

    # 下游目标接口返回了错误状态码时,信封里的 status_code 只是数据,必须转成
    # HTTP 错误码抛给上层 —— MCP 层只认 HTTP 状态行(>=400 才算失败),若不转码,
    # 下游 4xx/5xx 会以 HTTP 200 返回,agent 侧 isError 永不置位,报错预算失效。
    if isinstance(result, dict) and result.get("status_code", 200) >= 400:
        detail_data = json.dumps(result.get("data", ""), ensure_ascii=False)[:500]
        raise HTTPException(
            status_code=result["status_code"],
            detail=f"行为 {behavior_name} 执行失败 (下游 HTTP {result['status_code']}): {detail_data}",
        )
    return result
