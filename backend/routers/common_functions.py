"""API for listing common functions."""

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/common-functions", tags=["公共函数"])

COMMON_DIR = Path(__file__).resolve().parent.parent.parent / "backend" / ".data" / "common_functions"
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
