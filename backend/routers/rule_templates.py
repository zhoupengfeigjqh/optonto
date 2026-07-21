"""API for listing rule template types from rule_template/ files."""

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/rule-templates", tags=["规则模板"])

RULE_TEMPLATE_DIR = Path(__file__).resolve().parent.parent.parent / "backend" / ".data" / "rule_template"


@router.get("/types")
async def list_rule_template_types() -> list[str]:
    """Scan rule_template/ subdirectories for JSON files and return their ruleName values."""
    types: list[str] = []
    if not RULE_TEMPLATE_DIR.exists():
        return types
    for sub_dir in sorted(RULE_TEMPLATE_DIR.iterdir()):
        if not sub_dir.is_dir():
            continue
        for f in sorted(sub_dir.iterdir()):
            if f.suffix == ".json":
                try:
                    with open(f, encoding="utf-8") as fh:
                        data = json.load(fh)
                    if rule_name := data.get("ruleName"):
                        types.append(rule_name)
                except (json.JSONDecodeError, KeyError, OSError):
                    continue
    return types
