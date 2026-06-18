# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
MFA (TOTP) servisi — pure utility'ler.

  - generate_secret / get_totp_uri / generate_qr_data_uri
  - verify_totp (window=1 ile)
  - replay koruması (Redis)
  - recovery code üretici

Admin secret'i mtl_core.admin_account.mfa_secret_encrypted'ta Fernet ile
saklanır — auth_service.py o tablo erişimini yönetir.
"""

from __future__ import annotations

import base64
import io
import secrets

import pyotp
import qrcode

from app.core.logging import get_logger
from app.core.redis_client import get_redis

logger = get_logger(__name__)

TOTP_DIGITS = 6
TOTP_INTERVAL = 30
TOTP_WINDOW = 1  # önceki + sonraki time-step
ISSUER_NAME = "MTL LDAP Admin"


def generate_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(username: str, secret: str) -> str:
    return pyotp.totp.TOTP(
        secret,
        digits=TOTP_DIGITS,
        interval=TOTP_INTERVAL,
    ).provisioning_uri(name=username, issuer_name=ISSUER_NAME)


def generate_qr_data_uri(otpauth_uri: str) -> str:
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(otpauth_uri)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def verify_totp(secret: str, code: str) -> bool:
    if not code.isdigit() or len(code) != TOTP_DIGITS:
        return False
    try:
        totp = pyotp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_INTERVAL)
        return totp.verify(code, valid_window=TOTP_WINDOW)
    except Exception as e:  # noqa: BLE001
        logger.warning("mfa.totp.verify_error", error=str(e))
        return False


# Replay koruması — kodu en fazla 1 kez


def _used_code_key(subject_id: str, code: str) -> str:
    return f"mtl:auth:mfa:used:{subject_id}:{code}"


async def is_code_already_used(subject_id: str, code: str) -> bool:
    redis = get_redis()
    return bool(await redis.exists(_used_code_key(subject_id, code)))


async def mark_code_used(subject_id: str, code: str) -> None:
    redis = get_redis()
    ttl = TOTP_INTERVAL * (TOTP_WINDOW + 1) + 5
    await redis.setex(_used_code_key(subject_id, code), ttl, "1")


def generate_recovery_codes(count: int = 10) -> list[str]:
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(4).upper()  # 8 hex char
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes
