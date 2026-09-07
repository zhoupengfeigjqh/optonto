"""运行面转发器 — core-backend 运行期执行归零后的唯一出口。

设计器测试按钮与 Agent 真实调用必须走同一条路径（消灭双执行路径）：
- 行为/数据引擎执行 → optonto-data-engine-mcp 的 /call-behavior /call-engine
- 本体/公共函数执行 → optonto-ontology-mcp 的 /execute-function /execute-common-function

转发语义：状态码与响应体原样透传（下游 4xx/5xx 保持错误形态，isError 语义不破坏）；
服务不可达返回 502（5s 连接超时 + 明确报错，见架构文档 §十四风险表）。
"""

import os

import httpx
from fastapi import HTTPException

DATA_ENGINE_MCP_URL = os.getenv("DATA_ENGINE_MCP_URL", "http://optonto-data-engine-mcp:8005")
ONTOLOGY_MCP_URL = os.getenv("ONTOLOGY_MCP_URL", "http://optonto-ontology-mcp:8002")

_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


async def forward_call(base: str, path: str, payload: dict, service_label: str):
    """POST 转发并透传结果。>=400 抛 HTTPException（detail 原样透传），否则返回响应体。"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{base}{path}", json=payload)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"{service_label} 不可达（{base}），请确认服务已启动")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"{service_label} 响应超时")

    body = resp.json() if "json" in resp.headers.get("content-type", "") else {"detail": resp.text}
    if resp.status_code >= 400:
        detail = body.get("detail") if isinstance(body, dict) else None
        raise HTTPException(status_code=resp.status_code, detail=detail or str(body))
    return body
