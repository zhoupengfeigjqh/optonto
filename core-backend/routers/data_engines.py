"""CRUD API for data engines within an ontology — maps ontology behaviors to target APIs."""

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from dependencies import get_ontology_names
from schemas import DataEngineItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from llm_utils import load_env, llm_json

router = APIRouter(prefix="/api/ontologies/{ontology_id}/data-engines", tags=["数据引擎"])


# ─── Load .env ────────────────────────────────────────────────────────────
load_env()


# ─── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_data_engines(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.data_engines


@router.post("", status_code=201)
async def create_data_engine(ontology_id: int, item: DataEngineItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    ensure_unique(data.data_engines, item.name, "数据引擎")
    data.data_engines.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{engine_name}")
async def update_data_engine(ontology_id: int, engine_name: str, item: DataEngineItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    idx = find_index(data.data_engines, engine_name, "数据引擎")
    ensure_unique(data.data_engines, item.name, "数据引擎", exclude_name=engine_name)
    data.data_engines[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{engine_name}")
async def delete_data_engine(ontology_id: int, engine_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    idx = find_index(data.data_engines, engine_name, "数据引擎")
    data.data_engines.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "数据引擎已删除"}


# ─── Mapping Analysis ──────────────────────────────────────────────────────────

class AnalyzeMappingRequest(BaseModel):
    onto_input_fields: list[str] = []
    target_input_fields: list[str] = []
    onto_output_fields: list[str] = []
    target_output_fields: list[str] = []


@router.post("/{engine_name}/analyze-mapping")
async def analyze_mapping(ontology_id: int, engine_name: str, body: AnalyzeMappingRequest = AnalyzeMappingRequest()):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise HTTPException(status_code=404, detail="数据引擎不存在")

    beh = next((b for b in data.behaviors if b.name == de.behavior_name), None)
    if beh is None:
        raise HTTPException(status_code=404, detail="关联的本体行为不存在")

    from config import MAPPING_ANALYSIS_SYSTEM_PROMPT, MAPPING_ANALYSIS_PROMPT

    prompt = MAPPING_ANALYSIS_PROMPT.format(
        onto_input_fields=json.dumps(body.onto_input_fields, ensure_ascii=False),
        target_input_fields=json.dumps(body.target_input_fields, ensure_ascii=False),
        onto_output_fields=json.dumps(body.onto_output_fields, ensure_ascii=False),
        target_output_fields=json.dumps(body.target_output_fields, ensure_ascii=False),
    )

    try:
        result, stripped = await llm_json(MAPPING_ANALYSIS_SYSTEM_PROMPT, prompt, 0.3)
        if result is None:
            if stripped is None:
                raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行智能映射")
            return {"status": "error", "message": f"LLM 返回格式异常: {stripped[:200]}", "issues": []}

        # Save mapping results to data engine
        de.input_mapping = result.get("input_mapping", {})
        de.output_mapping = result.get("output_mapping", {})
        save_ontology_data(sc_name, on_name, data)

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"智能映射失败: {str(e)}")


# ─── Smart Align ────────────────────────────────────────────────────────────────

@router.post("/{engine_name}/smart-align")
async def smart_align(ontology_id: int, engine_name: str):
    """Use LLM to align ontology behavior params/response field names with target API."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise HTTPException(status_code=404, detail="数据引擎不存在")

    beh = next((b for b in data.behaviors if b.name == de.behavior_name), None)
    if beh is None:
        raise HTTPException(status_code=404, detail="关联的本体行为不存在")

    if not de.target.params and not de.target.response:
        raise HTTPException(status_code=400, detail="目标接口参数和返回结构均为空，无法对齐")

    from config import ALIGNMENT_SYSTEM_PROMPT, ALIGNMENT_PROMPT

    prompt = ALIGNMENT_PROMPT.format(
        ontology_params=json.dumps(beh.params, ensure_ascii=False),
        ontology_response=json.dumps(beh.response, ensure_ascii=False),
        target_params=json.dumps(de.target.params, ensure_ascii=False),
        target_response=json.dumps(de.target.response, ensure_ascii=False),
    )

    try:
        result, stripped = await llm_json(ALIGNMENT_SYSTEM_PROMPT, prompt, 0.3)
        if result is None:
            if stripped is None:
                raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行智能对齐")
            raise HTTPException(status_code=500, detail=f"LLM 返回格式异常: {stripped[:200]}")
        aligned_params = result.get("params", beh.params)
        aligned_response = result.get("response", beh.response)

        # Save aligned params/response back to the behavior
        beh.params = aligned_params
        beh.response = aligned_response
        save_ontology_data(sc_name, on_name, data)

        return {"params": aligned_params, "response": aligned_response}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"智能对齐失败: {str(e)}")


# ─── Data Engine Call ──────────────────────────────────────────────────────────


@router.post("/{engine_name}/call")
async def call_engine(ontology_id: int, engine_name: str, body: dict):
    """Call target API or execute SQL query via data engine — 降级转发 data-engine-mcp。

    设计器连接测试与 Agent 行为调用走同一执行器（消灭双执行路径）；
    状态码与 detail 原样透传（下游 4xx/5xx 保持错误形态，isError 语义不破坏）。
    """
    from services.runtime_forward import DATA_ENGINE_MCP_URL, forward_call
    return await forward_call(
        DATA_ENGINE_MCP_URL, "/call-engine",
        {"ontology_id": ontology_id, "engine_name": engine_name, "params": body.get("params", {})},
        "data-engine-mcp",
    )
