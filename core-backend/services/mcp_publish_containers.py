"""自建发布容器生命周期（动态发布面的 docker 交互层）。

与 ``routers/mcp_ctl.py``（固定服务启停）的分工：
- 固定服务：compose 里 7 个常驻容器，**只启停**、不创建；
- 自建发布：本模块创建/启停/删除动态容器，镜像白名单收口到 ``IMAGE`` 一个。

就绪判定：容器 running **且** ``/health`` 返回 200（读容器在 optonto-net 上的 IP 直连，core
同网络可达）。两者缺一都不算就绪——"容器起来了但配置非法导致进程已退出"是最常见的假成功，
只看 status 会把坏发布报成成功。失败时回传**容器日志尾部**，用户能直接看到失败原因。
"""

import asyncio

import httpx

from errors import ConflictError, NotFoundError, UpstreamUnavailableError
from services import mcp_publish_registry as store

_READY_TIMEOUT_S = 20.0
_READY_INTERVAL_S = 0.5
_HEALTH_TIMEOUT = httpx.Timeout(2.0, connect=1.0)


def _client():
    import docker  # 延迟导入：无 docker 包时应用仍能正常启动
    return docker.from_env()


def _is_not_found(exc: Exception) -> bool:
    try:
        import docker
        return isinstance(exc, docker.errors.NotFound)
    except Exception:
        return False


def image_exists(image: str = store.IMAGE) -> bool:
    """动态创建依赖镜像已在本地；core 容器内无源码，故缺失时只能由宿主机预构建。"""
    try:
        _client().images.get(image)
        return True
    except Exception:
        return False


def missing_image_message() -> str:
    return (f"镜像 {store.IMAGE} 不存在，无法创建自建发布。请先在项目根目录执行："
            f"docker compose --profile published-mcp build {store.IMAGE}")


def container_state(container_name: str) -> dict:
    """容器实时状态（只读，不写注册表）。"""
    try:
        container = _client().containers.get(container_name)
        return {"status": container.status, "running": container.status == "running"}
    except Exception as e:
        if _is_not_found(e):
            return {"status": "not_found", "running": False}
        return {"status": "unknown", "running": False}


_network_cache: dict = {}


def resolve_network() -> str:
    """运行时解析业务网络真实名（**不能硬编码**）。

    compose 会给网络名加项目名前缀（``optonto-net`` → ``optonto_optonto-net``），
    硬编码会在容器 start 时报 "network not found"。这里按优先级解析并缓存：
    ① 精确命中 ``NETWORK``；② 以 ``_<NETWORK>`` 结尾（compose 命名形态）；
    ③ 任取一个非默认 bridge 网络（最后的兜底，仍失败则由 Docker 报错，错误信息可读）。
    """
    if "name" in _network_cache:
        return _network_cache["name"]
    name = store.NETWORK
    try:
        networks = _client().networks.list()
    except Exception:
        networks = []
    candidates = [n.name for n in networks]
    if store.NETWORK in candidates:
        name = store.NETWORK
    else:
        suffixed = [n for n in candidates if n.endswith(f"_{store.NETWORK}")]
        if suffixed:
            name = suffixed[0]
        else:
            others = [n for n in candidates if n not in ("bridge", "host", "none")]
            if others:
                name = others[0]
    _network_cache["name"] = name
    return name


def _container_ip(container_name: str) -> str | None:
    """容器在业务网络上的 IP（core 同网络，可直连探活）。

    网络名同样走 ``resolve_network()``（compose 会加项目名前缀）；取不到就退回第一个网络。
    """
    try:
        container = _client().containers.get(container_name)
        networks = (container.attrs.get("NetworkSettings") or {}).get("Networks") or {}
        entry = networks.get(resolve_network()) or next(iter(networks.values()), None)
        return (entry or {}).get("IPAddress") or None
    except Exception:
        return None


def _log_tail(container_name: str, lines: int = 20) -> str:
    try:
        raw = _client().containers.get(container_name).logs(tail=lines)
        return raw.decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


async def wait_ready(container_name: str) -> None:
    """轮询 /health 至就绪；超时抛 502 并带上容器日志尾部（失败原因就在日志里）。"""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + _READY_TIMEOUT_S
    last_state = "unknown"
    while loop.time() < deadline:
        state = container_state(container_name)
        last_state = state["status"]
        if not state["running"] and last_state in ("exited", "dead"):
            break  # 进程已退出（配置非法等）：日志此刻最有价值，不必等满超时
        if state["running"]:
            ip = _container_ip(container_name)
            if ip:
                try:
                    async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT) as client:
                        resp = await client.get(f"http://{ip}:{store.CONTAINER_PORT}/health")
                    if resp.status_code == 200:
                        return
                except Exception:
                    pass
        await asyncio.sleep(_READY_INTERVAL_S)
    tail = _log_tail(container_name)
    raise UpstreamUnavailableError(
        f"发布容器未就绪（状态: {last_state}）" + (f"；容器日志: {tail}" if tail else ""))


