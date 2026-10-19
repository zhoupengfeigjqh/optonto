"""optonto-ontology-query-mcp — 本体查询 MCP 服务（**平台内置对外工具面之一**，另一个是公共函数 MCP 服务）。

职责：回答「本体里有什么」——本体语义查询八件套（``list*`` 系列，含 6 个 ``listOnto*``）：
概念、关系、函数清单、行为清单、流程、安全配置、场景与本体花名册。全部**只读**、无副作用。

**不承担执行职责**（2026-10-04 拆分）：

- 本体函数与公共函数的**执行唯一实现**已独立为 ``ontology-function-executor``（零工具，仅内网）；
- 本体行为的**执行唯一实现**是 ``data-engine-executor``（2026-10-19 起同样零工具，仅内网 REST）；
- 对外提供"可执行能力"只有一条路：自建发布（``mcp-publish`` 动态容器，带令牌）。
- 因此 ``listOntoBehaviors`` 按「**已就绪 ∩ 已发布**」过滤（见 ``publish_registry``）：
  已映射但没有挂载点的行为不可规划，列出来只会诱导父 Agent 规划一个挂不上的行为。

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
from mcp_app import build_mcp_app
from publish_registry import published_behavior_names
from tool_contract import (
    CATEGORY_QUERY, build_query_schema, ready_behavior_names,
    require_ontology_id, with_category,
)

logger = logging.getLogger(__name__)

server = Server("optonto-ontology-query-mcp")


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
    """发布面 = 本体语义查询八件套（本体函数/公共函数已移交自建发布，见模块 docstring）。"""
    return list(_QUERY_TOOLS)


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
    """MCP 工具面 = 查询八件套（与 _list_tools 严格一致：未发布的工具不可经 MCP 调用）。"""
    result = None

    if name == "listScenarios":
        result = _filter_list(data_store.list_scenarios(), arguments.get("keyword"), ["name"])

    elif name == "listOntologies":
        result = _filter_list(data_store.list_all_ontologies(), arguments.get("keyword"), ["name", "scenario_name"])

    elif name == "listOntoBehaviors":
        data = _ontology_of(name, arguments)
        # 契约 ⑥ 的**查询面**同口径：只列「已就绪 ∩ 已发布」的行为。
        # 2026-10-19 方案 B：行为工具唯一来源是自建发布，已就绪 ≠ 可执行——没有挂载点的行为
        # 列出来只会诱导父 Agent 规划一个挂不上的行为（规划闸会拒，白费一轮）。
        # 查看未就绪/未发布行为请走设计器 / core API（设计期花名册视角，不经本工具）。
        ready = ready_behavior_names(data)
        published = published_behavior_names((data.get("metadata") or {}).get("ontology_id"))
        behaviors = [dict(b) for b in data.get("behaviors") or []
                     if isinstance(b, dict) and b.get("name") in ready and b.get("name") in published]
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

    if result is None:
        raise ValueError(f"未知工具: {name}")

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


starlette_app = build_mcp_app(server, _list_tools, "optonto-ontology-query-mcp")
