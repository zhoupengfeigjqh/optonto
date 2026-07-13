"""CRUD API for scenarios."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Scenario, Ontology
from schemas import ScenarioCreate, ScenarioUpdate, ScenarioOut
from services import delete_scenario_dir

router = APIRouter(prefix="/api/scenarios", tags=["场景"])


@router.get("", response_model=List[ScenarioOut])
async def list_scenarios(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Scenario).order_by(Scenario.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=ScenarioOut, status_code=201)
async def create_scenario(data: ScenarioCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Scenario).where(Scenario.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="场景名称已存在")
    scenario = Scenario(name=data.name, description=data.description)
    db.add(scenario)
    await db.flush()
    await db.refresh(scenario)
    return scenario


@router.get("/{scenario_id}", response_model=ScenarioOut)
async def get_scenario(scenario_id: int, db: AsyncSession = Depends(get_db)):
    scenario = await db.get(Scenario, scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    return scenario


@router.put("/{scenario_id}", response_model=ScenarioOut)
async def update_scenario(scenario_id: int, data: ScenarioUpdate, db: AsyncSession = Depends(get_db)):
    scenario = await db.get(Scenario, scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    if data.name is not None:
        scenario.name = data.name
    if data.description is not None:
        scenario.description = data.description
    await db.flush()
    await db.refresh(scenario)
    return scenario


@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: int, db: AsyncSession = Depends(get_db)):
    scenario = await db.get(Scenario, scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    # Check if the scenario has any ontologies
    ontologies = await db.execute(
        select(Ontology).where(Ontology.scenario_id == scenario_id)
    )
    if ontologies.scalars().first():
        raise HTTPException(status_code=400, detail="该场景下存在本体，请先删除所有本体后再删除场景")

    # 删除 onto_market/{场景名}/ 目录
    delete_scenario_dir(scenario.name)

    await db.delete(scenario)
    await db.flush()
    return {"message": "场景已删除"}
