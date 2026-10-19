"""自建发布 API（MCP发布页）。

与 ``mcp_ctl.py`` 的分工：``mcp_ctl`` 只管**固定服务**（本体 / 数据引擎 / 业务）的启停与状态，
本模块只管**自建发布**（用户创建、绑定单一本体、对外暴露）的全生命周期。

路由前缀刻意与固定服务错开（``/api/mcp/published`` 独立成段），避免 ``/{service}/status``
这类通配路由把自建发布误当成固定服务键。
"""

from fastapi import APIRouter

from services import mcp_publish_containers as runtime
from services.mcp_publish_registry import HOST_PORT_MAX, HOST_PORT_MIN, KINDS, TRANSPORTS

router = APIRouter(prefix="/api/mcp/published", tags=["MCP自建发布"])


@router.get("")
async def list_published():
    """全部自建发布（含实时容器状态）。"""
    return {"services": runtime.list_publishes()}


@router.get("/meta")
async def publish_meta():
    """发布表单的可选值与约束（端口段、类型、传输模式）——前端据此渲染与预校验。"""
    return {
        "kinds": list(KINDS),
        "transports": list(TRANSPORTS),
        "host_port_min": HOST_PORT_MIN,
        "host_port_max": HOST_PORT_MAX,
    }


@router.get("/{name}")
async def get_published(name: str):
    return runtime.get_publish(name)


@router.get("/{name}/client-config")
async def published_client_config(name: str, host: str | None = None):
    """可直接粘进「MCP配置」的客户端配置片段（含令牌请求头；host 缺省用占位符）。"""
    return runtime.client_config(name, host)


@router.get("/{name}/tools")
async def published_tools(name: str):
    """发布时冻结的工具清单（只读注册表：不启停、不探测容器；停机也能看）。"""
    return runtime.published_tools(name)


@router.post("", status_code=201)
async def create_published(body: dict):
    """创建发布：``{ontology_id, name, kind, items[], host_port, transport}``。

    校验失败与名称/端口冲突 400（ConflictError 口径）、勾选项不存在 404、
    行为未就绪 400、镜像缺失或容器未就绪 502。
    """
    return await runtime.create_publish(
        ontology_id=body.get("ontology_id"),
        name=body.get("name"),
        kind=body.get("kind"),
        items=body.get("items") or [],
        host_port=body.get("host_port"),
        transport=body.get("transport"),
    )


@router.post("/{name}/start")
async def start_published(name: str):
    return await runtime.start_publish(name)


@router.post("/{name}/stop")
async def stop_published(name: str):
    return await runtime.stop_publish(name)


@router.delete("/{name}")
async def delete_published(name: str):
    return await runtime.delete_publish(name)
