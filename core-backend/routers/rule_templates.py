"""API for listing rule template types from rule_template/ files.

分层（章程 II）：本模块为接口层；文件读写一律经数据访问层 ``repositories.fs_store``。
"""

from fastapi import APIRouter, HTTPException

from config import DATA_DIR
from repositories import fs_store

router = APIRouter(prefix="/api/rule-templates", tags=["规则模板"])

RULE_TEMPLATE_DIR = DATA_DIR / "templates/rule_template"


@router.get("/types")
async def list_rule_template_types() -> list[str]:
    """Scan rule_template/ subdirectories for JSON files and return their ruleName values."""
    types: list[str] = []
    if not fs_store.exists(RULE_TEMPLATE_DIR):
        return types
    for sub_dir in sorted(fs_store.list_dir(RULE_TEMPLATE_DIR)):
        if not sub_dir.is_dir():
            continue
        for f in fs_store.list_files(sub_dir, "*.json"):
            data = fs_store.read_json(f)
            if isinstance(data, dict):
                rule_name = data.get("ruleName")
                if rule_name:
                    types.append(rule_name)
    return types


@router.get("/{rule_name}")
async def get_rule_template(rule_name: str) -> dict:
    """Return the full template JSON for a given rule name."""
    if not fs_store.exists(RULE_TEMPLATE_DIR):
        raise HTTPException(status_code=404, detail="模板目录不存在")
    for sub_dir in sorted(fs_store.list_dir(RULE_TEMPLATE_DIR)):
        if not sub_dir.is_dir():
            continue
        for f in fs_store.list_files(sub_dir, "*.json"):
            data = fs_store.read_json(f)
            if isinstance(data, dict) and data.get("ruleName") == rule_name:
                return data
    raise HTTPException(status_code=404, detail=f"未找到规则模板: {rule_name}")
