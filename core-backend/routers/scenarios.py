"""场景 CRUD API —— 注册表（meta.json）。

分层（章程 II）：本模块为接口层；注册表经 ``services.ontology_registry``，不直连 repositories。
"""

from fastapi import APIRouter

from errors import ConflictError, InvalidInputError, NotFoundError

from services import ontology_registry as registry

router = APIRouter(prefix="/api/scenarios", tags=["场景"])


@router.get("")
async def list_scenarios_api():
    return registry.list_scenarios()


@router.post("", status_code=201)
async def create_scenario_api(data: dict):
    name = (data.get("name") or "").strip()
    if not name:
        raise InvalidInputError("场景名称不能为空")
    if registry.scenario_by_name(name):
        raise ConflictError("场景名称已存在")
    return registry.create_scenario(name, data.get("description", ""))


@router.get("/{scenario_id}")
async def get_scenario_api(scenario_id: int):
    return registry.require_scenario(scenario_id)


@router.put("/{scenario_id}")
async def update_scenario_api(scenario_id: int, data: dict):
    name = data.get("name")
    if name:
        existing = registry.scenario_by_name(name)
        if existing and existing["id"] != scenario_id:
            raise ConflictError("场景名称已存在")

    before = registry.get_scenario(scenario_id)
    result = registry.update_scenario(scenario_id, name=name, description=data.get("description"))
    if not result:
        raise NotFoundError("场景不存在")

    # 场景改名（整目录已移动）→ 回刷其下所有本体的 ontology.yaml.metadata.scenario_name。
    # 身份唯一读取来源是 metadata；不回刷则读取侧（清单/路由/scope）拿到旧场景名 → 与目录不一致 → 整条跳过。
    # 按目录物理枚举（此刻身份尚未同步，不能靠 list_ontologies_by_scenario，否则自锁）。
    if name and before and name != before.get("name"):
        for ontology_name in registry.ontology_dir_names(name):
            registry.refresh_identity_metadata(name, ontology_name)
    return result


@router.delete("/{scenario_id}")
async def delete_scenario_api(scenario_id: int):
    scenario = registry.require_scenario(scenario_id)
    # Check if any ontologies exist
    if registry.list_ontologies_by_scenario(scenario["name"]):
        raise ConflictError("该场景下存在本体，请先删除所有本体后再删除场景")
    registry.delete_scenario(scenario_id)
    return {"message": "场景已删除"}
