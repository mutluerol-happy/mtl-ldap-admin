# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
MTL LDAP Admin Backend — Ana giriş noktası.

Çalıştırma:
  Geliştirme   : uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
  Üretim       : gunicorn -k uvicorn.workers.UvicornWorker -w 4 app.main:app
  systemd      : ExecStart=/opt/mtl/venv/bin/gunicorn ... (mtl-ldap-admin.service)
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.db import dispose_engine, init_engine
from app.core.exceptions import register_exception_handlers
from app.core.ldap import dispose_ldap, init_ldap
from app.core.logging import configure_logging, get_logger
from app.core.middleware import AccessLogMiddleware, RequestIDMiddleware, LocaleMiddleware
from app.core.redis_client import dispose_redis, init_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Uygulama yaşam döngüsü.

    Startup:
      1. Logging yapılandır
      2. DB engine başlat
      3. Redis client başlat
      4. LDAP client başlat
      5. Bootstrap admin (sadece master)
    Shutdown:
      Hepsini ters sırada kapat.
    """
    configure_logging()
    logger = get_logger("app.lifespan")
    settings = get_settings()

    logger.info(
        "app.startup",
        version="0.1.0",
        profile=settings.profile.value,
        listen=f"{settings.listen_host}:{settings.listen_port}",
    )

    init_engine()
    init_redis()
    init_ldap()

    # Bootstrap admin (master-only, idempotent)
    if settings.is_master:
        try:
            from app.core.db import session_scope
            from app.services.bootstrap import ensure_bootstrap_admin

            async with session_scope() as db:
                await ensure_bootstrap_admin(db)
        except Exception:  # noqa: BLE001
            logger.exception("app.bootstrap.failed")
            # Bootstrap başarısız olursa uygulama yine de açılır;
            # operatör log'a bakıp düzeltir.

    logger.info("app.ready")
    yield

    logger.info("app.shutdown")
    dispose_ldap()
    await dispose_redis()
    await dispose_engine()
    logger.info("app.stopped")


def create_app() -> FastAPI:
    """Application factory (testing için ayrı çağrılabilir)."""
    settings = get_settings()

    app = FastAPI(
        title="MTL LDAP Admin API",
        description=(
            "Kurumsal LDAP/IAM yönetim platformu backend API'si. "
            f"Profil: {settings.profile.value}"
        ),
        version="0.1.0",
        docs_url="/api/docs" if settings.debug else None,
        redoc_url="/api/redoc" if settings.debug else None,
        openapi_url="/api/openapi.json" if settings.debug else None,
        lifespan=lifespan,
    )

    # Middleware (sırayla — son eklenen ilk çalışır)
    app.add_middleware(LocaleMiddleware)
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(AccessLogMiddleware)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["*"],
            expose_headers=["X-Request-ID", "X-Response-Time-Ms"],
        )

    # Exception handler'lar
    register_exception_handlers(app)

    # Router'lar
    app.include_router(api_router, prefix=settings.api_prefix)

    # Kök endpoint
    @app.get("/", include_in_schema=False)
    async def root():
        return {
            "service": "mtl-ldap-admin",
            "version": "0.1.0",
            "profile": settings.profile.value,
            "api": settings.api_prefix,
        }

    return app


app = create_app()
