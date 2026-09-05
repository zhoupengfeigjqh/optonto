"""API for common functions (list / code / execute)."""

import json

from fastapi import APIRouter, HTTPException

from config import DATA_DIR
from services import build_restricted_globals

router = APIRouter(prefix="/api/common-functions", tags=["公共函数"])

COMMON_DIR = DATA_DIR / "common_functions"
FUNCTIONS_PATH = COMMON_DIR / "functions.json"


@router.get("")
async def list_common_functions() -> list[dict]:
    """Return all common functions with full metadata."""
    if not FUNCTIONS_PATH.exists():
        return []
    try:
        with open(FUNCTIONS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


@router.get("/{func_name}/code")
async def get_common_function_code(func_name: str) -> dict:
    """Read a common function's Python source code."""
    code_path = COMMON_DIR / f"{func_name}.py"
    if not code_path.exists():
        raise HTTPException(status_code=404, detail="函数代码文件不存在")
    content = code_path.read_text(encoding="utf-8")
    return {"content": content, "func_name": func_name}


@router.post("/{func_name}/execute")
async def execute_common_function(func_name: str, body: dict):
    """Execute a common function. Convention: def run(params: dict) -> dict.

    2026-09-05 起本体函数也统一为同一 run 约定（见 routers/functions.py）。
    run() 已自带 {"result": ...} 包装，故原样返回（不再包一层，避免双重嵌套）。
    """
    code_path = COMMON_DIR / f"{func_name}.py"
    if not code_path.exists():
        raise HTTPException(status_code=404, detail="函数代码文件不存在")

    code = code_path.read_text(encoding="utf-8")
    params = body.get("params", {})
    local_vars = {}

    try:
        exec(code, build_restricted_globals(), local_vars)
        func = local_vars.get("run")
        if func is None:
            raise HTTPException(status_code=500, detail="未找到函数 run，公共函数须以 def run(params) 定义")
        return func(params)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"公共函数执行失败: {str(e)}")
