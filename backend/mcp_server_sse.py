"""MCP Server (SSE mode) — persistent service for ontology API access.

Runs as a standalone container, accessible via SSE at http://localhost:8002/sse.
Agents connect via MCP protocol over SSE.
"""

import json
import os

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

server = Server("optonto-api")


async def _api_get(path: str, timeout: int = 15) -> dict | list:
    """Helper: GET from FastAPI backend."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(f"{API_BASE}{path}")
        if resp.status_code >= 400:
            return {"error": True, "detail": resp.text}
        return resp.json()


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return [
        Tool(
            name="list_scenarios",
            description="列出所有可用的场景列表，返回每个场景的 id、名称和描述",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="list_ontologies",
            description="列出所有可用的本体列表，返回每个本体的 id、名称和描述",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="list_behaviors",
            description="列出指定本体下的所有行为及其参数结构",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="list_concepts",
            description="列出指定本体下的所有概念",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="get_concept_attributes",
            description="获取本体中某个概念的所有属性",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "concept_name": {"type": "string", "description": "概念名称"},
                },
                "required": ["ontology_id", "concept_name"],
            },
        ),
        Tool(
            name="list_relations",
            description="列出指定本体下概念之间的所有关系",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                },
                "required": ["ontology_id"],
            },
        ),
        Tool(
            name="get_concept_relations",
            description="获取本体中某个概念的一阶关系（直接关联的概念）",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "concept_name": {"type": "string", "description": "概念名称"},
                },
                "required": ["ontology_id", "concept_name"],
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
            name="search_scenarios",
            description="根据场景名称模糊搜索场景，返回匹配场景的 id、名称、描述等信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词，模糊匹配场景名称"},
                },
                "required": ["keyword"],
            },
        ),
        Tool(
            name="search_ontologies",
            description="根据本体名称模糊搜索本体，返回匹配本体的 id、名称、描述、所属场景等信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词，支持模糊匹配（如输入'原材料'会匹配'原材料采购和库存'）"},
                },
                "required": ["keyword"],
            },
        ),
        Tool(
            name="search_behaviors",
            description="模糊搜索指定本体下的行为，返回匹配的行为名称、描述、输入输出结构等",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词，模糊匹配行为名称"},
                },
                "required": ["ontology_id", "keyword"],
            },
        ),
        Tool(
            name="search_concepts",
            description="模糊搜索指定本体下的概念，返回匹配的概念名称、描述、属性列表等",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词，模糊匹配概念名称"},
                },
                "required": ["ontology_id", "keyword"],
            },
        ),
        Tool(
            name="list_functions",
            description="列出指定本体下的所有函数及其输入参数和返回结构",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                },
                "required": ["ontology_id"],
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
        Tool(
            name="search_functions",
            description="模糊搜索指定本体下的函数，返回匹配的函数名称、描述、输入输出结构等",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词，模糊匹配函数名称"},
                },
                "required": ["ontology_id", "keyword"],
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
    ]


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    result = None

    if name == "list_scenarios":
        result = await _api_get("/api/scenarios")

    elif name == "list_ontologies":
        result = await _api_get("/api/ontologies")

    elif name == "list_behaviors":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/behaviors")

    elif name == "list_concepts":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/concepts")

    elif name == "get_concept_attributes":
        oid = arguments["ontology_id"]
        cname = arguments["concept_name"]
        concepts = await _api_get(f"/api/ontologies/{oid}/concepts")
        if isinstance(concepts, list):
            for c in concepts:
                if c.get("name") == cname:
                    result = c.get("attributes", [])
                    break
        if result is None:
            result = {"error": True, "message": f"概念 '{cname}' 不存在"}

    elif name == "list_relations":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/relations")

    elif name == "get_concept_relations":
        oid = arguments["ontology_id"]
        cname = arguments["concept_name"]
        all_rels = await _api_get(f"/api/ontologies/{oid}/relations")
        if isinstance(all_rels, list):
            result = [
                r for r in all_rels
                if r.get("source") == cname or r.get("target") == cname
            ]

    elif name == "list_functions":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/functions")

    elif name == "list_securities":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/securities")

    elif name == "search_scenarios":
        keyword = arguments["keyword"]
        all_scenarios = await _api_get("/api/scenarios")
        if isinstance(all_scenarios, list):
            matched = [
                s for s in all_scenarios
                if keyword.lower() in s.get("name", "").lower()
            ]
            result = matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的场景", "results": []}
        else:
            result = all_scenarios

    elif name == "search_ontologies":
        keyword = arguments["keyword"]
        all_ontos = await _api_get("/api/ontologies")
        if isinstance(all_ontos, list):
            matched = [
                o for o in all_ontos
                if keyword.lower() in o.get("name", "").lower()
                or keyword.lower() in o.get("scenario_name", "").lower()
            ]
            result = matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的本体", "results": []}
        else:
            result = all_ontos

    elif name == "search_behaviors":
        oid = arguments["ontology_id"]
        keyword = arguments["keyword"]
        behaviors = await _api_get(f"/api/ontologies/{oid}/behaviors")
        if isinstance(behaviors, list):
            matched = [
                b for b in behaviors
                if keyword.lower() in b.get("name", "").lower()
                or keyword.lower() in b.get("display_name", "").lower()
            ]
            result = matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的行为", "results": []}
        else:
            result = behaviors

    elif name == "search_concepts":
        oid = arguments["ontology_id"]
        keyword = arguments["keyword"]
        concepts = await _api_get(f"/api/ontologies/{oid}/concepts")
        if isinstance(concepts, list):
            matched = [
                c for c in concepts
                if keyword.lower() in c.get("name", "").lower()
                or keyword.lower() in c.get("display_name", "").lower()
            ]
            result = matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的概念", "results": []}
        else:
            result = concepts

    elif name == "search_functions":
        oid = arguments["ontology_id"]
        keyword = arguments["keyword"]
        functions = await _api_get(f"/api/ontologies/{oid}/functions")
        if isinstance(functions, list):
            matched = [
                f for f in functions
                if keyword.lower() in f.get("name", "").lower()
                or keyword.lower() in f.get("display_name", "").lower()
            ]
            result = matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的函数", "results": []}
        else:
            result = functions

    elif name == "list_functions":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/functions")

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
    tools = await handle_list_tools()
    return JSONResponse([
        {"name": t.name, "description": t.description, "inputSchema": t.inputSchema}
        for t in tools
    ])


# ─── OAuth & Well-Known (MCP client auth discovery) ──────────────
# Newer MCP clients (Claude Code) probe these before connecting via SSE.
# Return "no auth needed" so the client proceeds without authentication.


async def handle_oauth_auth_server(request):
    """RFC 8414 OAuth Authorization Server metadata — no auth = no endpoints."""
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
    """RFC 8705 OAuth Resource metadata — no protection."""
    return JSONResponse({
        "resource": "http://localhost:8002/sse",
        "scopes_supported": [],
        "bearer_methods_supported": [],
    })


async def handle_openid_config(request):
    """OpenID Discovery — not supported."""
    return JSONResponse({
        "issuer": "http://localhost:8002",
        "authorization_endpoint": None,
        "token_endpoint": None,
    })


async def handle_register(request):
    """Client registration — not needed when no auth."""
    return JSONResponse({
        "client_id": "public-client",
        "client_secret": None,
    })


well_known_routes = [
    Route("/.well-known/oauth-authorization-server",
          endpoint=handle_oauth_auth_server),
    Route("/.well-known/oauth-authorization-server/sse",
          endpoint=handle_oauth_auth_server),
    Route("/.well-known/oauth-protected-resource",
          endpoint=handle_oauth_resource),
    Route("/.well-known/oauth-protected-resource/sse",
          endpoint=handle_oauth_resource),
    Route("/.well-known/openid-configuration",
          endpoint=handle_openid_config),
    Route("/.well-known/openid-configuration/sse",
          endpoint=handle_openid_config),
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
