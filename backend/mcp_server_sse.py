"""MCP Server (SSE mode) — persistent service for ontology API access.

Runs as a standalone container, accessible via SSE at http://localhost:8002/sse.
Agents connect via MCP protocol over SSE.
"""

import json
import os
from pathlib import Path

import httpx
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import TextContent, Tool
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

# FastAPI backend URL (configurable via env)
API_BASE = os.getenv("API_BASE_URL", "http://optonto_backend:8001")

# Common functions directory (inside container)
COMMON_DIR = Path("/app/backend/.data/common_functions")
MANIFEST_PATH = COMMON_DIR / "functions.json"


def _load_common_functions() -> tuple[list[Tool], list[dict]]:
    """一次读取 functions.json，产出 Tool 列表与原始 manifest 条目（此前两次读取同一文件）。"""
    if not MANIFEST_PATH.exists():
        return [], []
    try:
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            entries = json.load(f)
        tools = [
            Tool(
                name=entry["name"],
                description=entry.get("description", ""),
                inputSchema=entry.get("inputSchema", {"type": "object", "properties": {}}),
            )
            for entry in entries
        ]
        return tools, entries
    except (json.JSONDecodeError, KeyError, OSError):
        return [], []


COMMON_TOOLS, COMMON_MANIFEST = _load_common_functions()
COMMON_TOOL_NAMES = {t.name for t in COMMON_TOOLS}

server = Server("optonto-api")


