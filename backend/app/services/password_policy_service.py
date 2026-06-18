# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Merkezi parola politikası servisi.

`mtl_core.system_setting` tablosundaki `password_policy.*` anahtarlarından
politikayı okur ve validate eder. Tüm parola validation noktaları (admin
oluşturma, admin reset password, end-user change-password, password reset
completion vb.) bu servisi kullanmalı — böylece Settings'ten yapılan
değişiklik her yerde aynı anda geçerli olur.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.exceptions import ValidationError
from app.models.setting import SystemSetting


# Varsayılan politika — DB'de hiç ayar yoksa veya okuma başarısızsa kullanılır.
DEFAULT_POLICY: dict[str, Any] = {
    "min_length": 8,
    "max_length": 128,
    "require_upper": True,
    "require_lower": True,
    "require_digit": True,
    "require_special": False,
    # İleride kullanım için (history, age vb.) — şimdilik validation'da yer almıyor
    "history_count": 0,
    "min_age_hours": 0,
    "max_age_days": 0,
}


# ============================================================================
# Policy reader
# ============================================================================
async def get_active_policy(db: AsyncSession) -> dict[str, Any]:
    """Settings'ten aktif policy'yi yükle.

    Beklenen anahtarlar (mtl_core.system_setting):
      password_policy.min_length      (integer)
      password_policy.max_length      (integer)
      password_policy.require_upper   (boolean)
      password_policy.require_lower   (boolean)
      password_policy.require_digit   (boolean)
      password_policy.require_special (boolean)
      password_policy.history_count   (integer, opsiyonel)
      password_policy.min_age_hours   (integer, opsiyonel)
      password_policy.max_age_days    (integer, opsiyonel)

    Bunlardan biri eksikse veya parse edilemezse DEFAULT_POLICY değeri kullanılır.
    """
    stmt = select(SystemSetting).where(
        SystemSetting.category == "password_policy",
    )
    rows = (await db.execute(stmt)).scalars().all()

    policy = dict(DEFAULT_POLICY)
    int_keys = {"min_length", "max_length", "history_count", "min_age_hours", "max_age_days"}
    bool_keys = {"require_upper", "require_lower", "require_digit", "require_special"}

    for row in rows:
        # DB'de key'ler "password.min_length" gibi prefix'li — son segmenti al
        full_key = row.key
        key = full_key.rsplit(".", 1)[-1] if "." in full_key else full_key
        raw = row.value
        if raw is None:
            continue
        if key in int_keys:
            try:
                policy[key] = int(raw)
            except (TypeError, ValueError):
                pass  # default kalır
        elif key in bool_keys:
            policy[key] = str(raw).strip().lower() in ("true", "1", "yes", "on", "evet")
        else:
            policy[key] = raw

    # Mantıklı clamp'ler — kötü ayardan koruma
    policy["min_length"] = max(1, min(int(policy["min_length"]), 1024))
    policy["max_length"] = max(int(policy["min_length"]), min(int(policy["max_length"]), 1024))

    return policy


# ============================================================================
# Validation
# ============================================================================
def validate_password(
    password: str,
    policy: dict[str, Any],
    *,
    username: str | None = None,
    lang: str = "tr",
) -> None:
    """Policy'ye göre parolayı doğrula. Hatada ValidationError fırlat.

    Args:
        password: Yeni parola
        policy: get_active_policy()'den dönen sözlük
        username: kullanıcı adı (parolanın içermemesi için kontrol; opsiyonel)
    """
    if not isinstance(password, str) or password == "":
        raise ValidationError(t("errors.passwordEmpty", lang), code="PASSWORD_EMPTY")

    min_len = int(policy.get("min_length", 8))
    max_len = int(policy.get("max_length", 128))
    require_upper = bool(policy.get("require_upper", True))
    require_lower = bool(policy.get("require_lower", True))
    require_digit = bool(policy.get("require_digit", True))
    require_special = bool(policy.get("require_special", False))

    if len(password) < min_len:
        raise ValidationError(
            t("errors.passwordMinLength", lang).replace("{min}", str(min_len)),
            code="PASSWORD_TOO_SHORT",
            details={"min_length": min_len, "actual": len(password)},
        )
    if len(password) > max_len:
        raise ValidationError(
            t("errors.passwordMaxLength", lang).replace("{max}", str(max_len)),
            code="PASSWORD_TOO_LONG",
            details={"max_length": max_len, "actual": len(password)},
        )

    if require_upper and not any(c.isupper() for c in password):
                raise ValidationError(
            t("errors.passwordNoUpper", lang),
            code="PASSWORD_NO_UPPER",
        )
    if require_lower and not any(c.islower() for c in password):
        raise ValidationError(
            t("errors.passwordNoLower", lang),
            code="PASSWORD_NO_LOWER",
        )
    if require_digit and not any(c.isdigit() for c in password):
        raise ValidationError(
            t("errors.passwordNoDigit", lang),
            code="PASSWORD_NO_DIGIT",
        )
    if require_special and not any(not c.isalnum() for c in password):
        raise ValidationError(
            t("errors.passwordNoSpecial", lang),
            code="PASSWORD_NO_SPECIAL",
        )

    if username and len(username) >= 3 and username.lower() in password.lower():
        raise ValidationError(
            t("errors.passwordContainsUsername", lang),
            code="PASSWORD_CONTAINS_UID",
        )


async def validate_password_async(
    db: AsyncSession,
    password: str,
    *,
    username: str | None = None,
    lang: str = "tr",
) -> None:
    """Convenience: policy'yi DB'den otomatik yükle + validate et."""
    policy = await get_active_policy(db)
    validate_password(password, policy, username=username, lang=lang)


# ============================================================================
# Public dict — frontend'e gönderim için
# ============================================================================
async def get_public_policy(db: AsyncSession) -> dict[str, Any]:
    """Frontend'e gönderilecek policy görünümü.

    Sensitive olmayan bütün alanlar dahil. /reset/policy endpoint'i bunu kullanır.
    """
    policy = await get_active_policy(db)
    return {
        "min_length": policy["min_length"],
        "max_length": policy["max_length"],
        "require_upper": policy["require_upper"],
        "require_lower": policy["require_lower"],
        "require_digit": policy["require_digit"],
        "require_special": policy["require_special"],
        # Geriye dönük uyumluluk — eski Pydantic schemalarında bu isim de var
        "require_uppercase": policy["require_upper"],
        "require_lowercase": policy["require_lower"],
    }
