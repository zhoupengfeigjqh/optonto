"""运行面转发器 — core-backend 运行期执行归零后的唯一出口。

设计器测试按钮与 Agent 真实调用必须走同一条路径（消灭双执行路径）：

- **本体行为 / 数据引擎**执行 → ``optonto-data-engine-executor:8005`` 的 ``/call-behavior``、``/call-engine``
- **本体函数**执行           → ``optonto-ontology-function-executor:8006`` 的 ``/execute-function``
- **公共函数**执行           → ``optonto-common-function-mcp:8007`` 的 ``/execute-common-function``

三类函数的语义差别（勿混用）：本体函数**有本体归属**（执行前做归属一致性校验、必填 ontology_id）；
公共函数**是平台级能力**（无 ontology_id、不做归属校验），它的执行与对外发布合体在同一个服务
（common-function-mcp 既是发布面也是执行面）——与本体函数"执行底座不对外"的处理刻意不同。

转发语义：状态码与响应体原样透传（下游 4xx/5xx 保持错误形态，isError 语义不破坏）；
服务不可达返回 502（5s 连接超时 + 明确报错，见架构文档 §十四风险表）。

异常类型（章程 II）：抛领域异常（``errors``）而非 ``fastapi.HTTPException``，
业务层不依赖传输层；状态码由 ``main.py`` 全局处理器统一映射。
"""

import os

import httpx

from errors import UpstreamResponseError, UpstreamTimeoutError, UpstreamUnavailableError

# 三个执行/能力服务的地址（键名即角色，避免"函数"一词两义）
DATA_ENGINE_EXECUTOR_URL = os.getenv("DATA_ENGINE_EXECUTOR_URL", "http://optonto-data-engine-executor:8005")
ONTOLOGY_FUNCTION_EXECUTOR_URL = os.getenv(
    "ONTOLOGY_FUNCTION_EXECUTOR_URL", "http://optonto-ontology-function-executor:8006")
COMMON_FUNCTION_MCP_URL = os.getenv("COMMON_FUNCTION_MCP_URL", "http://optonto-common-function-mcp:8007")

_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


async def forward_call(base: str, path: str, payload: dict, service_label: str):
    """POST 转发并透传结果。>=400 抛领域异常（detail 原样透传），否则返回响应体。"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{base}{path}", json=payload)
    except httpx.ConnectError:
        raise UpstreamUnavailableError(service_label, base)
    except httpx.TimeoutException:
        raise UpstreamTimeoutError(service_label)

    body = resp.json() if "json" in resp.headers.get("content-type", "") else {"detail": resp.text}
    if resp.status_code >= 400:
        detail = body.get("detail") if isinstance(body, dict) else None
        raise UpstreamResponseError(resp.status_code, detail or str(body))
    return body