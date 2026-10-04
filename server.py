"""optonto-mcp-publish — 自建发布门面（**对外提供执行能力的唯一出口**）。

一个镜像、N 个实例：用户在「MCP发布 → 数据引擎」页勾选本体的函数或行为 → core 编译工具清单
并把配置经环境变量 ``PUBLISH_CONFIG_JSON`` 注入 → 本服务按 ``kind`` **转发**到对应执行底座：

- ``kind=function`` → ``ontology-function-executor:8006/execute-function``（本体函数执行唯一实现）
- ``kind=behavior`` → ``data-engine-executor:8005/call-behavior``（行为映射执行唯一实现）

**本服务不执行任何东西**：零挂载、不读 .data、不含执行实现——本体函数与本体行为的执行语义
各自只有一份（在上游执行底座），杜绝第二套执行路径。故镜像依赖极简、启动秒级。

**为什么需要这一层**：执行底座只在**内网**可达（不对外提供工具），"谁能调用哪些函数/行为"
由发布配置决定——发布即授权：自带端口、传输模式（sse / streamable）与访问令牌。

配置形态（由 core 的动态发布面生成，本服务只读不改）：
``{"name": 服务名, "kind": "function"|"behavior", "ontology_id": 1, "tools": [{name, description, inputSchema}]}``

``tools[].name`` 即转发目标（函数名/行为名裸名，与平台发布面同一命名口径）。工具 schema 由
core 用 mcp-shared/tool_contract 编译（``ontology_id_mode="const"``：绑定单一本体，调用方
无需传 ontology_id），故本服务运行期不再需要本体数据。

配置非法即**启动失败**（fail-fast，绝不静默起一个空服务）：core 侧会轮询 /health，
失败时把容器日志尾部回传给用户，而不是让用户面对一个"能连但没工具"的服务。

运行：python -m uvicorn server:starlette_app --host 0.0.0.0 --port $PORT
"""

import json
import logging
import os
import sys
from pathlib import Path

# 本地直跑兜底：Docker 镜像内 mcp-shared 的模块已在 /app 顶层可直接 import
for _p in (Path(__file__).resolve().parent.parent / "mcp-shared",):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import httpx
from mcp.server import Server
from mcp.types import TextContent, Tool

from mcp_app import build_mcp_app
from tool_contract import strip_system_params

logger = logging.getLogger(__name__)

KIND_FUNCTION = "function"
KIND_BEHAVIOR = "behavior"
_KINDS = (KIND_FUNCTION, KIND_BEHAVIOR)

# 各 kind 的转发目标：**执行底座**（都不对外提供工具，仅内网可达）
# 路径 + payload 里的目标键（执行面字段名不同，转发时一一对应）
_UPSTREAM = {
    KIND_FUNCTION: {
        "env": "FUNCTION_EXECUTOR_URL",
        "default": "http://optonto-ontology-function-executor:8006",
        "path": "/execute-function",
        "target_key": "function_name",
        "label": "本体函数执行服务",
    },
    KIND_BEHAVIOR: {
        "env": "DATA_ENGINE_EXECUTOR_URL",
        "default": "http://optonto-data-engine-executor:8005",
        "path": "/call-behavior",
        "target_key": "behavior_name",
        "label": "数据引擎执行服务",
    },
}

_TIMEOUT = httpx.Timeout(60.0, connect=5.0)


class ConfigError(RuntimeError):
    """发布配置非法（容器应据此终止启动，由编排侧把原因回传用户）。"""


