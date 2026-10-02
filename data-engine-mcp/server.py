"""optonto-data-engine-mcp — 映射执行面 MCP 服务（SSE）。

职责：行为工具（唯一入口）、映射前后翻译、参数契约检查。
引擎唯一形态=MCP（target.server_url/tool_name 分发；HTTP/SQL 型已分别于阶段五、2026-09-07 删除）。

直读 .data（data_store），运行期零回调 core-backend。
core-backend 的 /behaviors/{name}/call 与 /data-engines/{name}/call 降级转发到
本服务的 /call-behavior /call-engine（设计器测试与 Agent 走同一路径，消灭双执行路径）。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8005
"""

import json
import sys
from pathlib import Path

# 本地直跑兜底：Docker 镜像内 mcp-shared 的模块已在 /app 顶层可直接 import
for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from mcp.server import Server
from mcp.types import TextContent, Tool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from mcp_app import build_mcp_app
from tool_contract import (
    owner_label, require_ontology_id, require_ontology_match, strip_system_params,
)

import behavior_tools
import executor

server = Server("optonto-data-engine-mcp")


async def _list_tools() -> list[Tool]:
    return behavior_tools.load_behavior_tools()


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    # 确保行为缓存已加载（MCP 协议先 list_tools 后 call_tool，此处兜底直连场景）
    entries = behavior_tools.behavior_entries()
    entry = entries.get(name)
    if entry is None:
        # 契约 ⑥：行为存在但未就绪（未完成映射）→ 专用报错，与"未知工具"区分开（指向病根，
        # 而不是让调用方以为是自己不存在的工具名写错了）
        unready = behavior_tools.unready_behavior(name)
        if unready:
            raise ValueError(
                f"行为 {name} 尚未就绪：未完成数据引擎映射，未发布为工具"
                f"（本体「{unready.get('ontology_name')}」）；请先在映射页完成配置")
        raise ValueError(f"未知工具: {name}")

    bname = entry["name"]  # 工具名 = 行为裸名（无本体前缀）
    oid = require_ontology_id(arguments.get("ontology_id"), f"行为 {bname}")
    # 归属一致性（契约 ④）：entry["ontology_id"] 是本行为发布时的权威归属（与 scope.const 同源）。
    # 不等说明调用方把工具挂到了错误的本体上（行为侧跨本体重名可构造，会静默执行错本体）→ 拒。
    require_ontology_match(entry.get("ontology_id"), oid, f"行为 {bname}", owner_label(entry))
    # scope 是规划元数据（非行为输入），剥离；ontology_id 仅路由用，亦剥离（共用实现）
    params = strip_system_params(arguments)

    try:
        result = await executor.execute_behavior(int(oid), bname, params)
    except ValueError as e:
        raise RuntimeError(f"行为 {bname} 调用配置错误: {str(e)}")
    except Exception as e:
        raise RuntimeError(f"行为 {bname} 执行失败: {str(e)}")

    # 下游错误状态必须置 isError（抛异常），交由 agent 判定失败——
    # 信封里的 status_code 只是数据，不转的话 agent 侧把失败当成功文本。
    if isinstance(result, dict) and result.get("status_code", 200) >= 400:
        detail = json.dumps(result.get("data", ""), ensure_ascii=False)[:2000]
        raise RuntimeError(f"行为 {bname} 执行失败 (下游 HTTP {result['status_code']}): {detail}")

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


# ─── 设计期转发入口（core 降级转发，与 behavior_tools 共用 executor 同一实现）──────────


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
    """POST /call-behavior {ontology_id, behavior_name, params}（ontology_id 必填）。"""
    body = await request.json()
    bname = body.get("behavior_name")
    try:
        oid = require_ontology_id(body.get("ontology_id"), f"行为 {bname}")
        # 归属一致性（契约 ④）：与 MCP 入口同口径（设计期转发也走这条路径）
        entry = behavior_tools.behavior_entries().get(bname)
        require_ontology_match((entry or {}).get("ontology_id"), oid, f"行为 {bname}", owner_label(entry))
        # 系统参数剥离：与 MCP 入口同口径（scope/ontology_id 不进业务参数、不进映射翻译）
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
        # 剥了会误删真名为 scope/ontology_id 的引擎参数。
        result = await executor.execute_engine(int(oid), ename, body.get("params") or {})
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": f"调用失败: {str(e)}"}, status_code=500)
    return _envelope_response(result, f"数据引擎 {ename}")


starlette_app = build_mcp_app(
    server, _list_tools, "optonto-data-engine-mcp",
    extra_routes=[
        Route("/call-behavior", endpoint=_handle_call_behavior, methods=["POST"]),
        Route("/call-engine", endpoint=_handle_call_engine, methods=["POST"]),
    ],
)
