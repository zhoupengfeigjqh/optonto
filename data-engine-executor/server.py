"""optonto-data-engine-executor — 数据引擎执行服务（行为/引擎执行的**唯一实现**，零工具）。

职责：把「本体行为」翻译成对外部业务系统的调用——

- **执行链**：行为名 → 反查**就绪**数据引擎（契约 ⑥）→ 映射翻译入参 → 调下游 MCP
  （``target.server_url`` + ``target.tool_name``）→ 映射翻译出参；
- **执行端点**：``/call-behavior``（按行为名执行）、``/call-engine``（按引擎名直调）。

**工具面已下线**（2026-10-19 方案 B，用户拍板）：本服务是**零工具执行底座**
（``transport=none``，不挂 ``/mcp``、``/sse``，外部误连直接 404）。对 Agent 提供
"可执行行为"的唯一出口是自建发布（``mcp-publish`` 动态容器：按本体切片、带令牌、
发布即授权）；本服务只作为它的下游执行面，以及 core 设计器测试的转发目标。

这样两类执行底座口径一致（本体函数执行 8006 / 数据引擎执行 8005 都是零工具），
且"谁能调用哪些行为"完全由发布配置决定，不再存在第二套全量工具面。

直读 .data（data_store），运行期零回调 core-backend。
core-backend 的 ``/behaviors/{name}/call`` 与 ``/data-engines/{name}/call`` 转发到本服务
（设计器测试与 Agent 走同一路径，消灭双执行路径）。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8005
"""

import json
import sys
from pathlib import Path

# 本地直跑兜底：Docker 镜像内 mcp-shared 的模块已在 /app 顶层可直接 import
for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from mcp_app import TRANSPORT_NONE, build_mcp_app
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from tool_contract import (
    owner_label, require_ontology_id, require_ontology_match, require_scope_match,
    strip_system_params,
)

import behavior_index
import executor


async def _list_tools() -> list:
    """零工具：本服务不通过 MCP 协议暴露任何工具（``/tools`` 恒为空，仅作自检）。"""
    return []


# ─── 执行入口（REST；自建发布与 core 设计器测试共用同一实现）───────────────────


def _envelope_response(result: dict, label: str) -> JSONResponse:
    """下游目标接口返回错误状态码时，信封 status_code 转成 HTTP 错误码抛给上层。"""
    if isinstance(result, dict) and result.get("status_code", 200) >= 400:
        detail_data = json.dumps(result.get("data", ""), ensure_ascii=False)[:500]
        return JSONResponse(
            {"detail": f"{label} 执行失败 (下游 HTTP {result['status_code']}): {detail_data}"},
            status_code=result["status_code"],
        )
    return JSONResponse(result)


async def _handle_call_behavior(request: Request) -> JSONResponse:
    """POST /call-behavior {ontology_id, scope, behavior_name, params}（ontology_id 必填）。

    ``ontology_id`` 由调用方（LLM）填写；``scope`` 是自建发布时固化的本体上下文。两道闸：
    ① 发布声明 == 调用意图（``require_scope_match``，无 scope 时跳过——设计期 REST 调用）；
    ② 调用意图 == 数据事实（``require_ontology_match``，防伪造 scope 跨本体路由）。
    """
    body = await request.json()
    bname = body.get("behavior_name")
    try:
        oid = require_ontology_id(body.get("ontology_id"), f"行为 {bname}")
        require_scope_match(body.get("scope"), oid, f"行为 {bname}")
        # 数据归属：来自行为索引（与发布面同一份就绪判据）
        entry = behavior_index.behavior_entries().get(bname)
        require_ontology_match((entry or {}).get("ontology_id"), oid, f"行为 {bname}", owner_label(entry))
        # 系统参数剥离：ontology_id 不进业务参数、不进映射翻译
        result = await executor.execute_behavior(int(oid), bname, strip_system_params(body.get("params")))
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": f"调用失败: {str(e)}"}, status_code=500)
    return _envelope_response(result, f"行为 {bname}")


async def _handle_call_engine(request: Request) -> JSONResponse:
    """POST /call-engine {ontology_id, engine_name, params}（ontology_id 必填）。"""
    body = await request.json()
    ename = body.get("engine_name")
    try:
        oid = require_ontology_id(body.get("ontology_id"), f"数据引擎 {ename}")
        # 有意**不**做系统参数剥离：引擎 params 是用户自定义字段（SYSTEM_PARAMS 只属本体执行类），
        # 剥了会误删真名为 ontology_id 的引擎参数。
        result = await executor.execute_engine(int(oid), ename, body.get("params") or {})
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": f"调用失败: {str(e)}"}, status_code=500)
    return _envelope_response(result, f"数据引擎 {ename}")


starlette_app = build_mcp_app(
    None, _list_tools, "optonto-data-engine-executor",
    transport=TRANSPORT_NONE,
    extra_routes=[
        Route("/call-behavior", endpoint=_handle_call_behavior, methods=["POST"]),
        Route("/call-engine", endpoint=_handle_call_engine, methods=["POST"]),
    ],
)
