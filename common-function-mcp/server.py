"""optonto-common-function-mcp — 公共函数 MCP 服务（**发布 + 执行一体，自包含**）。

公共函数是**平台级**的通用算力（日期处理 / 数据过滤 / 聚合 / 分组）：无本体归属、跨场景共享、
约定为纯计算（无副作用）。本服务把它们以 MCP 工具形态对外提供，并**在本服务内本地执行**。

**为什么发布与执行放同一个容器**（与本体函数的处理不同，这里是刻意的）：
公共函数的执行是「读一个十几行 .py 后内存 exec」，代价≈0、无外部依赖、无副作用。
此时把发布与执行拆开是过度设计——拆开就会出现「发布面声明了一套、执行实现是另一套」的风险面，
且每次 MCP 调用多一次网络往返。合体后：**发布什么就能执行什么，失败面只有一处**。

平台统一判定规则：
- **对外的服务自包含**（要对外提供的能力，自己就具备）→ 本服务、本体查询 MCP 服务；
- **不对外的服务是纯执行底座** → 本体函数执行服务、数据引擎执行服务。

─── 与本体函数的语义差别（本服务不套用本体那一套，勿混淆）────────────────────────

| 维度 | 本体函数 | 公共函数（本服务） |
|---|---|---|
| 归属 | 某个本体：ontology_id 必填 + 执行前归属一致性校验（契约 ④：函数名是裸名，跨本体会误路由） | 平台：无 ontology_id、**不做**归属校验 |
| 声明位置 | 本体 ontology.yaml 的 functions[].params | .data/common_functions/functions.json 的 manifest |
| 参数声明格式 | params 需**编译**（类型映射 + 按「参数名=属性名」回溯概念约束 + 必填非空） | manifest 的 inputSchema **已是 JSON Schema → 直接透传，零编译** |
| 唯一性 | 全局唯一（跨本体 + 跨公共函数，由 core 拦截重名） | manifest 内唯一 |
| 工具 schema | 带 scope 上下文块 + ontology_id const | **不带** scope、**不带** ontology_id |
| agent 侧分类 | 本体执行类（挂载期剥 scope、执行期注入 ontology_id） | 非本体执行类（isOntologyExec 为 false → 零适配） |
| 能否作规则判断函数 | 可（type=VALIDATION → 进 judge_functions → 进裁决闸） | 不可（无 type，只留痕不阻断） |

对外端点：
- /mcp（streamable HTTP）：发布 7 个公共函数工具
- POST /execute-common-function：core 设计器测试按钮经此调用（内网，与 MCP 面共用同一执行实现）
- /health、/tools、/functions：运维视图

直读 .data（data_store，manifest mtime 指纹热加载），运行期零回调 core-backend。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port 8007
Docker：build context = 仓库根（需 COPY mcp-shared）
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
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

import data_store
from function_runner import run_function_code
from mcp_app import build_mcp_app
from tool_contract import CATEGORY_COMMON, strip_system_params, with_category

logger = logging.getLogger(__name__)

# 统一返回信封说明（追加到每个公共函数工具 description 尾部）
_ENVELOPE_NOTE = "。返回为统一信封 {\"success\": bool, \"data\": 业务数据, \"error\": 业务失败信息}"
# ─── 发布面：公共函数工具（manifest 的 inputSchema 直接透传，零编译）───────────────

_COMMON_CACHE: dict = {"fingerprint": None, "tools": [], "names": set()}


def _load_common_tools() -> tuple[list[Tool], set[str]]:
    """公共函数工具（平台级：无 ontology_id、无 scope）。

    与本体函数的关键差异：**不做 schema 编译** —— manifest 里存的就是标准 JSON Schema
    （inputSchema 已含 properties/required），透传即可；本体函数那边需要从 params 编译
    并回溯概念属性约束。两者不可混用同一套编译逻辑。
    分类标记由 with_category 统一注入（x-category=公共函数），消费端据此识别。
    """
    fingerprint = data_store.common_manifest_mtime()
    if _COMMON_CACHE["fingerprint"] == fingerprint:
        return _COMMON_CACHE["tools"], _COMMON_CACHE["names"]
    tools: list[Tool] = []
    for entry in data_store.load_common_function_entries():
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = entry["name"]
        description = (entry.get("description") or name) + _ENVELOPE_NOTE
        tools.append(Tool(
            name=name,
            description=description,
            inputSchema=with_category(
                entry.get("inputSchema") or {"type": "object", "properties": {}},
                CATEGORY_COMMON, entry.get("display_name", "")),
        ))
    _COMMON_CACHE.update(
        fingerprint=fingerprint, tools=tools, names={t.name for t in tools})
    return tools, _COMMON_CACHE["names"]


async def _list_tools() -> list[Tool]:
    return list(_load_common_tools()[0])


# ─── 执行面：本地 exec（与发布面同一份代码路径，不存在「两套实现」）────────────────

def _run_common_function(name: str, arguments: dict) -> dict:
    """公共函数执行（唯一实现）：读 .py → 受限 globals exec → 调用 run(params)。

    系统参数剥离（防御性）：公共函数 schema 本就没有 scope/ontology_id，
    但外部调用方（agent 挂载、REST 直调）可能多传，剥掉以防污染函数入参。
    """
    _tools, names = _load_common_tools()
    if name not in names:
        raise ValueError("未知公共函数: %s（本服务仅提供 %d 个公共函数）" % (name, len(names)))
    code_path = data_store.common_function_code_path(name)
    if not code_path.exists():
        raise ValueError("公共函数代码文件不存在: %s" % name)
    return run_function_code(code_path.read_text(encoding="utf-8"),
                             strip_system_params(arguments))


server = Server("optonto-common-function-mcp")


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    """MCP 工具调用：本地执行。失败抛异常置 isError，交由调用方判定（不静默返回失败数据）。"""
    try:
        result = _run_common_function(name, arguments)
    except Exception as e:
        raise RuntimeError("公共函数 %s 执行失败: %s" % (name, str(e)))
    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


# ─── 内网执行端点（core 设计器测试按钮；与 MCP 面共用上面的同一执行实现）───────────

async def _handle_execute_common_function(request: Request) -> JSONResponse:
    """POST /execute-common-function {function_name, params} — 公共函数执行（无 ontology_id）。"""
    body = await request.json()
    fname = body.get("function_name")
    try:
        return JSONResponse(_run_common_function(fname or "", body.get("params") or {}))
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"detail": "公共函数执行失败: %s" % str(e)}, status_code=500)


async def _handle_list_functions(request: Request) -> JSONResponse:
    """GET /functions — 公共函数清单（运维视图，含代码文件是否存在）。"""
    _tools, names = _load_common_tools()
    return JSONResponse({
        "server": "optonto-common-function-mcp",
        "functions": [
            {
                "name": e.get("name"),
                "display_name": e.get("display_name", ""),
                "description": e.get("description", ""),
                "code_exists": data_store.common_function_code_path(e.get("name") or "").exists(),
            }
            for e in data_store.load_common_function_entries()
            if isinstance(e, dict) and e.get("name") in names
        ],
    })


starlette_app = build_mcp_app(
    server, _list_tools, "optonto-common-function-mcp",
    extra_routes=[
        Route("/execute-common-function", endpoint=_handle_execute_common_function, methods=["POST"]),
        Route("/functions", endpoint=_handle_list_functions, methods=["GET"]),
    ],
)