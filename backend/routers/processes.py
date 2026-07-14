"""CRUD API for processes within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import ProcessItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/processes", tags=["业务流程"])


@router.get("")
async def list_processes(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.processes


@router.post("", status_code=201)
async def create_process(ontology_id: int, item: ProcessItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    if any(p.name == item.name for p in data.processes):
        raise HTTPException(status_code=400, detail="流程名称已存在")

    data.processes.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{process_name}")
async def update_process(ontology_id: int, process_name: str, item: ProcessItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, p in enumerate(data.processes) if p.name == process_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="流程不存在")

    if item.name != process_name and any(p.name == item.name for p in data.processes):
        raise HTTPException(status_code=400, detail="流程名称已存在")

    data.processes[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{process_name}")
async def delete_process(ontology_id: int, process_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, p in enumerate(data.processes) if p.name == process_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="流程不存在")

    data.processes.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "流程已删除"}
