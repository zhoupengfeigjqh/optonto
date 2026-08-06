"""CRUD API for securities within an ontology."""

from fastapi import APIRouter

from dependencies import get_ontology_names
from schemas import SecurityItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index

router = APIRouter(prefix="/api/ontologies/{ontology_id}/securities", tags=["安全"])


@router.get("")
async def list_securities(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.securities


@router.post("", status_code=201)
async def create_security(ontology_id: int, item: SecurityItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.securities, item.action_name, "安全审核设置", field="action_name", duplicate_msg="该动作已存在安全审核设置")

    data.securities.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{action_name}")
async def update_security(ontology_id: int, action_name: str, item: SecurityItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.securities, action_name, "安全审核设置", field="action_name")
    ensure_unique(data.securities, item.action_name, "安全审核设置", exclude_name=action_name, field="action_name", duplicate_msg="该动作已存在安全审核设置")

    data.securities[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{action_name}")
async def delete_security(ontology_id: int, action_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.securities, action_name, "安全审核设置", field="action_name")

    data.securities.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "安全审核设置已删除"}
