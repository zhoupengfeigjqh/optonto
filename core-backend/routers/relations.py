"""CRUD API for relations within an ontology."""

from fastapi import APIRouter

from dependencies import get_ontology_names
from schemas import RelationItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index

router = APIRouter(prefix="/api/ontologies/{ontology_id}/relations", tags=["关系"])


@router.get("")
async def list_relations(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.relations


@router.post("", status_code=201)
async def create_relation(ontology_id: int, item: RelationItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.relations, item.name, "关系")

    data.relations.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{relation_name}")
async def update_relation(ontology_id: int, relation_name: str, item: RelationItem):
    """Update a relation."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.relations, relation_name, "关系")
    ensure_unique(data.relations, item.name, "关系", exclude_name=relation_name)

    data.relations[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{relation_name}")
async def delete_relation(ontology_id: int, relation_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.relations, relation_name, "关系")

    data.relations.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "关系已删除"}
