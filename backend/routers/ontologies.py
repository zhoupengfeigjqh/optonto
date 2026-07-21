"""CRUD API for ontologies — file-based metadata."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from metadata import (
    list_ontologies, list_all_ontologies, get_ontology_by_id, get_scenario_by_id,
    get_scenario_by_name, create_ontology, update_ontology, delete_ontology,
)
from services import ensure_ontology_dir, save_ontology_data, load_ontology_data, OntologyData

router = APIRouter(prefix="/api/ontologies", tags=["本体"])


@router.get("")
async def list_all_ontologies_api():
    """列出所有本体（跨场景全量列表）。"""
    return list_all_ontologies()


@router.get("/by-scenario/{scenario_id}")
async def list_ontologies_api(scenario_id: int):
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    return list_ontologies(scenario["name"])


@router.post("", status_code=201)
async def create_ontology_api(data: dict):
    scenario_id = data.get("scenario_id")
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="本体名称不能为空")
    if not scenario_id:
        raise HTTPException(status_code=400, detail="场景ID不能为空")

    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")

    # Check uniqueness within scenario
    for o in list_ontologies(scenario["name"]):
        if o["name"] == name:
            raise HTTPException(status_code=400, detail="该场景下本体名称已存在")

    result = create_ontology(
        scenario_name=scenario["name"],
        name=name,
        description=data.get("description", ""),
        creator=data.get("creator", ""),
    )
    if not result:
        raise HTTPException(status_code=404, detail="场景不存在")

    # Create YAML directory and initialize data
    ensure_ontology_dir(scenario["name"], name)
    save_ontology_data(scenario["name"], name, OntologyData())

    return result


@router.get("/{ontology_id}")
async def get_ontology_api(ontology_id: int):
    result = get_ontology_by_id(ontology_id)
    if not result:
        raise HTTPException(status_code=404, detail="本体不存在")
    ontology, scenario_name, ontology_name = result
    ontology["scenario_name"] = scenario_name
    return ontology


@router.put("/{ontology_id}")
async def update_ontology_api(ontology_id: int, data: dict):
    result = get_ontology_by_id(ontology_id)
    if not result:
        raise HTTPException(status_code=404, detail="本体不存在")

    name = data.get("name")
    if name:
        existing_result = get_ontology_by_id(ontology_id)
        if existing_result:
            # Check for duplicate name in same scenario
            for o in list_ontologies(existing_result[1]):
                if o["name"] == name and o["id"] != ontology_id:
                    raise HTTPException(status_code=400, detail="该场景下本体名称已存在")

    updated = update_ontology(
        ontology_id,
        name=name,
        description=data.get("description"),
        creator=data.get("creator"),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="本体不存在")
    return updated


@router.delete("/{ontology_id}")
async def delete_ontology_api(ontology_id: int):
    result = get_ontology_by_id(ontology_id)
    if not result:
        raise HTTPException(status_code=404, detail="本体不存在")
    delete_ontology(ontology_id)
    return {"message": "本体已删除"}


@router.get("/{ontology_id}/data")
async def get_ontology_data_api(ontology_id: int):
    """Load full ontology data (concepts, relations, etc.) from YAML."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    return load_ontology_data(sc_name, on_name)


@router.put("/{ontology_id}/data")
async def update_ontology_data_api(ontology_id: int, data: OntologyData):
    """Save full ontology data to YAML."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    save_ontology_data(sc_name, on_name, data)
    return data
