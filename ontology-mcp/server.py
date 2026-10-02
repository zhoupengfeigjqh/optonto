"""optonto-ontology-mcp — 本体语义面 MCP 服务（SSE）。

职责：本体 list* 查询、本体函数、公共函数（本地 function_runner 执行）。
直读 .data（data_store，mtime 指纹热加载），运行期零回调 core-backend。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8002
Docker：build context = 仓库根（需 COPY mcp-shared）。
"""

import json
import logging
import sys
from pathlib import Path

# 本地直跑兜底：Docker 镜像内 mcp-shared 的模块已在 /app 顶层可直接 import
for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from mcp.server import Server
from mcp.types import TextContent, Tool

import data_store
from function_runner import run_function_code
from mcp_app import build_mcp_app
from tool_contract import (
    CATEGORY_COMMON, CATEGORY_FUNCTION, CATEGORY_QUERY, build_query_schema,
    owner_label, params_to_input_schema, ready_behavior_names, related_concepts,
    require_ontology_id, require_ontology_match, strip_system_params,
    with_category, with_ontology_context,
)

logger = logging.getLogger(__name__)

server = Server("optonto-ontology-mcp")

# 统一返回信封说明（追加到所有函数工具 description 尾部；response 声明描述的是 data 内容）
_ENVELOPE_NOTE = (
    "。返回为统一信封 {\"success\": bool, \"data\": 业务数据, \"error\": 业务失败信息}；"
    "类型为 VALIDATION（逻辑验证）的函数在 data 内另返回 pass（bool）/reason（str）——被规则引用时作为判断函数参与真阻断"
)


# ─── 公共函数工具（指纹缓存：文件一变下次 list_tools 即生效）───────────────────────

_COMMON_CACHE: dict = {"fingerprint": None, "tools": [], "names": set()}


def _load_common_tools() -> tuple[list[Tool], set[str]]:
    """公共函数工具（全局：无 ontology_id、无 scope）：分类标记由 with_category 统一注入。"""
    fingerprint = data_store.common_manifest_mtime()
    if _COMMON_CACHE["fingerprint"] == fingerprint:
        return _COMMON_CACHE["tools"], _COMMON_CACHE["names"]
    tools = [
        Tool(
            name=entry["name"],
            description=entry.get("description", "") + _ENVELOPE_NOTE,
            inputSchema=with_category(
                entry.get("inputSchema", {"type": "object", "properties": {}}),
                CATEGORY_COMMON, entry.get("display_name", "")),
        )
        for entry in data_store.load_common_function_entries()
        if isinstance(entry, dict) and entry.get("name")
    ]
    _COMMON_CACHE.update(fingerprint=fingerprint, tools=tools, names={t.name for t in tools})
    return tools, _COMMON_CACHE["names"]


# ─── 本体函数工具（动态注册：函数名即工具名，schema = ontology_id + 展开参数含约束）────

_FUNCTION_CACHE: dict = {"fingerprint": None, "tools": [], "names": set(), "owners": {}}


