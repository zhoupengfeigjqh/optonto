"""固定 MCP 服务启停 API —— 平台内置运行时底座的 start/stop/status（白名单）。

白名单化（架构文档 §十六）：只允许管控平台内置底座，**严禁收任意容器名**——
docker.sock 等价宿主机 root。这是 API 层硬边界：不在白名单里的服务键一律 404。

服务键语义（2026-10-04 统一，键名即角色）：

| 键 | 容器 | 角色 | 对外发布工具 |
|---|---|---|---|
| ontology-query | optonto-ontology-query-mcp | 本体查询 MCP 服务（只读 list* 查询） | 唯一内置对外工具面 |
| common-function | optonto-common-function-mcp | 公共函数 MCP 服务（平台通用算力，发布+执行一体） | 是（7 个公共函数工具） |
| function-executor | optonto-ontology-function-executor | 本体函数执行服务（零工具） | 否，仅内网 |
| data-engine | optonto-data-engine-executor | 数据引擎执行服务（行为/引擎执行） | 否，仅内网（Agent 挂载） |
| business | optonto-business-mcp | 业务系统 MCP（模拟外部业务系统） | 是（外部形态） |

**业务系统 MCP 纳入管控**（2026-10-04 用户决策）：此前它是唯一"只读"服务——不进白名单、
只能 Docker 手动启停（§十六 双层防护的第二层）。现按用户要求**与其他固定服务同权**：
可启停、可查状态。docker.sock 层面的第一层防护不变——白名单仍是硬编码字典，
仍收不到任意容器名（自建发布的动态容器也不在此列，它有独立的生命周期端点
routers/mcp_publish.py，镜像与容器名由 services/mcp_publish_* 收口）。
"""

from fastapi import APIRouter, HTTPException

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
        raise HTTPException(status_code=404, detail=f"未知或不允许管控的 MCP 服务: {service}")
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
    return {"status": status_text, "running": running, "container": container}


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
            return {"message": "容器 %s 不存在" % container, "running": False}
        return {"message": "启动失败: %s" % str(e), "running": False}


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
            return {"message": "容器 %s 不存在" % container, "running": False}
        return {"message": "停止失败: %s" % str(e), "running": True}