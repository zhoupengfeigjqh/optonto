"""CRUD API for rules within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import RuleItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/rules", tags=["规则"])


@router.get("")
async def list_rules(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.rules


@router.post("", status_code=201)
async def create_rule(ontology_id: int, item: RuleItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    if any(r.name == item.name for r in data.rules):
        raise HTTPException(status_code=400, detail="规则名称已存在")

    data.rules.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{rule_name}")
async def update_rule(ontology_id: int, rule_name: str, item: RuleItem):
    """Update a rule."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, r in enumerate(data.rules) if r.name == rule_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="规则不存在")

    if item.name != rule_name and any(r.name == item.name for r in data.rules):
        raise HTTPException(status_code=400, detail="规则名称已存在")

    data.rules[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{rule_name}")
async def delete_rule(ontology_id: int, rule_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, r in enumerate(data.rules) if r.name == rule_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="规则不存在")

    data.rules.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "规则已删除"}
