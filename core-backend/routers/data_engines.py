"""CRUD API for data engines within an ontology — maps ontology behaviors to target APIs."""

import json

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import DATA_DIR
from dependencies import get_ontology_names
from schemas import DataEngineItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from llm_utils import load_env, llm_json, llm_text

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


# ─── Smart Parse ────────────────────────────────────────────────────────────────

class SmartParseRequest(BaseModel):
    params_content: str = ""
    response_content: str = ""


@router.post("/{engine_name}/smart-parse")
async def smart_parse(ontology_id: int, engine_name: str, body: SmartParseRequest):
    """Use LLM to parse pasted API doc content into structured params/response."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise HTTPException(status_code=404, detail="数据引擎不存在")

    from config import TARGET_PARSE_SYSTEM_PROMPT, TARGET_PARSE_PROMPT, DATA_DIR
    import yaml

    # 从 onto_template.yaml 读取标准参考模板
    template_path = DATA_DIR / "onto_template.yaml"
    template_params = "{}"
    template_response = "{}"
    if template_path.exists():
        with open(template_path, encoding="utf-8") as f:
            template_data = yaml.safe_load(f) or {}
        if template_data.get("behaviors"):
            template_params = json.dumps(template_data["behaviors"][0].get("params", {}), ensure_ascii=False)
            template_response = json.dumps(template_data["behaviors"][0].get("response", {}), ensure_ascii=False)

    prompt = TARGET_PARSE_PROMPT.format(
        template_params=template_params,
        template_response=template_response,
        params_content=body.params_content or "（未提供）",
        response_content=body.response_content or "（未提供）",
    )

    try:
        result, stripped = await llm_json(TARGET_PARSE_SYSTEM_PROMPT, prompt, 0.3)
        if result is None:
            if stripped is None:
                raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行智能解析")
            raise HTTPException(status_code=500, detail=f"LLM 返回格式异常: {stripped[:200]}")
        return {
            "api_name": result.get("api_name", ""),
            "data_source_name": result.get("data_source_name", ""),
            "url": result.get("url", ""),
            "method": result.get("method", ""),
            "params": result.get("params", {}),
            "response": result.get("response", {}),
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"智能解析失败: {str(e)}")


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
    """Call target API or execute SQL query via data engine."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise HTTPException(status_code=404, detail="数据引擎不存在")

    params = body.get("params", {})

    if de.engine_type == "SQL":
        from services.data_engine import execute_sql
        return await execute_sql(sc_name, on_name, de, params, ontology_id)

    # API type — use existing data engine

    # API type — use existing data engine
    try:
        from services.data_engine import call_data_engine
        return await call_data_engine(data, engine_name, params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.ConnectError:
        raise HTTPException(status_code=400, detail="无法连接到目标接口，请检查 URL 是否正确")
    except httpx.TimeoutException:
        raise HTTPException(status_code=408, detail="目标接口请求超时")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"调用失败: {str(e)}")


# ─── Generate SQL ─────────────────────────────────────────────────────────


@router.post("/{engine_name}/generate-sql")
async def generate_sql(ontology_id: int, engine_name: str):
    """Use LLM to generate SQL from schema + behavior definition."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise HTTPException(status_code=404, detail="数据引擎不存在")

    beh = next((b for b in data.behaviors if b.name == de.behavior_name), None)
    if beh is None:
        raise HTTPException(status_code=404, detail="关联的本体行为不存在")

    # Read schema
    schema_path = DATA_DIR / "onto_market" / sc_name / on_name / "db_schema" / "db_schema.md"
    db_schema = ""
    if schema_path.exists():
        db_schema = schema_path.read_text(encoding="utf-8")

    from config import DB_GENERATE_SYSTEM_PROMPT, DB_GENERATE_PROMPT

    import json
    prompt = DB_GENERATE_PROMPT.format(
        db_schema=db_schema or "（未上传数据库 Schema）",
        behavior_name=beh.name,
        behavior_description=beh.description or "",
        params=json.dumps(beh.params, ensure_ascii=False, indent=2),
        response=json.dumps(beh.response, ensure_ascii=False, indent=2),
    )

    try:
        sql, _ = await llm_text(DB_GENERATE_SYSTEM_PROMPT, prompt, 0.3)
        if sql is None:
            raise HTTPException(status_code=400, detail="未配置 LLM API Key")
        return {"sql": sql}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL 生成失败: {str(e)}")
