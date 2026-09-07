"""optonto-ontology-mcp — 本体语义面 MCP 服务（SSE）。

职责：本体 list* 查询、本体函数、公共函数（本地沙箱执行）。
直读 .data（mcp_shared.loaders，mtime 指纹热加载），运行期零回调 core-backend。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8002
Docker：build context = 仓库根（需 COPY mcp-shared/mcp_shared）。
"""

import json
import sys
from pathlib import Path

# 本地直跑兜底：Docker 镜像内 mcp_shared 已在 /app 下可直接 import
for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from mcp.server import Server
from mcp.types import TextContent, Tool

from mcp_shared import loaders
from mcp_shared.mcp_base import build_sse_app
from mcp_shared.sandbox import run_function_code
from mcp_shared.schema_compile import (
    FUNCTION_SCOPE_KEYS, params_to_input_schema, related_concepts, with_function_scope,
)

server = Server("optonto-ontology-mcp")


# ─── 公共函数工具（mtime 缓存：文件一变下次 list_tools 即生效）────────────────────

_COMMON_CACHE: dict = {"mtime": None, "tools": [], "names": set()}


def _get_common_tools() -> tuple[list[Tool], set[str]]:
    """inputSchema 注入 x-category/x-display_name 发布方标记（JSON Schema 扩展键，协议透传）：
    agent-backend 据此分类，display_name 结构化可得。"""
    mtime = loaders.common_manifest_mtime()
    if _COMMON_CACHE["mtime"] == mtime:
        return _COMMON_CACHE["tools"], _COMMON_CACHE["names"]
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
        for entry in loaders.load_common_function_entries()
        if isinstance(entry, dict) and entry.get("name")
    ]
    _COMMON_CACHE.update(mtime=mtime, tools=tools, names={t.name for t in tools})
    return tools, _COMMON_CACHE["names"]


# ─── 本体函数工具（动态注册：函数名即工具名，schema = ontology_id + 展开参数含约束）────

_FUNCTION_CACHE: dict = {"fingerprint": None, "tools": [], "names": set()}


def _load_function_tools(force: bool = False) -> list[Tool]:
    """直读 .data 聚合所有本体函数并转成 Tool（mtime 指纹缓存，与 core 聚合端点同口径）。"""
    fingerprint = loaders.ontology_fingerprint()
    if not force and _FUNCTION_CACHE["fingerprint"] is not None and _FUNCTION_CACHE["fingerprint"] == fingerprint:
        return _FUNCTION_CACHE["tools"]
    tools: list[Tool] = []
    names: set[str] = set()
    for onto in loaders.list_all_ontologies():
        oid = onto.get("id")
        sc_name, on_name = onto.get("scenario_name"), onto.get("ontology_name")
        if oid is None or not sc_name or not on_name:
            continue
        try:
            data = loaders.load_ontology_data(sc_name, on_name)
        except Exception:
            continue
        for fn in data.get("functions") or []:
            if not isinstance(fn, dict) or not fn.get("name"):
                continue
            schema, _conflicts = params_to_input_schema(
                fn.get("params"), related_concepts(data, fn.get("related_concepts")))
            desc_parts = [p for p in (fn.get("display_name"), fn.get("description")) if p]
            desc = "：".join(desc_parts) if desc_parts else fn["name"]
            desc = f"{desc}（本体「{on_name}」）"
            item = {**fn, "ontology_id": oid, "ontology_name": on_name,
                    "scenario_id": onto.get("scenario_id"), "scenario_name": sc_name}
            tools.append(Tool(
                name=fn["name"],
                description=desc,
                inputSchema=with_function_scope(schema, item),
            ))
            names.add(fn["name"])
    _FUNCTION_CACHE.update(fingerprint=fingerprint, tools=tools, names=names)
    return tools


_FIXED_TOOLS = [
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
        description="列出指定本体的行为安全管控配置（全行为花名册）。返回每行为的 action_name（行为名称）、display_name（展示名称）、op_type（操作类型 command/query）、scope（权限范围：everyone 所有用户 / disable 全部禁用 / 用户或组织列表）、confirm（执行前是否需人工确认）、confirm_content（确认弹窗提示文案）。",
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
]


async def _list_tools() -> list[Tool]:
    function_tools = _load_function_tools()
    common_tools, _ = _get_common_tools()
    return common_tools + _FIXED_TOOLS + function_tools


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


def _filter_list(data, keyword: str | None, fields: list[str]):
    """Filter a list of dicts by keyword across given fields."""
    if keyword is None or not isinstance(data, list):
        return data
    kw = keyword.lower()
    matched = [item for item in data if any(kw in str(item.get(f, "")).lower() for f in fields)]
    return matched if matched else {"message": f"未找到包含关键词 '{keyword}' 的结果", "results": []}


def _ontology_or_error(ontology_id: int) -> dict:
    data, _sc, _on = _load_ontology_or_error(ontology_id)
    return data


def _load_ontology_or_error(ontology_id: int) -> tuple[dict, str, str]:
    try:
        return loaders.load_ontology_data_by_id(ontology_id)
    except KeyError:
        raise ValueError(f"本体不存在: ontology_id={ontology_id}")


