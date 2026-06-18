# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
PostgreSQL bağlantı yönetimi (async SQLAlchemy 2).

Engine ve sessionmaker uygulama başlangıcında bir kez kurulur,
FastAPI dependency olarak per-request session enjekte edilir.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    """Tüm ORM modelleri bundan türetilir."""

    pass


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def init_engine() -> AsyncEngine:
    """
    Engine'i başlat (uygulama lifespan'inde çağrılır).

    Idempotent: çağrı zaten yapıldıysa mevcut engine'i döner.
    """
    global _engine, _sessionmaker
    if _engine is not None:
        return _engine

    settings = get_settings()
    logger.info(
        "db.engine.init",
        url=_safe_url(settings.db_url),
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )

    _engine = create_async_engine(
        settings.db_url,
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_pre_ping=True,  # Stale bağlantıları otomatik düzeltir
        connect_args={
            "server_settings": {
                "application_name": f"mtl-{settings.node_id}",
                "timezone": "UTC",
            }
        },
    )
    _sessionmaker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )
    return _engine


async def dispose_engine() -> None:
    """Engine'i temiz kapat (lifespan shutdown'da çağrılır)."""
    global _engine, _sessionmaker
    if _engine is not None:
        logger.info("db.engine.dispose")
        await _engine.dispose()
        _engine = None
        _sessionmaker = None


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("Engine başlatılmadı — init_engine() çağrılmalı")
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("Sessionmaker başlatılmadı — init_engine() çağrılmalı")
    return _sessionmaker


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency — per-request session.

    Kullanım:
        @router.get("/users")
        async def list_users(db: AsyncSession = Depends(get_session)):
            ...

    Otomatik rollback hata durumunda, otomatik close her zaman.
    """
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def session_scope() -> AsyncGenerator[AsyncSession, None]:
    """
    Manuel kullanım için context manager (worker, CLI, vs.).

    Kullanım:
        async with session_scope() as db:
            await db.execute(...)
            await db.commit()
    """
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def check_db_health() -> dict[str, Any]:
    """
    Healthcheck için: bağlantı çalışıyor mu ve mtl_core şeması var mı?
    """
    from sqlalchemy import text

    try:
        async with session_scope() as db:
            result = await db.execute(text("SELECT 1"))
            result.scalar_one()

            # Şema kontrolü
            schema_result = await db.execute(
                text(
                    "SELECT count(*) FROM information_schema.schemata "
                    "WHERE schema_name IN ('mtl_core', 'mtl_audit')"
                )
            )
            schema_count = schema_result.scalar_one()

        return {
            "status": "healthy",
            "schemas_present": schema_count >= 2,
            "schema_count": schema_count,
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


def _safe_url(url: str) -> str:
    """DB URL'inden parolayı gizle (log için)."""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.password:
            return url.replace(parsed.password, "***")
    except Exception:  # noqa: BLE001
        pass
    return url
