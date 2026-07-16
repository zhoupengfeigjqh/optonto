"""Data engine — translate and forward ontology API calls to target APIs.

Callable by both HTTP endpoints and agents.
"""

import re
import httpx

from schemas import OntologyData


def _translate_input(params: dict, input_mapping: dict) -> dict:
    """Translate ontology param keys to target param keys via input_mapping."""
    if not input_mapping:
        return params
    result = {}
    for onto_key, value in params.items():
        target_key = input_mapping.get(onto_key, onto_key)
        result[target_key] = value
    return result


def _translate_output(data, output_mapping: dict, _path: str = ""):
    """Recursively rename keys in target response back to ontology names via output_mapping."""
    if not output_mapping or not data:
        return data
    reverse_map = {v: k for k, v in output_mapping.items() if v}

    if isinstance(data, dict):
        result = {}
        for k, v in data.items():
            full_path = f"{_path}.{k}" if _path else k
            onto_full = reverse_map.get(full_path, k)
            new_key = onto_full.rsplit(".", 1)[-1] if "." in onto_full else onto_full
            new_path = f"{_path}.{new_key}" if _path else new_key
            result[new_key] = _translate_output(v, output_mapping, new_path)
        return result
    if isinstance(data, list):
        new_path = f"{_path}[*]" if _path else "[*]"
        return [_translate_output(item, output_mapping, new_path) for item in data]
    return data


def _is_json(content_type: str) -> bool:
    return "application/json" in content_type or "json" in content_type


def _substitute_path_params(url: str, params: dict) -> tuple[str, dict]:
    """Replace {paramName} placeholders in URL with values from params. Returns (url, remaining_params)."""
    remaining = dict(params)

    def replace(m: re.Match) -> str:
        key = m.group(1)
        val = str(remaining.pop(key, m.group(0)))
        return val

    url = re.sub(r"\{(\w+)\}", replace, url)
    return url, remaining


async def _http_call(url: str, method: str, params: dict, timeout: int = 30) -> dict:
    """Make an HTTP request. Path params ({xxx}) are replaced in URL, remaining go to query/body."""
    url, params = _substitute_path_params(url, params)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if method == "GET":
            resp = await client.get(url, params=params)
        elif method == "DELETE":
            resp = await client.delete(url, params=params)
        else:
            resp = await client.request(method, url, json=params)
        resp_data = resp.json() if _is_json(resp.headers.get("content-type", "")) else resp.text
        return {
            "status_code": resp.status_code,
            "headers": dict(resp.headers),
            "data": resp_data,
        }


async def call_data_engine(
    data: OntologyData,
    engine_name: str,
    params: dict,
) -> dict:
    """Call target API via data engine, applying input/output mappings."""
    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise ValueError(f"数据引擎不存在: {engine_name}")
    if not de.target.url:
        raise ValueError("目标接口未配置 URL")

    translated = _translate_input(params, de.input_mapping)
    result = await _http_call(de.target.url, de.target.method, translated)
    result["data"] = _translate_output(result["data"], de.output_mapping)
    return result


async def call_behavior(
    data: OntologyData,
    behavior_name: str,
    params: dict,
) -> dict:
    """Call a behavior API via data engine mapping to target API."""
    beh = next((b for b in data.behaviors if b.name == behavior_name), None)
    if beh is None:
        raise ValueError(f"行为不存在: {behavior_name}")

    de = next((d for d in data.data_engines if d.behavior_name == behavior_name), None)
    if de is None:
        raise ValueError("该行为未绑定数据引擎，请先配置数据引擎")
    if not de.target.url:
        raise ValueError("目标接口未配置 URL")

    translated = _translate_input(params, de.input_mapping)
    result = await _http_call(de.target.url, de.target.method, translated)
    result["data"] = _translate_output(result["data"], de.output_mapping)
    return result