def _parse_config(raw: str | None) -> dict:
    """解析并校验 PUBLISH_CONFIG_JSON。任一项不合法即 ConfigError（附可操作的修复提示）。"""
    if not raw or not raw.strip():
        raise ConfigError("缺少发布配置 PUBLISH_CONFIG_JSON（该容器应由 MCP发布 动态创建，不支持手工启动）")
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ConfigError(f"发布配置不是合法 JSON: {e}") from e
    if not isinstance(cfg, dict):
        raise ConfigError("发布配置必须是 JSON 对象")

    name = str(cfg.get("name") or "").strip()
    if not name:
        raise ConfigError("发布配置缺少服务名 name")

    kind = str(cfg.get("kind") or "").strip()
    if kind not in _KINDS:
        raise ConfigError(f"发布类型 kind 非法: {kind!r}（可选 {', '.join(_KINDS)}）")

    ontology_id = cfg.get("ontology_id")
    if ontology_id is None or str(ontology_id).strip() == "":
        raise ConfigError("发布配置缺少 ontology_id（自建发布必须绑定唯一本体）")

    tools = cfg.get("tools") or []
    if not isinstance(tools, list) or not tools:
        raise ConfigError("发布配置未包含任何工具（tools 为空）")
    names: set[str] = set()
    for t in tools:
        if not isinstance(t, dict) or not str(t.get("name") or "").strip():
            raise ConfigError(f"发布配置含非法工具条目: {t!r}")
        tool_name = str(t["name"]).strip()
        if tool_name in names:
            raise ConfigError(f"发布配置含重名工具: {tool_name}")
        names.add(tool_name)

    return {"name": name, "kind": kind, "ontology_id": int(ontology_id), "tools": tools}


CONFIG = _parse_config(os.getenv("PUBLISH_CONFIG_JSON"))

# 自建发布的工具集是**发布时冻结**的：改勾选 = 改发布配置 = 重建容器（不热加载，
# 否则"页面看到的清单"与"容器内实际注册"会不一致，工具清单的可信度就没了）
_TOOLS: list[Tool] = [
    Tool(
        name=str(t["name"]).strip(),
        description=str(t.get("description") or t["name"]),
        inputSchema=t.get("inputSchema") or {"type": "object", "properties": {}},
    )
    for t in CONFIG["tools"]
]
_TOOL_NAMES = {t.name for t in _TOOLS}

server = Server(CONFIG["name"])


async def _list_tools() -> list[Tool]:
    return list(_TOOLS)


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return await _list_tools()


def _upstream_url() -> str:
    spec = _UPSTREAM[CONFIG["kind"]]
    return os.getenv(spec["env"], spec["default"]).rstrip("/")


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
    """按发布类型转发到既有执行面；下游错误置 isError（抛异常），交由调用方判定失败。

    ``ontology_id`` 一律用**发布时绑定的本体**（忽略调用方传入值）：自建发布的服务面就是
    这个本体的切片，跨本体调用在结构上不可能发生，故调用方无需传、也不允许改。
    """
    if name not in _TOOL_NAMES:
        raise ValueError(f"未知工具: {name}（本发布仅提供 {len(_TOOL_NAMES)} 个工具）")

    spec = _UPSTREAM[CONFIG["kind"]]
    payload = {
        "ontology_id": CONFIG["ontology_id"],
        spec["target_key"]: name,
        # 系统参数（scope/ontology_id）不是业务入参——调用方（agent 挂载期）可能带上，剥掉
        "params": strip_system_params(arguments),
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_upstream_url()}{spec['path']}", json=payload)
    except httpx.ConnectError as e:
        raise RuntimeError(
            f"{spec['label']} 不可达（{_upstream_url()}）：{e}。"
            f"请确认该固定服务在「MCP发布」页处于运行状态——本发布依赖它执行")
    except httpx.TimeoutException as e:
        raise RuntimeError(f"{spec['label']} 调用超时: {e}")

    if resp.status_code >= 400:
        raise RuntimeError(
            f"{name} 执行失败（{spec['label']} 返回 HTTP {resp.status_code}）: {resp.text[:2000]}")
    body = resp.json() if "json" in resp.headers.get("content-type", "") else {"result": resp.text}
    return [TextContent(type="text", text=json.dumps(body, ensure_ascii=False, indent=2))]


starlette_app = build_mcp_app(
    server, _list_tools, CONFIG["name"],
    transport=os.getenv("MCP_TRANSPORT", "streamable"),
    auth_token=os.getenv("AUTH_TOKEN") or None,
)
