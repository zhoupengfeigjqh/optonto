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


def _translate_input(params: dict, input_mapping: dict, _onto_path: str = "") -> dict:
    """Rename ontology param keys to target keys via input_mapping (recursive, in-place).

    与 _translate_output 同构（方向相反：本体路径 → 目标路径，原地换名不改结构）。
    平铺映射是路径的特例；object 内嵌套字段、array[object] 内部字段（[*] 路径）均可换名：
    {"order.lines[*].prod": "order.items[*].prod_name", "order.lines": "order.items"}
    """
    if not input_mapping or not params:
        return params
    result = {}
    for k, v in params.items():
        onto_path = f"{_onto_path}.{k}" if _onto_path else k
        target_full = input_mapping.get(onto_path, k)
        new_key = target_full.rsplit(".", 1)[-1]
        result[new_key] = _translate_input_value(v, input_mapping, onto_path)
    return result


def _translate_input_value(value, input_mapping: dict, onto_path: str):
    """值递归：dict 继续换名，list 元素走 [*] 路径，标量原样透传。"""
    if isinstance(value, dict):
        return _translate_input(value, input_mapping, onto_path)
    if isinstance(value, list):
        item_path = f"{onto_path}[*]"
        return [_translate_input_value(item, input_mapping, item_path) for item in value]
    return value


def _translate_output(data, output_mapping: dict, _orig_path: str = "", _reverse: dict | None = None):
    """Recursively rename keys in target response back to ontology names via output_mapping.

    查表一律用目标原始路径（_orig_path 由响应里的真实 key 拼成），与父节点是否改名无关——
    因此数组/对象节点换名与其内部字段换名可共存（如 {"items": "data", "items[*].name": "data[*].prod_name"}）。
    """
    if not output_mapping or not data:
        return data
    reverse_map = _reverse if _reverse is not None else {v: k for k, v in output_mapping.items() if v}

    if isinstance(data, dict):
        result = {}
        for k, v in data.items():
            orig_path = f"{_orig_path}.{k}" if _orig_path else k
            onto_full = reverse_map.get(orig_path, k)
            new_key = onto_full.rsplit(".", 1)[-1]
            result[new_key] = _translate_output(v, output_mapping, orig_path, reverse_map)
        return result
    if isinstance(data, list):
        orig_path = f"{_orig_path}[*]" if _orig_path else "[*]"
        return [_translate_output(item, output_mapping, orig_path, reverse_map) for item in data]
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
            # 占位符名与行为参数名同名（生成规则强制 :paramName），无需换名映射
            placeholder = f":{k}"
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