def _load_function_tools(force: bool = False) -> list[Tool]:
    """直读 .data 聚合所有本体函数并转成 Tool（mtime 指纹缓存，与 core 聚合端点同口径）。"""
    fingerprint = data_store.ontology_market_fingerprint()
    if not force and _FUNCTION_CACHE["fingerprint"] is not None and _FUNCTION_CACHE["fingerprint"] == fingerprint:
        return _FUNCTION_CACHE["tools"]
    tools: list[Tool] = []
    names: set[str] = set()
    owners: dict[str, dict] = {}  # 工具名 → 发布方归属（本体 id + 场景/本体名），归属校验的数据源
    for onto in data_store.list_all_ontologies():
        oid = onto.get("id")
        sc_name, on_name = onto.get("scenario_name"), onto.get("ontology_name")
        if oid is None or not sc_name or not on_name:
            continue
        try:
            data = data_store.load_ontology_data(sc_name, on_name)
        except Exception:
            continue
        for fn in data.get("functions") or []:
            if not isinstance(fn, dict) or not fn.get("name"):
                continue
            if fn["name"] in owners:
                # 跨本体重名（函数名本应全局唯一：设计期 core 的 _ensure_global_unique 保证）：
                # 与 behavior_tools 同口径——记错误并**保留先出现者**，保证 owners 唯一、归属校验不误拒；
                # 由设计侧改名解决（工具名不带本体前缀，同名在工具名维度无法共存）。
                logger.error("函数工具名跨本体重名：%s 已由 ontology_id=%s 注册，"
                             "ontology_id=%s 的同名函数未注册（请改名）",
                             fn["name"], owners[fn["name"]]["ontology_id"], oid)
                continue
            schema, conflicts = params_to_input_schema(
                fn.get("params"), related_concepts(data, fn.get("related_concepts")))
            if conflicts:
                # 冲突是"同名属性约束不一致、已取先扫到的"——必须留痕，否则约束静默劣化无从发现
                logger.warning("函数 %s 的属性约束冲突（已取先扫到的）: %s", fn["name"], "；".join(conflicts))
            desc_parts = [p for p in (fn.get("display_name"), fn.get("description")) if p]
            desc = "：".join(desc_parts) if desc_parts else fn["name"]
            desc = f"{desc}（本体「{on_name}」）" + _ENVELOPE_NOTE
            item = {**fn, "ontology_id": oid, "ontology_name": on_name,
                    "scenario_id": onto.get("scenario_id"), "scenario_name": sc_name}
            tools.append(Tool(
                name=fn["name"],
                description=desc,
                inputSchema=with_ontology_context(schema, item, CATEGORY_FUNCTION),
            ))
            names.add(fn["name"])
            owners[fn["name"]] = {"ontology_id": oid, "scenario_name": sc_name, "ontology_name": on_name}
    _FUNCTION_CACHE.update(fingerprint=fingerprint, tools=tools, names=names, owners=owners)
    return tools


def _function_owners() -> dict:
    """工具名 → 发布方归属（本体 id + 场景/本体名）：归属一致性校验（契约 ④）的数据源。

    复用工具缓存（同一次 mtime 指纹加载），不额外扫盘。
    """
    _load_function_tools()
    return _FUNCTION_CACHE["owners"]


