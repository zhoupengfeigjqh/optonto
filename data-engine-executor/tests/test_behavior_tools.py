# -*- coding: utf-8 -*-
"""行为工具发布（behavior_tools）命名 + 调用契约（ontology_id 必填）测试。

运行：cd data-engine-mcp && python -m pytest tests -q

口径（2026-10-01）：
- 工具名 = 行为**裸名**，不带本体前缀（与本体函数一致；本体归属由调用参数 ontology_id 决定）；
- 跨本体重名在工具名维度无法共存 → 保留先出现者 + 记 ERROR（不静默互相覆盖路由到错误本体）；
- ontology_id 必填：MCP 路径硬报错，REST 入口返回 400（不按发布记录回退）。
"""
import asyncio
import logging
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "data-engine-mcp"))

import behavior_tools  # noqa: E402
import server  # noqa: E402


def _stub_data_store(monkeypatch, ontologies: list[tuple[int, str, list[str]]],
                     unmapped: tuple[str, ...] = ()) -> None:
    """把 data_store 换成本体清单桩：(ontology_id, ontology_name, [行为名…])。

    行为默认配好可用引擎（就绪 → 发布）；``unmapped`` 里的行为**不配引擎**，模拟"未完成映射"
    （契约 ⑥：未就绪不发布为工具）。
    """
    monkeypatch.setattr(behavior_tools.data_store, "ontology_market_fingerprint", lambda: (99, 1))
    monkeypatch.setattr(behavior_tools.data_store, "list_all_ontologies", lambda: [
        {"id": oid, "scenario_id": 1, "scenario_name": "SC", "ontology_name": on}
        for oid, on, _ in ontologies
    ])

    def _load(_sc: str, on: str) -> dict:
        for _oid, name, behaviors in ontologies:
            if name == on:
                return {
                    "behaviors": [
                        {"name": n, "display_name": n, "description": "", "op_type": "command", "params": {}}
                        for n in behaviors
                    ],
                    "data_engines": [
                        {"name": f"E_{n}", "behavior_name": n,
                         "target": {"server_url": "http://downstream/mcp", "tool_name": "t"}}
                        for n in behaviors if n not in unmapped
                    ],
                }
        raise KeyError(on)

    monkeypatch.setattr(behavior_tools.data_store, "load_ontology_data", _load)


# ─── 命名：工具名 = 行为裸名 ────────────────────────────────────────────────────

def test_工具名即行为裸名_不带本体前缀(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA", "QueryA"]), (2, "B", ["QueryB"])])
    tools = behavior_tools.load_behavior_tools(force=True)
    assert [t.name for t in tools] == ["CreateA", "QueryA", "QueryB"]


def test_跨本体重名_保留先出现者并记错误(monkeypatch, caplog):
    _stub_data_store(monkeypatch, [(1, "A", ["QuerySame"]), (2, "B", ["QuerySame"])])
    with caplog.at_level(logging.ERROR):
        tools = behavior_tools.load_behavior_tools(force=True)
    assert [t.name for t in tools] == ["QuerySame"]  # 只注册一次（先出现者）
    assert "跨本体重名" in caplog.text and "QuerySame" in caplog.text
    # 路由条目指向先出现的本体，不会静默漂移到后一个本体
    assert behavior_tools.behavior_entries()["QuerySame"]["ontology_name"] == "A"


def test_行为工具schema_分类标记与本体上下文与必填id(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["QueryA"])])
    schema = behavior_tools.load_behavior_tools(force=True)[0].inputSchema
    # 分类标记单一来源：顶层 x-category / x-display_name
    assert schema["x-category"] == "本体行为"
    assert schema["x-display_name"] == "QueryA"
    # scope 只含本体上下文（不含分类标记）
    ctx = schema["properties"]["scope"]["properties"]
    assert ctx["name"]["const"] == "QueryA"
    assert ctx["ontology_name"]["const"] == "A"
    assert "category" not in ctx and "display_name" not in ctx
    # ontology_id 必填
    assert schema["required"] == ["ontology_id"]


