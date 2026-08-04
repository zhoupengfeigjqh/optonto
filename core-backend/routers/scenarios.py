"""CRUD API for scenarios — file-based metadata."""

from fastapi import APIRouter, HTTPException

from metadata import list_scenarios, get_scenario_by_id, get_scenario_by_name, create_scenario, update_scenario, delete_scenario, list_ontologies_by_scenario

router = APIRouter(prefix="/api/scenarios", tags=["场景"])


@router.get("")
async def list_scenarios_api():
    return list_scenarios()


@router.post("", status_code=201)
async def create_scenario_api(data: dict):
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="场景名称不能为空")
    if get_scenario_by_name(name):
        raise HTTPException(status_code=400, detail="场景名称已存在")
    return create_scenario(name, data.get("description", ""))


@router.get("/{scenario_id}")
async def get_scenario_api(scenario_id: int):
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    return scenario


@router.put("/{scenario_id}")
async def update_scenario_api(scenario_id: int, data: dict):
    name = data.get("name")
    if name and get_scenario_by_name(name):
        existing = get_scenario_by_name(name)
        if existing["id"] != scenario_id:
            raise HTTPException(status_code=400, detail="场景名称已存在")
    result = update_scenario(scenario_id, name=name, description=data.get("description"))
    if not result:
        raise HTTPException(status_code=404, detail="场景不存在")
    return result


@router.delete("/{scenario_id}")
async def delete_scenario_api(scenario_id: int):
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    # Check if any ontologies exist
    if list_ontologies_by_scenario(scenario["name"]):
        raise HTTPException(status_code=400, detail="该场景下存在本体，请先删除所有本体后再删除场景")
    delete_scenario(scenario_id)
    return {"message": "场景已删除"}
