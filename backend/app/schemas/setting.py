# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Settings API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SystemSettingItem(BaseModel):
    """Liste / detay öğesi. Hassas alanlar caller permission'una göre
    maskelenmiş (`'***'`) veya açık değer döner."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: str
    key: str
    # Parsed value (bool/int/str/dict). Hassas + permission yoksa "***" string'i.
    value: Any | None = None
    is_set: bool = False  # değerin dolu olup olmadığı (mask sonrası bilgiye gerek için)
    value_type: str
    is_sensitive: bool
    is_editable: bool
    description: str | None = None
    default_value: str | None = None
    updated_at: datetime
    updated_by: UUID | None = None


class SettingsCategoryResponse(BaseModel):
    """Tek kategori altındaki tüm ayarlar."""

    category: str
    title: str  # localized e.g. "Parola Politikası"
    description: str | None = None
    settings: list[SystemSettingItem]


class SettingsListResponse(BaseModel):
    """Üst response — tüm kategoriler."""

    categories: list[SettingsCategoryResponse]


class SettingUpdateRequest(BaseModel):
    """Ayarı güncelle. Value tipi serverda doğrulanır."""

    value: Any  # int / bool / str / dict — service validate eder


class SmtpTestRequest(BaseModel):
    """SMTP test maili."""

    to_email: str = Field(..., min_length=3, max_length=320, description="Alıcı e-posta")


class ServiceStatus(BaseModel):
    name: str
    status: str  # "active" | "inactive" | "failed" | "unknown"


class SystemInfoResponse(BaseModel):
    """Sistem bilgisi: versiyon, profile, services, DB/Redis/LDAP detay."""

    version: str
    profile: str  # MASTER | SLAVE
    node_id: str
    install_date: datetime | None = None

    # Runtime
    python_version: str
    fastapi_version: str | None = None

    # DB
    db_name: str | None = None
    db_version: str | None = None

    # Redis
    redis_version: str | None = None

    # LDAP
    ldap_uri: str | None = None
    ldap_base_dn: str | None = None

    # Services
    services: list[ServiceStatus] = Field(default_factory=list)


# ============================================================================
# Tur D2 — SMS Test
# ============================================================================
class SmsTestRequest(BaseModel):
    to_number: str | None = Field(
        None,
        description="Test SMS alici (bossa settings sms.test_to_number kullanilir)",
    )


class SmsTestResponse(BaseModel):
    ok: bool
    provider: str | None = None
    status: int | None = None
    error: str | None = None
    body: str | None = None


# ============================================================================
# Tur D — Notification Channels (Slack/Teams/Webhook) Test
# ============================================================================
class NotificationTestRequest(BaseModel):
    channel: str = Field(..., description="slack, teams veya webhook")


class NotificationTestResponse(BaseModel):
    ok: bool
    channel: str | None = None
    status: int | None = None
    error: str | None = None
    body: str | None = None
