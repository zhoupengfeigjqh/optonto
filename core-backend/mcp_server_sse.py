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
API_BASE = os.getenv("API_BASE_URL", "http://optonto-core-backend:8001")

# Common functions directory (inside container, mounted from project .data)
COMMON_DIR = Path("/app/.data/common_functions")
MANIFEST_PATH = COMMON_DIR / "functions.json"


def _load_common_functions() -> tuple[list[Tool], list[dict]]:
    """一次读取 functions.json，产出 Tool 列表与原始 manifest 条目（此前两次读取同一文件）。

    inputSchema 注入 x-category/x-display_name 发布方标记（JSON Schema 扩展键，协议透传）：
    agent-backend 据此分类（不再读 functions.json 名单比对），display_name 结构化可得。
    """
    if not MANIFEST_PATH.exists():
        return [], []
    try:
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            entries = json.load(f)
        tools = [
            Tool(
                name=entry["name"],
                description=entry.get("description", ""),
                inputSchema={
                    **entry.get("inputSchema", {"type": "object", "properties": {}}),
                    "x-category": "公共函数",
                    "x-display_name": entry.get("display_name", ""),
                },
            )
            for entry in entries
        ]
        return tools, entries
    except (json.JSONDecodeError, KeyError, OSError):
        return [], []


# 公共函数工具：mtime 缓存（原模块级一次性加载，改 functions.json 必须重启容器才生效）。
# 与本体函数工具的指纹缓存同语义——文件一变下次 list_tools 即生效，没变则不重读。
_COMMON_CACHE: dict = {"mtime": None, "tools": [], "names": set()}


def _get_common_tools() -> tuple[list[Tool], set[str]]:
    mtime = MANIFEST_PATH.stat().st_mtime_ns if MANIFEST_PATH.exists() else -1
    if _COMMON_CACHE["mtime"] == mtime:
        return _COMMON_CACHE["tools"], _COMMON_CACHE["names"]
    tools, _ = _load_common_functions()
    _COMMON_CACHE.update(mtime=mtime, tools=tools, names={t.name for t in tools})
    return tools, _COMMON_CACHE["names"]

# 本体函数工具 schema 前置的作用域块键（含所属场景/本体的真实值，非函数输入参数）。
# 供父 Agent 经 listAllMcpFunctions（agent-backend 内部工具）了解函数所属场景/本体；执行路径统一剥离，不传给后端。
SCOPE_KEY = "scope"
FUNCTION_SCOPE_KEYS = {SCOPE_KEY}


def _with_function_scope(input_schema: dict, fn: dict) -> dict:
    """本体函数工具 schema 前置 scope 作用域块（const 带真实值，供规划填子任务对应字段）。

    scope 块放在函数参数之前；agent-backend 的 listAllMcpFunctions 读出 scope 展示给父 Agent，
    callFunctionTool/scopeToOntology 与本分发器在调用前剥离 scope，避免污染真实函数参数。
    category/display_name 为发布方权威标记：agent-backend 据此分类（不再靠特征猜测），
    display_name 使中文名结构化可得（不再从 description 前缀切分）。
    """
    props: dict = {
        SCOPE_KEY: {
            "type": "object",
            "description": "本函数所属场景/本体上下文（规划时填子任务对应字段；非函数输入参数，执行时自动剥离）",
            "properties": {
                "category": {"type": "string", "const": "本体函数"},
                "display_name": {"type": "string", "const": fn.get("display_name") or ""},
            },
        },
    }
    for k, t in (("ontology_id", "integer"), ("scenario_id", "integer"),
                 ("scenario_name", "string"), ("ontology_name", "string")):
        v = fn.get(k)
        if v is not None:
            props[SCOPE_KEY]["properties"][k] = {"type": t, "const": v}
    props.update(input_schema.get("properties", {}))
    return {"type": "object", "properties": props, "required": input_schema.get("required", [])}


server = Server("optonto-api")


