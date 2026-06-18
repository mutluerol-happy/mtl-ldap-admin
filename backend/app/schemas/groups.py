# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Group (LDAP groupOfNames veya posixGroup) şemaları."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


_CN_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9._\- ]{1,62}[a-zA-Z0-9]$")


def _validate_cn(value: str) -> str:
    v = value.strip()
    if not _CN_PATTERN.match(v):
        raise ValueError(
            "Grup adı 3-64 karakter; harf/rakam/./_/-/boşluk; harfle başlar"
        )
    return v


class GroupCreateRequest(BaseModel):
    cn: str = Field(..., min_length=3, max_length=64, examples=["developers"])
    description: str | None = Field(None, max_length=512)
    group_type: Literal["groupOfNames", "posixGroup"] = Field("groupOfNames")
    member_uids: list[str] = Field(default_factory=list, description="Üyelerin uid'leri")

    @field_validator("cn")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_cn(v)


class GroupUpdateRequest(BaseModel):
    description: str | None = Field(None, max_length=512)


class GroupMemberRequest(BaseModel):
    uid: str = Field(..., min_length=3, max_length=64)


class GroupPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cn: str
    dn: str
    description: str | None = None
    group_type: str
    member_dns: list[str] = Field(default_factory=list)
    member_count: int = 0


class GroupListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[GroupPublic]
