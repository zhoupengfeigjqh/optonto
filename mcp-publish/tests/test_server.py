# -*- coding: utf-8 -*-
"""自建发布门面（mcp-publish）契约测试：配置校验、工具注册、按类型转发到执行底座。

服务是**配置驱动**的（配置经环境变量注入），所以测试按"给定配置 → 加载一份独立服务实例"的方式
构造被测对象（importlib 重复加载，而非 monkeypatch 模块级 CONFIG）——这样 function 与 behavior
两种发布形态、合法与非法配置能在同一测试进程内独立验证。

契约（2026-10-19）：
- 配置不含 ontology_id：本体归属只存在于每个工具的 ``inputSchema["x-ontology-scope"]``；
- ``ontology_id`` 是调用方（LLM）填写的必填参数，门面**原样转发**；
- ``scope`` 由门面从该工具元数据取出随载荷带给底座——门面不做一致性判断（底座统一校验）。

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

_SCOPE = {"ontology_id": 3, "scenario_id": 1, "scenario_name": "生产调度", "ontology_name": "订单排程"}

_FN_CONFIG = {
    "name": "订单函数发布",
    "kind": "ontology_function",
    "tools": [
        {"name": "calcOrderAmount", "description": "计算订单金额",
         "inputSchema": {
             "type": "object",
             "properties": {"ontology_id": {"type": "integer"}, "qty": {"type": "integer"}},
             "required": ["ontology_id", "qty"],
             "x-category": "本体函数",
             "x-ontology-scope": _SCOPE,
         }},
    ],
}
_BH_CONFIG = {
    "name": "订单行为发布",
    "kind": "behavior",
    "tools": [{"name": "createOrder", "description": "创建订单",
               "inputSchema": {
                   "type": "object",
                   "properties": {"ontology_id": {"type": "integer"}, "sku": {"type": "string"}},
                   "required": ["ontology_id"],
                   "x-category": "本体行为",
                   "x-ontology-scope": _SCOPE,
               }}],
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
    ({"kind": "ontology_function", "tools": [{"name": "a"}]}, "缺少服务名"),
    ({"name": "x", "kind": "sql", "tools": [{"name": "a"}]}, "kind 非法"),
    ({"name": "x", "kind": "ontology_function", "tools": [{"name": "a"}]}, "缺少本体上下文"),
    ({"name": "x", "kind": "ontology_function",
      "ontology_id": 1, "tools": [{"name": "a"}]}, "缺少本体上下文"),  # 旧配置形态不再被接受
    ({"name": "x", "kind": "ontology_function", "tools": []}, "未包含任何工具"),
    ({"name": "x", "kind": "ontology_function", "tools": [{"name": ""}]}, "非法工具条目"),
    ({"name": "x", "kind": "ontology_function", "tools": [
        {"name": "a", "inputSchema": {"x-ontology-scope": {"ontology_id": 1}}},
        {"name": "a", "inputSchema": {"x-ontology-scope": {"ontology_id": 1}}},
    ]}, "重名工具"),
    ({"name": "x", "kind": "ontology_function", "tools": [
        {"name": "a", "inputSchema": {"x-ontology-scope": {"ontology_id": 1}}},
        {"name": "b", "inputSchema": {"x-ontology-scope": {"ontology_id": 2}}},
    ]}, "只能绑定一个本体"),
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


def test_合法配置被接受且归属来自工具元数据():
    s = _load_server(_FN_CONFIG)
    assert (s.CONFIG["name"], s.CONFIG["kind"]) == ("订单函数发布", "ontology_function")
    assert "ontology_id" not in s.CONFIG                 # 单一事实来源：工具元数据
    assert s._TOOL_SCOPES["calcOrderAmount"] == _SCOPE


# ─── 工具注册 ─────────────────────────────────────────────────────────────────

def test_发布函数时工具集等于配置():
    s = _load_server(_FN_CONFIG)
    tools = asyncio.run(s._list_tools())
    assert [t.name for t in tools] == ["calcOrderAmount"]
    assert tools[0].description == "计算订单金额"
    assert tools[0].inputSchema["required"] == ["ontology_id", "qty"]


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


def test_函数发布转发到本体函数执行服务():
    s = _load_server(_FN_CONFIG)
    fake = _FakeClient(_Resp(payload={"success": True, "data": {"amount": 42}, "error": None}))
    _patch_client(s, fake)
    out = asyncio.run(s.handle_call_tool("calcOrderAmount", {"qty": 3, "ontology_id": 999}))
    call = fake.calls[0]
    assert call["url"] == "http://optonto-ontology-function-executor:8006/execute-function"
    # ontology_id = 调用方填写的值（门面不覆盖、不校验）；scope = 该工具发布时固化的元数据；
    # params 只留业务参数。一致性判定在执行底座（契约 ④-1）
    assert call["json"] == {
        "ontology_id": 999,
        "scope": _SCOPE,
        "function_name": "calcOrderAmount",
        "params": {"qty": 3},
    }
    assert json.loads(out[0].text)["data"] == {"amount": 42}


def test_行为发布转发到数据执行引擎():
    s = _load_server(_BH_CONFIG)
    fake = _FakeClient(_Resp(payload={"status_code": 200, "data": {"order_id": "A1"}}))
    _patch_client(s, fake)
    asyncio.run(s.handle_call_tool("createOrder", {"ontology_id": 3, "sku": "X"}))
    call = fake.calls[0]
    assert call["url"] == "http://optonto-data-engine-executor:8005/call-behavior"
    assert call["json"] == {
        "ontology_id": 3,
        "scope": _SCOPE,
        "behavior_name": "createOrder",
        "params": {"sku": "X"},
    }


def test_调用方漏填ontology_id时原样转发由底座报错():
    """门面只转发不判断：缺失的 ontology_id 交由执行底座给出统一、可自纠的错误。"""
    s = _load_server(_BH_CONFIG)
    fake = _FakeClient(_Resp(payload={"status_code": 200, "data": {}}))
    _patch_client(s, fake)
    asyncio.run(s.handle_call_tool("createOrder", {"sku": "X"}))
    assert fake.calls[0]["json"]["ontology_id"] is None


def test_上游地址可由环境变量覆盖(monkeypatch):
    """上游地址在**调用时**读取环境变量（容器内由编排注入），不是启动时冻结。"""
    s = _load_server(_FN_CONFIG)
    fake = _FakeClient(_Resp(payload={"success": True}))
    _patch_client(s, fake)
    monkeypatch.setenv("ONTOLOGY_FUNCTION_EXECUTOR_URL", "http://other-host:9999")
    asyncio.run(s.handle_call_tool("calcOrderAmount", {"ontology_id": 3}))
    assert fake.calls[0]["url"] == "http://other-host:9999/execute-function"


def test_下游错误置isError并带出状态码():
    s = _load_server(_FN_CONFIG)
    _patch_client(s, _FakeClient(_Resp(status_code=502, text="downstream boom")))
    with pytest.raises(RuntimeError, match="HTTP 502"):
        asyncio.run(s.handle_call_tool("calcOrderAmount", {"ontology_id": 3}))


def test_上游不可达时报出依赖服务与处置建议():
    s = _load_server(_FN_CONFIG)
    _patch_client(s, _FakeClient(error=httpx.ConnectError("connection refused")))
    with pytest.raises(RuntimeError, match="本体函数执行服务 不可达"):
        asyncio.run(s.handle_call_tool("calcOrderAmount", {"ontology_id": 3}))


def test_上游超时按失败处理():
    s = _load_server(_FN_CONFIG)
    _patch_client(s, _FakeClient(error=httpx.ReadTimeout("too slow")))
    with pytest.raises(RuntimeError, match="调用超时"):
        asyncio.run(s.handle_call_tool("calcOrderAmount", {"ontology_id": 3}))
