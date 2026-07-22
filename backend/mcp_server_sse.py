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


def _load_common_tools() -> list[Tool]:
    """Load common function tools from functions.json."""
    if not MANIFEST_PATH.exists():
        return []
    try:
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            entries = json.load(f)
        return [
            Tool(
                name=entry["name"],
                description=entry.get("description", ""),
                inputSchema=entry.get("inputSchema", {"type": "object", "properties": {}}),
            )
            for entry in entries
        ]
    except (json.JSONDecodeError, KeyError, OSError):
        return []


COMMON_TOOLS = _load_common_tools()
COMMON_TOOL_NAMES = {t.name for t in COMMON_TOOLS}

# Load raw manifest entries for metadata not in Tool object (e.g. display_name)
def _load_manifest_entries() -> list[dict]:
    if not MANIFEST_PATH.exists():
        return []
    try:
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []

COMMON_MANIFEST = _load_manifest_entries()

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
            name="list_scenarios",
            description="列出所有场景列表，支持可选 keyword 模糊搜索",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配场景名称"},
                },
            },
        ),
        Tool(
            name="list_ontologies",
            description="列出所有本体列表，支持可选 keyword 模糊搜索名称",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配本体名称或场景名称"},
                },
            },
        ),
        Tool(
            name="list_behaviors",
            description="列出指定本体下的行为，支持可选 keyword 模糊搜索",
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
            name="list_concepts",
            description="列出指定本体下的概念和属性，支持可选 keyword 模糊搜索或 concept_name 精确查找",
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
            name="list_relations",
            description="列出指定本体下的关系，支持可选 concept_name 过滤出该概念直接关联的关系",
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
            name="list_functions",
            description="列出指定本体下的函数，支持可选 keyword 模糊搜索",
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
            name="list_securities",
            description="列出指定本体下的所有安全审核信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="execute_behavior",
            description="调用本体行为对应的目标API，会经过完整的 input/output mapping 处理",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "behavior_name": {"type": "string", "description": "行为名称"},
                    "params": {"type": "object", "description": "行为输入参数"},
                },
                "required": ["ontology_id", "behavior_name", "params"],
            },
        ),
        Tool(
            name="execute_function",
            description="执行本体中函数的 Python 代码，传入参数并返回计算结果",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "function_name": {"type": "string", "description": "函数名称"},
                    "params": {"type": "object", "description": "函数输入参数，按展开的关键字传入"},
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

    if name == "list_scenarios":
        data = await _api_get("/api/scenarios")
        result = await _filter_list(data, arguments.get("keyword"), ["name"])

    elif name == "list_ontologies":
        data = await _api_get("/api/ontologies")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "scenario_name"])

    elif name == "list_behaviors":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/behaviors")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "display_name"])

    elif name == "list_concepts":
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

    elif name == "list_relations":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/relations")
        cname = arguments.get("concept_name")
        if isinstance(data, list) and cname:
            result = [r for r in data if r.get("source") == cname or r.get("target") == cname]
        else:
            result = data

    elif name == "list_functions":
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

    elif name == "list_securities":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/securities")

    elif name == "execute_function":
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

    elif name == "execute_behavior":
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

    # ─── Common function execution ─────────────────────────────────────
    if result is None and name in COMMON_TOOL_NAMES:
        code_path = COMMON_DIR / f"{name}.py"
        if code_path.exists():
            code = code_path.read_text(encoding="utf-8")
            restricted_globals = {
                "__builtins__": {
                    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
                    "enumerate": enumerate, "float": float, "int": int, "isinstance": isinstance,
                    "len": len, "list": list, "max": max, "min": min, "range": range,
                    "round": round, "sorted": sorted, "str": str, "sum": sum, "tuple": tuple,
                    "type": type, "zip": zip, "map": map, "filter": filter, "reversed": reversed,
                    "True": True, "False": False, "None": None,
                    "__import__": __import__, "print": print,
                },
            }
            local_vars = {}
            try:
                exec(code, restricted_globals, local_vars)
                func = local_vars.get("run")
                if func:
                    result = func(arguments)
            except Exception as e:
                result = {"error": True, "message": str(e)}

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

async def handle_oauth_auth_server(request):
    return JSONResponse({
        "issuer": "http://localhost:8002",
        "authorization_endpoint": None,
        "token_endpoint": None,
        "scopes_supported": [],
        "response_types_supported": [],
        "grant_types_supported": [],
        "token_endpoint_auth_methods_supported": [],
    })


async def handle_oauth_resource(request):
    return JSONResponse({
        "resource": "http://localhost:8002/sse",
        "scopes_supported": [],
        "bearer_methods_supported": [],
    })


async def handle_openid_config(request):
    return JSONResponse({
        "issuer": "http://localhost:8002",
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
