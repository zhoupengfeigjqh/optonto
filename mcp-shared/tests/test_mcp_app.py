# -*- coding: utf-8 -*-
"""mcp_app 协议层测试：双传输（streamable / sse / both）+ 令牌鉴权。

新增能力（2026-10-04，自建发布引入）的回归护栏：
- 平台四个带协议端点的固定服务仍走 streamable 单端点（不因支持 sse 而改动既有行为），
  本体函数执行服务走 none（零工具，误连 404）；
- 自建发布可选 sse；both 时两个端点并存；
- 令牌校验覆盖 /mcp、/sse、/messages、/tools，且放行 /health 与 /.well-known/*
  （探活与客户端鉴权发现必须在无令牌时可达，否则客户端连握手都进不去）。
"""

import pytest
from mcp.server import Server
from mcp.types import Tool
from starlette.testclient import TestClient

from mcp_app import (
    TRANSPORT_BOTH, TRANSPORT_NONE, TRANSPORT_SSE, TRANSPORT_STREAMABLE, build_mcp_app,
)

_SERVER = Server("test-mcp")
_TOOLS = [Tool(name="ping", description="探活工具", inputSchema={"type": "object", "properties": {}})]


async def _list_tools():
    return list(_TOOLS)


def _client(transport=TRANSPORT_STREAMABLE, token=None):
    app = build_mcp_app(_SERVER, _list_tools, "test-mcp", transport=transport, auth_token=token)
    return TestClient(app)


# ─── 传输模式 ─────────────────────────────────────────────────────────────────

def test_默认挂载streamable单端点():
    paths = {r.path for r in _client().app.routes}
    assert "/mcp" in paths
    assert "/sse" not in paths and "/messages" not in paths


def test_sse模式挂载双通道且无mcp():
    paths = {r.path for r in _client(TRANSPORT_SSE).app.routes}
    assert {"/sse", "/messages"}.issubset(paths)
    assert "/mcp" not in paths


def test_sse收信路由必须排在建流路由之前():
    """SDK 广告的收信路径是 ``root_path + endpoint`` = ``/sse/messages/``（sse.py:171-180）。

    Starlette 按顺序匹配：若 ``Mount("/sse")`` 排在前面，它会吞掉 ``/sse/messages/*``
    （表现为握手能拿到 endpoint、但消息发进去永远没有回音）。故更具体的收信路由必须在前。
    """
    paths = [r.path for r in _client(TRANSPORT_SSE).app.routes]
    assert "/sse/messages" in paths
    assert paths.index("/sse/messages") < paths.index("/sse")


def test_both模式并存():
    paths = {r.path for r in _client(TRANSPORT_BOTH).app.routes}
    assert {"/mcp", "/sse", "/messages"}.issubset(paths)


def test_未知传输模式直接拒绝():
    with pytest.raises(ValueError, match="未知传输模式"):
        build_mcp_app(_SERVER, _list_tools, "test-mcp", transport="carrier-pigeon")


def test_none模式不挂任何协议端点():
    """执行底座（本体函数/数据引擎）专用：对外零暴露、零工具，靠结构保证而非约定。"""
    paths = {r.path for r in _client(TRANSPORT_NONE).app.routes}
    assert "/mcp" not in paths
    assert "/sse" not in paths and "/messages" not in paths
    # 运维端点仍在（探活与工具清单自检）
    assert "/health" in paths and "/tools" in paths


def test_none模式探活可用且工具清单自检仍可读():
    client = _client(TRANSPORT_NONE)
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/tools").status_code == 200
    # 误连协议端点 → 404（而不是"连上了但没工具"）
    assert client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).status_code == 404


def test_health与tools端点在各模式下都在():
    for transport in (TRANSPORT_STREAMABLE, TRANSPORT_SSE, TRANSPORT_BOTH):
        client = _client(transport)
        assert client.get("/health").json()["status"] == "ok"
        assert [t["name"] for t in client.get("/tools").json()] == ["ping"]


# ─── 令牌鉴权 ─────────────────────────────────────────────────────────────────

def test_无令牌时工具面直接放行():
    assert _client().get("/tools").status_code == 200


def test_配令牌后工具面拒绝缺失与错误令牌():
    client = _client(token="secret-1")
    assert client.get("/tools").status_code == 401
    assert client.get("/tools", headers={"X-MCP-Token": "wrong"}).status_code == 401
    assert client.get("/tools", headers={"X-MCP-Token": "secret-1"}).status_code == 200


def test_配置令牌时mcp端点同样受保护():
    client = _client(token="secret-1")
    # 未带令牌的 MCP 初始化请求应被 401 拦下（而不是进入协议层）
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert resp.status_code == 401


def test_也接受Bearer形式的令牌():
    client = _client(token="secret-1")
    assert client.get("/tools", headers={"Authorization": "Bearer secret-1"}).status_code == 200


def test_health与鉴权发现端点放行():
    client = _client(token="secret-1")
    assert client.get("/health").status_code == 200
    assert client.get("/.well-known/oauth-authorization-server").status_code == 200
    assert client.post("/register").status_code == 200
