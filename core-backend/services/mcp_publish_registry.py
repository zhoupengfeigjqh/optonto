"""自建发布注册表 + 校验（动态发布面业务层）。

发布模型：一个发布 = 一个 docker 容器 + 一条注册表记录。注册表
（``.data/mcp_publishes/publishes.json``）是期望状态的事实来源，容器是运行态；两者不一致时
以容器为准（``list_publishes`` 逐条读容器状态），不做反向回写。

安全边界（docker.sock 等价宿主机 root，见 routers/mcp_ctl.py 既有约束）：镜像名、容器名、
网络、端口范围、挂载面全部由常量收口；调用方只能传业务选择（服务名/类型/勾选项/端口/传输
模式），**不能传任意镜像、任意命令、任意挂载**。容器零挂载（配置走环境变量）并强制降权。

异常类型（章程 II）：抛领域异常（``errors``），状态码由 ``main.py`` 全局处理器统一映射。
文件读写一律经数据访问层 ``repositories.fs_store``。
"""

import json
import os
import re
import secrets
from datetime import datetime, timezone

from config import DATA_DIR
from errors import ConflictError, InvalidInputError, NotFoundError
from repositories import fs_store
# 发布类型常量唯一权威在 mcp-shared/publish_upstream（core 侧经 bridge 转出）：
# 本地再写一份字符串常量，一旦门面侧改名就会静默漂移（与 2026-10-04 环境变量漂移同源）。
from services.mcp_contract_bridge import (
    PUBLISH_KIND_BEHAVIOR as KIND_BEHAVIOR,
    PUBLISH_KIND_ONTOLOGY_FUNCTION as KIND_ONTOLOGY_FUNCTION,
)

KINDS = (KIND_ONTOLOGY_FUNCTION, KIND_BEHAVIOR)

TRANSPORT_SSE = "sse"
TRANSPORT_STREAMABLE = "streamable"
TRANSPORTS = (TRANSPORT_SSE, TRANSPORT_STREAMABLE)

# 动态发布的宿主端口段（与 compose 静态端口分离）
HOST_PORT_MIN = 8020
HOST_PORT_MAX = 8099
RESERVED_PORTS = frozenset({80, 81, 443, 3000, 3306, 3307,
                            8000, 8001, 8002, 8003, 8004, 8005, 8006, 8007, 8080, 8081})

CONTAINER_PORT = 8100            # 容器内端口固定（一个镜像多实例靠宿主端口区分）
IMAGE = "optonto-mcp-publish"     # 镜像白名单：唯一允许动态创建的镜像（自建发布门面）
NETWORK = "optonto-net"
CONTAINER_PREFIX = "optonto-mcp-publish-"

RESERVED_CONTAINER_NAMES = frozenset({
    "optonto-frontend", "optonto-nginx", "optonto-mysql", "optonto-core-backend",
    "optonto-agent-backend", "optonto-business-backend",
    "optonto-ontology-query-mcp", "optonto-common-function-mcp",
    "optonto-ontology-function-executor",
    "optonto-data-engine-executor", "optonto-business-mcp",
})

NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,31}$")

PUBLISH_DIR = DATA_DIR / "mcp_publishes"
REGISTRY_FILE = PUBLISH_DIR / "publishes.json"


# ─── 注册表读写 ────────────────────────────────────────────────────────────────

def _read_registry() -> list[dict]:
    data = fs_store.read_json(REGISTRY_FILE, default=[])
    return data if isinstance(data, list) else []


def _write_registry(entries: list[dict]) -> None:
    fs_store.write_json(REGISTRY_FILE, entries)


def get_entry(name: str) -> dict:
    entry = next((e for e in _read_registry() if e.get("name") == name), None)
    if entry is None:
        raise NotFoundError(f"发布服务不存在: {name}")
    return entry


def save_entry(entry: dict) -> None:
    entries = _read_registry()
    entries.append(entry)
    _write_registry(entries)


def delete_entry(name: str) -> None:
    entries = _read_registry()
    remaining = [e for e in entries if e.get("name") != name]
    if len(remaining) == len(entries):
        raise NotFoundError(f"发布服务不存在: {name}")
    _write_registry(remaining)