# ─── 读 ───────────────────────────────────────────────────────────────────────

def list_publishes() -> list[dict]:
    """全部自建发布 + 实时容器状态（注册表为准，状态取容器，不反向回写）。"""
    return [store.public_view(e, container_state(e["container_name"]))
            for e in store._read_registry()]


def get_publish(name: str) -> dict:
    entry = store.get_entry(name)
    return store.public_view(entry, container_state(entry["container_name"]))


def client_config(name: str, host: str | None = None) -> dict:
    """生成可直接粘进「MCP配置」的客户端配置片段（含令牌请求头）。

    同一容器有两套地址，用途不同，**都给出来**（前端并排展示，用户按用途取用）：
    - ``mcpServers``：宿主地址（``host:host_port``），给**平台外**的 AI 客户端（Claude/Cursor 等）；
    - ``internal_mcpServers``：Docker 网络内的地址（容器名 + ``CONTAINER_PORT``），给**本平台 Agent**
      （agent-backend 自身在容器里，localhost 指向它自己、宿主端口也不从容器内走，必须走服务名）。

    ``type`` 取**客户端认的取值**（``http`` = Streamable HTTP / ``sse``），与平台的传输模式一一对应；
    此前写死的 ``"url"`` 是自造值（客户端 schema 里只有 http/sse/stdio，2026-10-05 修正）。
    """
    entry = store.get_entry(name)
    is_sse = entry["transport"] == store.TRANSPORT_SSE
    path = "/sse" if is_sse else "/mcp"
    url = f"http://{host or '<你的域名或IP>'}:{entry['host_port']}{path}"
    internal_url = f"http://{entry['container_name']}:{store.CONTAINER_PORT}{path}"
    headers = {"X-MCP-Token": entry["token"]}
    client_type = "sse" if is_sse else "http"
    return {
        "mcpServers": {entry["name"]: {"type": client_type, "url": url, "headers": headers}},
        "internal_mcpServers": {entry["name"]: {"type": client_type, "url": internal_url, "headers": headers}},
    }


# ─── 写 ───────────────────────────────────────────────────────────────────────

def _remove_quietly(container_name: str) -> None:
    try:
        _client().containers.get(container_name).remove(force=True)
    except Exception:
        pass


async def create_publish(*, ontology_id: int, name, kind, items, host_port, transport) -> dict:
    """校验 → 编译工具快照 → 起容器 → 就绪探测 → 落注册表。

    **先起容器、后落注册表**：起不来时不留脏记录（用户改配置重试即可）；落盘后若容器异常，
    ``list_publishes`` 会如实显示为 stopped / not_found，不掩盖。
    """
    if not image_exists():
        raise UpstreamUnavailableError(missing_image_message())

    entry = store.build_entry(ontology_id=ontology_id, name=name, kind=kind,
                              items=items, host_port=host_port, transport=transport)
    kwargs = store.build_run_kwargs(entry)
    kwargs["network"] = resolve_network()   # 真实网络名（compose 带项目前缀，见 resolve_network）
    try:
        _client().containers.run(**kwargs)
    except Exception as e:
        # 端口被 Docker 层面占用（静态服务 / 其他程序）、网络名解析失败等都在这里暴露；
        # 容器可能已 create 成功但 start 失败 → 一律回滚，不留脏容器
        _remove_quietly(entry["container_name"])
        raise ConflictError(f"创建发布容器失败: {e}")
    try:
        await wait_ready(entry["container_name"])
    except Exception:
        _remove_quietly(entry["container_name"])  # 回滚：不留半成品容器
        raise
    store.save_entry(entry)
    return store.public_view(entry, container_state(entry["container_name"]))


async def start_publish(name: str) -> dict:
    entry = store.get_entry(name)
    try:
        _client().containers.get(entry["container_name"]).start()
    except Exception as e:
        if _is_not_found(e):
            raise NotFoundError(
                "发布容器不存在（可能已被手工删除）：请删除该发布后重新创建")
        raise UpstreamUnavailableError(f"启动发布容器失败: {e}")
    await wait_ready(entry["container_name"])
    return get_publish(name)


async def stop_publish(name: str) -> dict:
    entry = store.get_entry(name)
    try:
        _client().containers.get(entry["container_name"]).stop()
    except Exception as e:
        if _is_not_found(e):
            raise NotFoundError(
                "发布容器不存在（可能已被手工删除）：请删除该发布后重新创建")
        raise UpstreamUnavailableError(f"停止发布容器失败: {e}")
    return get_publish(name)


async def delete_publish(name: str) -> dict:
    """删除发布：先删容器（幂等——已不存在也算成功），再删注册表条目。"""
    entry = store.get_entry(name)
    _remove_quietly(entry["container_name"])
    store.delete_entry(name)
    return {"message": f"发布服务「{name}」已删除", "name": name}
