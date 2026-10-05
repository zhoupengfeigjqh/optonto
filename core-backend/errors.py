"""领域异常（与传输层解耦）。

背景：业务层（``services``）此前直接抛 ``fastapi.HTTPException``，把业务规则
（"重名"、"不存在"、"下游不可达"）与 HTTP 协议绑死，业务逻辑无法脱离 Web 框架复用，
也违反章程 II 的分层约束。

约定：

- 业务层只抛本模块的领域异常，**不** import fastapi；
- 接口层（``routers``）通常无需捕获——``main.py`` 的全局处理器会把 ``DomainError``
  统一映射为 ``{code, message, detail}`` 错误体（章程 VI）；
- 若确需在业务调用处短路，必须显式 ``raise`` 领域异常，不得转成通用 500。

状态码语义与改造前逐字保持一致，避免外部契约变化。
"""

from typing import Any


class DomainError(Exception):
    """业务异常基类：携带对外 HTTP 状态码与对外呈现的 ``detail``。"""

    def __init__(self, detail: Any, status_code: int):
        self.detail = detail
        self.status_code = status_code
        super().__init__(str(detail))


class InvalidInputError(DomainError):
    """入参不合法（HTTP 400）。"""

    def __init__(self, detail: Any = "请求参数不合法"):
        super().__init__(detail, 400)


class ConflictError(DomainError):
    """资源冲突：重名 / 重复（HTTP 400，与改造前一致，不改为 409 以免破坏前端契约）。"""

    def __init__(self, detail: Any = "资源已存在"):
        super().__init__(detail, 400)


class NotFoundError(DomainError):
    """资源不存在（HTTP 404）。"""

    def __init__(self, detail: Any = "资源不存在"):
        super().__init__(detail, 404)


class InternalError(DomainError):
    """服务内部不可用（HTTP 500）。

    「资源本应存在却缺失/损坏」（如模板文件丢失、落盘数据解析失败）用它——
    与入参错误（400）区分开：调用方无可修，属运维/数据层面事实。
    """

    def __init__(self, detail: Any = "服务内部错误"):
        super().__init__(detail, 500)


class UpstreamUnavailableError(DomainError):
    """下游服务不可达（HTTP 502）。"""

    def __init__(self, service_label: str, base: str):
        super().__init__(f"{service_label} 不可达（{base}），请确认服务已启动", 502)


class ServiceUnavailableError(DomainError):
    """平台自有服务操作失败（固定服务启停 / 容器操作）—— HTTP 502。

    与 ``UpstreamUnavailableError`` 的区别：后者是「下游 MCP 服务连不上」，
    本类是「我们自己的运行时底座操作没成功」。两者对外都是 502，但语义不同，
    日志/排障时不应混为一谈。
    """

    def __init__(self, detail: Any = "服务操作失败"):
        super().__init__(detail, 502)


class UpstreamTimeoutError(DomainError):
    """下游服务响应超时（HTTP 504）。"""

    def __init__(self, service_label: str):
        super().__init__(f"{service_label} 响应超时", 504)


class UpstreamResponseError(DomainError):
    """下游返回 >=400：状态码与 detail 原样透传，保持 MCP ``isError`` 语义不破坏。"""

    def __init__(self, status_code: int, detail: Any):
        super().__init__(detail, status_code)
