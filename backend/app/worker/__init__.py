# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Celery worker uygulaması."""

from app.worker.celery_app import celery_app

__all__ = ["celery_app"]
