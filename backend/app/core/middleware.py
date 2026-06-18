# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
HTTP middleware'leri:
  - RequestIDMiddleware: her isteğe trace_id atama (logda görünür)
  - AccessLogMiddleware: her isteği yapılandırılmış logla
  - LocaleMiddleware: X-Lang/Accept-Language parse → request.state.lang
"""

from __future__ import annotations

import time
from uuid import uuid4

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger

logger = get_logger(__name__)


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        trace_id = request.headers.get("x-request-id") or uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(trace_id=trace_id)
        request.state.trace_id = trace_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = trace_id
        return response


class AccessLogMiddleware(BaseHTTPMiddleware):
    SKIP_PATHS = ("/health", "/metrics", "/api/v1/health")

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.exception(
                "http.request.error",
                method=request.method,
                path=request.url.path,
                duration_ms=round(duration_ms, 2),
            )
            raise
        duration_ms = (time.perf_counter() - start) * 1000
        if not any(request.url.path.startswith(p) for p in self.SKIP_PATHS):
            logger.info(
                "http.request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round(duration_ms, 2),
                client=request.client.host if request.client else None,
            )
        response.headers["X-Response-Time-Ms"] = str(round(duration_ms, 2))
        return response


class LocaleMiddleware:
    """Pure ASGI middleware. BaseHTTPMiddleware ContextVar bug'ından kaçınır.
    X-Lang (öncelikli) veya Accept-Language → request.state.lang + ContextVar."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        from app.core.i18n import parse_accept_language, current_lang_ctxvar
        from starlette.datastructures import State
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        x_lang = headers.get("x-lang")
        if x_lang and x_lang.lower() in ("tr", "en"):
            lang = x_lang.lower()
        else:
            lang = parse_accept_language(headers.get("accept-language"))
        current_lang_ctxvar.set(lang)
        if "state" not in scope:
            scope["state"] = State()
        # State object veya dict olabilir
        try:
            scope["state"].lang = lang
        except Exception:
            scope["state"]["lang"] = lang
        await self.app(scope, receive, send)

