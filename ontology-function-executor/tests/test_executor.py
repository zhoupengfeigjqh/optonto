# -*- coding: utf-8 -*-
"""本体函数执行服务契约测试（零工具 + 执行语义 + 归属一致性）。

运行：cd ontology-function-executor && python -m pytest tests -q
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "ontology-function-executor"))

_DATA = _REPO_ROOT / ".data"
if _DATA.exists():
    os.environ.setdefault("DATA_DIR", str(_DATA))

import server  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="module")
def client():
    return TestClient(server.starlette_app)


# ─── 零工具（对外不提供 MCP 工具是结构性保证）────────────────────────────────

def test_协议端点不存在():
    """执行底座不对外提供工具：误连 /mcp、/sse 直接 404（不是"连上了但没工具"）。"""
    paths = {r.path for r in server.starlette_app.routes}
    assert "/mcp" not in paths
    assert "/sse" not in paths and "/messages" not in paths


def test_tools清单恒为空(client):
    resp = client.get("/tools")
    assert resp.status_code == 200
    assert resp.json() == []


def test_健康与函数清单可用(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/functions").json()["server"] == "optonto-ontology-function-executor"


def test_mcp端点返回404(client):
    assert client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).status_code == 404


# ─── 执行语义 ─────────────────────────────────────────────────────────────────

def _fn_with_code():
    for name, owner in sorted(server._function_owners().items()):
        path = server.data_store.ontology_function_code_path(
            owner["scenario_name"], owner["ontology_name"], name)
        if path.exists():
            return name, owner
    return None


def test_函数执行成功返回统一信封(monkeypatch):
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    seen = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: seen.append(params) or {"success": True, "data": {"ok": 1}, "error": None})
    resp = TestClient(server.starlette_app).post("/execute-function", json={
        "ontology_id": owner["ontology_id"], "function_name": name, "params": {"x": 1}})
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == {"ok": 1}
    assert seen == [{"x": 1}]


def test_系统参数被剥离(monkeypatch):
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    seen = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: seen.append(params) or {"success": True, "data": {}})
    TestClient(server.starlette_app).post("/execute-function", json={
        "ontology_id": owner["ontology_id"], "function_name": name,
        "params": {"scope": {"name": name}, "ontology_id": owner["ontology_id"], "biz": 1}})
    assert seen and seen[0] == {"biz": 1}, "scope/ontology_id 必须剥离，业务参数保留"


def test_归属不一致被拒且不执行(monkeypatch):
    picked = _fn_with_code()
    if not picked:
        pytest.skip("当前 .data 无带代码文件的本体函数")
    name, owner = picked
    others = sorted({o.get("id") for o in server.data_store.list_all_ontologies()} - {owner["ontology_id"]})
    if not others:
        pytest.skip("需要至少两个本体才能构造跨本体用例")
    ran = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: ran.append(params) or {"success": True, "data": {}})
    resp = TestClient(server.starlette_app).post("/execute-function", json={
        "ontology_id": others[0], "function_name": name, "params": {}})
    assert resp.status_code == 400, resp.text
    assert "归属校验失败" in resp.json()["detail"]
    assert ran == [], "归属不一致时不得执行函数代码"


def test_函数不存在返回404():
    resp = TestClient(server.starlette_app).post("/execute-function", json={
        "ontology_id": 1, "function_name": "__不存在的函数__", "params": {}})
    assert resp.status_code in (400, 404)


def test_缺ontology_id被拒():
    resp = TestClient(server.starlette_app).post("/execute-function", json={
        "function_name": "whatever", "params": {}})
    assert resp.status_code == 400
    assert "ontology_id" in resp.json()["detail"]


def test_公共函数端点已迁走():
    """2026-10-04：公共函数执行迁至 common-function-mcp（发布 + 执行一体）。

    本服务只执行**本体函数**；若此端点仍在，就是两份执行实现（双路径，宪法禁止）。
    """
    paths = {r.path for r in server.starlette_app.routes}
    assert "/execute-common-function" not in paths
    assert "/execute-function" in paths


# ─── 归属索引 ─────────────────────────────────────────────────────────────────

def test_归属索引与本体函数一致():
    owners = server._function_owners()
    if not owners:
        pytest.skip("当前 .data 无本体函数（DATA_DIR 不可见时不适用）")
    for onto in server.data_store.list_all_ontologies():
        oid, sc, on = onto.get("id"), onto.get("scenario_name"), onto.get("ontology_name")
        if oid is None or not sc or not on:
            continue
        data = server.data_store.load_ontology_data(sc, on)
        for fn in data.get("functions") or []:
            name = (fn or {}).get("name")
            if name in owners:
                assert owners[name]["ontology_id"] == oid, name
                assert owners[name]["ontology_name"] == on, name