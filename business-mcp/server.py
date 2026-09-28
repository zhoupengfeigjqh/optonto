"""optonto-business-mcp — 业务集成面 MCP 服务（阶段二落地）。

定位：模拟业务系统（真实部署时对应客户自建的 MCP 服务）。非平台内置——
由人手工配进 Agent 的 mcp-config（与外部远程 MCP 同一入口），Docker 手动启停。

职责：按 config/tools.yaml 声明把业务 REST 端点包装为 MCP 工具——
自描述 input/outputSchema（强制，缺一条即启动失败），不知本体/映射/Agent。
工具字段名一律业务系统原始命名；换名是 data-engine-mcp 映射层的职责。

信封语义：Java 侧 ApiResponse {code, message, data}——code != 0 或 HTTP >= 400
一律抛错（MCP 层置 isError 穿透）；成功返回 envelope.data 的 JSON 文本。

修改 tools.yaml 后重启容器生效（本服务只能 Docker 手动启停，见架构文档 §十六）。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8004
"""

import json
import os
import re
import sys
import urllib.parse
from pathlib import Path

import httpx

for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from mcp.server import Server
from mcp.types import TextContent, Tool

from mcp_base import build_mcp_app
from decls import load_tool_decls

BUSINESS_API_BASE = os.environ.get("BUSINESS_API_BASE", "http://optonto-business-backend:8080")
TOOLS_YAML = Path(__file__).resolve().parent / "config" / "tools.yaml"
HTTP_TIMEOUT = 15.0

server = Server("optonto-business-mcp")

TOOL_DECLS = load_tool_decls(TOOLS_YAML)

# path 中的 {pathParam} 占位（从工具入参取值替换，替换后该参数不再进 query/body）
_PATH_PARAM_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


async def _list_tools() -> list[Tool]:
    return [
        Tool(name=t["name"], description=t["description"],
             inputSchema=t["inputSchema"], outputSchema=t["outputSchema"])
        for t in TOOL_DECLS.values()
    ]


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    decl = TOOL_DECLS.get(name)
    if decl is None:
        raise ValueError(f"未知工具: {name}")
    ep = decl["endpoint"]
    args = dict(arguments or {})

    # path 占位替换（值 URL 转义；缺参数=调用方错误）
    path = ep["path"]
    for pm in _PATH_PARAM_RE.findall(path):
        if pm not in args:
            raise ValueError(f"缺少路径参数: {pm}")
        path = path.replace("{" + pm + "}", urllib.parse.quote(str(args.pop(pm)), safe=""))

    method = ep["method"].upper()
    url = BUSINESS_API_BASE + path
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            if method == "GET":
                resp = await client.get(url, params={k: v for k, v in args.items() if v is not None})
            else:
                resp = await client.request(method, url, json=args)
    except httpx.TimeoutException:
        raise RuntimeError(f"业务系统调用超时（{HTTP_TIMEOUT}s）: {method} {path}")
    except httpx.RequestError as e:
        raise RuntimeError(f"业务系统不可达: {e}")

    if resp.status_code >= 400:
        raise RuntimeError(f"业务系统返回 HTTP {resp.status_code}: {resp.text[:300]}")
    try:
        envelope = resp.json()
    except ValueError:
        raise RuntimeError(f"业务系统返回非 JSON: {resp.text[:300]}")
    if isinstance(envelope, dict) and "code" in envelope:
        if envelope["code"] != 0:
            raise RuntimeError(f"业务系统拒绝: {envelope.get('message') or envelope['code']}")
        envelope = envelope.get("data")
    # 协议约束：outputSchema 已声明 → 必须回 structuredContent 且通过 SDK 的 jsonschema 校验；
    # structuredContent 只能是对象 → 非对象负载（查询类数组）统一包 {"result": [...]}，
    # 文本通道与 structured 同负载（单一形状，消费方/映射路径都面向它，无双口径）。
    # 递归剔除 null 字段：可选字段缺省=不存在（同 Jackson NON_NULL 语义），
    # 避免声明 string 的字段带 null 触发校验失败，也省得 Agent/映射面对垃圾空值。
    payload = _strip_nulls(envelope)
    if not isinstance(payload, dict):
        payload = {"result": payload}
    text = json.dumps(payload, ensure_ascii=False, default=str)
    return [TextContent(type="text", text=text)], payload


def _strip_nulls(v):
    if isinstance(v, dict):
        return {k: _strip_nulls(x) for k, x in v.items() if x is not None}
    if isinstance(v, list):
        return [_strip_nulls(x) for x in v]
    return v


starlette_app = build_mcp_app(server, _list_tools, "optonto-business-mcp")
