# -*- coding: utf-8 -*-
"""自建发布门面（mcp-publish）契约测试：配置校验、工具注册、按类型转发到执行底座。

服务是**配置驱动**的（配置经环境变量注入），所以测试按"给定配置 → 加载一份独立服务实例"的方式
构造被测对象（importlib 重复加载，而非 monkeypatch 模块级 CONFIG）——这样 function 与 behavior
两种发布形态、合法与非法配置能在同一测试进程内独立验证。

运行：cd mcp-publish && python -m pytest tests -q
"""

import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path

import httpx
import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))

_SERVER_PATH = _REPO_ROOT / "mcp-publish" / "server.py"

_FN_CONFIG = {
    "name": "订单函数发布",
    "kind": "ontology_function",
    "ontology_id": 3,
    "tools": [
        {"name": "calcOrderAmount", "description": "计算订单金额",
         "inputSchema": {"type": "object", "properties": {"qty": {"type": "integer"}}, "required": ["qty"]}},
    ],
}
_BH_CONFIG = {
    "name": "订单行为发布",
    "kind": "behavior",
    "ontology_id": 3,
    "tools": [{"name": "createOrder", "description": "创建订单",
               "inputSchema": {"type": "object", "properties": {}}}],
}

_counter = {"n": 0}


def _load_server(config=None, **extra_env):
    """按给定配置加载一份独立服务实例（config=None → 不注入配置，等价手工启动）。"""
    _counter["n"] += 1
    backup = dict(os.environ)
    os.environ.pop("PUBLISH_CONFIG_JSON", None)
    os.environ["AUTH_TOKEN"] = "tok-for-test"
    if config is not None:
        os.environ["PUBLISH_CONFIG_JSON"] = json.dumps(config, ensure_ascii=False)
    os.environ.update(extra_env)
    try:
        spec = importlib.util.spec_from_file_location(f"_published_server_{_counter['n']}", _SERVER_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        os.environ.clear()
        os.environ.update(backup)


# ─── 配置校验（fail-fast：配置非法即启动失败，绝不静默起一个空服务）──────────────

@pytest.mark.parametrize("config, hint", [
    ({"kind": "ontology_function", "ontology_id": 1, "tools": [{"name": "a"}]}, "缺少服务名"),
    ({"name": "x", "kind": "sql", "ontology_id": 1, "tools": [{"name": "a"}]}, "kind 非法"),
    ({"name": "x", "kind": "ontology_function", "tools": [{"name": "a"}]}, "缺少 ontology_id"),
    ({"name": "x", "kind": "ontology_function", "ontology_id": 1, "tools": []}, "未包含任何工具"),
    ({"name": "x", "kind": "ontology_function", "ontology_id": 1, "tools": [{"name": ""}]}, "非法工具条目"),
    ({"name": "x", "kind": "ontology_function", "ontology_id": 1, "tools": [{"name": "a"}, {"name": "a"}]}, "重名工具"),
])
def test_配置非法一律拒绝启动(config, hint):
    s = _load_server(_FN_CONFIG)
    with pytest.raises(s.ConfigError, match=hint):
        s._parse_config(json.dumps(config, ensure_ascii=False))


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_缺配置拒绝启动(raw):
    s = _load_server(_FN_CONFIG)
    with pytest.raises(s.ConfigError, match="缺少发布配置"):
        s._parse_config(raw)


def test_配置不是合法JSON被拒绝():
    s = _load_server(_FN_CONFIG)
    with pytest.raises(s.ConfigError, match="不是合法 JSON"):
        s._parse_config("{不是 JSON")


def test_无配置时加载即失败():
    """手工 docker run 起本镜像（不经发布面）必须直接起不来，而不是给一个空服务。"""
    with pytest.raises(Exception) as err:
        _load_server(None)
    assert "缺少发布配置" in str(err.value)


def test_合法配置被接受():
    s = _load_server(_FN_CONFIG)
    assert (s.CONFIG["name"], s.CONFIG["kind"], s.CONFIG["ontology_id"]) == ("订单函数发布", "ontology_function", 3)


# ─── 工具注册 ─────────────────────────────────────────────────────────────────

def test_发布函数时工具集等于配置():
    s = _load_server(_FN_CONFIG)
    tools = asyncio.run(s._list_tools())
    assert [t.name for t in tools] == ["calcOrderAmount"]
    assert tools[0].description == "计算订单金额"
    assert tools[0].inputSchema["required"] == ["qty"]


def test_发布行为时工具集等于配置():
    s = _load_server(_BH_CONFIG)
    assert [t.name for t in asyncio.run(s._list_tools())] == ["createOrder"]


def test_未发布的工具不可调用():
    s = _load_server(_FN_CONFIG)
    with pytest.raises(ValueError, match="未知工具"):
        asyncio.run(s.handle_call_tool("createOrder", {}))


def test_工具面受令牌保护():
    """自建发布对外暴露，工具面必须带令牌才能读（配置经环境变量 AUTH_TOKEN 注入）。"""
    s = _load_server(_FN_CONFIG)
    from starlette.testclient import TestClient
    client = TestClient(s.starlette_app)
    assert client.get("/tools").status_code == 401
    assert client.get("/tools", headers={"X-MCP-Token": "tok-for-test"}).status_code == 200


# ─── 转发（执行语义在既有固定服务，本服务只转发，不复制实现）─────────────────────

class _Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text or json.dumps(payload if payload is not None else {})
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._payload


class _FakeClient:
    """httpx.AsyncClient 替身：记录请求并回放预设响应/异常。"""

    def __init__(self, resp=None, error=None):
        self.resp, self.error = resp, error
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        self.calls.append({"url": url, "json": json})
        if self.error:
            raise self.error
        return self.resp


def _patch_client(s, fake):
    s.httpx.AsyncClient = lambda *a, **kw: fake


def test_函数发布转发到本体MCP服务():
    s = _load_server(_FN_CONFIG)
    fake = _FakeClient(_Resp(payload={"success": True, "data": {"amount": 42}, "error": None}))
    _patch_client(s, fake)
    out = asyncio.run(s.handle_call_tool("calcOrderAmount",
                                         {"qty": 3, "ontology_id": 999, "scope": {"name": "x"}}))
    call = fake.calls[0]
    assert call["url"] == "http://optonto-ontology-function-executor:8006/execute-function"
    # ontology_id 一律取发布时绑定的本体（忽略调用方传值）；scope/ontology_id 等系统参数被剥离
    assert call["json"] == {"ontology_id": 3, "function_name": "calcOrderAmount", "params": {"qty": 3}}
    assert json.loads(out[0].text)["data"] == {"amount": 42}


def test_行为发布转发到数据引擎MCP服务():
    s = _load_server(_BH_CONFIG)
    fake = _FakeClient(_Resp(payload={"status_code": 200, "data": {"order_id": "A1"}}))
    _patch_client(s, fake)
    asyncio.run(s.handle_call_tool("createOrder", {"sku": "X"}))
    call = fake.calls[0]
    assert call["url"] == "http://optonto-data-engine-executor:8005/call-behavior"
    assert call["json"] == {"ontology_id": 3, "behavior_name": "createOrder", "params": {"sku": "X"}}


def test_上游地址可由环境变量覆盖(monkeypatch):
    """上游地址在**调用时**读取环境变量（容器内由编排注入），不是启动时冻结。"""
    s = _load_server(_FN_CONFIG)
    fake = _FakeClient(_Resp(payload={"success": True}))
    _patch_client(s, fake)
    monkeypatch.setenv("ONTOLOGY_FUNCTION_EXECUTOR_URL", "http://other-host:9999")
    asyncio.run(s.handle_call_tool("calcOrderAmount", {}))
    assert fake.calls[0]["url"] == "http://other-host:9999/execute-function"


def test_下游错误置isError并带出状态码():
    s = _load_server(_FN_CONFIG)
    _patch_client(s, _FakeClient(_Resp(status_code=502, text="downstream boom")))
    with pytest.raises(RuntimeError, match="HTTP 502"):
        asyncio.run(s.handle_call_tool("calcOrderAmount", {}))


def test_上游不可达时报出依赖服务与处置建议():
    s = _load_server(_FN_CONFIG)
    _patch_client(s, _FakeClient(error=httpx.ConnectError("connection refused")))
    with pytest.raises(RuntimeError, match="本体函数执行服务 不可达"):
        asyncio.run(s.handle_call_tool("calcOrderAmount", {}))


def test_上游超时按失败处理():
    s = _load_server(_FN_CONFIG)
    _patch_client(s, _FakeClient(error=httpx.ReadTimeout("too slow")))
    with pytest.raises(RuntimeError, match="调用超时"):
        asyncio.run(s.handle_call_tool("calcOrderAmount", {}))
