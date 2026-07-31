"""API for listing common functions."""

import json

from fastapi import APIRouter, HTTPException

from config import DATA_DIR

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
