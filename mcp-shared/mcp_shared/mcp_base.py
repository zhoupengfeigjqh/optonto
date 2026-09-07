"""MCP SSE Starlette 骨架（迁自 core-backend mcp_server_sse.py 的协议层）。

给定 mcp.server.Server 与 list_tools 回调，产出带以下端点的 Starlette app：
- /sse + /messages/（MCP over SSE）
- /health、/tools（运维与调试）
- /.well-known/* + /register（MCP client auth discovery，issuer 从请求推导不硬编码）

extra_routes 可挂服务私有 REST 端点（如 data-engine-mcp 的 /call-* 转发入口）。
"""

from mcp.server import Server
from mcp.server.sse import SseServerTransport
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route


def build_sse_app(server: Server, list_tools, service_name: str, extra_routes: list | None = None) -> Starlette:
    """list_tools: async () -> list[mcp.types.Tool]，供 /tools 调试端点使用。"""
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

    return Starlette(
        routes=sse_routes + well_known_routes + list(extra_routes or []),
        middleware=[
            Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]),
        ],
    )
