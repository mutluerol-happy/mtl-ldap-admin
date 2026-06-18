# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
MTL Yapılandırılmış Loglama

structlog ile JSON loglar üretir, ELK/Loki gibi log aggregator'larına
doğrudan akabilir. Geliştirme için 'text' formatı da var.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, Processor

from app.core.config import get_settings


def _add_service_context(logger: Any, method_name: str, event_dict: EventDict) -> EventDict:
    """Her log mesajına node_id ve service ekle."""
    settings = get_settings()
    event_dict["service"] = "mtl-ldap-admin"
    event_dict["node_id"] = settings.node_id
    event_dict["profile"] = settings.profile.value
    return event_dict


def _drop_color_message_key(_: Any, __: str, event_dict: EventDict) -> EventDict:
    """uvicorn'un eklediği color_message anahtarını kaldır."""
    event_dict.pop("color_message", None)
    return event_dict


def configure_logging() -> None:
    """
    structlog + stdlib logging entegrasyonu.

    Çağrı yeri: app.main lifespan başlangıcı.
    Tüm logger'lar (uvicorn, sqlalchemy, vs.) tek formatla yazar.
    """
    settings = get_settings()
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _drop_color_message_key,
        _add_service_context,
    ]

    if settings.log_format == "json":
        render_processor: Processor = structlog.processors.JSONRenderer()
    else:
        render_processor = structlog.dev.ConsoleRenderer(colors=sys.stdout.isatty())

    structlog.configure(
        processors=[*shared_processors, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processor=render_processor,
    )

    # Root logger temizle ve yeniden yapılandır
    root = logging.getLogger()
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root.addHandler(handler)
    root.setLevel(log_level)

    # Gürültülü logger'ları sustur
    for noisy in ("uvicorn.access", "asyncio", "watchfiles.main"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # SQLAlchemy: debug'da SQL, normalde sessiz
    sqla_level = logging.INFO if settings.db_echo else logging.WARNING
    logging.getLogger("sqlalchemy.engine").setLevel(sqla_level)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Modül başına logger almak için kısayol."""
    return structlog.get_logger(name)
