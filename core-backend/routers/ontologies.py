"""本体 CRUD API —— 注册表（meta.json + 身份）+ YAML 数据。

分层（章程 II）：本模块为接口层，只做参数接收与响应组装；
注册表经 ``services.ontology_registry``，本体数据经 ``services`` 本体领域函数，
**不直连 repositories**。
"""

from fastapi import APIRouter

from errors import ConflictError, InvalidInputError, NotFoundError

from dependencies import get_ontology_names
from schemas import OntologyData
from services import (
    deployed_version_of,
    ensure_ontology_dir,
    load_ontology_data,
    ontology_registry,
    save_ontology_data,
)

router = APIRouter(prefix="/api/ontologies", tags=["本体"])


@router.get("")
async def list_all_ontologies_api():
    """列出所有本体（跨场景全量列表）。"""
    return ontology_registry.list_all_ontologies()


@router.get("/by-scenario/{scenario_id}")
async def list_ontologies_api(scenario_id: int):
    scenario = ontology_registry.require_scenario(scenario_id)
    return ontology_registry.list_ontologies_by_scenario(scenario["name"])


@router.post("", status_code=201)
async def create_ontology_api(data: dict):
    name = (data.get("name") or "").strip()
    if not name:
        raise InvalidInputError("本体名称不能为空")
    scenario_id = data.get("scenario_id")
    if not scenario_id:
        raise InvalidInputError("场景ID不能为空")

    scenario = ontology_registry.require_scenario(scenario_id)

    # Check uniqueness within scenario
    for o in ontology_registry.list_ontologies_by_scenario(scenario["name"]):
        if o["name"] == name:
            raise ConflictError("该场景下本体名称已存在")

    result = ontology_registry.create_ontology(
        scenario_name=scenario["name"],
        name=name,
        description=data.get("description", ""),
        creator=data.get("creator", ""),
    )
    if not result:
        raise NotFoundError("场景不存在")

    # Create YAML directory and initialize data
    ensure_ontology_dir(scenario["name"], name)
    save_ontology_data(scenario["name"], name, OntologyData())

    return result


@router.get("/{ontology_id}")
async def get_ontology_api(ontology_id: int):
    ontology, scenario_name, ontology_name = ontology_registry.require_ontology(ontology_id)
    ontology["scenario_name"] = scenario_name
    # deployed_version 与清单口径同源（services.deployed_version_of 读 ontology.yaml.metadata）
    ontology["deployed_version"] = deployed_version_of(scenario_name, ontology_name)
    return ontology


@router.put("/{ontology_id}")
async def update_ontology_api(ontology_id: int, data: dict):
    _, scenario_name, ontology_name = ontology_registry.require_ontology(ontology_id)

    name = data.get("name")
    if name:
        # Check for duplicate name in same scenario
        for o in ontology_registry.list_ontologies_by_scenario(scenario_name):
            if o["name"] == name and o["id"] != ontology_id:
                raise ConflictError("该场景下本体名称已存在")

    updated = ontology_registry.update_ontology(
        ontology_id,
        name=name,
        description=data.get("description"),
        creator=data.get("creator"),
    )
    if not updated:
        raise NotFoundError("本体不存在")
    # 改名（目录已移动）→ 回刷 ontology.yaml.metadata：身份唯一读取来源，落后会让清单/路由跳过该本体
    if name and name != ontology_name:
        ontology_registry.refresh_identity_metadata(scenario_name, name)
    return updated


@router.delete("/{ontology_id}")
async def delete_ontology_api(ontology_id: int):
    ontology_registry.require_ontology(ontology_id)
    ontology_registry.delete_ontology(ontology_id)
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
