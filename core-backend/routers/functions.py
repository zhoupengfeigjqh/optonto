"""CRUD API for functions within an ontology.
Function code is stored as .py files in onto_market/{scenario}/{ontology}/functions/.
代码统一入口约定（2026-09-05 起，与公共函数一致）：def run(params: dict) -> dict；
保存/生成写盘前经 _validate_function_code 静态校验。
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from errors import DomainError

from config import DATA_DIR
from dependencies import get_ontology_names
from repositories.metadata import list_all_ontologies
from repositories import fs_store
from schemas import FunctionItem
from services import (
    load_ontology_data, save_ontology_data, ensure_functions_dir, _get_functions_dir,
)
from services.entity_crud import ensure_unique, find_index
from llm_utils import load_env, llm_text

router = APIRouter(prefix="/api/ontologies/{ontology_id}/functions", tags=["函数"])


load_env()


def _code_path(sc_name: str, on_name: str, func_name: str) -> Path:
    return _get_functions_dir(sc_name, on_name) / f"{func_name}.py"


def _validate_function_code(code: str) -> str | None:
    """函数代码入口静态校验（保存/生成写盘前调用）。返回 None = 通过，否则返回错误描述。

    统一入口约定（2026-09-05）：本体函数与公共函数同为 def run(params: dict) -> dict，
    exec 后按 "run" 取符号、整包传参。注册名（YAML name / 文件名）只作标识，
    不再要求代码内函数同名——改名/迁移不影响代码。
    """
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"语法错误: {e}"
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            if not node.args.args:
                return "run 必须接收 params 参数（def run(params: dict) -> dict）"
            return None
    return "未找到 def run(params) 定义——函数代码须以 run 为统一入口（与公共函数同约定）"


# ─── 函数名全局唯一 ─────────────────────────────────────────────────────────────
# 本体函数注册为一等 MCP 工具后，工具名 = 函数名（与公共函数并列暴露给 LLM）。
# 因此函数名必须跨本体唯一，且不得与公共函数重名，否则 MCP 工具名冲突。

_COMMON_FUNCTIONS_PATH = DATA_DIR / "common_functions" / "functions.json"


def _common_function_names() -> set[str]:
    entries = fs_store.read_json(_COMMON_FUNCTIONS_PATH, default=[])
    if not isinstance(entries, list):
        return set()
    return {e["name"] for e in entries if isinstance(e, dict) and e.get("name")}


def _ensure_global_unique(name: str, sc_name: str, on_name: str) -> None:
    """函数名跨本体 + 对公共函数 全局唯一校验（当前本体内的查重由 ensure_unique 负责）。"""
    common = _common_function_names()
    if name in common:
        raise HTTPException(status_code=400, detail=f"函数名「{name}」与公共函数重名，请更换函数名")
    for onto in list_all_ontologies():
        sc = onto.get("scenario_name")
        on = onto.get("ontology_name")
        if not sc or not on:
            continue
        if sc == sc_name and on == on_name:
            continue  # 当前本体内查重由 ensure_unique 负责
        try:
            data = load_ontology_data(sc, on)
        except Exception:
            continue
        if any(fn.name == name for fn in data.functions):
            raise HTTPException(status_code=400, detail=f"函数名「{name}」已存在于本体「{on}」（函数名需全局唯一）")


# ─── CRUD ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_functions(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.functions


@router.post("", status_code=201)
async def create_function(ontology_id: int, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.functions, item.name, "函数")
    _ensure_global_unique(item.name, sc_name, on_name)

    data.functions.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{function_name}")
async def update_function(ontology_id: int, function_name: str, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.functions, function_name, "函数")
    ensure_unique(data.functions, item.name, "函数", exclude_name=function_name)
    _ensure_global_unique(item.name, sc_name, on_name)

    data.functions[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{function_name}")
async def delete_function(ontology_id: int, function_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.functions, function_name, "函数")

    # Remove code file if exists
    fs_store.delete_file(_code_path(sc_name, on_name, function_name))

    data.functions.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "函数已删除"}


# ─── Code Read/Write ──────────────────────────────────────────────────────

@router.get("/{function_name}/code")
async def get_function_code(ontology_id: int, function_name: str):
    """Read function code from file. Returns content and whether file exists."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    fn = next((g for g in data.functions if g.name == function_name), None)
    if fn is None:
        raise HTTPException(status_code=404, detail="函数不存在")

    code_path = _code_path(sc_name, on_name, function_name)
    exists = fs_store.exists(code_path)
    content = fs_store.read_text(code_path) if exists else ""
    return {"content": content, "exists": exists, "code_file": fn.code_file}


