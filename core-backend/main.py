"""FastAPI application entry point."""

import json
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from errors import DomainError

from routers import (
    scenarios_router,
    ontologies_router,
    concepts_router,
    relations_router,
    behaviors_router,
    rules_router,
    processes_router,
    securities_router,
    functions_router,
    files_router,
    threads_router,
    chat_router,
    data_engines_router,
    mcp_ctl_router,
    rule_templates_router,
    common_functions_router,
    skills_router,
    deploy_router,
)


app = FastAPI(
    title="OPTONTO 本体开发平台",
    description="本体开发平台后端 API",
    version="1.0.0",
)

# CORS – allow frontend dev servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(scenarios_router)
app.include_router(ontologies_router)
app.include_router(concepts_router)
app.include_router(relations_router)
app.include_router(behaviors_router)
app.include_router(rules_router)
app.include_router(processes_router)
app.include_router(securities_router)
app.include_router(functions_router)
app.include_router(mcp_ctl_router)
app.include_router(files_router)
app.include_router(threads_router)
app.include_router(chat_router)
app.include_router(data_engines_router)
app.include_router(rule_templates_router)
app.include_router(common_functions_router)
app.include_router(skills_router)
app.include_router(deploy_router)


@app.get("/")
async def root():
    return {"message": "OPTONTO API is running"}


@app.get("/health")
async def health():
    return {"status": "ok"}


# ─── 统一错误响应契约（章程 VI：统一错误格式 + 稳定错误码）─────────────────────
# 所有错误一律返回 {"code": <int>, "message": <str>, "detail": <str>}：
# - code 为稳定语义码（当前取 HTTP 状态码，后续可在不改结构的前提下细分业务码）
# - message 为面向用户的权威错误文本
# - detail 保留为字符串，与既有前端解析（err.detail）兼容

logger = logging.getLogger("core-backend")


def _error_body(status_code: int, message: str) -> dict:
    return {"code": status_code, "message": message, "detail": message}


@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(request: Request, exc: StarletteHTTPException):
    """HTTPException 统一化：detail 可能是任意对象，一律折叠为可读字符串。"""
    detail = exc.detail
    message = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
    return JSONResponse(status_code=exc.status_code, content=_error_body(exc.status_code, message))


@app.exception_handler(DomainError)
async def _domain_error_handler(request: Request, exc: DomainError):
    """领域异常 → HTTP：业务层不依赖 fastapi，由本处统一映射状态码与错误体。

    与上面的 HTTPException 处理器同构，保证「业务层抛领域异常」与
    「路由层抛 HTTPException」对外契约完全一致（改造成本对前端为零）。
    """
    detail = exc.detail
    message = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
    return JSONResponse(status_code=exc.status_code, content=_error_body(exc.status_code, message))


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    """参数校验失败：FastAPI 默认 detail 为数组，前端会解析成无意义文本，此处折叠为首条可读信息。"""
    errors = exc.errors()
    first = errors[0] if errors else {}
    loc = ".".join(str(p) for p in first.get("loc", []) if p not in ("body", "query", "path"))
    msg = first.get("msg", "参数不合法")
    return JSONResponse(
        status_code=422,
        content=_error_body(422, f"参数校验失败: {loc} {msg}".strip()),
    )


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """兜底异常：记录堆栈但对外只暴露结构化错误，避免泄漏内部细节。"""
    logger.exception("未处理异常: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=_error_body(500, "服务器内部错误"))
