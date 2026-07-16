"""CRUD API for data engines within an ontology — maps ontology behaviors to target APIs."""

import json
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from dependencies import get_ontology_names
from schemas import DataEngineItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/data-engines", tags=["数据引擎"])


# ─── LLM setup ────────────────────────────────────────────────────────────────

# ─── Load .env ────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parent.parent.parent / "config" / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

try:
    from langchain_openai import ChatOpenAI

    _HAS_LANGCHAIN = True
except ImportError:
    _HAS_LANGCHAIN = False


def _build_llm():
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    api_url = os.environ.get("LLM_API_URL", "https://api.deepseek.com")
    model = os.environ.get("LLM_MODEL", "deepseek-chat")
    if not api_key:
        return None
    return ChatOpenAI(
        model=model,
        openai_api_key=api_key,
        openai_api_base=api_url,
        temperature=0.3,
        streaming=False,
    )


MAPPING_ANALYSIS_SYSTEM_PROMPT = "你是一个API接口映射分析专家。只输出JSON，不输出其他内容。"

MAPPING_ANALYSIS_PROMPT = """分析本体API接口和目标系统API接口的参数和返回结构是否可以正常映射。

【本体行为接口】
- 参数: {ontology_params}
- 返回结构: {ontology_response}

【目标系统接口】
- 参数: {target_params}
- 返回结构: {target_response}

检查规则：
1. 参数名称和类型是否一致
2. 必填参数是否可以满足
3. 返回结构字段是否可以对应

严格按以下JSON格式输出，不要任何解释：
{{"status": "ok"或"warning"或"error", "message": "分析结论", "issues": ["具体问题描述"]}}"""


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
    if any(d.name == item.name for d in data.data_engines):
        raise HTTPException(status_code=400, detail="数据引擎名称已存在")
    data.data_engines.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{engine_name}")
async def update_data_engine(ontology_id: int, engine_name: str, item: DataEngineItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    idx = next((i for i, d in enumerate(data.data_engines) if d.name == engine_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="数据引擎不存在")
    if item.name != engine_name and any(d.name == item.name for d in data.data_engines):
        raise HTTPException(status_code=400, detail="数据引擎名称已存在")
    data.data_engines[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{engine_name}")
async def delete_data_engine(ontology_id: int, engine_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    idx = next((i for i, d in enumerate(data.data_engines) if d.name == engine_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="数据引擎不存在")
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

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行智能映射")

    from langchain_core.messages import HumanMessage, SystemMessage
    from config import MAPPING_ANALYSIS_SYSTEM_PROMPT, MAPPING_ANALYSIS_PROMPT

    prompt = MAPPING_ANALYSIS_PROMPT.format(
        onto_input_fields=json.dumps(body.onto_input_fields, ensure_ascii=False),
        target_input_fields=json.dumps(body.target_input_fields, ensure_ascii=False),
        onto_output_fields=json.dumps(body.onto_output_fields, ensure_ascii=False),
        target_output_fields=json.dumps(body.target_output_fields, ensure_ascii=False),
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=MAPPING_ANALYSIS_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        text = response.content.strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)

        # Save mapping results to data engine
        de.input_mapping = result.get("input_mapping", {})
        de.output_mapping = result.get("output_mapping", {})
        save_ontology_data(sc_name, on_name, data)

        return result
    except json.JSONDecodeError:
        return {"status": "error", "message": f"LLM 返回格式异常: {text[:200]}", "issues": []}
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

    beh = next((b for b in data.behaviors if b.name == de.behavior_name), None)

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行智能解析")

    from langchain_core.messages import HumanMessage, SystemMessage
    from config import TARGET_PARSE_SYSTEM_PROMPT, TARGET_PARSE_PROMPT

    ontology_params = json.dumps(beh.params, ensure_ascii=False) if beh else "{}"
    ontology_response = json.dumps(beh.response, ensure_ascii=False) if beh else "{}"

    prompt = TARGET_PARSE_PROMPT.format(
        ontology_params=ontology_params,
        ontology_response=ontology_response,
        params_content=body.params_content or "（未提供）",
        response_content=body.response_content or "（未提供）",
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=TARGET_PARSE_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        text = response.content.strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        return {
            "api_name": result.get("api_name", ""),
            "data_source_name": result.get("data_source_name", ""),
            "url": result.get("url", ""),
            "method": result.get("method", ""),
            "params": result.get("params", {}),
            "response": result.get("response", {}),
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"LLM 返回格式异常: {text[:200]}")
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

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行智能对齐")

    from langchain_core.messages import HumanMessage, SystemMessage
    from config import ALIGNMENT_SYSTEM_PROMPT, ALIGNMENT_PROMPT

    prompt = ALIGNMENT_PROMPT.format(
        ontology_params=json.dumps(beh.params, ensure_ascii=False),
        ontology_response=json.dumps(beh.response, ensure_ascii=False),
        target_params=json.dumps(de.target.params, ensure_ascii=False),
        target_response=json.dumps(de.target.response, ensure_ascii=False),
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=ALIGNMENT_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        text = response.content.strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        aligned_params = result.get("params", beh.params)
        aligned_response = result.get("response", beh.response)

        # Save aligned params/response back to the behavior
        beh.params = aligned_params
        beh.response = aligned_response
        save_ontology_data(sc_name, on_name, data)

        return {"params": aligned_params, "response": aligned_response}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"LLM 返回格式异常: {text[:200]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"智能对齐失败: {str(e)}")


# ─── Data Engine Call ──────────────────────────────────────────────────────────


@router.post("/{engine_name}/call")
async def call_engine(ontology_id: int, engine_name: str, body: dict):
    """Call target API via data engine (used by frontend and agents)."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    params = body.get("params", {})

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