# ─── 本体查询工具（父 Agent 专用；x-category=本体查询，不进子任务可规划清单）──────────
# 表驱动：工具名 → (description, 过滤参数, 中文名, 是否针对某本体)。ontology_id 由
# build_query_schema 统一前置为必填；全局花名册（listScenarios / listOntologies）不针对某本体
# → requires_ontology=False（该两类是「本体查询」类里唯一不带 ontology_id 的工具，契约矩阵见
# mcp-shared/tool_contract.py 模块 docstring）。
_QUERY_TOOL_SPECS: list[tuple[str, str, dict, str, bool]] = [
    ("listScenarios",
     "列出所有场景。返回每个场景的 id、name和description等。",
     {"keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配场景名称"}},
     "查询场景清单", False),
    ("listOntologies",
     "列出所有本体。返回每个本体的 id（ontology_id）、name、description、scenario_name、ontology_name和deployed_version（当前已部署版本）等",
     {"keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配本体名称或场景名称"}},
     "查询本体清单", False),
    ("listOntoBehaviors",
     "列出指定本体的**已就绪行为**（已完成数据引擎映射、可实际执行；未就绪的行为不在此列，需在设计器中完成映射）。返回行为的 name、display_name、description、params（输入参数结构）、response（返回结构）、rules（该行为关联的规则：name、display_name、position 介入位置、description）。",
     {"keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配行为名称或展示名称"}},
     "查询行为清单", True),
    ("listOntoConcepts",
     "列出指定本体的概念。返回概念的 name、display_name、description、attributes（属性列表）。传入 concept_name 则直接返回该概念的属性列表。",
     {"keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配概念名称"},
      "concept_name": {"type": "string", "description": "概念名称（可选），精确查找指定概念的属性"}},
     "查询概念清单", True),
    ("listOntoRelations",
     "列出指定本体的关系。返回关系的 name、source（源概念）、target（目标概念）、cardinality（基数）、description、display_name。传入 concept_name 则只返回该概念直接关联的关系。",
     {"concept_name": {"type": "string", "description": "概念名称（可选），仅返回与该概念相关的关系"}},
     "查询关系清单", True),
    ("listOntoFunctions",
     "列出指定本体的函数以及对应的输入输出结构。返回函数的 name、display_name、description、params（输入）、response（返回的）。",
     {"keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配函数名称或展示名称"}},
     "查询函数清单", True),
    ("listOntoSecurities",
     "列出指定本体的行为安全管控配置（全行为花名册）。返回每行为的 action_name（行为名称）、display_name（展示名称）、op_type（操作类型 command/query）、scope（权限范围：everyone 所有用户 / disable 全部禁用 / 用户或组织列表）、confirm（执行前是否需人工确认）、confirm_content（确认弹窗提示文案）。",
     {},
     "查询安全清单", True),
    ("listOntoProcesses",
     "列出指定本体的业务流程。返回流程的 name、display_name、goal（流程目标）、description、steps（流程步骤：current_action 当前动作、previous_action 上一动作、description 步骤描述、connection_type 衔接类型）。",
     {"keyword": {"type": "string", "description": "搜索关键词（可选），模糊匹配流程名称或展示名称"}},
     "查询流程清单", True),
]

_QUERY_TOOLS = [
    Tool(
        name=name,
        description=desc,
        inputSchema=with_category(
            build_query_schema(extra, requires_ontology=needs_ontology), CATEGORY_QUERY, label),
    )
    for name, desc, extra, label, needs_ontology in _QUERY_TOOL_SPECS
]


async def _list_tools() -> list[Tool]:
    function_tools = _load_function_tools()
    common_tools, _ = _load_common_tools()
    return common_tools + _QUERY_TOOLS + function_tools


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


def _not_found(message: str) -> dict:
    """「查不到」的统一返回形态（查询工具唯一口径）：调用方读 message，results 恒为空列表。

    区分两种"空"：集合本身为空 / 未加过滤条件 → 原样返回列表（可能为 []）；
    加了过滤条件但无匹配 → 本形态（带可读原因，避免 LLM 把"没匹配上"误读成"该本体没有"）。
    """
    return {"message": message, "results": []}


def _filter_list(data, keyword: str | None, fields: list[str]):
    """按关键词过滤 dict 列表；无匹配 → `_not_found` 形态（与"概念不存在"同一口径）。"""
    if keyword is None or not isinstance(data, list):
        return data
    kw = keyword.lower()
    matched = [item for item in data if any(kw in str(item.get(f, "")).lower() for f in fields)]
    return matched if matched else _not_found(f"未找到包含关键词 '{keyword}' 的结果")


def _load_ontology_or_error(ontology_id: int) -> tuple[dict, str, str]:
    try:
        return data_store.load_ontology_data_by_id(ontology_id)
    except KeyError:
        raise ValueError(f"本体不存在: ontology_id={ontology_id}")


def _ontology_of(name: str, arguments: dict) -> dict:
    """本体查询分支统一入口：ontology_id 必填（require_ontology_id）+ 本体加载（不存在即报错）。"""
    data, _sc, _on = _load_ontology_or_error(
        require_ontology_id(arguments.get("ontology_id"), f"工具 {name}"))
    return data


