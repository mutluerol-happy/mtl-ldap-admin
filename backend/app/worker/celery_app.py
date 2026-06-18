# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Celery uygulama bootstrap'i.

Worker ve beat tarafından kullanılır. Şimdilik temel yapılandırma —
sonraki turlarda gerçek task'lar eklenecek (audit replication, sync grid,
cluster heartbeat, OTP gönderme, vs).
"""

from __future__ import annotations

from celery import Celery
from celery.signals import worker_ready, worker_shutdown

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger

settings = get_settings()

celery_app = Celery(
    "mtl",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,        # 5 dakika max
    task_soft_time_limit=240,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    broker_connection_retry_on_startup=True,
)

# Periyodik görevler
celery_app.conf.beat_schedule = {
    "sync-ldap-db-scan": {
        "task": "sync.scan_users",
        "schedule": 3600.0,  # her saat
    },
    # Tur 4: cluster sync grid
    "cluster-flush-sync-queue": {
        "task": "cluster.flush_sync_queue",
        "schedule": 10.0,  # her 10 saniyede bir master→slave forward
    },
    "cluster-stale-node-check": {
        "task": "cluster.stale_node_check",
        "schedule": 60.0,  # dakikada bir
    },
    # Tur 4: alert engine
    "alert-evaluate-rules": {
        "task": "alert.evaluate_rules",
        "schedule": 60.0,  # dakikada bir tüm rule'ları kontrol et
    },
    # Parola expiry sweep — gunde bir, suresi dolan parolalari 3.partiden kilitle
    "password-sweep-expired": {
        "task": "password.sweep_expired",
        "schedule": 86400.0,  # gunde bir
    },
    # Settings sync — slave master'dan ayarlari ceker (master'da is_slave guard ile no-op)
    "cluster-pull-master-settings": {
        "task": "cluster.pull_master_settings",
        "schedule": 60.0,
    },
}

# Task'leri import ederek register et
import app.worker.tasks.alert_tasks  # noqa: E402,F401
import app.worker.tasks.bulk_tasks  # noqa: E402,F401
import app.worker.tasks.cluster_tasks  # noqa: E402,F401
import app.worker.tasks.sync_tasks  # noqa: E402,F401
import app.worker.tasks.password_expiry_tasks  # noqa: E402,F401
import app.worker.tasks.settings_sync_tasks  # noqa: E402,F401

# Task modüllerini otomatik discover et
celery_app.autodiscover_tasks(["app.worker.tasks"], related_name=None)


@worker_ready.connect
def _on_worker_ready(**_kwargs) -> None:
    configure_logging()
    logger = get_logger("celery.worker")
    logger.info("celery.worker.ready", node_id=settings.node_id, profile=settings.profile.value)


@worker_shutdown.connect
def _on_worker_shutdown(**_kwargs) -> None:
    logger = get_logger("celery.worker")
    logger.info("celery.worker.shutdown")
