# -*- coding: utf-8 -*-
"""公共函数 MCP 服务契约测试（发布 + 执行一体）。

锁死三件事：
1. **发布面**：manifest 里的公共函数全部发布，schema **透传**（不编译），
   分类标记为「公共函数」，且**不带 scope / ontology_id**（平台级 ≠ 本体级）；
2. **执行面**：MCP 工具调用与内网 /execute-common-function **共用同一执行实现**，
   失败置 isError，不静默返回失败数据；
3. **热加载**：manifest mtime 变化后无需重启即可发布新清单。

运行：cd common-function-mcp && python -m pytest tests -q
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "common-function-mcp"))

_DATA = _REPO_ROOT / ".data"
if _DATA.exists():
    os.environ.setdefault("DATA_DIR", str(_DATA))

import server  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


def _tools() -> dict:
    return {t.name: t for t in asyncio.run(server._list_tools())}


def _entries() -> list:
    return [e for e in server.data_store.load_common_function_entries() if e.get("name")]


# ─── 发布面 ────────────────────────────────────────────────────────────────────

def test_发布面覆盖manifest全部公共函数():
    expected = {e["name"] for e in _entries()}
    if not expected:
        pytest.skip(".data 中无公共函数（DATA_DIR 不可见时不适用）")
    assert set(_tools()) == expected


def test_工具schema透传manifest且带分类标记():
    tools = _tools()
    for entry in _entries():
        tool = tools[entry["name"]]
        manifest_schema = entry.get("inputSchema") or {"type": "object", "properties": {}}
        # 透传：properties / required 与 manifest 完全一致（本体函数那边是"编译"出来的，不可比）
        assert tool.inputSchema["properties"] == manifest_schema.get("properties", {}), entry["name"]
        assert tool.inputSchema.get("required", []) == manifest_schema.get("required", []), entry["name"]
        # 分类标记：公共函数（消费端据此识别为非本体执行类）
        assert tool.inputSchema["x-category"] == "公共函数", entry["name"]


def test_中文名同时投影到协议title():
    """协议级显示名（Tool.title）只服务外部 MCP 客户端；平台自身仍读 inputSchema["x-title"]。"""
    entries = {e["name"]: e for e in _entries()}
    if not entries:
        pytest.skip(".data 中无公共函数（DATA_DIR 不可见时不适用）")
    for name, tool in _tools().items():
        assert tool.title == tool.inputSchema["x-title"] == entries[name].get("title"), name


def test_工具schema不带scope与ontology_id():
    """公共函数是平台级的：**没有本体归属**，故不得出现本体执行类专属的上下文块与路由参数。"""
    for name, tool in _tools().items():
        props = tool.inputSchema.get("properties", {})
        assert "scope" not in props, f"{name} 不应带 scope（那是本体执行类专属）"
        assert "ontology_id" not in props, f"{name} 不应带 ontology_id（公共函数无本体归属）"


def test_description含统一信封说明():
    for name, tool in _tools().items():
        assert "success" in tool.description and "data" in tool.description, name


# ─── 执行面 ────────────────────────────────────────────────────────────────────

def test_mcp工具调用本地执行(monkeypatch):
    name = _entries()[0]["name"] if _entries() else None
    if not name:
        pytest.skip(".data 中无公共函数")
    seen = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: seen.append(params) or {"success": True, "data": {"ok": 1}, "error": None})
    out = asyncio.run(server.handle_call_tool(name, {"x": 1}))
    assert seen == [{"x": 1}]
    assert json.loads(out[0].text)["data"] == {"ok": 1}


def test_系统参数被剥离(monkeypatch):
    name = _entries()[0]["name"] if _entries() else None
    if not name:
        pytest.skip(".data 中无公共函数")
    seen = []
    monkeypatch.setattr(server, "run_function_code",
                        lambda code, params: seen.append(params) or {"success": True, "data": {}})
    asyncio.run(server.handle_call_tool(name, {"ontology_id": 1, "biz": 2}))
    assert seen == [{"biz": 2}]


def test_未知函数报错():
    with pytest.raises(ValueError, match="未知公共函数"):
        server._run_common_function("__不存在的公共函数__", {})


def test_mcp调用失败置isError语义(monkeypatch):
    name = _entries()[0]["name"] if _entries() else None
    if not name:
        pytest.skip(".data 中无公共函数")
    monkeypatch.setattr(server, "run_function_code", lambda code, params: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError, match="执行失败"):
        asyncio.run(server.handle_call_tool(name, {}))


# ─── 内网执行端点（core 设计器测试按钮走这里）──────────────────────────────────

def test_execute端点与MCP面共用实现(monkeypatch):
    name = _entries()[0]["name"] if _entries() else None
    if not name:
        pytest.skip(".data 中无公共函数")
    calls = []
    monkeypatch.setattr(server, "_run_common_function",
                        lambda n, args: calls.append((n, args)) or {"success": True, "data": {}})
    client = TestClient(server.starlette_app)
    resp = client.post("/execute-common-function", json={"function_name": name, "params": {"a": 1}})
    assert resp.status_code == 200, resp.text
    assert calls == [(name, {"a": 1})], "REST 与 MCP 必须共用同一执行实现（防双路径）"


def test_execute端点未知函数返回400():
    resp = TestClient(server.starlette_app).post(
        "/execute-common-function", json={"function_name": "__不存在__", "params": {}})
    assert resp.status_code == 400


def test_运维端点可用():
    client = TestClient(server.starlette_app)
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/tools").status_code == 200
    listing = client.get("/functions").json()
    assert listing["server"] == "optonto-common-function-mcp"


# ─── 热加载 ────────────────────────────────────────────────────────────────────

def test_manifest变更后清单自动刷新(monkeypatch):
    if not _entries():
        pytest.skip(".data 中无公共函数")
    server._load_common_tools()  # 先建立缓存
    fake = [{"name": "brandNew", "title": "新函数", "description": "d", "inputSchema": {"type": "object", "properties": {}}}]
    monkeypatch.setattr(server.data_store, "common_manifest_mtime", lambda: -999)
    monkeypatch.setattr(server.data_store, "load_common_function_entries", lambda: fake)
    assert "brandNew" in _tools()