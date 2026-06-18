# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""LDAP↔DB sync için Celery beat task'leri."""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.worker.celery_app import celery_app

logger = get_logger(__name__)


@celery_app.task(name="sync.scan_users", bind=True)
def scan_users_task(self) -> dict[str, Any]:
    """Saatlik LDAP↔DB tarama."""
    settings = get_settings()
    if not settings.is_master:
        return {"skipped": "not_master"}

    try:
        return asyncio.run(_scan_async())
    except Exception as e:  # noqa: BLE001
        logger.exception("sync.task.failed", error=str(e))
        return {"error": str(e)}


async def _scan_async() -> dict[str, Any]:
    from app.core.db import init_engine, session_scope
    from app.core.ldap import init_ldap
    from app.services.sync_service import scan_user_sync

    init_engine()
    init_ldap()

    async with session_scope() as db:
        return await scan_user_sync(db)
