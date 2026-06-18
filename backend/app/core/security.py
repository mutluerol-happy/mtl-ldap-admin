# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Kriptografik yardımcılar.

  - Fernet ile symmetric encrypt/decrypt (mtlMfaSecret saklamak için)
  - Bcrypt ile password hash (PostgreSQL'deki internal user'lar için)
  - Secure random token üretici
"""

from __future__ import annotations

import secrets
from functools import lru_cache

import bcrypt
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

# Bcrypt round=12 — 2026 standartı
_BCRYPT_ROUNDS = 12

# Bcrypt 72-byte sınırı — uzun parolaları truncate etmek yerine reddederiz
_MAX_PASSWORD_BYTES = 72


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    """Fernet instance — settings'ten key okur, cache'ler."""
    settings = get_settings()
    key = settings.fernet_key.get_secret_value().encode()
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    """
    String'i Fernet ile şifrele.

    Returns:
        Base64-encoded ciphertext (URL-safe, str).
    """
    if not plaintext:
        raise ValueError("encrypt: boş string şifrelenemez")
    token = _fernet().encrypt(plaintext.encode("utf-8"))
    return token.decode("ascii")


def decrypt(ciphertext: str) -> str:
    """
    Şifreyi çöz.

    Raises:
        ValueError: token bozuk veya yanlış key ile şifrelenmişse.
    """
    if not ciphertext:
        raise ValueError("decrypt: boş ciphertext")
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise ValueError("Geçersiz veya bozuk ciphertext") from e


def hash_password(password: str) -> str:
    """
    Plaintext parolayı bcrypt ile hash'le.

    Returns:
        Bcrypt hash (str, UTF-8 decoded).

    Raises:
        ValueError: parola 72 byte'tan uzunsa.
    """
    if not password:
        raise ValueError("Parola boş olamaz")
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > _MAX_PASSWORD_BYTES:
        raise ValueError(f"Parola {_MAX_PASSWORD_BYTES} byte'tan uzun olamaz")
    salt = bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Plaintext parolayı hash ile karşılaştır (constant time, exception-safe)."""
    if not password or not hashed:
        return False
    try:
        password_bytes = password.encode("utf-8")[:_MAX_PASSWORD_BYTES]
        return bcrypt.checkpw(password_bytes, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def generate_token(nbytes: int = 32) -> str:
    """
    Cryptographically secure rastgele token üret.

    Kullanım: OTP token, password reset link token, vs.
    """
    return secrets.token_urlsafe(nbytes)


def generate_otp_code(digits: int = 6) -> str:
    """
    Sayısal OTP kodu üret (e-mail/SMS reset için).

    secrets.randbelow ile uniform dağılım garantili.
    """
    if digits < 4 or digits > 10:
        raise ValueError("OTP digit sayısı 4-10 arasında olmalı")
    max_val = 10**digits
    code = secrets.randbelow(max_val)
    return str(code).zfill(digits)


def constant_time_compare(a: str, b: str) -> bool:
    """
    Timing-safe string karşılaştırma.

    Token doğrulama, OTP doğrulama, vs. için.
    """
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
