# SPDX-License-Identifier: Apache-2.0
"""Hafif JSON tabanlı i18n yardımcısı."""
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

DEFAULT_LANG = "tr"
SUPPORTED_LANGS = ("tr", "en")
LOCALES_DIR = Path(__file__).parent.parent / "locales"


@lru_cache(maxsize=8)
def _load_locale(lang: str) -> dict[str, Any]:
    if lang not in SUPPORTED_LANGS:
        lang = DEFAULT_LANG
    path = LOCALES_DIR / f"{lang}.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def t(key: str, lang: str = DEFAULT_LANG, **kwargs: Any) -> str:
    """Nokta-yollu key ile çeviri. Bulamazsa key'i geri döndürür."""
    if not lang or lang not in SUPPORTED_LANGS:
        lang = DEFAULT_LANG

    data = _load_locale(lang)
    parts = key.split(".")
    value: Any = data
    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            value = None
            break

    if not isinstance(value, str):
        if lang != DEFAULT_LANG:
            return t(key, DEFAULT_LANG, **kwargs)
        return key

    if kwargs:
        try:
            return value.format(**kwargs)
        except (KeyError, IndexError):
            return value
    return value


def parse_accept_language(header: str | None) -> str:
    """Accept-Language header'ı parse et. Quality (q=) öncelikli."""
    if not header:
        return DEFAULT_LANG

    candidates: list[tuple[str, float]] = []
    for part in header.split(","):
        item = part.strip().split(";")
        lang = item[0].strip().lower()
        if "-" in lang:
            lang = lang.split("-")[0]
        q = 1.0
        if len(item) > 1:
            try:
                q_part = item[1].strip()
                if q_part.startswith("q="):
                    q = float(q_part[2:])
            except (IndexError, ValueError):
                pass
        candidates.append((lang, q))

    candidates.sort(key=lambda x: x[1], reverse=True)
    for lang, _ in candidates:
        if lang in SUPPORTED_LANGS:
            return lang

    return DEFAULT_LANG


# ─────────────────────────────────────────────────────────────────────────────
# Request scope için ContextVar (Pydantic validator gibi request-free yerlerde de erişebiliriz)
# ─────────────────────────────────────────────────────────────────────────────
from contextvars import ContextVar
current_lang_ctxvar: ContextVar[str] = ContextVar("current_lang", default=DEFAULT_LANG)

def get_current_lang() -> str:
    """ContextVar'dan lang oku (LocaleMiddleware set ediyor)."""
    try:
        return current_lang_ctxvar.get()
    except Exception:
        return DEFAULT_LANG