# ─── 契约：ontology_id 必填 ────────────────────────────────────────────────────

def test_MCP调用缺ontology_id直接报错(monkeypatch):
    monkeypatch.setattr(behavior_tools, "behavior_entries",
                        lambda: {"QueryA": {"name": "QueryA", "ontology_name": "A"}})
    with pytest.raises(ValueError, match="行为 QueryA 缺少 ontology_id"):
        asyncio.run(server.handle_call_tool("QueryA", {}))


def test_REST入口缺ontology_id一律400():
    client = TestClient(server.starlette_app)
    for path, body in (("/call-behavior", {"behavior_name": "QueryA", "params": {}}),
                       ("/call-engine", {"engine_name": "QueryA", "params": {}})):
        resp = client.post(path, json=body)
        assert resp.status_code == 400, (path, resp.status_code, resp.text)
        assert "缺少 ontology_id" in resp.json()["detail"]


# ─── 契约 ④：归属一致性（工具发布归属 == 调用方指定本体）──────────────────────────
# 场景：调用方把工具挂到了错误的本体上（父 Agent 规划错配 / 外部客户端乱传）。
# 行为侧跨本体重名可构造 → 不校验就会**静默执行另一个本体的同名行为**。

def _stub_executor(monkeypatch) -> list:
    """把 executor.execute_behavior 换成记录调用的桩；返回调用记录列表。"""
    calls: list = []

    async def _fake(oid, bname, params):
        calls.append((oid, bname))
        return {"status_code": 200, "data": {}}

    monkeypatch.setattr(server.executor, "execute_behavior", _fake)
    return calls


def test_MCP调用归属不一致被拒且不触达执行器(monkeypatch):
    # 两个本体重名行为 QuerySame：发布取先出现者（本体 A）；传本体 B 的 id → 拒
    _stub_data_store(monkeypatch, [(1, "A", ["QuerySame"]), (2, "B", ["QuerySame"])])
    behavior_tools.load_behavior_tools(force=True)
    calls = _stub_executor(monkeypatch)
    with pytest.raises(ValueError, match="归属校验失败"):
        asyncio.run(server.handle_call_tool("QuerySame", {"ontology_id": 2}))
    assert calls == [], "归属不一致时不得触达 executor（否则就是静默跨本体执行）"


