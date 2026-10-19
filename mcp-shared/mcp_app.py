"""MCP 协议骨架 app 工厂（迁自 core-backend mcp_server_sse.py 的协议层；原名 mcp_base.py，2026-10-02 更名）。

给定 mcp.server.Server 与 list_tools 回调，产出带以下端点的 Starlette app：
- /mcp（MCP over Streamable HTTP：POST 请求 / GET 流 / DELETE 终止会话）—— transport=streamable|both
- /sse + /messages/（MCP over SSE 双通道）—— transport=sse|both
- /health、/tools（运维与调试）
- /.well-known/* + /register（MCP client auth discovery，issuer 从请求推导不硬编码）

extra_routes 可挂服务私有 REST 端点（如 ontology-mcp 的 /execute-*、data-engine-mcp 的 /call-* 转发入口）。

**transport**（2026-10-04 引入 / 2026-10-19 收敛）：平台固定服务里**三个带协议端点**的为 `streamable`
（单端点、无状态）：本体查询（8002）、公共函数（8007）、业务系统 MCP（8004）；
**两个执行底座用 `none`**（零工具，见 TRANSPORT_NONE）：本体函数执行服务（8006）、
数据引擎执行服务（8005，2026-10-19 方案 B：行为工具的唯一出口是自建发布）。
自建发布容器由用户在发布时选择，故协议层支持两种模式（含 both，便于同容器并存两种端点）。
- streamable：`StreamableHTTPSessionManager(stateless=True)`，单端点 /mcp，请求-响应自足；
- sse：`SseServerTransport` 双通道（GET /sse 建流、POST /messages/ 送消息），**有会话**，
  故每条连接各自持有 session（connect_sse 上下文），容器重启/断连无残留需清理。

**auth_token**（2026-10-04，自建发布引入）：非空时对 /mcp、/sse、/messages、/tools 校验令牌；
/health 与 /.well-known/*、/register 放行（前者供探活，后者是 MCP 客户端鉴权发现入口，
令牌尚未拿到时也必须可达，否则客户端拿不到 issuer 就无法完成握手）。校验用**原生 ASGI 中间件**
而非 BaseHTTPMiddleware——后者会缓冲响应体，破坏 SSE 的流式输出。
"""

import contextlib
import hmac

from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.types import Receive, Scope, Send

TRANSPORT_STREAMABLE = "streamable"
TRANSPORT_SSE = "sse"
TRANSPORT_BOTH = "both"
# 零工具模式：执行底座专用（本体函数执行服务、数据引擎执行服务）。
# 不挂任何 MCP 协议端点——「不对外提供工具」是**结构性保证**，不依赖"列表恰好为空"的约定，
# 外部客户端误连会直接 404，而不是连上后发现没有工具。
TRANSPORT_NONE = "none"
TRANSPORTS = (TRANSPORT_STREAMABLE, TRANSPORT_SSE, TRANSPORT_BOTH, TRANSPORT_NONE)

DEFAULT_AUTH_HEADER = "X-MCP-Token"

# 鉴权放行路径：探活 + MCP 客户端鉴权发现（不带令牌也必须可达，见模块 docstring）
_OPEN_PREFIXES = ("/.well-known/", "/register", "/health")


def _is_open_path(path: str) -> bool:
    return any(path == p or path.startswith(p) for p in _OPEN_PREFIXES)


