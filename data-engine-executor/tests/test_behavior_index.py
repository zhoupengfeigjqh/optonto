# -*- coding: utf-8 -*-
"""行为索引（behavior_index）契约测试：就绪过滤 + 跨本体重名 + 归属条目。

运行：cd data-engine-executor && python -m pytest tests -q

2026-10-19 方案 B 后本模块**不再发布工具**（工具面归自建发布），故测试只锁两件事：
- 已就绪行为才有路由条目（未就绪只留痕，供调用期区分"没配映射"与"名字写错"）；
- 条目必带归属本体 id/中文名（REST 入口归属一致性校验的数据源）。

工具 schema 编译（x-category / scope / required）的唯一实现已归 core 自建发布面，
不在本服务测试范围内。
"""
import logging
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "data-engine-executor"))

import behavior_index  # noqa: E402
import server  # noqa: E402


def _stub_data_store(monkeypatch, ontologies: list[tuple[int, str, list[str]]],
                     unmapped: tuple[str, ...] = ()) -> None:
    """把 data_store 换成本体清单桩：(ontology_id, ontology_name, [行为名…])。

    行为默认配好可用引擎（就绪 → 进索引）；``unmapped`` 里的行为**不配引擎**，模拟"未完成映射"
    （契约 ⑥：未就绪不进路由索引）。
    """
    monkeypatch.setattr(behavior_index.data_store, "ontology_market_fingerprint", lambda: (99, 1))
    monkeypatch.setattr(behavior_index.data_store, "list_all_ontologies", lambda: [
        {"id": oid, "scenario_id": 1, "scenario_name": "SC", "ontology_name": on}
        for oid, on, _ in ontologies
    ])

    def _load(_sc: str, on: str) -> dict:
        for _oid, name, behaviors in ontologies:
            if name == on:
                return {
                    "behaviors": [
                        {"name": n, "title": n, "description": "", "op_type": "command", "params": {}}
                        for n in behaviors
                    ],
                    "data_engines": [
                        {"name": f"E_{n}", "behavior_name": n,
                         "target": {"server_url": "http://downstream/mcp", "tool_name": "t"}}
                        for n in behaviors if n not in unmapped
                    ],
                }
        raise KeyError(on)

    monkeypatch.setattr(behavior_index.data_store, "load_ontology_data", _load)


# ─── 索引内容：只收已就绪行为 ──────────────────────────────────────────────────

def test_已就绪行为按本体聚合(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA", "QueryA"]), (2, "B", ["QueryB"])])
    entries = behavior_index.load_behavior_index(force=True)
    assert list(entries) == ["CreateA", "QueryA", "QueryB"]


def test_未就绪行为不入索引但留痕(monkeypatch, caplog):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA", "QueryA"])], unmapped=("QueryA",))
    with caplog.at_level(logging.WARNING):
        entries = behavior_index.load_behavior_index(force=True)
    assert list(entries) == ["CreateA"]
    assert entries["CreateA"]["name"] == "CreateA"
    assert behavior_index.unready_behavior("QueryA") is not None
    assert "未就绪" in caplog.text and "QueryA" in caplog.text


def test_跨本体重名_保留先出现者并记错误(monkeypatch, caplog):
    _stub_data_store(monkeypatch, [(1, "A", ["QuerySame"]), (2, "B", ["QuerySame"])])
    with caplog.at_level(logging.ERROR):
        behavior_index.load_behavior_index(force=True)
    assert "跨本体重名" in caplog.text and "QuerySame" in caplog.text
    # 条目指向先出现的本体，不会静默漂移到后一个本体
    assert behavior_index.behavior_entries()["QuerySame"]["ontology_name"] == "A"


def test_引擎存在但target不全仍不就绪(monkeypatch):
    """半成品映射（缺 target.tool_name）→ 同样未就绪（与 visibility-guard 收编同口径）。"""
    monkeypatch.setattr(behavior_index.data_store, "ontology_market_fingerprint", lambda: (7, 1))
    monkeypatch.setattr(behavior_index.data_store, "list_all_ontologies",
                        lambda: [{"id": 1, "scenario_id": 1, "scenario_name": "SC", "ontology_name": "A"}])
    monkeypatch.setattr(behavior_index.data_store, "load_ontology_data", lambda _sc, _on: {
        "behaviors": [{"name": "HalfMapped", "title": "半成品", "params": {}}],
        "data_engines": [{"name": "E1", "behavior_name": "HalfMapped",
                          "target": {"server_url": "http://downstream/mcp"}}],
    })
    assert behavior_index.load_behavior_index(force=True) == {}
    assert behavior_index.unready_behavior("HalfMapped") is not None


# ─── 条目形态：归属校验的数据源 ────────────────────────────────────────────────

def test_行为条目必带归属本体id与中文名(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"])])
    behavior_index.load_behavior_index(force=True)
    entry = behavior_index.behavior_entries()["CreateA"]
    assert entry["ontology_id"] == 1
    assert entry["ontology_name"] == "A"
    assert entry["scenario_name"] == "SC"
    assert entry["name"] == "CreateA"


# ─── REST 入口的归属一致性（索引是唯一数据源）──────────────────────────────────

def _stub_executor(monkeypatch) -> list:
    calls: list = []

    async def _fake(oid, bname, params):
        calls.append((oid, bname))
        return {"status_code": 200, "data": {}}

    monkeypatch.setattr(server.executor, "execute_behavior", _fake)
    return calls


def test_REST入口归属不一致返回400(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"]), (2, "B", ["QueryB"])])
    behavior_index.load_behavior_index(force=True)
    client = TestClient(server.starlette_app)
    resp = client.post("/call-behavior",
                       json={"ontology_id": 2, "behavior_name": "CreateA", "params": {}})
    assert resp.status_code == 400, resp.text
    assert "归属校验失败" in resp.json()["detail"]


def test_归属不一致报错文案含真实归属(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"]), (2, "B", ["QueryB"])])
    behavior_index.load_behavior_index(force=True)
    client = TestClient(server.starlette_app)
    resp = client.post("/call-behavior",
                       json={"ontology_id": 2, "behavior_name": "CreateA", "params": {}})
    msg = resp.json()["detail"]
    assert "本体「A」" in msg and "ontology_id=1" in msg and "ontology_id=2" in msg


def test_REST入口归属一致时落到执行器(monkeypatch):
    _stub_data_store(monkeypatch, [(1, "A", ["CreateA"])])
    behavior_index.load_behavior_index(force=True)
    calls = _stub_executor(monkeypatch)
    client = TestClient(server.starlette_app)
    resp = client.post("/call-behavior", json={"ontology_id": 1, "behavior_name": "CreateA", "params": {}})
    assert resp.status_code == 200, resp.text
    assert calls == [(1, "CreateA")]
