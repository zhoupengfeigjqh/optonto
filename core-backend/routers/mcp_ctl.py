"""固定 MCP 服务启停 API —— 平台内置运行时底座的 start/stop/status（白名单）。

白名单化（架构文档 §十六）：只允许管控平台内置底座，**严禁收任意容器名**——
docker.sock 等价宿主机 root。这是 API 层硬边界：不在白名单里的服务键一律 404。

服务键语义（2026-10-04 统一，键名即角色）：

| 键 | 容器 | 角色 | 对外发布工具 |
|---|---|---|---|
| ontology-query | optonto-ontology-query-mcp | 本体查询 MCP 服务（只读 list* 查询） | 内置对外工具面之一 |
| common-function | optonto-common-function-mcp | 公共函数 MCP 服务（平台通用算力，发布+执行一体） | 是（7 个公共函数工具） |
| function-executor | optonto-ontology-function-executor | 本体函数执行服务（零工具） | 否，仅内网 |
| data-engine | optonto-data-engine-executor | 数据引擎执行服务（行为/引擎执行，零工具） | 否，仅内网 |
| business | optonto-business-mcp | 业务系统 MCP（模拟外部业务系统） | 是（外部形态） |

**失败语义（2026-10-05 与自建发布统一）**：启动/停止**操作失败一律抛领域异常**
（容器缺失 → 404、Docker 操作失败 → 502），不再以 HTTP 200 + ``{running:false}``
掩盖失败；「已在运行 / 本就未运行」这类**无操作**仍返回 200（不是失败）。

**业务系统 MCP 纳入管控**（2026-10-04 用户决策）：与所有固定服务同权，可启停、可查状态。
docker.sock 层面的第一层防护不变——白名单仍是硬编码字典，收不到任意容器名；
自建发布的动态容器不在此列，它有独立的生命周期端点（routers.mcp_publish）。
"""

from fastapi import APIRouter

from errors import NotFoundError, ServiceUnavailableError

router = APIRouter(prefix="/api/mcp", tags=["MCP固定服务"])

# 服务键 → 容器名（硬编码白名单，API 层硬边界）
MCP_SERVICES = {
    "ontology-query": "optonto-ontology-query-mcp",
    "common-function": "optonto-common-function-mcp",
    "function-executor": "optonto-ontology-function-executor",
    "data-engine": "optonto-data-engine-executor",
    "business": "optonto-business-mcp",
}


def _container_name(service: str) -> str:
    name = MCP_SERVICES.get(service)
    if name is None:
        raise NotFoundError(f"未知或不允许管控的 MCP 服务: {service}")
    return name


def _get_client():
    import docker  # 延迟导入：无 docker 包时应用仍能正常启动
    return docker.from_env()


def _docker_errors():
    """返回 docker.errors 模块（未安装时返回 None）。"""
    try:
        import docker
        return docker.errors
    except Exception:
        return None


def _is_not_found(exc: Exception) -> bool:
    errors = _docker_errors()
    return bool(errors and isinstance(exc, errors.NotFound))


def _container_status(container_name: str) -> tuple[str, bool]:
    """Return (status_text, is_running)."""
    try:
        client = _get_client()
        container = client.containers.get(container_name)
        return container.status, container.status == "running"
    except Exception as e:
        if _is_not_found(e):
            return "not_found", False
        return "unknown", False


@router.get("/{service}/status")
async def mcp_status(service: str):
    container = _container_name(service)
    status_text, running = _container_status(container)
    return {"status": status_text, "running": running, "container": container}


@router.post("/{service}/start")
async def mcp_start(service: str):
    container = _container_name(service)
    _, running = _container_status(container)
    if running:
        return {"message": "MCP 服务已在运行中", "running": True}
    try:
        _get_client().containers.get(container).start()
    except Exception as e:
        if _is_not_found(e):
            raise NotFoundError(f"容器 {container} 不存在（该固定服务未部署）")
        raise ServiceUnavailableError(f"启动固定服务失败: {e}")
    return {"message": "MCP 服务已启动", "running": True}


@router.post("/{service}/stop")
async def mcp_stop(service: str):
    container = _container_name(service)
    _, running = _container_status(container)
    if not running:
        return {"message": "MCP 服务未运行", "running": False}
    try:
        _get_client().containers.get(container).stop()
    except Exception as e:
        if _is_not_found(e):
            raise NotFoundError(f"容器 {container} 不存在（该固定服务未部署）")
        raise ServiceUnavailableError(f"停止固定服务失败: {e}")
    return {"message": "MCP 服务已停止", "running": False}