def test_MCP调用归属一致时落到执行器(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"])])
    behavior_tools.load_behavior_tools(force=True)
    calls = _stub_executor(monkeypatch)
    out = asyncio.run(server.handle_call_tool("CreateA", {"ontology_id": 1}))
    assert calls == [(1, "CreateA")]
    assert out and out[0].type == "text"


def test_归属不一致报错文案含真实归属(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"]), (2, "B", ["QueryB"])])
    behavior_tools.load_behavior_tools(force=True)
    with pytest.raises(ValueError) as ei:
        asyncio.run(server.handle_call_tool("CreateA", {"ontology_id": 2}))
    msg = str(ei.value)
    assert "本体「A」" in msg and "ontology_id=1" in msg and "ontology_id=2" in msg


def test_REST入口归属不一致返回400(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"]), (2, "B", ["QueryB"])])
    behavior_tools.load_behavior_tools(force=True)
    client = TestClient(server.starlette_app)
    resp = client.post("/call-behavior",
                       json={"ontology_id": 2, "behavior_name": "CreateA", "params": {}})
    assert resp.status_code == 400, resp.text
    assert "归属校验失败" in resp.json()["detail"]


def test_行为条目必带归属本体id(monkeypatch):
    # 归属校验的数据源：条目里的 ontology_id（防未来重构删字段后校验静默失效）
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"])])
    behavior_tools.load_behavior_tools(force=True)
    assert behavior_tools.behavior_entries()["CreateA"]["ontology_id"] == 1


# ─── 入口口径统一：REST 与 MCP 同剥系统参数（2026-10-01 收口）─────────────────────

def test_REST行为入口剥离系统参数(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"])])
    behavior_tools.load_behavior_tools(force=True)
    seen: list = []

    async def _fake(oid, bname, params):
        seen.append((oid, bname, params))
        return {"status_code": 200, "data": {}}

    monkeypatch.setattr(server.executor, "execute_behavior", _fake)
    client = TestClient(server.starlette_app)
    resp = client.post("/call-behavior", json={
        "ontology_id": 1, "behavior_name": "CreateA",
        "params": {"scope": {"name": "CreateA"}, "ontology_id": 1, "biz": "x"}})
    assert resp.status_code == 200, resp.text
    assert seen == [(1, "CreateA", {"biz": "x"})], "系统参数必须被剥离（与 MCP 入口同口径）"


def test_引擎入口有意不剥系统参数(monkeypatch):
    """引擎 params 是用户自定义字段（SYSTEM_PARAMS 只属本体执行类）→ 不剥，防误删同名业务字段。"""
    seen: list = []

    async def _fake(oid, ename, params):
        seen.append((oid, ename, params))
        return {"status_code": 200, "data": {}}

    monkeypatch.setattr(server.executor, "execute_engine", _fake)
    client = TestClient(server.starlette_app)
    resp = client.post("/call-engine", json={
        "ontology_id": 1, "engine_name": "E", "params": {"ontology_id": "业务字段"}})
    assert resp.status_code == 200, resp.text
    assert seen == [(1, "E", {"ontology_id": "业务字段"})]


# ─── 契约 ⑥：就绪才发布（未完成映射的行为不进工具清单）────────────────────────────

def test_未就绪行为不发布并记本体级告警(monkeypatch, caplog):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA", "QueryA"])], unmapped=("QueryA",))
    with caplog.at_level(logging.WARNING):
        tools = behavior_tools.load_behavior_tools(force=True)
    assert [t.name for t in tools] == ["CreateA"]              # 未就绪者不在工具清单
    assert "QueryA" not in behavior_tools.behavior_entries()   # 也不可路由
    assert "未就绪" in caplog.text and "QueryA" in caplog.text  # 但必须留痕（设计器仍可见）


def test_未就绪行为被调用时报尚未就绪而非未知工具(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA", "QueryA"])], unmapped=("QueryA",))
    behavior_tools.load_behavior_tools(force=True)
    with pytest.raises(ValueError) as ei:
        asyncio.run(server.handle_call_tool("QueryA", {"ontology_id": 1}))
    msg = str(ei.value)
    # 报错指向病根：是"没配映射"，不是"工具名写错了"
    assert "尚未就绪" in msg and "未完成数据引擎映射" in msg and "本体「A」" in msg
    with pytest.raises(ValueError, match="未知工具"):
        asyncio.run(server.handle_call_tool("NeverExisted", {"ontology_id": 1}))


def test_引擎存在但target不全仍不发布(monkeypatch):
    """半成品映射（缺 target.tool_name）→ 同样未就绪（与 visibility-guard 收编同口径）。"""
    monkeypatch.setattr(behavior_tools.data_store, "ontology_market_fingerprint", lambda: (7, 1))
    monkeypatch.setattr(behavior_tools.data_store, "list_all_ontologies",
                        lambda: [{"id": 1, "scenario_id": 1, "scenario_name": "SC", "ontology_name": "A"}])
    monkeypatch.setattr(behavior_tools.data_store, "load_ontology_data", lambda _sc, _on: {
        "behaviors": [{"name": "HalfMapped", "display_name": "半成品", "params": {}}],
        "data_engines": [{"name": "E1", "behavior_name": "HalfMapped",
                          "target": {"server_url": "http://downstream/mcp"}}],
    })
    assert behavior_tools.load_behavior_tools(force=True) == []
    assert behavior_tools.unready_behavior("HalfMapped") is not None
