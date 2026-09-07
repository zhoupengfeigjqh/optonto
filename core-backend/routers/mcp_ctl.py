"""MCP service control API — start/stop/status for runtime MCP containers (whitelist).

白名单化（2026-09-07，架构文档 §十六）：只允许启停平台运行时底座两个容器，
严禁收任意容器名——docker.sock 等价宿主机 root。
business-mcp 是业务侧集成边缘，不进白名单：只能 Docker 手动启停，前端只读显示。
"""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/mcp", tags=["MCP控制"])

# 服务键 → 容器名（硬编码白名单，API 层硬边界）
MCP_SERVICES = {
    "ontology": "optonto-ontology-mcp",
    "data-engine": "optonto-data-engine-mcp",
}

# business-mcp：业务侧集成边缘，只读状态（start/stop 仍走 _container_name → 404 硬边界）
BUSINESS_CONTAINER = "optonto-business-mcp"


@router.get("/business/status")
async def business_status():
    """business-mcp 容器状态（只读）。启停只能在 Docker 手动操作，前端展示用。"""
    status_text, running = _container_status(BUSINESS_CONTAINER)
    return {"status": status_text, "running": running, "container": BUSINESS_CONTAINER}


def _container_name(service: str) -> str:
    name = MCP_SERVICES.get(service)
    if name is None:
        raise HTTPException(status_code=404, detail=f"未知或不允许管控的 MCP 服务: {service}")
    return name


def _get_client():
    import docker  # 延迟导入：无 docker 包时应用仍可正常启动
    return docker.from_env()


def _docker_errors():
    """返回 docker.errors 模块（未安装时返回 None）。"""
    try:
        import docker
        return docker.errors
    except Exception:
        return None


def _container_status(container_name: str) -> tuple[str, bool]:
    """Return (status_text, is_running)."""
    try:
        client = _get_client()
        container = client.containers.get(container_name)
        return container.status, container.status == "running"
    except Exception as e:
        errors = _docker_errors()
        if errors and isinstance(e, errors.NotFound):
            return "not_found", False
        return "unknown", False


@router.get("/{service}/status")
async def mcp_status(service: str):
    container = _container_name(service)
    status_text, running = _container_status(container)
    return {
        "status": status_text,
        "running": running,
        "container": container,
    }


@router.post("/{service}/start")
async def mcp_start(service: str):
    container = _container_name(service)
    _, running = _container_status(container)
    if running:
        return {"message": "MCP 服务已在运行中", "running": True}
    try:
        client = _get_client()
        client.containers.get(container).start()
        return {"message": "MCP 服务已启动", "running": True}
    except Exception as e:
        errors = _docker_errors()
        if errors and isinstance(e, errors.NotFound):
            return {"message": f"容器 {container} 不存在", "running": False}
        return {"message": f"启动失败: {str(e)}", "running": False}


@router.post("/{service}/stop")
async def mcp_stop(service: str):
    container = _container_name(service)
    _, running = _container_status(container)
    if not running:
        return {"message": "MCP 服务未运行", "running": False}
    try:
        client = _get_client()
        client.containers.get(container).stop()
        return {"message": "MCP 服务已停止", "running": False}
    except Exception as e:
        errors = _docker_errors()
        if errors and isinstance(e, errors.NotFound):
            return {"message": f"容器 {container} 不存在", "running": False}
        return {"message": f"停止失败: {str(e)}", "running": True}
