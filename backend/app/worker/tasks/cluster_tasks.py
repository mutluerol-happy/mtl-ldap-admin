# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Cluster sync worker task'leri."""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.worker.celery_app import celery_app

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# İzole engine helper (loop-safe) — Tur 13 fix
# Celery asyncio.run() her çağrıda yeni loop açar; global engine'in pool'u
# eski loop'a bağlı kalır → "Future attached to a different loop". Çözüm:
# her çağrıda NullPool'lu taze engine yaratıp iş bitince dispose etmek.
# ---------------------------------------------------------------------------
from contextlib import asynccontextmanager as _asynccontextmanager


@_asynccontextmanager
async def _isolated_session():
    from sqlalchemy.ext.asyncio import (
        AsyncSession as _AsyncSession,
        async_sessionmaker as _async_sessionmaker,
        create_async_engine as _create_async_engine,
    )
    from sqlalchemy.pool import NullPool as _NullPool

    _settings = get_settings()
    _engine = _create_async_engine(
        _settings.db_url,
        echo=False,
        poolclass=_NullPool,  # pool tutma — task kısa ömürlü, loop'a bağlanma sorunu yok
        connect_args={
            "server_settings": {
                "application_name": f"mtl-{_settings.node_id}-worker",
                "timezone": "UTC",
            }
        },
    )
    _maker = _async_sessionmaker(_engine, class_=_AsyncSession, expire_on_commit=False, autoflush=False)
    try:
        async with _maker() as _session:
            try:
                yield _session
            except Exception:
                await _session.rollback()
                raise
    finally:
        await _engine.dispose()



@celery_app.task(name="cluster.flush_sync_queue", bind=True)
def flush_sync_queue_task(self) -> dict[str, Any]:
    """Master tarafı: pending audit event'leri slave'lere POST et."""
    settings = get_settings()
    # AŞAMA 2: master VE slave flush eder (slave->master audit forward icin).
    # Hedef kuyruktaki target_node_id'den gelir; enqueue dogru yonu yazar.
    if not (settings.is_master or settings.is_slave):
        return {"skipped": "no_profile"}

    try:
        return asyncio.run(_flush_async())
    except Exception as e:  # noqa: BLE001
        logger.exception("cluster.flush.failed", error=str(e))
        return {"error": str(e)}


async def _flush_async() -> dict[str, Any]:
    from app.services.cluster_service import flush_queue_once

    async with _isolated_session() as db:
        return await flush_queue_once(db, batch_size=50)


@celery_app.task(name="cluster.stale_node_check", bind=True)
def stale_node_check_task(self) -> dict[str, Any]:
    """Heartbeat'i eskimiş node'ları offline işaretle."""
    try:
        return asyncio.run(_stale_async())
    except Exception as e:  # noqa: BLE001
        logger.exception("cluster.stale_check.failed", error=str(e))
        return {"error": str(e)}


async def _stale_async() -> dict[str, Any]:
    from app.services.cluster_service import get_cluster_status

    async with _isolated_session() as db:
        data = await get_cluster_status(db)  # bu zaten stale check yapıyor
        return {
            "total": data["total_nodes"],
            "online": data["online_nodes"],
            "offline": data["offline_nodes"],
        }