# ─── 校验（失败抛领域异常，文案给可操作的修复方向）───────────────────────────────

def validate_name(name, entries: list[dict]) -> str:
    name = (name or "").strip()
    if not NAME_PATTERN.match(name):
        raise InvalidInputError(
            "服务名只能包含字母、数字、下划线与连字符，且须以字母或数字开头（最长 32 字符）")
    if name in RESERVED_CONTAINER_NAMES:
        raise InvalidInputError(f"服务名 {name} 与平台固定服务冲突，请换一个")
    if any(e.get("name") == name for e in entries):
        raise ConflictError(f"发布服务名已存在: {name}")
    return name


def validate_host_port(port, entries: list[dict]) -> int:
    try:
        port = int(port)
    except (TypeError, ValueError):
        raise InvalidInputError("端口必须是数字")
    if not (HOST_PORT_MIN <= port <= HOST_PORT_MAX):
        raise InvalidInputError(
            f"端口需在 {HOST_PORT_MIN}-{HOST_PORT_MAX} 段内（该段预留给自建发布，避免与固定服务冲突）")
    if port in RESERVED_PORTS:
        raise InvalidInputError(f"端口 {port} 已被平台固定服务占用，请换一个")
    hit = next((e for e in entries if e.get("host_port") == port), None)
    if hit is not None:
        raise ConflictError(f"端口 {port} 已被发布服务「{hit.get('name')}」占用")
    return port


def validate_items(items) -> list[str]:
    if not isinstance(items, list) or not items:
        raise InvalidInputError("请至少选择一个本体函数或本体行为")
    names = [str(i).strip() for i in items if str(i).strip()]
    if len(set(names)) != len(names):
        raise InvalidInputError("勾选项存在重复")
    return names


def validate_transport(transport) -> str:
    transport = (transport or "").strip()
    if transport not in TRANSPORTS:
        raise InvalidInputError(f"传输模式非法: {transport}（可选 {'、'.join(TRANSPORTS)}）")
    return transport


def validate_kind(kind) -> str:
    kind = (kind or "").strip()
    if kind not in KINDS:
        raise InvalidInputError(f"发布类型非法: {kind}（可选 {'、'.join(KINDS)}）")
    return kind


# ─── 工具清单编译（发布快照；约束编译唯一实现在 mcp-shared/tool_contract）────────

# 统一信封说明（追加到 description 尾部；response 声明描述的是 data 内容）
_ENVELOPE_NOTE = "。返回为统一信封 {\"success\": bool, \"data\": 业务数据, \"error\": 业务失败信息}"
_BEHAVIOR_ENVELOPE_NOTE = (
    "。返回为执行结果信封 {\"status_code\": int, \"data\": 业务数据}；"
    "下游返回非 2xx 时以错误形式抛出（不会静默返回失败数据）"
)


def _description(item: dict, ontology_name: str, note: str) -> str:
    parts = [p for p in (item.get("display_name"), item.get("description")) if p]
    desc = "：".join(parts) if parts else str(item.get("name"))
    return f"{desc}（本体「{ontology_name}」）" + note


