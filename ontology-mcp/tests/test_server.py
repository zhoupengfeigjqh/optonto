# -*- coding: utf-8 -*-
"""ontology-mcp 协议注册 + 工具发布契约测试。

运行：cd ontology-mcp && python -m pytest tests -q

背景（2026-10-01 实测发现的历史缺陷）：`@server.call_tool()` 曾被误挂在辅助函数
`_rule_behavior` 上，导致 `handle_call_tool` 从未注册——**本服务的全部工具
（listOnto* / 本体函数 / 公共函数）经 MCP 调用一律报**
`_rule_behavior() takes 1 positional argument but 2 were given`。

因此注册测试不走"函数对象同一性"断言（SDK 装饰器注册的是内层闭包），
而是**按协议层的方式真正调用一次处理器**。

同时锁定发布契约（单一权威：mcp-shared/tool_contract.py 模块 docstring）：
分类标记 x-category/x-display_name 齐备、本体上下文块 scope 只属于本体执行类、
listOnto* 必填 ontology_id / 全局花名册无该参数。
查询面就绪口径（契约 ⑥，2026-10-02）：listOntoBehaviors 只列**就绪**行为——与发布面
（未就绪不发布为工具）、规划闸（未就绪不可规划）三处同源。
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
sys.path.insert(0, str(_REPO_ROOT / "ontology-mcp"))

# 指向仓库 .data（data_store 默认 /app/.data 是容器内路径）——让发布契约断言基于真实本体数据
_DATA = _REPO_ROOT / ".data"
if _DATA.exists():
    os.environ.setdefault("DATA_DIR", str(_DATA))

import server  # noqa: E402

_CATEGORIES = {"本体查询", "本体函数", "公共函数"}


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
    # 误挂辅助函数时的特征：签名不匹配（协议层会以 (name, arguments) 双参调用）
    assert "positional argument" not in text


def test_list_tools_已注册():
    assert types.ListToolsRequest in server.server.request_handlers


def test_处理器签名为_名称_加_参数():
    assert list(inspect.signature(server.handle_call_tool).parameters) == ["name", "arguments"]


# ─── 发布契约 ─────────────────────────────────────────────────────────────────

def test_所有自有工具都带分类标记():
    for name, tool in _published_tools().items():
        assert tool.inputSchema.get("x-category") in _CATEGORIES, f"{name} 缺分类标记"
        assert tool.inputSchema.get("x-display_name"), f"{name} 缺中文名标记"


def test_查询工具契约_八件套与参数矩阵():
    tools = _published_tools()
    queries = {n: t for n, t in tools.items() if t.inputSchema.get("x-category") == "本体查询"}
    assert set(queries) == {"listScenarios", "listOntologies", "listOntoBehaviors", "listOntoConcepts",
                            "listOntoRelations", "listOntoFunctions", "listOntoSecurities",
                            "listOntoProcesses"}
    # 6 个 listOnto* 必填 ontology_id；2 个全局花名册无该参数
    for name in ("listOntoBehaviors", "listOntoConcepts", "listOntoRelations",
                 "listOntoFunctions", "listOntoSecurities", "listOntoProcesses"):
        schema = queries[name].inputSchema
        assert schema["required"] == ["ontology_id"], name
        assert "scope" not in schema["properties"], name
    for name in ("listScenarios", "listOntologies"):
        assert "ontology_id" not in queries[name].inputSchema["properties"], name


def test_本体函数契约_分类_上下文块_必填id():
    fns = {n: t for n, t in _published_tools().items() if t.inputSchema.get("x-category") == "本体函数"}
    if not fns:
        pytest.skip("当前 .data 无本体函数（DATA_DIR 不可见时不适用）")
    for name, tool in fns.items():
        schema = tool.inputSchema
        assert schema["required"][0] == "ontology_id", name
        ctx = schema["properties"]["scope"]["properties"]
        assert ctx["name"]["const"] == name
        assert set(ctx) == {"name", "ontology_id", "scenario_id", "scenario_name", "ontology_name"}


def test_公共函数契约_无系统参数():
    commons = {n: t for n, t in _published_tools().items() if t.inputSchema.get("x-category") == "公共函数"}
    if not commons:
        pytest.skip("当前 .data 无公共函数（DATA_DIR 不可见时不适用）")
    for name, tool in commons.items():
        props = tool.inputSchema.get("properties", {})
        assert "ontology_id" not in props and "scope" not in props, name


# ─── 调用契约：ontology_id 必填（不兜底）────────────────────────────────────────

def test_查询工具缺ontology_id经协议口报错():
    """协议层两道拦截：SDK 按 inputSchema.required 先拒（英文文案）；
    绕过 schema 校验时落到 require_ontology_id（中文文案，见下一条）。"""
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
    """有行为但一个都没映射 → 清单为空（不是"没行为"，是不可规划）。"""
    import json
    monkeypatch.setattr(server, "_ontology_of", lambda n, a: {"behaviors": [{"name": "B1"}]})
    out = asyncio.run(server.handle_call_tool("listOntoBehaviors", {"ontology_id": 2}))
    assert json.loads(out[0].text) == []


# ─── 归属一致性（契约 ④）：发布方声明的归属 == 调用方指定的本体 ────────────────────

def _fn_with_code() -> tuple[str, dict] | None:
    """取一个"有代码文件"的本体函数（真实 .data 驱动；无则返回 None）。"""
    for name, owner in sorted(server._function_owners().items()):
        path = server.data_store.ontology_function_code_path(
            owner["scenario_name"], owner["ontology_name"], name)
        if path.exists():
            return name, owner
    return None


def _other_oid(cur) -> int | None:
    ids = sorted({o.get("id") for o in server.data_store.list_all_ontologies()} - {cur})
    return ids[0] if ids else None


def test_归属表与对外scope_const一致():
    """发布期自锁：归属表（校验数据源）必须等于对外 schema 的 scope.const.ontology_id。"""
    tools = _published_tools()
    owners = server._function_owners()
    fns = {n: t for n, t in tools.items() if t.inputSchema.get("x-category") == "本体函数"}
    if not fns:
        pytest.skip("当前 .data 无本体函数（DATA_DIR 不可见时不适用）")
    for name, tool in fns.items():
        const = tool.inputSchema["properties"]["scope"]["properties"]["ontology_id"]["const"]
        assert owners[name]["ontology_id"] == const, name


def test_函数归属不一致被拒且不执行代码(monkeypatch):
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    other = _other_oid(owner["ontology_id"])
    if other is None:
        pytest.skip("需要至少两个本体才能构造跨本体用例")
    ran: list = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: ran.append(params) or {"success": True, "data": {}})
    with pytest.raises(ValueError, match="归属校验失败"):
        asyncio.run(server.handle_call_tool(name, {"ontology_id": other}))
    assert ran == [], "归属不一致时不得执行函数代码"


def test_函数归属一致时放行到执行(monkeypatch):
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    ran: list = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: ran.append(params) or {"success": True, "data": {}})
    out = asyncio.run(server.handle_call_tool(name, {"ontology_id": owner["ontology_id"]}))
    assert ran, "归属一致时应当落到函数执行"
    assert out and out[0].type == "text"


def test_REST入口函数归属不一致返回400():
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    other = _other_oid(owner["ontology_id"])
    if other is None:
        pytest.skip("需要至少两个本体才能构造跨本体用例")
    from starlette.testclient import TestClient
    client = TestClient(server.starlette_app)
    resp = client.post("/execute-function",
                       json={"ontology_id": other, "function_name": name, "params": {}})
    assert resp.status_code == 400, resp.text
    assert "归属校验失败" in resp.json()["detail"]


# ─── 入口口径统一：REST 与 MCP 同剥系统参数（2026-10-01 收口）─────────────────────

def test_REST函数入口剥离系统参数(monkeypatch):
    """REST /execute-function 与 MCP 入口同口径：scope/ontology_id 不进函数 params。"""
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    seen: list = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: seen.append(params) or {"success": True, "data": {}})
    from starlette.testclient import TestClient
    client = TestClient(server.starlette_app)
    resp = client.post("/execute-function", json={
        "ontology_id": owner["ontology_id"], "function_name": name,
        "params": {"scope": {"name": name}, "ontology_id": owner["ontology_id"], "biz": 1}})
    assert resp.status_code == 200, resp.text
    assert seen and seen[0] == {"biz": 1}, "系统参数必须被剥离，业务参数保留"


# ─── 查询工具「查不到」形态统一（三种空表达收敛为 _not_found）────────────────────

def test_未加过滤的空集合原样返回_过滤无匹配走统一形态():
    # 集合本身为空 / 未加过滤 → 原样列表；加了过滤但无匹配 → _not_found（带可读原因）
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
