"""CRUD API for behaviors within an ontology."""

import httpx
from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import BehaviorItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/behaviors", tags=["行为"])

# 写操作幂等缓存：op_key -> {"status": "ok"|"error", "result": ...}
# 内存缓存即可——重试窗口是秒级；超过上限按 FIFO 淘汰最旧
_OP_CACHE: dict[str, dict] = {}
_MAX_OP_CACHE = 1000
_WRITE_METHODS = ("POST", "PATCH", "DELETE")


def _cache_op(op_key: str, status: str, result: dict) -> None:
    if len(_OP_CACHE) >= _MAX_OP_CACHE:
        _OP_CACHE.pop(next(iter(_OP_CACHE)))
    _OP_CACHE[op_key] = {"status": status, "result": result}


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
    """Call a behavior. API type routes through data engine, SQL type executes SQL query.

    op_key 幂等：仅对写操作（API + POST/PATCH/DELETE）生效。
    - 同一 op_key 首次执行成功（status_code<400）→ 缓存；后续同 key 直接返回缓存，不重复执行。
    - 首次失败/抛异常 → 不缓存（或 status=error），重试重新执行。
    - 读操作（SQL / GET）忽略 op_key，始终重新执行，避免重试拿到旧数据。
    """
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    params = body.get("params", {})
    op_key = body.get("op_key")

    # Check if this behavior has a SQL data engine
    de = next((d for d in data.data_engines if d.behavior_name == behavior_name), None)
    if de and de.engine_type == "SQL":
        # SQL 只读（SELECT only），天然幂等，无需去重
        from routers.data_engines import _execute_sql
        return await _execute_sql(sc_name, on_name, de, params)

    is_write = de is not None and de.engine_type != "SQL" and de.target.method in _WRITE_METHODS
    if is_write and op_key:
        cached = _OP_CACHE.get(op_key)
        if cached and cached["status"] == "ok":
            return cached["result"]  # 已成功执行过，直接返回，不重复写

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

    if is_write and op_key:
        ok = result.get("status_code", 200) < 400
        _cache_op(op_key, "ok" if ok else "error", result)
    return result
