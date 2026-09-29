"""FastAPI application factory for the FINALAIAGENT AI service.

Phase 1 scope: the process starts, authenticates its internal boundary, reports health
truthfully, and shares one error envelope with the Java backend. No model or crawler calls yet.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.api.v1 import health as health_router
from app.api.v1 import requirements as requirements_router
from app.api.v1 import research as research_router
from app.config import Settings, get_settings
from app.firecrawl.client import FirecrawlWeb
from app.llm.client import GeminiLlm
from app.logging_setup import configure_logging

log = logging.getLogger("finalagent.ai")

SERVICE_NAME = "finalagent-ai-service"
VERSION = "0.1.0"

_CODE_BY_STATUS = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    408: "TIMEOUT",
    422: "VALIDATION_FAILED",
    429: "RATE_LIMITED",
}


def _envelope(code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or []}}


def create_app(settings: Settings | None = None, *, llm: object | None = None,
               web: object | None = None) -> FastAPI:
    resolved = settings if settings is not None else get_settings()
    configure_logging(resolved.log_level)

    app = FastAPI(
        title="FINALAIAGENT AI service",
        version=VERSION,
        # Internal, key-authenticated, and never public: no schema or docs endpoints.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = resolved

    # Constructed at startup so a broken provider or missing SDK fails the boot rather
    # than the first request. Tests inject doubles through the keyword arguments.
    app.state.llm = llm if llm is not None else GeminiLlm(resolved)
    app.state.web = web if web is not None else FirecrawlWeb(resolved)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=resolved.allowed_hosts)

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request_id_value = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id_value
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id_value
        response.headers["X-Response-Time-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
        return response

    # Registered for both classes deliberately: fastapi.HTTPException subclasses Starlette's, but
    # Starlette looks up handlers by exact type first, so binding only one of the two would let
    # framework-generated 404s bypass the shared error envelope.
    @app.exception_handler(HTTPException)
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        if isinstance(exc, HTTPException) and isinstance(exc.detail, dict) and "code" in exc.detail:
            code = exc.detail["code"]
            message = exc.detail.get("message", "Request could not be completed.")
        else:
            code = _CODE_BY_STATUS.get(exc.status_code, "ERROR")
            message = str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(code, message),
            headers={"WWW-Authenticate": "X-API-Key"} if exc.status_code == 401 else None,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        details = [
            f"{'.'.join(str(part) for part in error['loc'][1:])}: {error['msg']}"
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_envelope("VALIDATION_FAILED", "The request body does not satisfy the contract.", details),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        reference = uuid.uuid4().hex[:12]
        log.exception("Unhandled exception [id=%s]", reference)
        return JSONResponse(
            status_code=500,
            content=_envelope("INTERNAL_ERROR", f"An unexpected error occurred. Reference id: {reference}"),
        )

    app.include_router(health_router.router, prefix="/ai/v1")
    app.include_router(research_router.router, prefix="/ai/v1")
    app.include_router(requirements_router.router, prefix="/ai/v1")

    @app.get("/")
    def root() -> dict[str, Any]:
        return {"service": SERVICE_NAME, "version": VERSION, "health": "/ai/v1/health"}

    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = app.state.settings
    uvicorn.run(
        "app.main:app",
        host=settings.ai_service_host,
        port=settings.ai_service_port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    run()
