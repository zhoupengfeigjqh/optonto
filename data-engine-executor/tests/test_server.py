# -*- coding: utf-8 -*-
"""data-engine-mcp 协议回调注册契约测试（与 ontology-mcp 同口径）。

运行：cd data-engine-mcp && python -m pytest tests -q

锁定"call_tool 处理器确实注册成了本服务的 handle_call_tool"——装饰器挂错函数会让
整个服务的工具调用静默失效（ontology-mcp 2026-10-01 实测踩过）。
"""
import asyncio
import inspect
import sys
from pathlib import Path

from mcp import types

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))
sys.path.insert(0, str(_REPO_ROOT / "data-engine-mcp"))

import server  # noqa: E402


def _call_registered_handler(tool_name: str, arguments: dict) -> str:
    handler = server.server.request_handlers[types.CallToolRequest]
    req = types.CallToolRequest(method="tools/call",
                                params={"name": tool_name, "arguments": arguments})
    return asyncio.run(handler(req)).model_dump_json()


def test_call_tool_处理器注册正确且可按双参调用():
    text = _call_registered_handler("__不存在的工具__", {})
    assert "未知工具" in text
    assert "positional argument" not in text


def test_list_tools_已注册():
    assert types.ListToolsRequest in server.server.request_handlers


def test_处理器签名为_名称_加_参数():
    assert list(inspect.signature(server.handle_call_tool).parameters) == ["name", "arguments"]