def compile_tools(ontology_id: int, kind: str, items: list[str]) -> tuple[str, list[dict]]:
    """勾选项 → (本体中文名, 工具清单)。inputSchema 已编译、scope 上下文块已注入。

    走 ``ontology_id_mode="const"``：自建发布绑定单一本体，``ontology_id`` 以 const 出现但
    **不进 required**——调用方（LLM / 外部 MCP 客户端）无需传，容器转发时注入绑定值，
    跨本体误路由在结构上不可能发生。scope 块仍注入（agent 侧挂载过滤依赖它），
    分类标记取真实归位（本体函数 / 本体行为），故 agent 侧零改动即可挂载这些工具。
    """
    from repositories.metadata import get_ontology_name_by_id
    from services import load_ontology_data
    from services.mcp_contract_bridge import (
        CATEGORY_BEHAVIOR, CATEGORY_FUNCTION, behavior_concept_names,
        params_to_input_schema, ready_behavior_names, related_concepts, with_ontology_context,
    )

    located = get_ontology_name_by_id(ontology_id)
    if not located:
        raise NotFoundError("本体不存在")
    sc_name, on_name = located
    data = load_ontology_data(sc_name, on_name).model_dump()

    if kind == KIND_BEHAVIOR:
        # ── 本体行为分支：取本体 behaviors 段，编译入参 schema（带 ontology_id const + scope）
        # 契约 ⑥：未完成数据引擎映射的行为不可发布——工具清单是对 LLM 的可调用承诺，
        # "清单里有、调用必失败"就是违约。这里直接拒，不给"建了才发现用不了"。
        ready = ready_behavior_names(data)
        catalog = {b.get("name"): b for b in data.get("behaviors") or [] if isinstance(b, dict)}
        missing = [n for n in items if n not in catalog]
        if missing:
            raise NotFoundError(f"本体「{on_name}」不存在这些行为: {'、'.join(missing)}")
        unready = [n for n in items if n not in ready]
        if unready:
            raise InvalidInputError(
                f"行为未就绪（未完成数据引擎映射、无法调达下游，不能发布为工具）: {'、'.join(unready)}；"
                f"请先在「数据引擎 → 接口映射」完成映射")
        category, note, concepts_of = CATEGORY_BEHAVIOR, _BEHAVIOR_ENVELOPE_NOTE, behavior_concept_names
    else:
        # ── 本体函数分支：取本体 functions 段，**编译**入参 schema（params → JSON Schema，
        #    并按「参数名=属性名」回溯概念属性约束），再注入 ontology_id const + scope 块。
        #    公共函数**不走这里**：它无本体归属、由 common-function-mcp 直接对外发布（无需按本体切片）。
        catalog = {f.get("name"): f for f in data.get("functions") or [] if isinstance(f, dict)}
        missing = [n for n in items if n not in catalog]
        if missing:
            raise NotFoundError(f"本体「{on_name}」不存在这些函数: {'、'.join(missing)}")
        category, note = CATEGORY_FUNCTION, _ENVELOPE_NOTE
        concepts_of = lambda it: it.get("related_concepts") or []  # noqa: E731

    meta = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    tools: list[dict] = []
    for name in items:
        item = catalog[name]
        schema, _conflicts = params_to_input_schema(
            item.get("params"), related_concepts(data, concepts_of(item)),
            ontology_id_mode="const", ontology_id=ontology_id,
        )
        context = {"name": name, "ontology_id": ontology_id,
                   "scenario_name": sc_name, "ontology_name": on_name}
        if meta.get("scenario_id") is not None:
            context["scenario_id"] = meta["scenario_id"]
        input_schema = with_ontology_context(
            schema, {**context, "display_name": item.get("display_name", "")}, category)
        # 注：2026-10-05 移除了旧的 `x-publish-service` 标记——它写进 inputSchema 但**无任何运行期消费者**
        # （消费端按 x-category 判定归属），属"写而不读"的死数据，留在工具契约里只会让契约多一个无意义键。
        tools.append({
            "name": name,
            "description": _description(item, on_name, note),
            "inputSchema": input_schema,
        })
    return on_name, tools


# ─── 容器规格（收口：镜像/网络/端口/降权全来自常量，调用方无法越界）──────────────

def build_container_name(name: str) -> str:
    """发布服务名 → 容器名（``optonto-mcp-<slug>-<6位随机>``）。

    随机后缀的作用：删掉重建同名发布时不会因容器名残留而失败；同时用户可见的服务名与容器名
    解耦（服务名可含下划线，容器名不允许）。
    """
    slug = re.sub(r"[^a-z0-9-]+", "-", str(name).lower()).strip("-") or "svc"
    return f"{CONTAINER_PREFIX}{slug[:20]}-{secrets.token_hex(3)}"


def build_publish_config(entry: dict) -> dict:
    """容器消费的配置（只含容器需要的字段；令牌走独立环境变量，不进配置）。"""
    return {
        "name": entry["name"],
        "kind": entry["kind"],
        "ontology_id": entry["ontology_id"],
        "tools": entry["tools"],
    }


