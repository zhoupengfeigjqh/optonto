"""CRUD API for functions within an ontology."""

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import FunctionItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/functions", tags=["函数"])


# ─── LLM setup ────────────────────────────────────────────────────────────

try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent.parent / "config" / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    ChatOpenAI = None


def _build_llm():
    if ChatOpenAI is None:
        return None
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    api_url = os.environ.get("LLM_API_URL", "https://api.deepseek.com")
    model = os.environ.get("LLM_MODEL", "deepseek-chat")
    if not api_key:
        return None
    return ChatOpenAI(
        model=model,
        openai_api_key=api_key,
        openai_api_base=api_url,
        temperature=0.3,
        streaming=False,
    )


@router.get("")
async def list_functions(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.functions


@router.post("", status_code=201)
async def create_function(ontology_id: int, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    if any(g.name == item.name for g in data.functions):
        raise HTTPException(status_code=400, detail="函数名称已存在")

    data.functions.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{function_name}")
async def update_function(ontology_id: int, function_name: str, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, g in enumerate(data.functions) if g.name == function_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="函数不存在")

    if item.name != function_name and any(g.name == item.name for g in data.functions):
        raise HTTPException(status_code=400, detail="函数名称已存在")

    data.functions[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{function_name}")
async def delete_function(ontology_id: int, function_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, g in enumerate(data.functions) if g.name == function_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="函数不存在")

    data.functions.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "函数已删除"}


# ─── Generate Code ─────────────────────────────────────────────────────────

@router.post("/{function_name}/generate-code")
async def generate_function_code(ontology_id: int, function_name: str):
    """Use LLM to generate Python code for a function based on its metadata."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    fn = next((g for g in data.functions if g.name == function_name), None)
    if fn is None:
        raise HTTPException(status_code=404, detail="函数不存在")

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法智能生成代码")

    from langchain_core.messages import HumanMessage, SystemMessage

    prompt = f"""根据以下函数定义生成 Python 计算代码。

函数名称：{fn.name}
函数描述：{fn.description or '（无描述）'}
输入参数结构：{json.dumps(fn.params, ensure_ascii=False, indent=2)}
返回结构：{json.dumps(fn.response, ensure_ascii=False, indent=2)}

【要求】
1. 生成一个 Python 函数，函数名与参数名保持一致
2. 函数签名：def {fn.name}(params: dict) -> dict:
3. 入参 params 为字典，按输入参数结构取数据
4. 返回值为字典，按返回结构组装
5. 代码必须是可直接运行的 Python 3 代码
6. 只输出代码本身，不要任何解释或 markdown 标记

【示例】
def sumNotArrivalQty(params: dict) -> dict:
    total = 0
    for item in params.get("purchaseRecordSet", []):
        if item.get("arrivalTime", "") > "2026-01-01":
            total += item.get("arrivalQuantity", 0)
    return {{"total": total}}"""

    try:
        response = await llm.ainvoke([
            SystemMessage(content="你是一个Python计算代码生成专家，只输出代码，不输出其他内容。"),
            HumanMessage(content=prompt),
        ])
        code = response.content.strip()
        if code.startswith("```"):
            code = code.split("\n", 1)[1] if "\n" in code else code[3:]
            code = code.rsplit("```", 1)[0].strip()
        return {"code": code}
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
    if not fn.code:
        raise HTTPException(status_code=400, detail="函数代码为空，请先编写或生成代码")

    params = body.get("params", {})

    # Prepare restricted execution context
    restricted_globals = {
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
            "enumerate": enumerate, "float": float, "int": int, "isinstance": isinstance,
            "len": len, "list": list, "max": max, "min": min, "range": range,
            "round": round, "sorted": sorted, "str": str, "sum": sum, "tuple": tuple,
            "type": type, "zip": zip, "map": map, "filter": filter, "reversed": reversed,
            "True": True, "False": False, "None": None,
        },
    }
    local_vars = {}

    try:
        exec(fn.code, restricted_globals, local_vars)
        func = local_vars.get(fn.name)
        if func is None:
            raise HTTPException(status_code=500, detail=f"未找到函数 {fn.name}，请确认函数名与定义一致")
        result = func(params)
        return {"result": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")
