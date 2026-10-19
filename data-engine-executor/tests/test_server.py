# -*- coding: utf-8 -*-
"""data-engine-executor 协议面契约测试（**零工具**执行底座）。

运行：cd data-engine-executor && python -m pytest tests -q

2026-10-19 方案 B：本服务不再发布 MCP 工具（工具面归自建发布），故锁定：
- `/mcp`、`/sse`、`/messages` 一律不挂载（误连直接 404，而不是"连上了但没工具"）；
- `/health`、`/tools`（恒空）仍可达，供探活与自检；
- 执行入口 `/call-behavior`、`/call-engine` 照常工作（自建发布与设计器测试共用）。
"""
import sys
from pathlib import Path

from starlette.testclient import TestClient

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "data-engine-executor"))

import server  # noqa: E402


def test_协议端点不存在():
    """执行底座不对外提供工具：误连 /mcp、/sse 直接 404。"""
    paths = {r.path for r in server.starlette_app.routes}
    assert "/mcp" not in paths
    assert "/sse" not in paths and "/messages" not in paths


def test_mcp端点返回404():
    client = TestClient(server.starlette_app)
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert resp.status_code == 404


def test_探活可用且工具清单为空():
    client = TestClient(server.starlette_app)
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/tools").json() == []


def test_执行端点仍挂载():
    """/call-behavior、/call-engine 是自建发布与设计器测试的唯一执行入口，不得随工具面一起删。"""
    paths = {r.path for r in server.starlette_app.routes}
    assert "/call-behavior" in paths
    assert "/call-engine" in paths


# ─── 归属一致性（契约 ④：发布声明闸）──────────────────────────────────────────

def test_发布scope与调用本体不一致即拒():
    """scope 来自自建发布的工具元数据；与调用方 ontology_id 不等时，在碰任何本体数据前就中止。"""
    resp = TestClient(server.starlette_app).post("/call-behavior", json={
        "ontology_id": 1, "behavior_name": "anyBehavior",
        "scope": {"ontology_id": 2, "ontology_name": "订单排程", "scenario_name": "生产调度"},
        "params": {},
    })
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert "本体不一致" in detail
    assert "本体「订单排程」" in detail          # 详细错误：给出中文名，便于调用方自纠
    assert "ontology_id=1" in detail and "ontology_id=2" in detail
    assert "请传入 ontology_id=2" in detail


def test_缺ontology_id被拒():
    resp = TestClient(server.starlette_app).post("/call-behavior", json={
        "behavior_name": "anyBehavior", "params": {},
    })
    assert resp.status_code == 400
    assert "ontology_id" in resp.json()["detail"]
