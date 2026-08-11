"""CRUD API for functions within an ontology.
Function code is stored as .py files in onto_market/{scenario}/{ontology}/functions/.
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import FunctionItem
from services import (
    load_ontology_data, save_ontology_data, ensure_functions_dir, _get_functions_dir,
    build_restricted_globals,
)
from services.entity_crud import ensure_unique, find_index
from llm_utils import load_env, llm_text

router = APIRouter(prefix="/api/ontologies/{ontology_id}/functions", tags=["函数"])


load_env()


def _code_path(sc_name: str, on_name: str, func_name: str) -> Path:
    return _get_functions_dir(sc_name, on_name) / f"{func_name}.py"


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

    data.functions.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{function_name}")
async def update_function(ontology_id: int, function_name: str, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.functions, function_name, "函数")
    ensure_unique(data.functions, item.name, "函数", exclude_name=function_name)

    data.functions[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{function_name}")
async def delete_function(ontology_id: int, function_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.functions, function_name, "函数")

    # Remove code file if exists
    code_path = _code_path(sc_name, on_name, function_name)
    if code_path.exists():
        code_path.unlink()

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
    content = ""
    if code_path.exists():
        content = code_path.read_text(encoding="utf-8")
    return {"content": content, "exists": code_path.exists(), "code_file": fn.code_file}


@router.put("/{function_name}/code")
async def save_function_code(ontology_id: int, function_name: str, body: dict):
    """Write function code to file and update code_file in YAML."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, g in enumerate(data.functions) if g.name == function_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="函数不存在")

    ensure_functions_dir(sc_name, on_name)
    code_path = _code_path(sc_name, on_name, function_name)
    code_path.write_text(body.get("code", ""), encoding="utf-8")

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

        # Save to file
        ensure_functions_dir(sc_name, on_name)
        code_path = _code_path(sc_name, on_name, function_name)
        code_path.write_text(code, encoding="utf-8")

        # Update code_file reference in YAML
        data.functions[data.functions.index(fn)].code_file = f"functions/{function_name}.py"
        save_ontology_data(sc_name, on_name, data)

        return {"code": code, "code_file": f"functions/{function_name}.py"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"代码生成失败: {str(e)}")


# ─── Execute Code ──────────────────────────────────────────────────────────

@router.post("/{function_name}/execute")
async def execute_function(ontology_id: int, function_name: str, body: dict):
    """Execute a function's Python code with given params."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    fn = next((g for g in data.functions if g.name == function_name), None)
    if fn is None:
        raise HTTPException(status_code=404, detail="函数不存在")

    code_path = _code_path(sc_name, on_name, function_name)
    if not code_path.exists():
        raise HTTPException(status_code=400, detail="函数代码文件不存在，请先编写或生成代码")

    code = code_path.read_text(encoding="utf-8")
    params = body.get("params", {})

    restricted_globals = build_restricted_globals()
    local_vars = {}

    try:
        exec(code, restricted_globals, local_vars)
        func = local_vars.get(fn.name)
        if func is None:
            raise HTTPException(status_code=500, detail=f"未找到函数 {fn.name}，请确认函数名与定义一致")
        # 函数代码已自带 {"result": ...} 包装（与公共函数 run() 约定一致，见 common_functions.py），
        # 故原样返回，不再包一层，避免双重嵌套（sumRawNotArrivalQty 等函数 code_file 均自带头 result）。
        result = func(**params)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")
