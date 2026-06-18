# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Alert engine worker task."""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.logging import get_logger
from app.worker.celery_app import celery_app

logger = get_logger(__name__)


@celery_app.task(name="alert.evaluate_rules", bind=True)
def evaluate_alert_rules_task(self) -> dict[str, Any]:
    """Tüm aktif alert kurallarını değerlendir, tetiklenenler için AlertEvent yarat."""
    try:
        return asyncio.run(_eval_async())
    except Exception as e:  # noqa: BLE001
        logger.exception("alert.task.failed", error=str(e))
        return {"error": str(e)}


async def _eval_async() -> dict[str, Any]:
    from app.core.db import init_engine, session_scope
    from app.services.alert_service import evaluate_all_rules

    init_engine()
    async with session_scope() as db:
        return await evaluate_all_rules(db)
