"""CRUD API for behavior permissions within an ontology.

权限范围稀疏存储：everyone（所有人可用，默认）不落盘，仅 disable / 用户白名单落盘。
运行面（agent）暂不过滤，待后续按 everyone 放过 / disable 过滤 / 用户名白名单过滤实施。
"""

from fastapi import APIRouter

from dependencies import get_ontology_names
from schemas import PermissionItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index

router = APIRouter(prefix="/api/ontologies/{ontology_id}/permissions", tags=["权限"])


@router.get("")
async def list_permissions(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.permissions


@router.post("", status_code=201)
async def create_permission(ontology_id: int, item: PermissionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.permissions, item.action_name, "权限设置", field="action_name", duplicate_msg="该动作已存在权限设置")

    data.permissions.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{action_name}")
async def update_permission(ontology_id: int, action_name: str, item: PermissionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.permissions, action_name, "权限设置", field="action_name")
    ensure_unique(data.permissions, item.action_name, "权限设置", exclude_name=action_name, field="action_name", duplicate_msg="该动作已存在权限设置")

    data.permissions[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{action_name}")
async def delete_permission(ontology_id: int, action_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.permissions, action_name, "权限设置", field="action_name")

    data.permissions.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "权限设置已删除（恢复默认 everyone）"}
