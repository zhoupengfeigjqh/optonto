"""CRUD API for ontologies."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Scenario, Ontology
from schemas import OntologyCreate, OntologyUpdate, OntologyOut, OntologyData
from services import (
    ensure_ontology_dir,
    delete_ontology_dir,
    load_ontology_data,
    save_ontology_data,
)

router = APIRouter(prefix="/api/ontologies", tags=["本体"])


@router.get("/by-scenario/{scenario_id}", response_model=List[OntologyOut])
async def list_ontologies(scenario_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Ontology).where(Ontology.scenario_id == scenario_id).order_by(Ontology.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=OntologyOut, status_code=201)
async def create_ontology(data: OntologyCreate, db: AsyncSession = Depends(get_db)):
    scenario = await db.get(Scenario, data.scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")

    # Check uniqueness within scenario
    existing = await db.execute(
        select(Ontology).where(
            Ontology.scenario_id == data.scenario_id,
            Ontology.name == data.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该场景下本体名称已存在")

    ontology = Ontology(
        scenario_id=data.scenario_id,
        name=data.name,
        description=data.description,
        creator=data.creator,
    )
    db.add(ontology)
    await db.flush()
    await db.refresh(ontology)

    # Create ontology directory and initialize YAML
    ensure_ontology_dir(scenario.name, data.name)
    save_ontology_data(scenario.name, data.name, OntologyData())

    return ontology


@router.get("/{ontology_id}", response_model=OntologyOut)
async def get_ontology(ontology_id: int, db: AsyncSession = Depends(get_db)):
    ontology = await db.get(Ontology, ontology_id)
    if not ontology:
        raise HTTPException(status_code=404, detail="本体不存在")
    return ontology


@router.put("/{ontology_id}", response_model=OntologyOut)
async def update_ontology(ontology_id: int, data: OntologyUpdate, db: AsyncSession = Depends(get_db)):
    ontology = await db.get(Ontology, ontology_id)
    if not ontology:
        raise HTTPException(status_code=404, detail="本体不存在")
    if data.name is not None:
        ontology.name = data.name
    if data.description is not None:
        ontology.description = data.description
    if data.creator is not None:
        ontology.creator = data.creator
    await db.flush()
    await db.refresh(ontology)
    return ontology


@router.delete("/{ontology_id}")
async def delete_ontology(ontology_id: int, db: AsyncSession = Depends(get_db)):
    ontology = await db.get(Ontology, ontology_id)
    if not ontology:
        raise HTTPException(status_code=404, detail="本体不存在")

    # Delete the ontology directory
    scenario = await db.get(Scenario, ontology.scenario_id)
    if scenario:
        delete_ontology_dir(scenario.name, ontology.name)

    await db.delete(ontology)
    await db.flush()
    return {"message": "本体已删除"}


# ─── Ontology data (YAML) ─────────────────────────────────────────────────────

@router.get("/{ontology_id}/data", response_model=OntologyData)
async def get_ontology_data(ontology_id: int, db: AsyncSession = Depends(get_db)):
    """Get the full ontology data from YAML."""
    ontology = await db.get(Ontology, ontology_id)
    if not ontology:
        raise HTTPException(status_code=404, detail="本体不存在")
    scenario = await db.get(Scenario, ontology.scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="关联场景不存在")
    return load_ontology_data(scenario.name, ontology.name)


@router.put("/{ontology_id}/data", response_model=OntologyData)
async def update_ontology_data(ontology_id: int, data: OntologyData, db: AsyncSession = Depends(get_db)):
    """Save the full ontology data to YAML."""
    ontology = await db.get(Ontology, ontology_id)
    if not ontology:
        raise HTTPException(status_code=404, detail="本体不存在")
    scenario = await db.get(Scenario, ontology.scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="关联场景不存在")
    save_ontology_data(scenario.name, ontology.name, data)
    return data