@router.put("/{function_name}/code")
async def save_function_code(ontology_id: int, function_name: str, body: dict):
    """Write function code to file and update code_file in YAML."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, g in enumerate(data.functions) if g.name == function_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="函数不存在")

    ensure_functions_dir(sc_name, on_name)
    code = body.get("code", "")
    err = _validate_function_code(code)
    if err:
        raise HTTPException(status_code=400, detail=f"函数代码校验未通过: {err}")
    fs_store.write_text(_code_path(sc_name, on_name, function_name), code)

    # Update code_file reference in YAML
    data.functions[idx].code_file = f"functions/{function_name}.py"
    save_ontology_data(sc_name, on_name, data)

    return {"message": "代码已保存", "code_file": data.functions[idx].code_file}


# ─── Generate Code ─────────────────────────────────────────────────────────

@router.post("/{function_name}/generate-code")
async def generate_function_code(ontology_id: int, function_name: str):
    """Use LLM to generate Python code and save to file."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    fn = next((g for g in data.functions if g.name == function_name), None)
    if fn is None:
        raise HTTPException(status_code=404, detail="函数不存在")

    from config import FUNCTION_CODE_SYSTEM_PROMPT, FUNCTION_CODE_PROMPT

    prompt = FUNCTION_CODE_PROMPT.format(
        name=fn.name,
        description=fn.description or "（无描述）",
        params=json.dumps(fn.params, ensure_ascii=False, indent=2),
        response=json.dumps(fn.response, ensure_ascii=False, indent=2),
    )

    try:
        code, _ = await llm_text(FUNCTION_CODE_SYSTEM_PROMPT, prompt, 0.3)
        if code is None:
            raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法智能生成代码")

        # 生成物过同一道入口校验，不合格不落地（提示词已要求 run 形态，此处兜底）
        err = _validate_function_code(code)
        if err:
            raise HTTPException(status_code=500, detail=f"生成的代码未通过入口校验: {err}")

        # Save to file
        ensure_functions_dir(sc_name, on_name)
        fs_store.write_text(_code_path(sc_name, on_name, function_name), code)

        # Update code_file reference in YAML
        data.functions[data.functions.index(fn)].code_file = f"functions/{function_name}.py"
        save_ontology_data(sc_name, on_name, data)

        return {"code": code, "code_file": f"functions/{function_name}.py"}
    except (HTTPException, DomainError):
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"代码生成失败: {str(e)}")


# ─── Execute Code ──────────────────────────────────────────────────────────

@router.post("/{function_name}/execute")
async def execute_function(ontology_id: int, function_name: str, body: dict):
    """Execute a function's Python code — 降级转发 ontology-mcp（沙箱已随迁，core 执行归零）。

    统一入口约定（与公共函数一致）：def run(params: dict) -> dict，整包传参；
    返回值已由沙箱出口归一为统一信封 {"success", "data", "error"}（读时兼容旧式 {"result": ...}），透传返回。
    """
    from services.runtime_forward import ONTOLOGY_MCP_URL, forward_call
    return await forward_call(
        ONTOLOGY_MCP_URL, "/execute-function",
        {"ontology_id": ontology_id, "function_name": function_name, "params": body.get("params", {})},
        "ontology-mcp",
    )
