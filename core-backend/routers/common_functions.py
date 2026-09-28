"""API for common functions (list / code / execute).执行已迁至 ontology-mcp 沙箱，本路由仅设计期读写 + 转发。

分层（章程 II）：本模块为接口层；文件读写一律经数据访问层 ``repositories.fs_store``。
"""

from fastapi import APIRouter, HTTPException

from config import DATA_DIR
from repositories import fs_store

router = APIRouter(prefix="/api/common-functions", tags=["公共函数"])

COMMON_DIR = DATA_DIR / "common_functions"
FUNCTIONS_PATH = COMMON_DIR / "functions.json"


@router.get("")
async def list_common_functions() -> list[dict]:
    """Return all common functions with full metadata."""
    # 缺失/损坏统一按「空清单」降级（口径见 fs_store.read_json）
    return fs_store.read_json(FUNCTIONS_PATH, default=[])


@router.get("/{func_name}/code")
async def get_common_function_code(func_name: str) -> dict:
    """Read a common function's Python source code."""
    code_path = COMMON_DIR / f"{func_name}.py"
    if not fs_store.exists(code_path):
        raise HTTPException(status_code=404, detail="函数代码文件不存在")
    return {"content": fs_store.read_text(code_path), "func_name": func_name}


@router.post("/{func_name}/execute")
async def execute_common_function(func_name: str, body: dict):
    """Execute a common function — 降级转发 ontology-mcp（沙箱已随迁，core 执行归零）。

    Convention: def run(params: dict) -> dict。run() 已自带 {"result": ...} 包装，透传返回。
    """
    from services.runtime_forward import ONTOLOGY_MCP_URL, forward_call
    return await forward_call(
        ONTOLOGY_MCP_URL, "/execute-common-function",
        {"function_name": func_name, "params": body.get("params", {})},
        "ontology-mcp",
    )
