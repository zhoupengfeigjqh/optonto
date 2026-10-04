"""optonto-ontology-function-executor — 本体函数执行服务（零工具·不对外提供 MCP 工具）。

职责：**本体函数执行的唯一实现**（公共函数执行已于 2026-10-04 迁至
``optonto-common-function-mcp``——公共函数是平台级能力、对外发布，故其发布与执行合体自包含）。
本地执行本体函数代码（function_runner：exec 受限 globals + 调用约定的 run(params)），
返回值归一为统一信封 {success, data, error}。

为什么独立成一个服务（2026-10-04 拆分自本体 MCP 服务）：
- 「回答本体里有什么」（查询）与「把函数算出来」（执行）是两种职责，发布面与执行面必须分开；
- 本服务不挂任何 MCP 协议端点（transport="none"）——不对外提供工具是结构性保证，
  外部客户端误连直接 404，而不是"连上了但没有工具"；
- 本体函数**有本体归属**，对外暴露需按本体切片 + 令牌（自建发布的职责），故本服务不对外；
  公共函数无归属、直接对外发布，故走「对外服务自包含」那一侧（见 common-function-mcp）。

归属一致性（契约 ④）：函数名是裸名（不带本体前缀），故执行前必须校验「函数真正所属本体
== 请求里的 ontology_id」，不等即拒——否则同名函数会被静默路由到错误本体。
（公共函数无归属概念，**不做**此校验——两侧不可混用同一套校验逻辑。）

直读 .data（data_store，mtime 指纹热加载），运行期零回调 core-backend。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8006
Docker：build context = 仓库根（需 COPY mcp-shared）。
"""

import logging
import sys
from pathlib import Path

for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import data_store
from function_runner import run_function_code
from mcp_app import TRANSPORT_NONE, build_mcp_app
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from tool_contract import owner_label, require_ontology_id, require_ontology_match, strip_system_params

logger = logging.getLogger(__name__)

_FUNCTION_INDEX: dict = {"fingerprint": None, "owners": {}}


def _load_function_index(force: bool = False) -> dict:
    """函数名 → 归属本体（ontology_id + 场景/本体名），mtime 指纹缓存。

    跨本体重名（函数名本应全局唯一，由设计期 core 保证）：记 ERROR 并保留先出现者——
    归属索引必须唯一，否则会用错误归属拒掉正确调用。由设计侧改名解决。
    """
    fingerprint = data_store.ontology_market_fingerprint()
    if not force and _FUNCTION_INDEX["fingerprint"] == fingerprint:
        return _FUNCTION_INDEX["owners"]
    owners: dict[str, dict] = {}
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
                logger.error("函数名跨本体重名：%s 已归属 ontology_id=%s，ontology_id=%s 的同名函数按先出现者归属（请改名）",
                             fn["name"], owners[fn["name"]]["ontology_id"], oid)
                continue
            owners[fn["name"]] = {"ontology_id": oid, "scenario_name": sc_name, "ontology_name": on_name}
    _FUNCTION_INDEX.update(fingerprint=fingerprint, owners=owners)
    return owners


def _function_owners() -> dict:
    """函数名 → 归属本体：归属一致性校验（契约 ④）的数据源。复用索引缓存，不额外扫盘。"""
    return _load_function_index()


def _load_ontology_or_error(ontology_id: int):
    try:
        return data_store.load_ontology_data_by_id(ontology_id)
    except KeyError:
        raise ValueError("本体不存在: ontology_id=%s" % ontology_id)

# ─── 执行端点（唯一实现；core 设计器测试与自建发布-函数共用）──────────────────────

async def _handle_execute_function(request: Request) -> JSONResponse:
    """POST /execute-function {ontology_id, function_name, params} — 本体函数执行（ontology_id 必填）。"""
    body = await request.json()
    fname = body.get("function_name")
    try:
        oid = require_ontology_id(body.get("ontology_id"), "函数 %s" % fname)
        # 归属一致性（契约 ④）：调用方指定的本体必须是该函数真正所属的本体
        owner = _function_owners().get(fname)
        require_ontology_match((owner or {}).get("ontology_id"), oid, "函数 %s" % fname, owner_label(owner))
        data, sc_name, on_name = _load_ontology_or_error(int(oid))
        fn = next((g for g in data.get("functions") or [] if isinstance(g, dict) and g.get("name") == fname), None)
        if fn is None:
            return JSONResponse({"detail": "函数不存在"}, status_code=404)
        code_path = data_store.ontology_function_code_path(sc_name, on_name, fname)
        if not code_path.exists():
            return JSONResponse({"detail": "函数代码文件不存在，请先编写或生成代码"}, status_code=400)
        # 系统参数剥离：scope/ontology_id 不是业务入参（与工具面同口径）
        return JSONResponse(run_function_code(code_path.read_text(encoding="utf-8"),
                                              strip_system_params(body.get("params"))))
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": "执行失败: %s" % str(e)}, status_code=500)


# ─── 自检端点（零工具服务也要能回答"我这儿有哪些函数"）──────────────────────────

async def _handle_list_functions(request: Request) -> JSONResponse:
    """GET /functions — 函数清单（含归属），供管控面与排障使用。**不是 MCP 工具**，是运维视图。"""
    return JSONResponse({
        "server": "optonto-ontology-function-executor",
        "functions": [
            {"name": name, "ontology_id": owner.get("ontology_id"),
             "ontology_name": owner.get("ontology_name"), "scenario_name": owner.get("scenario_name")}
            for name, owner in sorted(_function_owners().items())
        ],
    })


async def _list_tools() -> list:
    """零工具：本服务不通过 MCP 协议暴露任何工具（/tools 恒为空）。"""
    return []


starlette_app = build_mcp_app(
    None, _list_tools, "optonto-ontology-function-executor",
    transport=TRANSPORT_NONE,
    extra_routes=[
        Route("/execute-function", endpoint=_handle_execute_function, methods=["POST"]),
        Route("/functions", endpoint=_handle_list_functions, methods=["GET"]),
    ],
)