"""CRUD API for processes within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import ProcessItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index

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

    ensure_unique(data.processes, item.name, "流程")

    data.processes.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{process_name}")
async def update_process(ontology_id: int, process_name: str, item: ProcessItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.processes, process_name, "流程")
    ensure_unique(data.processes, item.name, "流程", exclude_name=process_name)

    data.processes[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{process_name}")
async def delete_process(ontology_id: int, process_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.processes, process_name, "流程")

    data.processes.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "流程已删除"}
