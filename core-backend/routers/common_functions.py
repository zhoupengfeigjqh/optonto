"""API for common functions (list / code / execute).执行已迁至 ontology-mcp 沙箱，本路由仅设计期读写 + 转发。

分层（章程 II）：本模块为接口层；文件读写一律经数据访问层 ``repositories.fs_store``。
"""

from fastapi import APIRouter, HTTPException

from repositories import fs_store
from services.function_catalog import COMMON_FUNCTIONS_DIR as COMMON_DIR, read_common_functions

router = APIRouter(prefix="/api/common-functions", tags=["公共函数"])


@router.get("")
async def list_common_functions() -> list[dict]:
    """Return all common functions with full metadata."""
    # 缺失/损坏统一按「空清单」降级（口径见 services.function_catalog）
    return read_common_functions()


@router.get("/{func_name}/code")
async def get_common_function_code(func_name: str) -> dict:
    """Read a common function's Python source code."""
    code_path = COMMON_DIR / f"{func_name}.py"
    if not fs_store.exists(code_path):
        raise HTTPException(status_code=404, detail="函数代码文件不存在")
    return {"content": fs_store.read_text(code_path), "func_name": func_name}


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
