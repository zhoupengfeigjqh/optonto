"""MCP Streamable HTTP Starlette 骨架（迁自 core-backend mcp_server_sse.py 的协议层）。

给定 mcp.server.Server 与 list_tools 回调，产出带以下端点的 Starlette app：
- /mcp（MCP over Streamable HTTP：POST 请求 / GET 流 / DELETE 终止会话）
- /health、/tools（运维与调试）
- /.well-known/* + /register（MCP client auth discovery，issuer 从请求推导不硬编码）

extra_routes 可挂服务私有 REST 端点（如 data-engine-mcp 的 /call-* 转发入口）。
"""

import contextlib

from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.types import Receive, Scope, Send


def build_mcp_app(server: Server, list_tools, service_name: str, extra_routes: list | None = None) -> Starlette:
    """list_tools: async () -> list[mcp.types.Tool]，供 /tools 调试端点使用。

    Streamable HTTP 取代 SSE：单端点 /mcp 走 POST 请求-响应，不再需要 /sse + /messages/ 双通道。
    无状态模式（stateless=True）：每次请求自足，服务端不保存会话——多 Agent 并发连接、
    以及 data-engine-mcp 对下游「逐调用建连」都不留状态，容器重启/断连无残留需清理。
    """
    session_manager = StreamableHTTPSessionManager(app=server, stateless=True)

    async def handle_mcp(scope: Scope, receive: Receive, send: Send) -> None:
        await session_manager.handle_request(scope, receive, send)

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        # session_manager 的 task group 必须在 lifespan 内启动（run() 只能调用一次）
        async with session_manager.run():
            yield

    async def handle_health(request):
        return JSONResponse({"status": "ok", "server": service_name})

    async def handle_tools(request):
        tools = await list_tools()
        return JSONResponse([
            {"name": t.name, "description": t.description, "inputSchema": t.inputSchema,
             "outputSchema": getattr(t, "outputSchema", None)}
            for t in tools
        ])

    # ─── OAuth & Well-Known (MCP client auth discovery) ──────────────
    def _request_base_url(request) -> str:
        """从请求推导本服务基础地址，避免硬编码 host 导致容器化部署 issuer 错误。"""
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
            "resource": f"{base}/mcp",
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
        Route("/.well-known/oauth-authorization-server/mcp", endpoint=handle_oauth_auth_server),
        Route("/.well-known/oauth-protected-resource", endpoint=handle_oauth_resource),
        Route("/.well-known/oauth-protected-resource/mcp", endpoint=handle_oauth_resource),
        Route("/.well-known/openid-configuration", endpoint=handle_openid_config),
        Route("/.well-known/openid-configuration/mcp", endpoint=handle_openid_config),
        Route("/register", endpoint=handle_register, methods=["POST"]),
    ]

    # /mcp 走 Mount（ASGI 原始入口），不走 Route——Route 会把 endpoint 当 (request) -> Response 调用
    mcp_route = [Mount("/mcp", app=handle_mcp)]
    ops_routes = [
        Route("/health", endpoint=handle_health),
        Route("/tools", endpoint=handle_tools),
    ]

    return Starlette(
        routes=mcp_route + ops_routes + well_known_routes + list(extra_routes or []),
        middleware=[
            Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]),
        ],
        lifespan=lifespan,
    )
