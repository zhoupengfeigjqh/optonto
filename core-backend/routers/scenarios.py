"""CRUD API for scenarios — file-based metadata."""

from fastapi import APIRouter, HTTPException

from repositories.metadata import list_scenarios, get_scenario_by_id, get_scenario_by_name, create_scenario, update_scenario, delete_scenario, list_ontologies_by_scenario, list_ontology_dir_names, refresh_identity_metadata

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
    before = get_scenario_by_id(scenario_id)
    result = update_scenario(scenario_id, name=name, description=data.get("description"))
    if not result:
        raise HTTPException(status_code=404, detail="场景不存在")
    # 场景改名（整目录已移动）→ 回刷其下所有本体的 ontology.yaml.metadata.scenario_name。
    # 身份唯一读取来源是 metadata；不回刷则读取侧（清单/路由/scope）拿到旧场景名 → 与目录不一致 → 整条跳过。
    # 按目录物理枚举（此刻身份尚未同步，不能靠 list_ontologies_by_scenario，否则自锁）。
    if name and before and name != before.get("name"):
        for ontology_name in list_ontology_dir_names(name):
            refresh_identity_metadata(name, ontology_name)
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