class _TokenAuthMiddleware:
    """原生 ASGI 令牌校验中间件（不用 BaseHTTPMiddleware：会缓冲响应体、破坏 SSE 流式输出）。"""

    def __init__(self, app, token: str, header: str):
        self.app = app
        self.token = token
        self.header = header

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if scope.get("method") == "OPTIONS" or _is_open_path(path):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        provided = headers.get(self.header) or ""
        if not provided:
            auth = headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                provided = auth[7:].strip()
        # 常量时间比较（hmac.compare_digest），避免按字节短路造成的时序侧信道
        if not hmac.compare_digest(provided or "", self.token):
            response = JSONResponse(
                {"detail": "缺少或无效的访问令牌（请在 MCP 配置中带上该发布服务的令牌请求头）"},
                status_code=401,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def build_mcp_app(
    server: Server,
    list_tools,
    service_name: str,
    extra_routes: list | None = None,
    *,
    transport: str = TRANSPORT_STREAMABLE,
    auth_token: str | None = None,
    auth_header: str = DEFAULT_AUTH_HEADER,
) -> Starlette:
    """list_tools: async () -> list[mcp.types.Tool]，供 /tools 调试端点使用。

    transport 决定挂载哪些协议端点：
    - ``streamable``（默认）：/mcp 单端点——本体查询 8002 / 公共函数 8007 / 业务系统 8004；
    - ``sse`` / ``both``：SSE 双通道——固定服务都不用，仅自建发布可按用户选择；
    - ``none``：不挂协议端点——**只给零工具的执行底座**：本体函数执行服务 8006、
      数据引擎执行服务 8005（2026-10-19 方案 B：行为工具的唯一出口是自建发布）。

    auth_token 非空即启用令牌校验（自建发布对外暴露时必配，见模块 docstring）。
    """
    if transport not in TRANSPORTS:
        raise ValueError(f"未知传输模式: {transport}（可选 {', '.join(TRANSPORTS)}）")

    # Streamable HTTP：单端点 /mcp，无状态模式（stateless=True）——每次请求自足，
    # 服务端不保存会话：多 Agent 并发连接、data-engine-mcp 对下游「逐调用建连」都不留状态。
    session_manager = StreamableHTTPSessionManager(app=server, stateless=True)

    async def handle_mcp(scope: Scope, receive: Receive, send: Send) -> None:
        await session_manager.handle_request(scope, receive, send)

    # SSE：GET /sse 建流（服务端 → 客户端），POST /messages/ 送消息（客户端 → 服务端）。
    # 与 streamable 不同，SSE **有会话**：每条连接各自持有 session，随连接关闭而释放。
    sse_transport = SseServerTransport("/messages/")

    async def handle_sse(scope: Scope, receive: Receive, send: Send) -> None:
        async with sse_transport.connect_sse(scope, receive, send) as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        # session_manager 的 task group 必须在 lifespan 内启动（run() 只能调用一次）；
        # none 模式不挂任何协议端点，没有会话要开——不启动，省一个 task group
        if transport == TRANSPORT_NONE:
            yield
            return
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

    # 协议端点走 Mount（ASGI 原始入口），不走 Route——Route 会把 endpoint 当 (request) -> Response 调用
    mcp_routes: list = []
    if transport in (TRANSPORT_STREAMABLE, TRANSPORT_BOTH):
        mcp_routes.append(Mount("/mcp", app=handle_mcp))
    if transport in (TRANSPORT_SSE, TRANSPORT_BOTH):
        # **顺序敏感**：SSE 建流挂在 /sse，而 SDK 广告的收信路径是 `root_path + endpoint`
        # （root_path = "/sse"，见 mcp/server/sse.py:171-180），即 `/sse/messages/`。
        # Starlette 按顺序匹配路由，Mount("/sse") 会**吞掉** /sse/messages/*，故更具体的
        # 收信路由必须排在建流路由之前；两个都挂是为了同时兼容"SDK 广告路径"与
        # "客户端硬编码 /messages/"两种习惯。
        mcp_routes.append(Mount("/sse/messages", app=sse_transport.handle_post_message))
        mcp_routes.append(Mount("/messages", app=sse_transport.handle_post_message))
        mcp_routes.append(Mount("/sse", app=handle_sse))
    ops_routes = [
        Route("/health", endpoint=handle_health),
        Route("/tools", endpoint=handle_tools),
    ]

    middleware = [Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])]
    if auth_token:
        # 令牌校验放在 CORS 内侧：401 也要带 CORS 头，浏览器端才读得到错误体
        middleware.append(Middleware(_TokenAuthMiddleware, token=auth_token, header=auth_header))

    return Starlette(
        routes=mcp_routes + ops_routes + well_known_routes + list(extra_routes or []),
        middleware=middleware,
        lifespan=lifespan,
    )
