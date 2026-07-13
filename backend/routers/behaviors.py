"""CRUD API for behaviors within an ontology."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_ontology_names
from schemas import BehaviorItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/behaviors", tags=["行为"])


@router.get("")
async def list_behaviors(ontology_id: int, db: AsyncSession = Depends(get_db)):
    sc_name, on_name = await get_ontology_names(ontology_id, db)
    data = load_ontology_data(sc_name, on_name)
    return data.behaviors


@router.post("", status_code=201)
async def create_behavior(ontology_id: int, item: BehaviorItem, db: AsyncSession = Depends(get_db)):
    sc_name, on_name = await get_ontology_names(ontology_id, db)
    data = load_ontology_data(sc_name, on_name)

    if any(b.name == item.name for b in data.behaviors):
        raise HTTPException(status_code=400, detail="行为名称已存在")

    data.behaviors.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{behavior_name}")
async def update_behavior(ontology_id: int, behavior_name: str, item: BehaviorItem, db: AsyncSession = Depends(get_db)):
    """Update a behavior."""
    sc_name, on_name = await get_ontology_names(ontology_id, db)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, b in enumerate(data.behaviors) if b.name == behavior_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="行为不存在")

    if item.name != behavior_name and any(b.name == item.name for b in data.behaviors):
        raise HTTPException(status_code=400, detail="行为名称已存在")

    data.behaviors[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{behavior_name}")
async def delete_behavior(ontology_id: int, behavior_name: str, db: AsyncSession = Depends(get_db)):
    sc_name, on_name = await get_ontology_names(ontology_id, db)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, b in enumerate(data.behaviors) if b.name == behavior_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="行为不存在")

    data.behaviors.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "行为已删除"}
