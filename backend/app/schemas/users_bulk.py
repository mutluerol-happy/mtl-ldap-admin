# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""User bulk update/delete şemaları (Tur 4 eklemesi)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class BulkUserUpdateItem(BaseModel):
    uid: str = Field(..., min_length=3, max_length=64)
    cn: str | None = Field(None, max_length=128)
    sn: str | None = Field(None, max_length=64)
    given_name: str | None = Field(None, max_length=64)
    display_name: str | None = Field(None, max_length=128)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=32)
    title: str | None = Field(None, max_length=128)
    department: str | None = Field(None, max_length=128)
    is_active: bool | None = None
    preferred_language: Literal["tr", "en"] | None = None
    security_flags: dict[str, Any] | None = None


class BulkUserUpdateRequest(BaseModel):
    items: list[BulkUserUpdateItem] = Field(..., min_length=1, max_length=10000)
    on_error: Literal["skip", "fail"] = "skip"


class BulkUserDeleteRequest(BaseModel):
    uids: list[str] = Field(..., min_length=1, max_length=10000)
    on_error: Literal["skip", "fail"] = "skip"
