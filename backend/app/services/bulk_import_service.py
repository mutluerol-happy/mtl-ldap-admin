# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Bulk user import servisi.

İki kullanım:
  1. JSON payload: POST /users/bulk JSON body → senkron veya async
  2. CSV upload: POST /users/bulk multipart → async (Celery task)

JSON formatında küçük setler için (≤500) senkron işleriz.
Daha büyükler Celery'ye atılır.

CSV beklenen kolonlar (header sırası önemsiz):
  uid, cn, sn, given_name, email, phone, title, department, password,
  must_change_password, preferred_language
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationError
from app.core.logging import get_logger
from app.models.bulk_import import BulkImportJob
from app.schemas.users import BulkUserItem
from app.services import ldap_user_service

logger = get_logger(__name__)

SYNC_THRESHOLD = 500  # bu sınırın altı senkron, üstü async


async def import_users_from_json(
    db: AsyncSession,
    items: list[BulkUserItem],
    on_conflict: str = "skip",
    initiated_by: UUID | None = None,
) -> BulkImportJob:
    """JSON payload bulk import — küçük setler için senkron."""
    if initiated_by is None:
        raise ValidationError("initiated_by zorunlu", code="MISSING_ACTOR")

    job = BulkImportJob(
        job_type="user_create",
        initiated_by=initiated_by,
        status="running",
        total_records=len(items),
        source_format="json",
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    await db.flush()
    job_id = job.id

    if len(items) > SYNC_THRESHOLD:
        # Çok büyük → async task'e gönder
        from app.worker.tasks.bulk_tasks import run_bulk_user_import
        # Items'ı dict listesine çevir Celery için
        items_dict = [it.model_dump() for it in items]
        task = run_bulk_user_import.delay(
            job_id=str(job_id),
            items=items_dict,
            on_conflict=on_conflict,
            initiated_by=str(initiated_by),
        )
        job.celery_task_id = task.id
        job.status = "pending"
        await db.commit()
        return job

    # Senkron işle
    return await _process_bulk_sync(db, job, items, on_conflict, initiated_by)


async def import_users_from_csv(
    db: AsyncSession,
    csv_content: bytes,
    filename: str,
    on_conflict: str = "skip",
    initiated_by: UUID | None = None,
) -> BulkImportJob:
    """CSV içeriğinden bulk import — her zaman async."""
    if initiated_by is None:
        raise ValidationError("initiated_by zorunlu", code="MISSING_ACTOR")

    # CSV parse — formatı validate et
    try:
        text = csv_content.decode("utf-8")
    except UnicodeDecodeError:
        text = csv_content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    raw_rows = list(reader)

    # Her satırı BulkUserItem'a parse et (validate)
    items: list[BulkUserItem] = []
    parse_errors: list[dict[str, Any]] = []
    for idx, row in enumerate(raw_rows, start=2):  # CSV header 1. satır
        try:
            # Tip dönüşümü (must_change_password "true"/"false" → bool)
            mcp = row.get("must_change_password", "true").strip().lower()
            must_change = mcp in ("true", "1", "yes", "evet")
            item = BulkUserItem(
                uid=row.get("uid", "").strip(),
                cn=row.get("cn", "").strip(),
                sn=row.get("sn", "").strip(),
                given_name=row.get("given_name") or None,
                email=row.get("email") or None,
                phone=row.get("phone") or None,
                title=row.get("title") or None,
                department=row.get("department") or None,
                password=row.get("password", ""),
                must_change_password=must_change,
                preferred_language=(row.get("preferred_language") or "tr").strip(),  # type: ignore
            )
            items.append(item)
        except PydanticValidationError as e:
            parse_errors.append({"row": idx, "errors": e.errors()})

    job = BulkImportJob(
        job_type="user_create",
        initiated_by=initiated_by,
        status="pending" if items else "failed",
        total_records=len(raw_rows),
        successful_records=0,
        failed_records=len(parse_errors),
        source_filename=filename,
        source_format="csv",
        error_log=parse_errors,
        started_at=None,
    )
    db.add(job)
    await db.flush()
    job_id = job.id

    if not items:
        # Hiçbir geçerli kayıt yok
        job.status = "failed"
        job.result_summary = {"reason": "no_valid_rows"}
        await db.commit()
        return job

    # Async task
    from app.worker.tasks.bulk_tasks import run_bulk_user_import
    items_dict = [it.model_dump() for it in items]
    task = run_bulk_user_import.delay(
        job_id=str(job_id),
        items=items_dict,
        on_conflict=on_conflict,
        initiated_by=str(initiated_by),
    )
    job.celery_task_id = task.id
    await db.commit()
    return job


async def _process_bulk_sync(
    db: AsyncSession,
    job: BulkImportJob,
    items: list[BulkUserItem],
    on_conflict: str,
    initiated_by: UUID,
) -> BulkImportJob:
    """Küçük setler için senkron işleme."""
    successful = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for idx, item in enumerate(items):
        try:
            # UserCreateRequest formatına çevir
            from app.schemas.users import UserCreateRequest
            req = UserCreateRequest(**item.model_dump())
            await ldap_user_service.create_user(db, req, created_by=initiated_by)
            successful += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            err_msg = str(e)
            error_entry = {"index": idx, "uid": item.uid, "error": err_msg}
            errors.append(error_entry)

            # on_conflict politikası
            if "UID_EXISTS" in err_msg or "UID_EXISTS_DB" in err_msg:
                if on_conflict == "skip":
                    failed -= 1
                    successful += 1
                    error_entry["status"] = "skipped"
                elif on_conflict == "fail":
                    job.status = "failed"
                    break

    job.processed_records = len(items)
    job.successful_records = successful
    job.failed_records = failed
    job.error_log = errors
    job.completed_at = datetime.now(timezone.utc)
    job.status = "completed" if failed == 0 else "partial"
    job.result_summary = {
        "successful": successful,
        "failed": failed,
        "total": len(items),
        "on_conflict": on_conflict,
    }
    await db.commit()
    logger.info(
        "bulk.import.completed_sync",
        job_id=str(job.id),
        successful=successful,
        failed=failed,
    )
    return job


async def get_job(db: AsyncSession, job_id: UUID) -> BulkImportJob:
    from app.core.exceptions import NotFoundError
    stmt = select(BulkImportJob).where(BulkImportJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if job is None:
        raise NotFoundError("Bulk job bulunamadı", code="JOB_NOT_FOUND")
    return job


async def list_jobs(
    db: AsyncSession,
    initiated_by: UUID | None = None,
    limit: int = 50,
) -> list[BulkImportJob]:
    stmt = select(BulkImportJob)
    if initiated_by:
        stmt = stmt.where(BulkImportJob.initiated_by == initiated_by)
    stmt = stmt.order_by(BulkImportJob.queued_at.desc()).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars())


# ============================================================================
# Tur 4: Bulk update / delete
# ============================================================================


async def bulk_update_users(
    db: AsyncSession,
    items: list,  # list[BulkUserUpdateItem]
    on_error: str,
    initiated_by: UUID,
) -> BulkImportJob:
    """Senkron işlem — küçük setler için. Büyük setler async'a düşmez bu sürümde."""
    from app.schemas.users import UserUpdateRequest

    job = BulkImportJob(
        job_type="user_update",
        initiated_by=initiated_by,
        status="running",
        total_records=len(items),
        source_format="json",
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    await db.flush()

    successful = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for idx, item in enumerate(items):
        try:
            req = UserUpdateRequest(
                cn=item.cn, sn=item.sn, given_name=item.given_name,
                display_name=item.display_name, email=item.email, phone=item.phone,
                title=item.title, department=item.department,
                is_active=item.is_active, preferred_language=item.preferred_language,
                security_flags=item.security_flags,
            )
            await ldap_user_service.update_user(db, item.uid, req, updated_by=initiated_by)
            successful += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            errors.append({"index": idx, "uid": item.uid, "error": str(e)})
            if on_error == "fail":
                break

    job.processed_records = len(items)
    job.successful_records = successful
    job.failed_records = failed
    job.error_log = errors
    job.completed_at = datetime.now(timezone.utc)
    job.status = "completed" if failed == 0 else "partial"
    job.result_summary = {"successful": successful, "failed": failed, "total": len(items)}
    await db.commit()
    logger.info("bulk.update.completed", job_id=str(job.id),
                successful=successful, failed=failed)
    return job


async def bulk_delete_users(
    db: AsyncSession,
    uids: list[str],
    on_error: str,
    initiated_by: UUID,
) -> BulkImportJob:
    """Bulk user silme."""
    job = BulkImportJob(
        job_type="user_create",  # bulk_import_job.job_type CHECK constraint
        initiated_by=initiated_by,
        status="running",
        total_records=len(uids),
        source_format="json",
        started_at=datetime.now(timezone.utc),
        result_summary={"operation": "delete"},
    )
    db.add(job)
    await db.flush()

    successful = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for idx, uid in enumerate(uids):
        try:
            await ldap_user_service.delete_user(db, uid, deleted_by=initiated_by)
            successful += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            errors.append({"index": idx, "uid": uid, "error": str(e)})
            if on_error == "fail":
                break

    job.processed_records = len(uids)
    job.successful_records = successful
    job.failed_records = failed
    job.error_log = errors
    job.completed_at = datetime.now(timezone.utc)
    job.status = "completed" if failed == 0 else "partial"
    job.result_summary = {"operation": "delete", "successful": successful,
                          "failed": failed, "total": len(uids)}
    await db.commit()
    logger.info("bulk.delete.completed", job_id=str(job.id),
                successful=successful, failed=failed)
    return job
