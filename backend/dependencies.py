"""Shared dependencies for routers."""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models import Scenario, Ontology


async def get_ontology_names(ontology_id: int, db: AsyncSession):
    """Fetch ontology and its parent scenario, or raise 404. Returns (scenario_name, ontology_name)."""
    ontology = await db.get(Ontology, ontology_id)
    if not ontology:
        raise HTTPException(status_code=404, detail="本体不存在")
    scenario = await db.get(Scenario, ontology.scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="关联场景不存在")
    return scenario.name, ontology.name
