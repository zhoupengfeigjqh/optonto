"""MCP service control API — start/stop/status for optonto_mcp container."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/mcp", tags=["MCP控制"])

MCP_CONTAINER = "optonto_mcp"


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


def _container_status() -> tuple[str, bool]:
    """Return (status_text, is_running)."""
    try:
        client = _get_client()
        container = client.containers.get(MCP_CONTAINER)
        return container.status, container.status == "running"
    except Exception as e:
        errors = _docker_errors()
        if errors and isinstance(e, errors.NotFound):
            return "not_found", False
        return "unknown", False


@router.get("/status")
async def mcp_status():
    status_text, running = _container_status()
    return {
        "status": status_text,
        "running": running,
        "container": MCP_CONTAINER,
    }


@router.post("/start")
async def mcp_start():
    _, running = _container_status()
    if running:
        return {"message": "MCP 服务已在运行中", "running": True}
    try:
        client = _get_client()
        container = client.containers.get(MCP_CONTAINER)
        container.start()
        return {"message": "MCP 服务已启动", "running": True}
    except Exception as e:
        errors = _docker_errors()
        if errors and isinstance(e, errors.NotFound):
            return {"message": f"容器 {MCP_CONTAINER} 不存在", "running": False}
        return {"message": f"启动失败: {str(e)}", "running": False}


@router.post("/stop")
async def mcp_stop():
    _, running = _container_status()
    if not running:
        return {"message": "MCP 服务未运行", "running": False}
    try:
        client = _get_client()
        container = client.containers.get(MCP_CONTAINER)
        container.stop()
        return {"message": "MCP 服务已停止", "running": False}
    except Exception as e:
        errors = _docker_errors()
        if errors and isinstance(e, errors.NotFound):
            return {"message": f"容器 {MCP_CONTAINER} 不存在", "running": False}
        return {"message": f"停止失败: {str(e)}", "running": True}
