"""Data engine — translate and forward ontology API calls to target APIs.

Callable by both HTTP endpoints and agents.
行为执行路径的统一适配器：API 转发（含映射/信封判定）+ SQL 执行。
SQL 原在 routers/data_engines.py，迁移至此消除 cross-router 私有 import。
"""

import logging
import os
import re

import httpx
from fastapi import HTTPException

from schemas import DataEngineItem, OntologyData

logger = logging.getLogger(__name__)

# MySQL 连接池（懒初始化）—— SQL 型数据引擎共用
_sql_pools: dict = {}


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


async def _call_engine(de, params: dict) -> dict:
    """按数据引擎定义转发请求并应用输入/输出映射（call_data_engine/call_behavior 共用）。"""
    if not de.target.url:
        raise ValueError("目标接口未配置 URL")
    translated = _translate_input(params, de.input_mapping)
    result = await _http_call(de.target.url, de.target.method, translated)
    result["data"] = _translate_output(result["data"], de.output_mapping)
    return result


async def call_data_engine(
    data: OntologyData,
    engine_name: str,
    params: dict,
) -> dict:
    """Call target API via data engine, applying input/output mappings."""
    de = next((d for d in data.data_engines if d.name == engine_name), None)
    if de is None:
        raise ValueError(f"数据引擎不存在: {engine_name}")
    return await _call_engine(de, params)


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
    if de.engine_type != "SQL":
        check_param_contract(data, de, behavior_name)  # warn-only：暴露参数契约漂移
    return await _call_engine(de, params)


def is_business_failure(result: dict) -> bool:
    """Java ApiResponse 信封判定：data 为 {code≠0, message} 视为业务失败（HTTP 可能仍为 200）。

    修复幂等缓存 bug：behaviors 曾以 status_code<400 判成功，把 HTTP 200 + code≠0 的业务失败缓存在 ok。
    判定要求 code 为 int 且非 0、message 为非空 str，避免误伤普通业务数据里的 code 字段。
    """
    data = result.get("data")
    if isinstance(data, dict) and isinstance(data.get("code"), int) and data.get("code") != 0:
        if isinstance(data.get("message"), str) and data.get("message"):
            return True
    return False


def check_param_contract(data: OntologyData, de, behavior_name: str) -> list[str]:
    """参数契约一致性检查（warn-only，不阻断执行）。

    behaviors[].params / data_engines[].target.params / input_mapping 三份手工对齐，
    任一边改字段不会自动同步到其余两份。调用前跑一遍，把"必填参数未被目标接口或映射覆盖"
    的静默漂移记录成警告，便于建模期发现，而非等执行时报错。
    返回未覆盖的必填参数名。
    """
    beh = next((b for b in data.behaviors if b.name == behavior_name), None)
    if beh is None or de is None:
        return []
    required = [k for k, spec in (beh.params or {}).items() if isinstance(spec, dict) and spec.get("required")]
    covered = set(de.target.params or {})
    covered.update(de.input_mapping or {})
    missing = [k for k in required if k not in covered]
    if missing:
        logger.warning(
            "参数契约漂移：行为 %s 的必填参数 %s 未被 data_engine 的 target.params 或 input_mapping 覆盖",
            behavior_name, missing,
        )
    return missing


async def execute_sql(sc_name: str, on_name: str, de: DataEngineItem, params: dict, ontology_id: int = 0) -> dict:
    """Execute a SQL query from a data engine definition. Shared by data_engines and behaviors routers.

    迁移自 routers/data_engines.py 的 _execute_sql，行为逐字一致。
    """
    if not de.sql:
        raise HTTPException(status_code=400, detail="SQL 语句为空")
    try:
        sql = de.sql
        for k, v in params.items():
            var_name = de.sql_vars.get(k, k)
            placeholder = f":{var_name}"
            if isinstance(v, str):
                sql = sql.replace(placeholder, f"'{v}'")
            else:
                sql = sql.replace(placeholder, str(v))
        sql = re.sub(r":[a-zA-Z_]+", "NULL", sql)

        stripped = sql.strip().upper()
        if not stripped.startswith("SELECT"):
            raise HTTPException(status_code=400, detail="只允许执行 SELECT 查询")

        import mysql.connector.pooling
        db_host = os.environ.get("DB_HOST", "mysql")
        db_port = int(os.environ.get("DB_PORT", 3306))
        db_user = os.environ.get("DB_USERNAME", "root")
        db_pass = os.environ.get("DB_PASSWORD", "")
        db_name = os.environ.get("DB_NAME", "onto_material")

        pool_key = f"sql_pool_{ontology_id}"
        if pool_key not in _sql_pools:
            _sql_pools[pool_key] = mysql.connector.pooling.MySQLConnectionPool(
                pool_name=pool_key, pool_size=3,
                host=db_host, port=db_port,
                user=db_user, password=db_pass,
                database=db_name,
            )
        conn = _sql_pools[pool_key].get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql)
        rows = cursor.fetchmany(100)
        cursor.close()
        conn.close()
        return {"result": {"data": rows, "row_count": len(rows)}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL 执行失败: {str(e)}")
