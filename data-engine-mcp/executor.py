"""映射执行器：行为/引擎调用的唯一权威（迁自 core-backend services/data_engine.py）。

engine_type 收敛史：HTTP 型阶段五删除、SQL 型 2026-09-07 随 DB 映射整体删除——
现唯一形态 MCP：按 target.server_url/tool_name 做 MCP 分发（本服务对下游是 MCP Client，
映射代理形态：输入映射 → callTool → 输出映射；下游 isError 穿透为 RuntimeError）。
engine_type 字段已彻底删出 schema，缺省即 MCP；显式标其他类型的旧配置报错兜底。

传输无关：配置错误抛 ValueError（对应 HTTP 400），执行失败抛 RuntimeError（对应 500）；
HTTP 状态映射在 server.py 的 REST 层，MCP facade 层统一转 RuntimeError 置 isError。
"""

import asyncio
import json
import logging

import loaders
from mapper import _translate_input, _translate_output

logger = logging.getLogger(__name__)

# ─── MCP 下游调用（engine_type: MCP 分发）────────────────────────────
# 逐调用建连（同一 task 内 connect→call→close），不做跨请求会话缓存：
# anyio cancel scope 不能跨 task 关闭，缓存会话在并发请求下关闭即炸（实测）。
# 调用频率低、内网握手代价小，正确性优先；15s 总超时与架构文档 §五/§十四对齐。
MCP_CALL_TIMEOUT = 15.0


async def _mcp_call_tool(server_url: str, tool_name: str, arguments: dict,
                         headers: dict | None = None) -> dict:
    """callTool 下游 MCP：isError/超时/不可达 → RuntimeError（错误穿透，文档 §十）。

    headers：target.headers 配置的 HTTP 头（远程 MCP 鉴权，文档 §九.3），连接时携带。
    返回 {"status_code": 200, "data": <解析后的负载>}，与 http_call 信封同形——
    文本通道优先（business-mcp 约定文本与 structuredContent 同负载）；
    无文本时退 structuredContent（第三方只回 structured 的情形）。
    """
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async def _once() -> dict:
        # 下游为 Streamable HTTP（/mcp 单端点）；无状态模式下每次调用建连即关，无会话残留
        async with streamablehttp_client(server_url, headers=headers or None, timeout=10) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await asyncio.wait_for(
                    session.call_tool(tool_name, arguments), timeout=MCP_CALL_TIMEOUT)
        if getattr(result, "isError", False):
            detail = "".join(getattr(c, "text", "") for c in result.content or [])
            raise RuntimeError(f"下游 MCP 工具 {tool_name} 报错: {detail[:300]}")
        text = "".join(getattr(c, "text", "") for c in result.content or [])
        if text:
            try:
                payload = json.loads(text)
            except ValueError:
                payload = text
        else:
            payload = result.structuredContent
        return {"status_code": 200, "data": payload}

    try:
        return await asyncio.wait_for(_once(), timeout=MCP_CALL_TIMEOUT + 5)
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"下游 MCP 不可达或超时（{server_url}）: {e}")


async def _call_engine_mcp(de: dict, params: dict) -> dict:
    """MCP 型引擎：输入映射 → callTool(target.server_url, target.tool_name) → 输出映射。"""
    target = de.get("target") or {}
    server_url = target.get("server_url")
    tool_name = target.get("tool_name")
    if not server_url or not tool_name:
        raise ValueError("MCP 型数据引擎的 target 未配置 server_url / tool_name")
    translated = _translate_input(params, de.get("input_mapping") or {})
    result = await _mcp_call_tool(server_url, tool_name, translated,
                                  headers=target.get("headers") or None)
    result["data"] = _translate_output(result["data"], de.get("output_mapping") or {})
    return result


def _find_engine(data: dict, *, engine_name: str | None = None, behavior_name: str | None = None) -> dict | None:
    for de in data.get("data_engines") or []:
        if not isinstance(de, dict):
            continue
        if engine_name is not None and de.get("name") == engine_name:
            return de
        if behavior_name is not None and de.get("behavior_name") == behavior_name:
            return de
    return None


def _check_param_contract(data: dict, de: dict, behavior_name: str) -> list[str]:
    """参数契约一致性检查（warn-only，不阻断执行）。

    behaviors[].params / data_engines[].target.params / input_mapping 三份手工对齐，
    任一边改字段不会自动同步到其余两份。调用前跑一遍，把"必填参数未被目标接口或映射覆盖"
    的静默漂移记录成警告。返回未覆盖的必填参数名。
    """
    beh = next((b for b in data.get("behaviors") or [] if isinstance(b, dict) and b.get("name") == behavior_name), None)
    if beh is None or de is None:
        return []
    required = [k for k, spec in (beh.get("params") or {}).items() if isinstance(spec, dict) and spec.get("required")]
    target = de.get("target") or {}
    covered = set(target.get("params") or {})
    covered.update(de.get("input_mapping") or {})
    missing = [k for k in required if k not in covered]
    if missing:
        logger.warning(
            "参数契约漂移：行为 %s 的必填参数 %s 未被 data_engine 的 target.params 或 input_mapping 覆盖",
            behavior_name, missing,
        )
    return missing


def _ensure_mcp(de: dict) -> None:
    """唯一引擎类型=MCP（SQL/HTTP 已删除）。缺省视为 MCP；显式标其他类型 → 报错防静默走错路。"""
    et = de.get("engine_type")
    if et and et != "MCP":
        raise ValueError(f"引擎 {de.get('name') or de.get('behavior_name')} 是已删除的 {et} 型，请在映射页重新选择 MCP 服务与工具")


async def execute_engine(ontology_id: int, engine_name: str, params: dict) -> dict:
    """按引擎名调用（设计器连接测试路径，core /data-engines/{name}/call 转发至此）。"""
    try:
        data, sc_name, on_name = loaders.load_ontology_data_by_id(ontology_id)
    except KeyError as e:
        raise ValueError(str(e))
    de = _find_engine(data, engine_name=engine_name)
    if de is None:
        raise ValueError(f"数据引擎不存在: {engine_name}")
    _ensure_mcp(de)
    return await _call_engine_mcp(de, params)


async def execute_behavior(ontology_id: int, behavior_name: str, params: dict) -> dict:
    """按行为名调用（facade 执行路径）：查引擎绑定 → MCP 分发。"""
    try:
        data, sc_name, on_name = loaders.load_ontology_data_by_id(ontology_id)
    except KeyError as e:
        raise ValueError(str(e))
    beh = next((b for b in data.get("behaviors") or [] if isinstance(b, dict) and b.get("name") == behavior_name), None)
    if beh is None:
        raise ValueError(f"行为不存在: {behavior_name}")
    de = _find_engine(data, behavior_name=behavior_name)
    if de is None:
        raise ValueError("该行为未绑定数据引擎，请先配置数据引擎")
    _ensure_mcp(de)
    _check_param_contract(data, de, behavior_name)  # warn-only：暴露参数契约漂移
    return await _call_engine_mcp(de, params)
