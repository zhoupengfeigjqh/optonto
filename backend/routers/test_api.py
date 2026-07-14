"""API test execution — proxy behavior API calls for unit testing."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from services import load_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/test", tags=["测试"])


@router.post("/behavior")
async def test_behavior(ontology_id: int, body: dict):
    """Execute a behavior API test.

    body: { behavior_name: str, params: dict }
    """
    behavior_name = body.get("behavior_name", "").strip()
    params = body.get("params", {})

    if not behavior_name:
        raise HTTPException(status_code=400, detail="请提供 behavior_name")

    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    behavior = next((b for b in data.behaviors if b.name == behavior_name), None)
    if not behavior:
        raise HTTPException(status_code=404, detail="行为不存在")

    # Validate required params
    for key, spec in behavior.params.items():
        if isinstance(spec, dict) and spec.get("required", True):
            if key not in params or params[key] in (None, ""):
                raise HTTPException(status_code=400, detail=f"缺少必填参数: {key}")

    # ─── Placeholder: actual API / database call ───────────────────────────
    # ponytail: 预留，接入实际数据库或外部API时在此处实现
    #   - GET: 参数拼接 url query string，fetch GET
    #   - POST: 参数作为 JSON body，fetch POST
    #   - 根据 behavior.url 和 behavior.method 执行实际请求
    #   目前返回占位响应
    return {
        "status": "ok",
        "behavior_name": behavior_name,
        "method": behavior.method,
        "url": behavior.url,
        "sent_params": params,
        "data": None,
        "__placeholder__": True,
        "message": "API调用待接入 — 此处将执行实际数据库查询或外部API请求",
    }
