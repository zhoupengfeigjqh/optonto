"""CRUD API for functions within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import FunctionItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/functions", tags=["函数"])


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