def build_run_kwargs(entry: dict) -> dict:
    """``docker.containers.run`` 的完整参数（唯一创建路径；安全收口见模块 docstring）。"""
    config_json = json.dumps(build_publish_config(entry), ensure_ascii=False, separators=(",", ":"))
    # 转发契约来自 mcp-shared/publish_upstream（与门面读取的是**同一份**）：注入方的变量名与
    # 读取方的读取名必须一致。2026-10-04 修复：此前两类发布都注入 ONTOLOGY_FUNCTION_EXECUTOR_URL，
    # 行为类容器因此带了一个"名为本体函数执行器、实指数据引擎"的死变量，而门面真正读的
    # DATA_ENGINE_EXECUTOR_URL 从未被注入——行为发布只是靠门面默认值巧合跑通。
    from services.mcp_contract_bridge import upstream_of
    spec = upstream_of(entry["kind"])
    return {
        "image": IMAGE,
        "name": entry["container_name"],
        "network": NETWORK,
        "detach": True,
        # docker SDK 契约（ContainerCollection.run 文档）：ports 是 dict，键 = 容器内端口，
        # 值 = 宿主端口（值也可用列表指定多个宿主端口）。内部走 convert_port_bindings。
        "ports": {f"{CONTAINER_PORT}/tcp": entry["host_port"]},
        "environment": {
            "PUBLISH_CONFIG_JSON": config_json,
            "PORT": str(CONTAINER_PORT),
            "MCP_TRANSPORT": entry["transport"],
            "AUTH_TOKEN": entry["token"],
            # 上游地址以 core 的运行环境配置为准（compose 注入的 *_URL 即事实源），
            # 缺省才回落到契约默认值——避免"compose 改了地址、发布容器仍打默认地址"的漂移。
            spec["env"]: os.getenv(spec["env"], spec["default"]),
            "TZ": "Asia/Shanghai",
        },
        # 零挂载：配置与令牌全走环境变量，容器攻击面只有一个只读 HTTP 服务
        "volumes": {},
        "restart_policy": {"Name": "unless-stopped"},
        "mem_limit": "512m",
        "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges:true"],
        "labels": {
            "optonto.published": "1",
            "optonto.publish_name": entry["name"],
            "optonto.ontology_id": str(entry["ontology_id"]),
        },
    }


def build_entry(*, ontology_id: int, name, kind, items, host_port, transport) -> dict:
    """校验 + 编译 → 生成注册表条目（**不落盘、不起容器**，便于路由分步处理失败）。

    失败语义：名称/端口冲突 400（ConflictError 口径）、类型与勾选项非法 400、
    勾选项不存在或未就绪 404/400。
    """
    entries = _read_registry()
    kind = validate_kind(kind)
    name = validate_name(name, entries)
    transport = validate_transport(transport)
    port = validate_host_port(host_port, entries)
    names = validate_items(items)
    ontology_name, tools = compile_tools(ontology_id, kind, names)
    return {
        "name": name,
        "kind": kind,
        "ontology_id": int(ontology_id),
        "ontology_name": ontology_name,
        "items": names,
        "tool_count": len(tools),
        "host_port": port,
        "transport": transport,
        "container_name": build_container_name(name),
        "token": secrets.token_urlsafe(24),
        "tools": tools,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def public_view(entry: dict, runtime: dict) -> dict:
    """注册表条目 + 运行态 → 对外视图（令牌一并给出：用户要填进 MCP 配置才能连）。"""
    return {
        "name": entry["name"],
        "kind": entry["kind"],
        "ontology_id": entry["ontology_id"],
        "ontology_name": entry.get("ontology_name", ""),
        "items": entry.get("items", []),
        "tool_count": entry.get("tool_count", len(entry.get("tools") or [])),
        "host_port": entry["host_port"],
        "transport": entry["transport"],
        "token": entry["token"],
        "container_name": entry["container_name"],
        "created_at": entry.get("created_at", ""),
        "status": runtime.get("status", "unknown"),
        "running": runtime.get("running", False),
    }
