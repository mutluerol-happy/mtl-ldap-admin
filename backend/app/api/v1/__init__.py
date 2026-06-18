# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
API v1 router toplama.
Master ve slave farklı endpoint setleri kullanır:
  - Master  : tüm admin endpoint'leri (auth, users, groups, admins, rbac, sync, audit, cluster, alerts, settings)
  - Slave   : reset + end_user self-service + (audit query, cluster) ortak
Bu sayede aynı kod tabanı iki rolü destekler; runtime'da settings.profile'a göre seçilir.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admins,
    alerts,
    audit,
    auth,
    cluster,
    dashboard,
    end_user_auth,
    groups,
    health,
    rbac,
    reset,
    shield,
    sync,
    users,
)
from app.api.v1 import settings as settings_api  # global `settings` ile çakışmasın
from app.core.config import get_settings

api_router = APIRouter()
settings = get_settings()

# Ortak
api_router.include_router(health.router)
api_router.include_router(cluster.router)
api_router.include_router(audit.router)
# Self-service portal endpoints (ortak — master ve slave için)
api_router.include_router(reset.router)
api_router.include_router(end_user_auth.router)

if settings.is_master:
    api_router.include_router(auth.router)
    api_router.include_router(users.router)
    api_router.include_router(groups.router)
    api_router.include_router(admins.router)
    api_router.include_router(rbac.router)
    api_router.include_router(sync.router)
    api_router.include_router(alerts.router)
    api_router.include_router(dashboard.router)
    api_router.include_router(settings_api.router)  # Tur 10 — master only
    api_router.include_router(shield.router)  # Tur 14 — master only

if settings.is_slave:
    pass