async def _api_get(path: str, timeout: int = 15) -> dict | list:
    """Helper: GET from FastAPI backend."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(f"{API_BASE}{path}")
        if resp.status_code >= 400:
            return {"error": True, "detail": resp.text}
        return resp.json()


async def _list_tools() -> list[Tool]:
    return COMMON_TOOLS + [
        Tool(
            name="listScenarios",
            description="列出所有场景。返回每个场景的 id、name和description等。",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配场景名称"},
                },
            },
        ),
        Tool(
            name="listOntologies",
            description="列出所有本体。返回每个本体的 id（ontology_id）、name、description、scenario_name和ontology_name等",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配本体名称或场景名称"},
                },
            },
        ),
        Tool(
            name="listOntoBehaviors",
            description="列出指定本体的行为。返回行为的 name、display_name、description、params（输入参数结构）、response（返回结构）。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配行为名称或展示名称"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="listOntoConcepts",
            description="列出指定本体的概念。返回概念的 name、display_name、description、attributes（属性列表）。传入 concept_name 则直接返回该概念的属性列表。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配概念名称"},
                    "concept_name": {"type": "string", "description": "概念名称（可选），精确查找指定概念的属性"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="listOntoRelations",
            description="列出指定本体的关系。返回关系的 name、source（源概念）、target（目标概念）、cardinality（基数）、description、display_name。传入 concept_name 则只返回该概念直接关联的关系。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "concept_name": {"type": "string", "description": "概念名称（可选），仅返回与该概念相关的关系"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="listOntoFunctions",
            description="列出指定本体的函数以及对应的输入输出结构。返回函数的 name、display_name、description、params（输入）、response（返回的） 以及公共函数。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配函数名称或展示名称"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="listOntoSecurities",
            description="列出指定本体的安全审核信息。返回 action_name（关联行为）、audit_node（前置/后置）、audit_content（审核内容）。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="executeOntoBehavior",
            description="执行本体行为。API 类型调用目标 HTTP 接口，SQL 类型执行 SQL 查询。传入 ontology_id、behavior_name 和 params，返回按 response 结构对齐的数据。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "behavior_name": {"type": "string", "description": "行为名称"},
                    "params": {"type": "object", "description": "行为输入参数，按 behavior.params 结构传入"},
                },
                "required": ["ontology_id", "behavior_name", "params"],
            },
        ),
        Tool(
            name="executeOntoFunction",
            description="执行本体中函数的 Python 计算代码。传入 ontology_id、function_name 和 params，运行本地 Python 函数并返回计算结果。params 按函数定义的展开关键字传入。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "function_name": {"type": "string", "description": "函数名称"},
                    "params": {"type": "object", "description": "函数输入参数，按函数定义的 key 名展开传入"},
                },
                "required": ["ontology_id", "function_name", "params"],
            },
        ),
    ]


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


async def _filter_list(data: list | dict, keyword: str | None, fields: list[str]) -> list | dict:
    """Filter a list of dicts by keyword across given fields."""
    if keyword is None or not isinstance(data, list):
        return data
    kw = keyword.lower()
    matched = [item for item in data if any(kw in str(item.get(f, "")).lower() for f in fields)]
    return matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的结果", "results": []}


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    result = None

    if name == "listScenarios":
        data = await _api_get("/api/scenarios")
        result = await _filter_list(data, arguments.get("keyword"), ["name"])

    elif name == "listOntologies":
        data = await _api_get("/api/ontologies")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "scenario_name"])

    elif name == "listOntoBehaviors":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/behaviors")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoConcepts":
        oid = arguments["ontology_id"]
        cname = arguments.get("concept_name")
        data = await _api_get(f"/api/ontologies/{oid}/concepts")
        if isinstance(data, list) and cname:
            matched = [c for c in data if c.get("name") == cname]
            if matched:
                result = matched[0].get("attributes", [])
            else:
                result = {"error": True, "message": f"概念 '{cname}' 不存在"}
        else:
            result = await _filter_list(data, arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoRelations":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/relations")
        cname = arguments.get("concept_name")
        if isinstance(data, list) and cname:
            result = [r for r in data if r.get("source") == cname or r.get("target") == cname]
        else:
            result = data

    elif name == "listOntoFunctions":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/functions")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "display_name"])
        if isinstance(result, list) and COMMON_MANIFEST:
            common_list = [
                {
                    "name": entry["name"],
                    "display_name": entry.get("display_name", ""),
                    "description": entry.get("description", ""),
                    "source": "common",
                }
                for entry in COMMON_MANIFEST
            ]
            kw = (arguments.get("keyword") or "").lower()
            if kw:
                common_list = [c for c in common_list if kw in c["name"].lower() or kw in c.get("description","").lower() or kw in c.get("display_name","").lower()]
            result.extend(common_list)

    elif name == "listOntoSecurities":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/securities")

    elif name == "executeOntoFunction":
        oid = arguments["ontology_id"]
        fname = arguments["function_name"]
        params = arguments.get("params", {})
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}/api/ontologies/{oid}/functions/{fname}/execute",
                json={"params": params},
            )
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                except Exception:
                    err = {"detail": resp.text}
                result = {"error": True, "status_code": resp.status_code, "detail": err}
            else:
                result = resp.json()

    elif name == "executeOntoBehavior":
        oid = arguments["ontology_id"]
        bname = arguments["behavior_name"]
        params = arguments.get("params", {})
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}/api/ontologies/{oid}/behaviors/{bname}/call",
                json={"params": params},
            )
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                except Exception:
                    err = {"detail": resp.text}
                result = {"error": True, "status_code": resp.status_code, "detail": err}
            else:
                result = resp.json()

    # ─── Common function execution (proxied to backend) ────────────────
    if result is None and name in COMMON_TOOL_NAMES:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}/api/common-functions/{name}/execute",
                json={"params": arguments},
            )
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                except Exception:
                    err = {"detail": resp.text}
                result = {"error": True, "status_code": resp.status_code, "detail": err}
            else:
                result = resp.json()

    if result is None:
        raise ValueError(f"未知工具: {name}")

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


# ─── SSE Transport ─────────────────────────────────────────────────────

sse = SseServerTransport("/messages/")


class SSEHandler:
    """ASGI app for /sse — class form so Starlette treats it as raw ASGI."""
    async def __call__(self, scope, receive, send):
        async with sse.connect_sse(scope, receive, send) as streams:
            await server.run(
                streams[0],
                streams[1],
                server.create_initialization_options(),
            )


class MessagesHandler:
    """ASGI app for /messages/ — class form for raw ASGI."""
    async def __call__(self, scope, receive, send):
        await sse.handle_post_message(scope, receive, send)


async def handle_health(request):
    return JSONResponse({"status": "ok", "server": "optonto-api"})


async def handle_tools(request):
    """Return the list of available MCP tools with names and descriptions."""
    tools = await _list_tools()
    return JSONResponse([
        {"name": t.name, "description": t.description, "inputSchema": t.inputSchema}
        for t in tools
    ])


# ─── OAuth & Well-Known (MCP client auth discovery) ──────────────

def _request_base_url(request) -> str:
    """从请求推导本服务基础地址，避免硬编码 localhost:8002 导致容器化部署 issuer 错误。"""
    return f"{request.url.scheme}://{request.url.netloc}"


async def handle_oauth_auth_server(request):
    base = _request_base_url(request)
    return JSONResponse({
        "issuer": base,
        "authorization_endpoint": None,
        "token_endpoint": None,
        "scopes_supported": [],
        "response_types_supported": [],
        "grant_types_supported": [],
        "token_endpoint_auth_methods_supported": [],
    })


async def handle_oauth_resource(request):
    base = _request_base_url(request)
    return JSONResponse({
        "resource": f"{base}/sse",
        "scopes_supported": [],
        "bearer_methods_supported": [],
    })


async def handle_openid_config(request):
    base = _request_base_url(request)
    return JSONResponse({
        "issuer": base,
        "authorization_endpoint": None,
        "token_endpoint": None,
    })


async def handle_register(request):
    return JSONResponse({
        "client_id": "public-client",
        "client_secret": None,
    })


well_known_routes = [
    Route("/.well-known/oauth-authorization-server", endpoint=handle_oauth_auth_server),
    Route("/.well-known/oauth-authorization-server/sse", endpoint=handle_oauth_auth_server),
    Route("/.well-known/oauth-protected-resource", endpoint=handle_oauth_resource),
    Route("/.well-known/oauth-protected-resource/sse", endpoint=handle_oauth_resource),
    Route("/.well-known/openid-configuration", endpoint=handle_openid_config),
    Route("/.well-known/openid-configuration/sse", endpoint=handle_openid_config),
    Route("/register", endpoint=handle_register, methods=["POST"]),
]

sse_routes = [
    Route("/sse", endpoint=SSEHandler()),
    Route("/messages/", endpoint=MessagesHandler(), methods=["POST"]),
    Route("/health", endpoint=handle_health),
    Route("/tools", endpoint=handle_tools),
]

starlette_app = Starlette(
    routes=sse_routes + well_known_routes,
    middleware=[
        Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]),
    ],
)
