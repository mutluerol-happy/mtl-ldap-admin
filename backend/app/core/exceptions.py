# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Merkezi exception sınıfları ve FastAPI exception handler'ları.

Tüm API hataları aynı JSON formatında döner:
  { "error": { "code": "ERR_CODE", "message": "...", "details": {...} } }
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger
from app.core.i18n import t

logger = get_logger(__name__)


class MTLError(Exception):
    """Tüm MTL uygulama hatalarının taban sınıfı."""

    code: str = "MTL_ERROR"
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    default_message: str = "Beklenmeyen sunucu hatası"

    def __init__(
        self,
        message: str | None = None,
        details: dict[str, Any] | None = None,
        code: str | None = None,
    ) -> None:
        self.message = message or self.default_message
        self.details = details or {}
        if code:
            self.code = code
        super().__init__(self.message)


class ValidationError(MTLError):
    code = "VALIDATION_ERROR"
    status_code = status.HTTP_400_BAD_REQUEST
    default_message = "Geçersiz istek verisi"


class AuthenticationError(MTLError):
    code = "AUTH_FAILED"
    status_code = status.HTTP_401_UNAUTHORIZED
    default_message = "Kimlik doğrulama başarısız"


class AuthorizationError(MTLError):
    code = "FORBIDDEN"
    status_code = status.HTTP_403_FORBIDDEN
    default_message = "Bu işlem için yetkiniz yok"


class NotFoundError(MTLError):
    code = "NOT_FOUND"
    status_code = status.HTTP_404_NOT_FOUND
    default_message = "Kayıt bulunamadı"


class ConflictError(MTLError):
    code = "CONFLICT"
    status_code = status.HTTP_409_CONFLICT
    default_message = "Çakışma — kayıt zaten var veya kullanılıyor"


class RateLimitError(MTLError):
    code = "RATE_LIMIT_EXCEEDED"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_message = "Çok fazla istek — lütfen biraz sonra tekrar deneyin"


class LDAPOperationError(MTLError):
    code = "LDAP_ERROR"
    status_code = status.HTTP_502_BAD_GATEWAY
    default_message = "LDAP sunucusu erişilemiyor veya hata döndü"


class ClusterError(MTLError):
    code = "CLUSTER_ERROR"
    status_code = status.HTTP_502_BAD_GATEWAY
    default_message = "Cluster düğümleri arası senkron hatası"


class ReadOnlyError(MTLError):
    code = "READ_ONLY"
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_message = "Bu sunucu salt-okunur (slave) — değişiklik için master kullanın"


# ============================================================================
# FastAPI Handler'lar
# ============================================================================


def _error_response(
    code: str,
    message: str,
    status_code: int,
    details: dict[str, Any] | None = None,
    request: Request | None = None,
) -> JSONResponse:
    """Tek tip JSON hata yanıtı."""
    lang = getattr(getattr(request, "state", None), "lang", "tr")
    _translated = t(f"errors.{code}", lang=lang)
    _final_msg = _translated if _translated != f"errors.{code}" else message
    payload: dict[str, Any] = {"error": {"code": code, "message": _final_msg}}
    if details:
        payload["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


async def mtl_error_handler(request: Request, exc: MTLError) -> JSONResponse:
    """MTLError ve alt sınıfları için handler."""
    logger.warning(
        "api.mtl_error",
        code=exc.code,
        message=exc.message,
        path=request.url.path,
        method=request.method,
    )
    return _error_response(exc.code, exc.message, exc.status_code, exc.details, request=request)


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Pydantic doğrulama hataları için handler."""
    errors = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
        errors.append({"field": loc, "message": err.get("msg", "").removeprefix("Value error, ").removeprefix("Assertion failed, "), "type": err.get("type", "")})

    logger.warning(
        "api.validation_error", path=request.url.path, errors_count=len(errors)
    )
    return _error_response(
        code="VALIDATION_ERROR",
        message="İstek verisi geçersiz",
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        details={"errors": errors},
        request=request,
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Standart HTTPException için handler."""
    return _error_response(
        code="HTTP_ERROR",
        message=str(exc.detail),
        status_code=exc.status_code,
        request=request,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Beklenmeyen tüm hatalar — 500 döner, log'a yazar."""
    logger.exception(
        "api.unhandled_exception",
        path=request.url.path,
        method=request.method,
        error_type=type(exc).__name__,
    )
    return _error_response(
        code="INTERNAL_ERROR",
        message="Sunucuda beklenmeyen bir hata oluştu",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        request=request,
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Tüm handler'ları FastAPI'ye kayıt et (app.main'den çağrılır)."""
    app.add_exception_handler(MTLError, mtl_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
