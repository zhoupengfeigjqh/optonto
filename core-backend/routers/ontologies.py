"""CRUD API for ontologies — file-based metadata."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from metadata import (
    list_ontologies_by_scenario, list_all_ontologies, get_ontology_by_id, get_scenario_by_id,
    create_ontology, update_ontology, delete_ontology,
)
from services import ensure_ontology_dir, save_ontology_data, load_ontology_data, OntologyData
from services.params_schema import params_to_input_schema

router = APIRouter(prefix="/api/ontologies", tags=["本体"])


@router.get("")
async def list_all_ontologies_api():
    """列出所有本体（跨场景全量列表）。"""
    return list_all_ontologies()


@router.get("/functions/all")
async def list_all_functions_api():
    """跨本体聚合所有本体函数，产出带 inputSchema 的列表（MCP 注册一等函数工具用）。

    inputSchema 含约束（enum/pattern/min/max 按「参数名=属性名」从 related_concepts 回溯编译）；
    约束冲突时附带 constraint_conflicts 警告（不阻塞，先扫到的生效）。
    """
    result = []
    for onto in list_all_ontologies():
        oid = onto.get("id")
        scenario_name = onto.get("scenario_name")
        ontology_name = onto.get("ontology_name")
        if oid is None or not scenario_name or not ontology_name:
            continue
        try:
            data = load_ontology_data(scenario_name, ontology_name)
        except Exception:
            continue
        for fn in data.functions:
            schema, conflicts = params_to_input_schema(
                fn.params, _related_concepts(data, fn.related_concepts))
            item = {
                "ontology_id": oid,
                "ontology_name": ontology_name,
                "scenario_id": onto.get("scenario_id"),
                "scenario_name": scenario_name,
                "name": fn.name,
                "display_name": fn.display_name,
                "description": fn.description,
                "inputSchema": schema,
            }
            if conflicts:
                item["constraint_conflicts"] = conflicts
            result.append(item)
    return result


def _related_concepts(data: OntologyData, names: list[str]):
    """按 related_concepts 名解析概念对象（约束回溯的数据源）。"""
    if not names:
        return []
    wanted = set(names)
    return [c for c in data.concepts if c.name in wanted]


@router.get("/behaviors/all")
async def list_all_behaviors_api():
    """跨本体聚合所有本体行为，产出带 inputSchema 的工具列表（MCP 注册一等行为工具用，facade）。

    tool_name 全局命名：裸名优先；跨本体重名时冲突方加前缀 onto{ontology_id}__
    （避免中文字符进工具名）。inputSchema 含约束（同 functions/all 口径）。
    """
    entries = []
    for onto in list_all_ontologies():
        oid = onto.get("id")
        scenario_name = onto.get("scenario_name")
        ontology_name = onto.get("ontology_name")
        if oid is None or not scenario_name or not ontology_name:
            continue
        try:
            data = load_ontology_data(scenario_name, ontology_name)
        except Exception:
            continue
        for b in data.behaviors:
            schema, conflicts = params_to_input_schema(
                b.params, _related_concepts(data, b.related_concepts))
            item = {
                "ontology_id": oid,
                "ontology_name": ontology_name,
                "scenario_id": onto.get("scenario_id"),
                "scenario_name": scenario_name,
                "name": b.name,
                "display_name": b.display_name,
                "description": b.description,
                "op_type": b.op_type,
                "inputSchema": schema,
            }
            if conflicts:
                item["constraint_conflicts"] = conflicts
            entries.append(item)

    # 全局命名：裸名优先，跨本体重名的冲突方加 onto{ontology_id}__ 前缀
    name_count: dict[str, int] = {}
    for e in entries:
        name_count[e["name"]] = name_count.get(e["name"], 0) + 1
    for e in entries:
        e["tool_name"] = e["name"] if name_count[e["name"]] == 1 else f"onto{e['ontology_id']}__{e['name']}"
    return entries


@router.get("/by-scenario/{scenario_id}")
async def list_ontologies_api(scenario_id: int):
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="场景不存在")
    return list_ontologies_by_scenario(scenario["name"])


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
    for o in list_ontologies_by_scenario(scenario["name"]):
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
    # 从已部署的 ontology.yaml 解析 deployed_version（与 list_all_ontologies 一致）
    from services import _get_yaml_path
    import yaml
    ontology_yaml = _get_yaml_path(scenario_name, ontology_name)
    deployed_version = ""
    if ontology_yaml.exists():
        try:
            raw = yaml.safe_load(ontology_yaml.read_text(encoding="utf-8")) or {}
            meta = raw.get("metadata") if isinstance(raw, dict) else None
            if isinstance(meta, dict):
                deployed_version = str(meta.get("deployed_version") or "")
        except Exception:
            pass
    ontology["deployed_version"] = deployed_version
    return ontology


@router.put("/{ontology_id}")
async def update_ontology_api(ontology_id: int, data: dict):
    result = get_ontology_by_id(ontology_id)
    if not result:
        raise HTTPException(status_code=404, detail="本体不存在")

    name = data.get("name")
    if name:
        # Check for duplicate name in same scenario (result[1] = scenario_name)
        for o in list_ontologies_by_scenario(result[1]):
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