def _strip_scope(arguments: dict) -> dict:
    """scope 是规划元数据（非输入参数），剥离；ontology_id 仅路由用，亦剥离。"""
    return {k: v for k, v in arguments.items() if k not in FUNCTION_SCOPE_KEYS and k != "ontology_id"}


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    result = None
    # 确保本体函数缓存已加载（MCP 协议先 list_tools 后 call_tool，此处兜底直连场景）
    _load_function_tools()

    if name == "listScenarios":
        result = _filter_list(loaders.list_scenarios(), arguments.get("keyword"), ["name"])

    elif name == "listOntologies":
        result = _filter_list(loaders.list_all_ontologies(), arguments.get("keyword"), ["name", "scenario_name"])

    elif name == "listOntoBehaviors":
        data = _ontology_or_error(arguments["ontology_id"])
        behaviors = [dict(b) for b in data.get("behaviors") or [] if isinstance(b, dict)]
        # 附带每个行为关联的规则：规则经 related_behaviors 反向挂到行为上
        rules = data.get("rules") or []
        for b in behaviors:
            b["rules"] = [
                {"name": r.get("name"), "display_name": r.get("display_name"),
                 "position": r.get("position"), "description": r.get("description")}
                for r in rules
                if isinstance(r, dict) and b.get("name") in (r.get("related_behaviors") or [])
            ]
        result = _filter_list(behaviors, arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoConcepts":
        data = _ontology_or_error(arguments["ontology_id"])
        concepts = data.get("concepts") or []
        cname = arguments.get("concept_name")
        if cname:
            matched = [c for c in concepts if isinstance(c, dict) and c.get("name") == cname]
            if matched:
                result = matched[0].get("attributes", [])
            else:
                result = {"error": True, "message": f"概念 '{cname}' 不存在"}
        else:
            result = _filter_list(concepts, arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoRelations":
        data = _ontology_or_error(arguments["ontology_id"])
        relations = data.get("relations") or []
        cname = arguments.get("concept_name")
        if cname:
            result = [r for r in relations if isinstance(r, dict) and (r.get("source") == cname or r.get("target") == cname)]
        else:
            result = relations

    elif name == "listOntoFunctions":
        data = _ontology_or_error(arguments["ontology_id"])
        result = _filter_list(data.get("functions") or [], arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoSecurities":
        data = _ontology_or_error(arguments["ontology_id"])
        result = data.get("securities") or []

    elif name == "listOntoProcesses":
        data = _ontology_or_error(arguments["ontology_id"])
        result = _filter_list(data.get("processes") or [], arguments.get("keyword"), ["name", "display_name"])

    # ─── 公共函数执行（本地沙箱）────────────────────────────────────
    _, common_names = _get_common_tools()
    if result is None and name in common_names:
        code_path = loaders.common_function_code_path(name)
        if not code_path.exists():
            raise ValueError(f"公共函数代码文件不存在: {name}")
        try:
            result = run_function_code(code_path.read_text(encoding="utf-8"), arguments)
        except Exception as e:
            # 失败必须抛异常置 isError，而非返回 {"error": true} 文本
            raise RuntimeError(f"公共函数 {name} 执行失败: {str(e)}")

    # ─── 本体函数执行（本地沙箱；ontology_id 由 schema 必填，子 Agent 由 scopeToOntology 注入）──
    if result is None and name in _FUNCTION_CACHE["names"]:
        oid = arguments.get("ontology_id")
        if oid is None:
            raise ValueError(f"函数 {name} 缺少 ontology_id")
        data, sc_name, on_name = _load_ontology_or_error(oid)
        fn = next((g for g in data.get("functions") or [] if isinstance(g, dict) and g.get("name") == name), None)
        if fn is None:
            raise ValueError(f"函数 {name} 不存在于本体 ontology_id={oid}")
        code_path = loaders.ontology_function_code_path(sc_name, on_name, name)
        if not code_path.exists():
            raise ValueError(f"函数 {name} 代码文件不存在，请先编写或生成代码")
        try:
            result = run_function_code(code_path.read_text(encoding="utf-8"), _strip_scope(arguments))
        except Exception as e:
            raise RuntimeError(f"函数 {name} 执行失败: {str(e)}")

    if result is None:
        raise ValueError(f"未知工具: {name}")

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


# ─── 设计期转发入口（core 的函数 execute 端点降级转发到这里，与设计器同一路径）────

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


async def _handle_execute_function(request: Request) -> JSONResponse:
    """POST /execute-function {ontology_id, function_name, params} — core 本体函数执行转发。"""
    body = await request.json()
    oid = body.get("ontology_id")
    fname = body.get("function_name")
    try:
        data, sc_name, on_name = _load_ontology_or_error(int(oid))
        fn = next((g for g in data.get("functions") or [] if isinstance(g, dict) and g.get("name") == fname), None)
        if fn is None:
            return JSONResponse({"detail": "函数不存在"}, status_code=404)
        code_path = loaders.ontology_function_code_path(sc_name, on_name, fname)
        if not code_path.exists():
            return JSONResponse({"detail": "函数代码文件不存在，请先编写或生成代码"}, status_code=400)
        return JSONResponse(run_function_code(code_path.read_text(encoding="utf-8"), body.get("params") or {}))
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": f"执行失败: {str(e)}"}, status_code=500)


async def _handle_execute_common_function(request: Request) -> JSONResponse:
    """POST /execute-common-function {function_name, params} — core 公共函数执行转发。"""
    body = await request.json()
    fname = body.get("function_name")
    code_path = loaders.common_function_code_path(fname or "")
    if not code_path.exists():
        return JSONResponse({"detail": "函数代码文件不存在"}, status_code=404)
    try:
        return JSONResponse(run_function_code(code_path.read_text(encoding="utf-8"), body.get("params") or {}))
    except Exception as e:
        return JSONResponse({"detail": f"公共函数执行失败: {str(e)}"}, status_code=500)


starlette_app = build_sse_app(
    server, _list_tools, "optonto-ontology-mcp",
    extra_routes=[
        Route("/execute-function", endpoint=_handle_execute_function, methods=["POST"]),
        Route("/execute-common-function", endpoint=_handle_execute_common_function, methods=["POST"]),
    ],
)
