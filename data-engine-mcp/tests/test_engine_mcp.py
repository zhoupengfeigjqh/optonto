# -*- coding: utf-8 -*-
"""MCP 分发器单测（_call_engine_mcp）——引擎唯一形态=MCP，engine_type 已删出 schema。

mcp 客户端连接（_mcp_call_tool）整体打桩——单测只锁定分发器的本责：
target 校验、输入映射翻译（换名，未映射字段透传）、输出映射翻译（白名单）、错误穿透、
target.headers 鉴权头透传、已删除类型（SQL/HTTP）显式标注的报错兜底。
"""
import asyncio
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "data-engine-mcp"))

import executor


def _de(**over):
    de = {
        "name": "查询原材料",
        "behavior_name": "queryRawMaterial",
        "target": {"server_url": "http://optonto-business-mcp:8004/mcp", "tool_name": "query_raw_materials"},
        "input_mapping": {"原材料名称": "rawMaterialName"},
        "output_mapping": {"材料编号": "rawMaterialId", "单位": "unit"},
    }
    de.update(over)
    return de


def test_missing_target_raises_value_error():
    with pytest.raises(ValueError, match="server_url"):
        asyncio.run(executor._call_engine_mcp(_de(target={}), {}))
    with pytest.raises(ValueError, match="server_url"):
        asyncio.run(executor._call_engine_mcp(_de(target={"server_url": "http://x/mcp"}), {}))


def test_dispatch_translates_input_and_output(monkeypatch):
    captured = {}

    async def fake_call(server_url, tool_name, arguments, headers=None):
        captured.update(server_url=server_url, tool_name=tool_name, arguments=arguments, headers=headers)
        return {"status_code": 200, "data": {"rawMaterialId": "RM-001", "unit": "吨", "extra": "丢"}}

    monkeypatch.setattr(executor, "_mcp_call_tool", fake_call)
    result = asyncio.run(executor._call_engine_mcp(
        _de(), {"原材料名称": "高强度钢板", "未映射字段": "不进下游"}))

    assert captured["server_url"] == "http://optonto-business-mcp:8004/mcp"
    assert captured["tool_name"] == "query_raw_materials"
    # 输入映射：换名，未映射字段原样透传（与 HTTP 型同口径——_translate_input 非白名单）
    assert captured["arguments"] == {"rawMaterialName": "高强度钢板", "未映射字段": "不进下游"}
    # 输出映射：换名 + 白名单（extra 未映射被丢弃）
    assert result["status_code"] == 200
    assert result["data"] == {"材料编号": "RM-001", "单位": "吨"}


def test_downstream_error_passthrough(monkeypatch):
    async def fake_call(server_url, tool_name, arguments, headers=None):
        raise RuntimeError("下游 MCP 工具 query_raw_materials 报错: boom")

    monkeypatch.setattr(executor, "_mcp_call_tool", fake_call)
    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(executor._call_engine_mcp(_de(), {"原材料名称": "x"}))


def test_execute_behavior_routes_mcp_engine(monkeypatch):
    """行为入口走 MCP 分发（缺省即 MCP，无需 engine_type）。"""
    data = {
        "behaviors": [{"name": "queryRawMaterial", "params": {}}],
        "data_engines": [_de()],
    }
    monkeypatch.setattr(executor.loaders, "load_ontology_data_by_id",
                        lambda oid: (data, "生产调度", "原材料采购和库存"))

    async def fake_call(server_url, tool_name, arguments, headers=None):
        return {"status_code": 200, "data": {}}

    monkeypatch.setattr(executor, "_mcp_call_tool", fake_call)
    result = asyncio.run(executor.execute_behavior(1, "queryRawMaterial", {}))
    assert result["status_code"] == 200


def test_target_headers_forwarded(monkeypatch):
    """target.headers 配置的鉴权头透传给下游 MCP 连接；未配置时传 None。"""
    captured = {}

    async def fake_call(server_url, tool_name, arguments, headers=None):
        captured["headers"] = headers
        return {"status_code": 200, "data": {}}

    monkeypatch.setattr(executor, "_mcp_call_tool", fake_call)
    de = _de(target={"server_url": "http://x/mcp", "tool_name": "t",
                     "headers": {"Authorization": "Bearer tok-1"}})
    asyncio.run(executor._call_engine_mcp(de, {}))
    assert captured["headers"] == {"Authorization": "Bearer tok-1"}

    asyncio.run(executor._call_engine_mcp(_de(), {}))
    assert captured["headers"] is None


def test_deleted_engine_type_raises(monkeypatch):
    """显式标已删除类型（SQL/HTTP）的旧配置 → ValueError 兜底（executor._ensure_mcp）。"""
    data = {
        "behaviors": [{"name": "queryRawMaterial", "params": {}}],
        "data_engines": [_de(engine_type="SQL")],
    }
    monkeypatch.setattr(executor.loaders, "load_ontology_data_by_id",
                        lambda oid: (data, "生产调度", "原材料采购和库存"))
    with pytest.raises(ValueError, match="已删除的 SQL 型"):
        asyncio.run(executor.execute_behavior(1, "queryRawMaterial", {}))
