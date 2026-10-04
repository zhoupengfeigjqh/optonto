# -*- coding: utf-8 -*-
"""本体查询 MCP 服务契约测试（纯查询：只发布 list* 八件套，不含任何执行职责）。

运行：cd ontology-query-mcp && python -m pytest tests -q

背景（2026-10-04 拆分）：本服务从"本体语义面 + 函数执行"收缩为**纯查询**——
函数执行迁至 ontology-function-executor（零工具、仅内网），行为执行在 data-engine-executor。
因此这里锁定三件事：
1. 发布面恰好是查询八件套（多一项、少一项都是契约漂移）；
2. 协议注册正确（历史缺陷：@server.call_tool() 曾误挂辅助函数，导致全部工具不可调用）；
3. 不再挂载任何执行端点（执行职责已迁走，留着就是双实现）。
"""
import asyncio
import inspect
import os
import sys
from pathlib import Path

import pytest
from mcp import types

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "ontology-query-mcp"))

_DATA = _REPO_ROOT / ".data"
if _DATA.exists():
    os.environ.setdefault("DATA_DIR", str(_DATA))

import server  # noqa: E402

_QUERY_TOOL_NAMES = {"listScenarios", "listOntologies", "listOntoBehaviors", "listOntoConcepts",
                     "listOntoRelations", "listOntoFunctions", "listOntoSecurities",
                     "listOntoProcesses"}


def _published_tools() -> dict:
    return {t.name: t for t in asyncio.run(server._list_tools())}


def _call_registered_handler(tool_name: str, arguments: dict) -> str:
    """按协议层方式调用已注册的 call_tool 处理器，返回结果文本。"""
    handler = server.server.request_handlers[types.CallToolRequest]
    req = types.CallToolRequest(method="tools/call",
                                params={"name": tool_name, "arguments": arguments})
    return asyncio.run(handler(req)).model_dump_json()


# ─── 协议注册（防"装饰器挂错函数"这类静默失效）──────────────────────────────────

def test_call_tool_处理器注册正确且可按双参调用():
    text = _call_registered_handler("__不存在的工具__", {})
    assert "未知工具" in text
    assert "positional argument" not in text


def test_list_tools_已注册():
    assert types.ListToolsRequest in server.server.request_handlers


def test_处理器签名为_名称_加_参数():
    assert list(inspect.signature(server.handle_call_tool).parameters) == ["name", "arguments"]


# ─── 发布面契约：恰好是查询八件套 ───────────────────────────────────────────────

def test_发布面恰好是查询八件套():
    assert set(_published_tools()) == _QUERY_TOOL_NAMES


def test_所有工具都带分类标记与中文名():
    for name, tool in _published_tools().items():
        assert tool.inputSchema.get("x-category") == "本体查询", f"{name} 分类标记应为本体查询"
        assert tool.inputSchema.get("x-display_name"), f"{name} 缺中文名标记"


def test_查询工具参数矩阵():
    queries = _published_tools()
    for name in ("listOntoBehaviors", "listOntoConcepts", "listOntoRelations",
                 "listOntoFunctions", "listOntoSecurities", "listOntoProcesses"):
        schema = queries[name].inputSchema
        assert schema["required"] == ["ontology_id"], name
        assert "scope" not in schema["properties"], name
    for name in ("listScenarios", "listOntologies"):
        assert "ontology_id" not in queries[name].inputSchema["properties"], name


def test_不挂载执行端点():
    """执行职责已迁至 ontology-function-executor；此处留着就是双实现（宪法：单一来源）。"""
    paths = {r.path for r in server.starlette_app.routes}
    assert "/execute-function" not in paths
    assert "/execute-common-function" not in paths


# ─── 调用契约 ─────────────────────────────────────────────────────────────────

def test_查询工具缺ontology_id经协议口报错():
    text = _call_registered_handler("listOntoBehaviors", {})
    assert "is a required property" in text


def test_查询分支校验入口直接报错():
    with pytest.raises(ValueError, match="缺少 ontology_id"):
        server._ontology_of("listOntoBehaviors", {})


def test_行为清单只列就绪行为(monkeypatch):
    """契约 ⑥ 的查询面同口径：未就绪（未完成映射）的行为不出现在 listOntoBehaviors。"""
    import json
    data = {
        "behaviors": [{"name": "Ready1"}, {"name": "NotReady2"}],
        "data_engines": [{"behavior_name": "Ready1",
                          "target": {"server_url": "http://downstream/mcp", "tool_name": "t"}}],
        "rules": [],
    }
    monkeypatch.setattr(server, "_ontology_of", lambda n, a: data)
    out = asyncio.run(server.handle_call_tool("listOntoBehaviors", {"ontology_id": 1}))
    assert [b["name"] for b in json.loads(out[0].text)] == ["Ready1"]


def test_行为清单_全未就绪时为空(monkeypatch):
    import json
    monkeypatch.setattr(server, "_ontology_of", lambda n, a: {"behaviors": [{"name": "B1"}]})
    out = asyncio.run(server.handle_call_tool("listOntoBehaviors", {"ontology_id": 2}))
    assert json.loads(out[0].text) == []


# ─── 「查不到」形态统一 ────────────────────────────────────────────────────────

def test_未加过滤的空集合原样返回_过滤无匹配走统一形态():
    assert server._filter_list([], None, ["name"]) == []
    assert server._filter_list([{"name": "A"}], None, ["name"]) == [{"name": "A"}]
    miss = server._filter_list([{"name": "A"}], "zzz", ["name"])
    assert set(miss) == {"message", "results"} and miss["results"] == []
    assert miss == server._not_found("未找到包含关键词 'zzz' 的结果")


def test_关系查询_概念不存在与无关联同形态(monkeypatch):
    import json
    data = {"concepts": [{"name": "C1"}, {"name": "C2"}],
            "relations": [{"name": "R1", "source": "C1", "target": "C1"}]}
    monkeypatch.setattr(server, "_ontology_of", lambda n, a: data)

    def call(args) -> object:
        out = asyncio.run(server.handle_call_tool("listOntoRelations", args))
        return json.loads(out[0].text)

    assert call({"ontology_id": 1, "concept_name": "C1"}) == [{"name": "R1", "source": "C1", "target": "C1"}]
    assert call({"ontology_id": 1, "concept_name": "NOPE"}) == server._not_found("概念 'NOPE' 不存在")
    assert call({"ontology_id": 1, "concept_name": "C2"}) == server._not_found("概念 'C2' 没有关联关系")