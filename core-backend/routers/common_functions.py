"""公共函数 API（列表 / 源码 / 执行）。执行已迁至 common-function-mcp，本路由仅设计期读写 + 转发。

分层（章程 II）：本模块为接口层；名册读取与源码读取一律经业务层
``services.function_catalog``，**不直连 repositories**。
"""

from fastapi import APIRouter

from services.function_catalog import read_common_function_code, read_common_functions

router = APIRouter(prefix="/api/common-functions", tags=["公共函数"])


@router.get("")
async def list_common_functions() -> list[dict]:
    """Return all common functions with full metadata."""
    # 缺失/损坏统一按「空清单」降级（口径见 services.function_catalog）
    return read_common_functions()


@router.get("/{func_name}/code")
async def get_common_function_code(func_name: str) -> dict:
    """Read a common function's Python source code."""
    return {"content": read_common_function_code(func_name), "func_name": func_name}


@router.post("/{func_name}/execute")
async def execute_common_function(func_name: str, body: dict):
    """执行公共函数 — 转发 common-function-mcp（core 执行归零，2026-10-04 迁自本体函数执行服务）。

    公共函数是**平台级**能力：无 ontology_id、不做归属校验；其发布与执行合体在
    common-function-mcp（对外发布同一套工具，MCP 面与本 REST 入口共用同一执行实现）。

    Convention: def run(params: dict) -> dict。返回值已由执行器出口归一为统一信封（success/data/error），透传返回。
    """
    from services.runtime_forward import COMMON_FUNCTION_MCP_URL, forward_call
    return await forward_call(
        COMMON_FUNCTION_MCP_URL, "/execute-common-function",
        {"function_name": func_name, "params": body.get("params", {})},
        "common-function-mcp",
    )
