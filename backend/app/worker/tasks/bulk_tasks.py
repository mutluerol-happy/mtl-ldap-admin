# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Bulk import için Celery task'leri."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.core.logging import get_logger
from app.worker.celery_app import celery_app

logger = get_logger(__name__)


@celery_app.task(name="bulk.run_user_import", bind=True, max_retries=0)
def run_bulk_user_import(
    self,
    job_id: str,
    items: list[dict[str, Any]],
    on_conflict: str,
    initiated_by: str,
) -> dict[str, Any]:
    """
    Sync Celery task entry — içeride async kodu çalıştırır.

    Sebep: ldap3 sync ama servislerimiz async SQLAlchemy kullanıyor.
    """
    logger.info("bulk.task.started", job_id=job_id, total=len(items))
    try:
        result = asyncio.run(_run_async(job_id, items, on_conflict, initiated_by))
        logger.info("bulk.task.completed", job_id=job_id, result=result)
        return result
    except Exception as e:  # noqa: BLE001
        logger.exception("bulk.task.failed", job_id=job_id)
        # Job'u failed olarak işaretle
        try:
            asyncio.run(_mark_failed(job_id, str(e)))
        except Exception:  # noqa: BLE001
            pass
        raise


async def _run_async(
    job_id: str,
    items: list[dict[str, Any]],
    on_conflict: str,
    initiated_by: str,
) -> dict[str, Any]:
    from uuid import UUID

    from app.core.db import init_engine, session_scope
    from app.core.ldap import init_ldap
    from app.models.bulk_import import BulkImportJob
    from app.schemas.users import UserCreateRequest
    from app.services import ldap_user_service
    from sqlalchemy import select

    # Worker context — engine/ldap initialize gerekli
    init_engine()
    init_ldap()

    job_uuid = UUID(job_id)
    initiated_by_uuid = UUID(initiated_by)

    async with session_scope() as db:
        # Job kaydını al
        stmt = select(BulkImportJob).where(BulkImportJob.id == job_uuid)
        result = await db.execute(stmt)
        job = result.scalar_one_or_none()
        if job is None:
            return {"error": "job_not_found"}

        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        await db.commit()

        successful = 0
        failed = 0
        errors: list[dict[str, Any]] = []

        for idx, item_data in enumerate(items):
            try:
                req = UserCreateRequest(**item_data)
                await ldap_user_service.create_user(db, req, created_by=initiated_by_uuid)
                successful += 1
            except Exception as e:  # noqa: BLE001
                err_msg = str(e)
                if ("UID_EXISTS" in err_msg or "UID_EXISTS_DB" in err_msg) and on_conflict == "skip":
                    successful += 1
                    errors.append({"index": idx, "uid": item_data.get("uid"), "status": "skipped",
                                   "reason": "uid_exists"})
                else:
                    failed += 1
                    errors.append({"index": idx, "uid": item_data.get("uid"), "error": err_msg})
                    if on_conflict == "fail":
                        # Erken kes
                        break

            # Periyodik progress update (50 kayıtta bir)
            if (idx + 1) % 50 == 0:
                job.processed_records = idx + 1
                job.successful_records = successful
                job.failed_records = failed
                await db.commit()

        job.processed_records = len(items)
        job.successful_records = successful
        job.failed_records = failed
        job.error_log = errors[:1000]  # max 1000 hata log'la
        job.completed_at = datetime.now(timezone.utc)
        job.status = "completed" if failed == 0 else "partial"
        job.result_summary = {
            "successful": successful,
            "failed": failed,
            "total": len(items),
            "on_conflict": on_conflict,
        }
        await db.commit()

        return {"job_id": job_id, "successful": successful, "failed": failed}


async def _mark_failed(job_id: str, error_msg: str) -> None:
    from uuid import UUID

    from app.core.db import init_engine, session_scope
    from app.models.bulk_import import BulkImportJob
    from sqlalchemy import select

    init_engine()
    async with session_scope() as db:
        stmt = select(BulkImportJob).where(BulkImportJob.id == UUID(job_id))
        result = await db.execute(stmt)
        job = result.scalar_one_or_none()
        if job is not None:
            job.status = "failed"
            job.completed_at = datetime.now(timezone.utc)
            job.result_summary = {"error": error_msg}
            await db.commit()