def _rule_behavior(rule: dict) -> str:
    """规则绑定行为（唯一）：新格式为标量 behavior；旧数据 related_behaviors 数组读时兼容取首个。"""
    behavior = rule.get("behavior")
    if behavior:
        return str(behavior)
    legacy = rule.get("related_behaviors")
    if isinstance(legacy, list):
        return str(legacy[0]) if legacy else ""
    return str(legacy or "")


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    result = None
    # 确保本体函数缓存已加载（MCP 协议先 list_tools 后 call_tool，此处兜底直连场景）
    _load_function_tools()

    if name == "listScenarios":
        result = _filter_list(data_store.list_scenarios(), arguments.get("keyword"), ["name"])

    elif name == "listOntologies":
        result = _filter_list(data_store.list_all_ontologies(), arguments.get("keyword"), ["name", "scenario_name"])

    elif name == "listOntoBehaviors":
        data = _ontology_of(name, arguments)
        # 契约 ⑥ 的**查询面**同口径：只列就绪（已映射、已发布为工具）的行为。
        # 未就绪者不可规划（发布面已剔除、规划闸也拒），列出来只会诱导父 Agent 规划一个挂不上的行为；
        # 查看未就绪行为请走设计器 / core API（设计期花名册视角，不经本工具）。
        ready = ready_behavior_names(data)
        behaviors = [dict(b) for b in data.get("behaviors") or []
                     if isinstance(b, dict) and b.get("name") in ready]
        # 附带每个行为关联的规则：规则经 绑定行为（behavior 标量；旧数据 related_behaviors 数组取首个）反向挂到行为上
        rules = data.get("rules") or []
        for b in behaviors:
            b["rules"] = [
                {"name": r.get("name"), "display_name": r.get("display_name"),
                 "position": r.get("position"), "description": r.get("description")}
                for r in rules
                if isinstance(r, dict) and _rule_behavior(r) == b.get("name")
            ]
        result = _filter_list(behaviors, arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoConcepts":
        data = _ontology_of(name, arguments)
        concepts = data.get("concepts") or []
        cname = arguments.get("concept_name")
        if cname:
            matched = [c for c in concepts if isinstance(c, dict) and c.get("name") == cname]
            if matched:
                result = matched[0].get("attributes", [])
            else:
                result = _not_found(f"概念 '{cname}' 不存在")
        else:
            result = _filter_list(concepts, arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoRelations":
        data = _ontology_of(name, arguments)
        relations = data.get("relations") or []
        cname = arguments.get("concept_name")
        if cname:
            # 「查不到」与「无关联」两种空都要给可读原因（LLM 才能区分是写错概念名还是该概念真没关系）
            known = any(isinstance(c, dict) and c.get("name") == cname for c in data.get("concepts") or [])
            matched = [r for r in relations
                       if isinstance(r, dict) and (r.get("source") == cname or r.get("target") == cname)]
            if not known:
                result = _not_found(f"概念 '{cname}' 不存在")
            else:
                result = matched if matched else _not_found(f"概念 '{cname}' 没有关联关系")
        else:
            result = relations

    elif name == "listOntoFunctions":
        data = _ontology_of(name, arguments)
        result = _filter_list(data.get("functions") or [], arguments.get("keyword"), ["name", "display_name"])

    elif name == "listOntoSecurities":
        data = _ontology_of(name, arguments)
        result = data.get("securities") or []

    elif name == "listOntoProcesses":
        data = _ontology_of(name, arguments)
        result = _filter_list(data.get("processes") or [], arguments.get("keyword"), ["name", "display_name"])

    # ─── 公共函数执行（本地沙箱）────────────────────────────────────
    _, common_names = _load_common_tools()
    if result is None and name in common_names:
        code_path = data_store.common_function_code_path(name)
        if not code_path.exists():
            raise ValueError(f"公共函数代码文件不存在: {name}")
        try:
            result = run_function_code(code_path.read_text(encoding="utf-8"),
                                       strip_system_params(arguments))
        except Exception as e:
            # 失败必须抛异常置 isError，而非返回 {"error": true} 文本
            raise RuntimeError(f"公共函数 {name} 执行失败: {str(e)}")

    # ─── 本体函数执行（本地沙箱；ontology_id 由 schema 必填，子 Agent 由 scopeToOntology 注入）──
    if result is None and name in _FUNCTION_CACHE["names"]:
        oid = require_ontology_id(arguments.get("ontology_id"), f"函数 {name}")
        # 归属一致性（契约 ④）：该函数发布时归属的本体必须等于调用方指定的本体。
        # 不等说明调用方（父 Agent 规划 / 外部客户端）把工具挂到了错误的本体上 → 报错指向病根。
        # 此刻缓存必已加载（上面的分支条件依据 _FUNCTION_CACHE["names"]），零额外扫盘。
        _owner = _FUNCTION_CACHE["owners"].get(name)
        require_ontology_match((_owner or {}).get("ontology_id"), oid, f"函数 {name}", owner_label(_owner))
        data, sc_name, on_name = _load_ontology_or_error(oid)
        fn = next((fn for fn in data.get("functions") or [] if isinstance(fn, dict) and fn.get("name") == name), None)
        if fn is None:
            raise ValueError(f"函数 {name} 不存在于本体 ontology_id={oid}")
        code_path = data_store.ontology_function_code_path(sc_name, on_name, name)
        if not code_path.exists():
            raise ValueError(f"函数 {name} 代码文件不存在，请先编写或生成代码")
        try:
            result = run_function_code(code_path.read_text(encoding="utf-8"),
                                       strip_system_params(arguments))
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
    """POST /execute-function {ontology_id, function_name, params} — core 本体函数执行转发（ontology_id 必填）。"""
    body = await request.json()
    fname = body.get("function_name")
    try:
        oid = require_ontology_id(body.get("ontology_id"), f"函数 {fname}")
        # 归属一致性（契约 ④）：与 MCP 入口同口径（设计期转发也走这条路径）
        _owner = _function_owners().get(fname)
        require_ontology_match((_owner or {}).get("ontology_id"), oid, f"函数 {fname}", owner_label(_owner))
        data, sc_name, on_name = _load_ontology_or_error(int(oid))
        fn = next((g for g in data.get("functions") or [] if isinstance(g, dict) and g.get("name") == fname), None)
        if fn is None:
            return JSONResponse({"detail": "函数不存在"}, status_code=404)
        code_path = data_store.ontology_function_code_path(sc_name, on_name, fname)
        if not code_path.exists():
            return JSONResponse({"detail": "函数代码文件不存在，请先编写或生成代码"}, status_code=400)
        # 系统参数剥离：与 MCP 入口同口径（scope/ontology_id 不进函数）
        return JSONResponse(run_function_code(code_path.read_text(encoding="utf-8"),
                                              strip_system_params(body.get("params"))))
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": f"执行失败: {str(e)}"}, status_code=500)


async def _handle_execute_common_function(request: Request) -> JSONResponse:
    """POST /execute-common-function {function_name, params} — core 公共函数执行转发。"""
    body = await request.json()
    fname = body.get("function_name")
    code_path = data_store.common_function_code_path(fname or "")
    if not code_path.exists():
        return JSONResponse({"detail": "函数代码文件不存在"}, status_code=404)
    try:
        # 系统参数剥离：与 MCP 入口同口径（防御性——公共函数 schema 本就无这些键，防外部多传污染）
        return JSONResponse(run_function_code(code_path.read_text(encoding="utf-8"),
                                              strip_system_params(body.get("params"))))
    except Exception as e:
        return JSONResponse({"detail": f"公共函数执行失败: {str(e)}"}, status_code=500)


starlette_app = build_mcp_app(
    server, _list_tools, "optonto-ontology-mcp",
    extra_routes=[
        Route("/execute-function", endpoint=_handle_execute_function, methods=["POST"]),
        Route("/execute-common-function", endpoint=_handle_execute_common_function, methods=["POST"]),
    ],
)