async def _api_get(path: str, timeout: int = 15) -> dict | list:
    """Helper: GET from FastAPI backend."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(f"{API_BASE}{path}")
        if resp.status_code >= 400:
            return {"error": True, "detail": resp.text}
        return resp.json()


# ─── 本体函数工具（动态注册：函数名即工具名，schema = ontology_id + 展开参数）────────
# 替代原 executeOntoFunction 黑盒包装——本体函数与公共函数同形，参数在工具 schema 可见。
ONTO_MARKET_DIR = Path("/app/.data/onto_market")

# mtime 指纹缓存：函数清单只依赖各 ontology.yaml 的 functions 段与本体清单（meta.json），
# 与 OntologyGateway / services.load_ontology_data 的 mtime 失效语义一致——无 TTL 陈旧窗口，
# 文件一改下次 list_tools 即生效，没变则永不重拉。
_FUNCTION_CACHE: dict = {"fingerprint": None, "tools": [], "names": set()}


def _functions_fingerprint() -> tuple[int, int]:
    """(文件数, 最大 mtime_ns)。仅 stat 不走解析，代价远小于全量拉取。

    覆盖新增/删除（文件数变化）与编辑（mtime 变化）；函数 .py 代码文件不影响
    工具清单（name/desc/params 都在 ontology.yaml），有意不纳入，避免代码-only
    保存触发无谓重拉。
    """
    count, latest = 0, -1
    if ONTO_MARKET_DIR.exists():
        for p in ONTO_MARKET_DIR.rglob("*"):
            if p.is_file() and p.name in ("ontology.yaml", "meta.json"):
                count += 1
                m = p.stat().st_mtime_ns
                if m > latest:
                    latest = m
    return count, latest


async def _load_function_tools(force: bool = False) -> list[Tool]:
    """从后端聚合端点拉取所有本体函数并转成 Tool（mtime 指纹缓存）。"""
    fingerprint = _functions_fingerprint()
    if not force and _FUNCTION_CACHE["fingerprint"] is not None and _FUNCTION_CACHE["fingerprint"] == fingerprint:
        return _FUNCTION_CACHE["tools"]
    try:
        data = await _api_get("/api/ontologies/functions/all")
        if isinstance(data, dict) and data.get("error"):
            data = []
        tools: list[Tool] = []
        names: set[str] = set()
        for fn in data or []:
            if not isinstance(fn, dict) or not fn.get("name"):
                continue
            name = fn["name"]
            desc_parts = [p for p in (fn.get("display_name"), fn.get("description")) if p]
            desc = "：".join(desc_parts) if desc_parts else name
            oname = fn.get("ontology_name")
            if oname:
                desc = f"{desc}（本体「{oname}」）"
            tools.append(Tool(
                name=name,
                description=desc,
                inputSchema=_with_function_scope(fn.get("inputSchema", {"type": "object", "properties": {}}), fn),
            ))
            names.add(name)
        _FUNCTION_CACHE.update(fingerprint=fingerprint, tools=tools, names=names)
    except Exception:
        pass  # 拉取失败保留旧缓存；首次失败则沿用空列表
    return _FUNCTION_CACHE["tools"]


async def _list_tools() -> list[Tool]:
    function_tools = await _load_function_tools()
    common_tools, _ = _get_common_tools()
    return common_tools + [
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
            description="列出指定本体的行为。返回行为的 name、display_name、description、params（输入参数结构）、response（返回结构）、rules（该行为关联的规则：name、display_name、position 介入位置、description）。",
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
            description="列出指定本体的函数以及对应的输入输出结构。返回函数的 name、display_name、description、params（输入）、response（返回的）。",
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
            name="listOntoProcesses",
            description="列出指定本体的业务流程。返回流程的 name、display_name、goal（流程目标）、description、steps（流程步骤：current_action 当前动作、previous_action 上一动作、description 步骤描述、connection_type 衔接类型）。",
            inputSchema={
                "type": "object",
                "properties": {
                    "ontology_id": {"type": "integer", "description": "本体 ID"},
                    "keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配流程名称或展示名称"},
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
    ] + function_tools


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
    # 确保本体函数工具名缓存已加载（MCP 协议先 list_tools 后 call_tool，此处兜底直连场景）
    await _load_function_tools()

    if name == "listScenarios":
        data = await _api_get("/api/scenarios")
        result = await _filter_list(data, arguments.get("keyword"), ["name"])

    elif name == "listOntologies":
        data = await _api_get("/api/ontologies")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "scenario_name"])

    elif name == "listOntoBehaviors":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/behaviors")
        # 附带每个行为关联的规则（名称/展示名称/介入位置/描述）：规则经 related_behaviors 反向挂到行为上
        rules = await _api_get(f"/api/ontologies/{oid}/rules")
        if isinstance(data, list) and isinstance(rules, list):
            for b in data:
                b["rules"] = [
                    {"name": r.get("name"), "display_name": r.get("display_name"),
                     "position": r.get("position"), "description": r.get("description")}
                    for r in rules
                    if isinstance(r, dict) and b.get("name") in (r.get("related_behaviors") or [])
                ]
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

    elif name == "listOntoSecurities":
        result = await _api_get(f"/api/ontologies/{arguments['ontology_id']}/securities")

    elif name == "listOntoProcesses":
        oid = arguments["ontology_id"]
        data = await _api_get(f"/api/ontologies/{oid}/processes")
        result = await _filter_list(data, arguments.get("keyword"), ["name", "display_name"])

    elif name == "executeOntoBehavior":
        oid = arguments["ontology_id"]
        bname = arguments["behavior_name"]
        params = arguments.get("params", {})
        body = {"params": params}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}/api/ontologies/{oid}/behaviors/{bname}/call",
                json=body,
            )
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                except Exception:
                    err = {"detail": resp.text}
                # 同 executeOntoFunction：执行失败必须置 isError，交由 agent 判定失败
                raise RuntimeError(f"行为 {bname} 执行失败 (HTTP {resp.status_code}): {json.dumps(err, ensure_ascii=False)[:2000]}")
            result = resp.json()

    # ─── Common function execution (proxied to backend) ────────────────
    _, common_names = _get_common_tools()
    if result is None and name in common_names:
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
                # 与 executeOntoBehavior/Function 一致：失败必须置 isError（抛异常），
                # 而非返回 {"error": true} 文本——否则 agent 侧把失败当成功文本，成败全靠 LLM 读 JSON。
                raise RuntimeError(f"公共函数 {name} 执行失败 (HTTP {resp.status_code}): {json.dumps(err, ensure_ascii=False)[:2000]}")
            result = resp.json()

    # ─── 本体函数执行（一等工具，函数名即工具名；ontology_id 由 schema 必填，子 Agent 由 scopeToOntology 注入）────────
    if result is None and name in _FUNCTION_CACHE["names"]:
        oid = arguments.get("ontology_id")
        if oid is None:
            raise ValueError(f"函数 {name} 缺少 ontology_id")
        # scope 是规划元数据（非函数输入），剥离后再转发后端；ontology_id 亦剥离（仅路由用）
        params = {k: v for k, v in arguments.items() if k not in FUNCTION_SCOPE_KEYS and k != "ontology_id"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}/api/ontologies/{oid}/functions/{name}/execute",
                json={"params": params},
            )
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                except Exception:
                    err = {"detail": resp.text}
                raise RuntimeError(f"函数 {name} 执行失败 (HTTP {resp.status_code}): {json.dumps(err, ensure_ascii=False)[:2000]}")
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
