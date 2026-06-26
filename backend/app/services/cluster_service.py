# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Cluster sync grid servisi.

Master → Slave audit forwarding akışı:
  1. Master'daki audit_service.log_event() çağrıldığında, async hook ile
     event_log kaydı SyncQueue'ya da eklenir (status=pending).
  2. Celery beat task `cluster.flush_sync_queue` saniyede bir queue'yu okur,
     HMAC-imzalı POST ile slave'lere gönderir.
  3. Slave'in `/cluster/sync-receive` endpoint'i imzayı doğrular,
     event_log'a kaydeder.

HMAC akışı:
  Header: X-MTL-Node-Id, X-MTL-Timestamp, X-MTL-Signature
  Signature = HMAC-SHA256(CLUSTER_SECRET, f"{node_id}|{timestamp}|{body_sha256}")
  Timestamp ±5 dk pencerede olmalı (replay önleme).
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.audit import EventLog
from app.models.cluster import ClusterNode, SyncQueue

logger = get_logger(__name__)


HMAC_HEADER_NODE = "X-MTL-Node-Id"
HMAC_HEADER_TIMESTAMP = "X-MTL-Timestamp"
HMAC_HEADER_SIGNATURE = "X-MTL-Signature"
HMAC_VALID_WINDOW_SECONDS = 300


# ============================================================================
# HMAC sign / verify
# ============================================================================


def compute_signature(node_id: str, timestamp: str, body: bytes, secret: str) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    payload = f"{node_id}|{timestamp}|{body_hash}".encode()
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def verify_signature(
    node_id: str,
    timestamp: str,
    body: bytes,
    signature: str,
    secret: str,
) -> bool:
    expected = compute_signature(node_id, timestamp, body, secret)
    return hmac.compare_digest(expected, signature)


def verify_request_timestamp(timestamp: str) -> bool:
    try:
        ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    now = datetime.now(timezone.utc)
    delta = abs((now - ts).total_seconds())
    return delta <= HMAC_VALID_WINDOW_SECONDS


# ============================================================================
# Node registry
# ============================================================================


async def register_node(
    db: AsyncSession,
    node_id: str,
    node_type: str,
    hostname: str,
    base_url: str,
    version: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ClusterNode:
    """Slave'in (veya master'ın self-register) cluster.node'a kaydı."""
    stmt = select(ClusterNode).where(ClusterNode.node_id == node_id)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        existing.node_type = node_type
        existing.hostname = hostname
        existing.base_url = base_url
        existing.version = version
        existing.extra_metadata = metadata or {}
        existing.status = "online"
        existing.last_heartbeat_at = datetime.now(timezone.utc)
        await db.flush()
        logger.info("cluster.node_re_registered", node_id=node_id, type=node_type)
        return existing

    node = ClusterNode(
        node_id=node_id,
        node_type=node_type,
        hostname=hostname,
        base_url=base_url,
        version=version,
        extra_metadata=metadata or {},
        status="online",
        last_heartbeat_at=datetime.now(timezone.utc),
    )
    db.add(node)
    await db.flush()
    logger.info("cluster.node_registered", node_id=node_id, type=node_type)
    return node


async def heartbeat(
    db: AsyncSession,
    node_id: str,
    status: str = "online",
    version: str | None = None,
) -> ClusterNode:
    stmt = select(ClusterNode).where(ClusterNode.node_id == node_id)
    node = (await db.execute(stmt)).scalar_one_or_none()
    if node is None:
        raise NotFoundError(
            f"Node kayıtlı değil: {node_id} — önce register edin",
            code="NODE_NOT_REGISTERED",
        )

    node.status = status
    node.last_heartbeat_at = datetime.now(timezone.utc)
    if version:
        node.version = version
    await db.flush()
    return node


async def get_cluster_status(db: AsyncSession) -> dict[str, Any]:
    nodes_stmt = select(ClusterNode).order_by(ClusterNode.node_type, ClusterNode.node_id)
    nodes = list((await db.execute(nodes_stmt)).scalars())

    # Canlilik tespiti (GERCEK sinyale dayali; is_self kolonu yok -> node_type ile):
    #  - MASTER node: kod master'da calisir; bu yaniti donebiliyorsa makine ayaktadir -> "online".
    #  - SLAVE node'lar: son heartbeat VEYA son sync (last_sync_at) esik icindeyse "online".
    #    Slave master'a surekli baglanir (settings-export/sync) -> last_sync_at tazedir.
    #  Not: okuma islemi; durum yanitta hesaplanir (kalici DB yazimi/flush yok).
    LIVENESS_THRESHOLD = timedelta(minutes=2)
    _now = datetime.now(timezone.utc)
    for n in nodes:
        if n.status == "degraded":
            continue
        if n.node_type == "MASTER":
            n.status = "online"
            continue
        _last = None
        for _ts in (n.last_heartbeat_at, n.last_sync_at):
            if _ts and (_last is None or _ts > _last):
                _last = _ts
        n.status = "online" if (_last and (_now - _last) <= LIVENESS_THRESHOLD) else "offline"

    master_node = next((n.node_id for n in nodes if n.node_type == "MASTER"), None)
    online = sum(1 for n in nodes if n.status == "online")
    offline = sum(1 for n in nodes if n.status == "offline")
    degraded = sum(1 for n in nodes if n.status == "degraded")

    pending_stmt = select(func.count()).select_from(SyncQueue).where(SyncQueue.status == "pending")
    failed_stmt = (
        select(func.count())
        .select_from(SyncQueue)
        .where(
            SyncQueue.status == "failed",
            SyncQueue.target_node_id.in_(select(ClusterNode.node_id)),
        )
    )
    pending = (await db.execute(pending_stmt)).scalar_one()
    failed = (await db.execute(failed_stmt)).scalar_one()

    last_sync_stmt = select(func.max(SyncQueue.sent_at)).where(SyncQueue.status == "sent")
    last_sync = (await db.execute(last_sync_stmt)).scalar_one_or_none()

    return {
        "master_node_id": master_node,
        "total_nodes": len(nodes),
        "online_nodes": online,
        "offline_nodes": offline,
        "degraded_nodes": degraded,
        "queue_pending": pending,
        "queue_failed": failed,
        "last_sync_at": last_sync,
        "nodes": nodes,
    }


async def list_queue_items(
    db: AsyncSession,
    status: str | None = None,
    limit: int = 100,
) -> list[SyncQueue]:
    stmt = select(SyncQueue).order_by(SyncQueue.queued_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(SyncQueue.status == status)
    return list((await db.execute(stmt)).scalars())


# ============================================================================
# Audit event forwarding queue
# ============================================================================


async def enqueue_audit_event(db: AsyncSession, event: EventLog) -> None:
    """Master tarafı: log_event sonrası queue'ya at — sadece master ise."""
    settings = get_settings()
    if not settings.is_master:
        return

    # Sadece SLAVE'lere gönderilecek
    slaves_stmt = select(ClusterNode).where(ClusterNode.node_type == "SLAVE")
    slaves = list((await db.execute(slaves_stmt)).scalars())
    if not slaves:
        return  # Slave yok, queue boşa atma

    payload = {
        "id": str(event.id),
        "occurred_at": event.occurred_at.isoformat() if event.occurred_at else None,
        "server_node": event.server_node,
        "category": event.category,
        "event_code": event.event_code,
        "severity": event.severity,
        "actor_type": event.actor_type,
        "actor_id": event.actor_id,
        "actor_display": event.actor_display,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "target_display": event.target_display,
        "ip_address": str(event.ip_address) if event.ip_address else None,
        "user_agent": event.user_agent,
        "request_id": str(event.request_id) if event.request_id else None,
        "details": event.details or {},
    }

    for slave in slaves:
        db.add(SyncQueue(
            target_node_id=slave.node_id,
            payload_type="AUDIT_EVENT",
            payload={"events": [payload]},
        ))
    await db.flush()


# ============================================================================
# Flush queue → HTTP POST'lar
# ============================================================================


async def flush_queue_once(db: AsyncSession, batch_size: int = 50) -> dict[str, int]:
    """
    Pending queue item'larını grupla, slave'e POST et, başarılı/başarısız işaretle.

    Beat task tarafından saniyede bir çağrılır.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)

    # Bu turda işlenecekleri al
    stmt = (
        select(SyncQueue)
        .where(SyncQueue.status == "pending", SyncQueue.next_attempt_at <= now)
        .order_by(SyncQueue.queued_at)
        .limit(batch_size)
    )
    items = list((await db.execute(stmt)).scalars())
    if not items:
        return {"processed": 0, "sent": 0, "failed": 0}

    # Target node'a göre grupla
    by_target: dict[str, list[SyncQueue]] = {}
    for it in items:
        by_target.setdefault(it.target_node_id, []).append(it)

    sent_count = 0
    failed_count = 0

    for target_node_id, group in by_target.items():
        # Target node'un base_url'ünü al
        node_stmt = select(ClusterNode).where(ClusterNode.node_id == target_node_id)
        node = (await db.execute(node_stmt)).scalar_one_or_none()
        if node is None:
            # Node silinmiş — abandon
            for it in group:
                it.status = "abandoned"
                it.last_error = "target_node_not_found"
            await db.flush()
            failed_count += len(group)
            continue

        # Tek payload'da gönder (toplu)
        all_events = []
        for it in group:
            evts = it.payload.get("events", [])
            all_events.extend(evts)

        body = {
            "payload_type": "AUDIT_EVENT",
            "source_node_id": settings.node_id,
            "events": all_events,
        }
        body_bytes = json.dumps(body).encode("utf-8")
        timestamp = now.isoformat()
        signature = compute_signature(
            settings.node_id, timestamp, body_bytes,
            settings.cluster_secret.get_secret_value(),
        )

        url = f"{node.base_url.rstrip('/')}/api/v1/cluster/sync-receive"
        headers = {
            "Content-Type": "application/json",
            HMAC_HEADER_NODE: settings.node_id,
            HMAC_HEADER_TIMESTAMP: timestamp,
            HMAC_HEADER_SIGNATURE: signature,
        }

        success = False
        error_msg: str | None = None
        try:
            async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
                resp = await client.post(url, content=body_bytes, headers=headers)
                if 200 <= resp.status_code < 300:
                    success = True
                else:
                    error_msg = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except Exception as e:  # noqa: BLE001
            error_msg = f"{type(e).__name__}: {e}"

        # Sonuçları işaretle
        for it in group:
            it.attempts += 1
            it.last_attempt_at = now
            if success:
                it.status = "sent"
                it.sent_at = now
                sent_count += 1
            else:
                it.last_error = error_msg
                if it.attempts >= it.max_attempts:
                    it.status = "failed"
                else:
                    # Exponential backoff: 2^attempts dakika
                    backoff = min(2 ** it.attempts, 60)
                    it.next_attempt_at = now + timedelta(minutes=backoff)
                failed_count += 1

        if success:
            # Target node last_sync_at güncelle
            node.last_sync_at = now
        await db.flush()

        logger.info(
            "cluster.flush_batch",
            target=target_node_id,
            count=len(group),
            success=success,
            error=error_msg,
        )

    await db.commit()
    return {"processed": len(items), "sent": sent_count, "failed": failed_count}


# ============================================================================
# Slave-side: incoming audit event ingestion
# ============================================================================


async def ingest_audit_events(
    db: AsyncSession,
    source_node_id: str,
    events: list[dict[str, Any]],
) -> dict[str, int]:
    """
    Bir node'dan (slave veya master) gelen audit event'leri event_log'a yaz.

    - id TAŞINMAZ: EventLog.id BigInteger autoincrement, master kendisi üretir.
    - server_node KORUNUR: event'in hangi node'da oluştuğu saklanır.
    - Duplicate önleme: (server_node, occurred_at, event_code, actor_display)
      bileşimi aynıysa atla (idempotent retry için).
    """
    from datetime import datetime, timezone

    from sqlalchemy import select as _select

    from app.models.audit import EventLog

    inserted = 0
    skipped = 0

    for ev in events:
        # occurred_at parse
        try:
            occurred_at = (
                datetime.fromisoformat(ev["occurred_at"].replace("Z", "+00:00"))
                if ev.get("occurred_at")
                else datetime.now(timezone.utc)
            )
        except (ValueError, KeyError, AttributeError):
            occurred_at = datetime.now(timezone.utc)

        ev_server_node = ev.get("server_node") or source_node_id
        ev_code = ev.get("event_code") or "UNKNOWN"
        ev_actor = ev.get("actor_display")

        # Duplicate kontrolü — bileşik anahtar (retry idempotency)
        dup_stmt = (
            _select(EventLog.id)
            .where(
                EventLog.server_node == ev_server_node,
                EventLog.occurred_at == occurred_at,
                EventLog.event_code == ev_code,
            )
            .limit(1)
        )
        if (await db.execute(dup_stmt)).scalar_one_or_none() is not None:
            skipped += 1
            continue

        # request_id UUID parse (opsiyonel)
        request_id = None
        rid_raw = ev.get("request_id")
        if rid_raw:
            try:
                request_id = UUID(rid_raw)
            except (ValueError, TypeError):
                request_id = None

        event = EventLog(
            occurred_at=occurred_at,
            server_node=ev_server_node,
            category=ev.get("category") or "UNKNOWN",
            event_code=ev_code,
            severity=ev.get("severity") or "INFO",
            actor_type=ev.get("actor_type"),
            actor_id=ev.get("actor_id"),
            actor_display=ev_actor,
            target_type=ev.get("target_type"),
            target_id=ev.get("target_id"),
            target_display=ev.get("target_display"),
            ip_address=ev.get("ip_address"),
            user_agent=(ev.get("user_agent") or "")[:1024] or None,
            request_id=request_id,
            details=ev.get("details") or {},
        )
        db.add(event)
        inserted += 1

    await db.flush()
    logger.info(
        "cluster.ingested",
        source=source_node_id,
        inserted=inserted,
        skipped=skipped,
    )
    return {"inserted": inserted, "skipped": skipped}



# ===== TUR 13 EKLEMELERİ =====


async def admin_add_node(
    db: AsyncSession,
    node_id: str,
    node_type: str,
    hostname: str,
    base_url: str,
    version: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ClusterNode:
    """
    Admin UI'dan manuel node ekleme (HMAC register'dan farklı — admin-auth).

    Yeni bir consumer (slave) eklemek için kullanılır. status='unknown'
    başlar; node ilk heartbeat/sync ile 'online' olur.
    """
    stmt = select(ClusterNode).where(ClusterNode.node_id == node_id)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        raise ValidationError(
            f"'{node_id}' zaten kayıtlı",
            code="NODE_ALREADY_EXISTS",
        )

    node = ClusterNode(
        node_id=node_id,
        node_type=node_type,
        hostname=hostname,
        base_url=base_url,
        version=version,
        extra_metadata=metadata or {},
        status="unknown",
    )
    db.add(node)
    await db.flush()
    logger.info("cluster.admin_node_added", node_id=node_id, type=node_type)
    return node


async def admin_delete_node(db: AsyncSession, node_id: str) -> None:
    """Admin UI'dan node silme. MASTER silinemez."""
    stmt = select(ClusterNode).where(ClusterNode.node_id == node_id)
    node = (await db.execute(stmt)).scalar_one_or_none()
    if node is None:
        raise NotFoundError(f"Node bulunamadı: {node_id}", code="NODE_NOT_FOUND")
    if node.node_type == "MASTER":
        raise ValidationError(
            "Master node silinemez",
            code="CANNOT_DELETE_MASTER",
        )
    # Silinen dugume ait bekleyen/basarisiz kuyruk kayitlarini terminal isaretle
    # (oksuz failed/pending kalmasin -> Ozet hayalet hata gostermesin)
    await db.execute(
        update(SyncQueue)
        .where(
            SyncQueue.target_node_id == node_id,
            SyncQueue.status.in_(["pending", "failed"]),
        )
        .values(status="abandoned", last_error="node_deleted")
    )
    await db.delete(node)
    await db.flush()
    logger.info("cluster.admin_node_deleted", node_id=node_id)


def _read_node_context_csn(base_url: str, timeout: float = 6.0) -> str | None:
    """
    Bir node'un LDAP contextCSN'ini ldaps üzerinden oku.

    base_url 'https://host' formatında; LDAP host'unu oradan türetip
    ldaps://host:636'ya bağlanır. Replicator yerine anonim/bind denemez —
    sadece contextCSN base-scope okur (master ACL'i replicator'a açık, ama
    burada kendi CA'mızla TLS kurup admin bind ile okuruz).

    NOT: senkron (blocking) ldap3 çağrısı; çağıran tarafta thread'e alınır.
    """
    from urllib.parse import urlparse

    import ssl as _ssl
    from ldap3 import ALL, Connection, Server, Tls

    settings = get_settings()
    host = urlparse(base_url).hostname
    if not host:
        return None

    try:
        tls = Tls(
            ca_certs_file=str(settings.ldap_ca_path),
            validate=_ssl.CERT_REQUIRED if settings.ldap_tls_verify else _ssl.CERT_NONE,
            version=_ssl.PROTOCOL_TLS_CLIENT,
        )
        server = Server(f"ldaps://{host}:636", use_ssl=True, get_info=ALL, tls=tls, connect_timeout=int(timeout))
        # contextCSN okuma: replicator cluster genelinde AYNI parola (master+slave),
        # uzak node icin de calisir. Yoksa admin bind (geri uyum).
        if settings.ldap_replicator_dn and settings.ldap_replicator_password:
            _bind_user = settings.ldap_replicator_dn
            _bind_pw = settings.ldap_replicator_password.get_secret_value()
        else:
            _bind_user = settings.ldap_bind_dn
            _bind_pw = settings.ldap_bind_password.get_secret_value()
        conn = Connection(
            server,
            user=_bind_user,
            password=_bind_pw,
            auto_bind=True,
            receive_timeout=int(timeout),
            raise_exceptions=False,
        )
        conn.search(
            search_base=settings.ldap_base_dn,
            search_filter="(objectClass=*)",
            search_scope="BASE",
            attributes=["contextCSN"],
        )
        csn = None
        if conn.entries and "contextCSN" in conn.entries[0].entry_attributes:
            val = conn.entries[0]["contextCSN"].value
            # contextCSN birden çok değer olabilir (serverID başına); en büyüğü al
            if isinstance(val, (list, tuple)):
                csn = max(str(v) for v in val) if val else None
            else:
                csn = str(val)
        conn.unbind()
        return csn
    except Exception as e:  # noqa: BLE001
        logger.warning("cluster.contextcsn_read_failed", host=host, error=str(e))
        return None


async def get_sync_state(db: AsyncSession) -> dict[str, Any]:
    """
    Tüm node'ların LDAP contextCSN'ini canlı oku, master ile karşılaştır.

    Dönüş:
      {
        "master_node_id": "...",
        "master_csn": "...",
        "nodes": [
          {"node_id","node_type","base_url","csn","in_sync","reachable","lag_note"}
        ],
        "checked_at": iso,
      }
    """
    import asyncio
    from datetime import datetime, timezone

    nodes_stmt = select(ClusterNode).order_by(ClusterNode.node_type, ClusterNode.node_id)
    nodes = list((await db.execute(nodes_stmt)).scalars())

    # contextCSN okumaları blocking → thread pool'da paralel
    async def _read(n: ClusterNode) -> tuple[ClusterNode, str | None]:
        csn = await asyncio.to_thread(_read_node_context_csn, n.base_url)
        return n, csn

    results = await asyncio.gather(*[_read(n) for n in nodes])

    master_csn: str | None = None
    for n, csn in results:
        if n.node_type == "MASTER":
            master_csn = csn
            break

    _now = datetime.now(timezone.utc)
    node_states = []
    for n, csn in results:
        reachable = csn is not None
        in_sync = bool(reachable and master_csn and csn == master_csn)
        # contextCSN'i DB'ye de yaz (izleme için)
        n.last_context_csn = csn
        # otomatik heartbeat client yok -> node sagligini canli ulasilabilirlikten turet
        if reachable:
            n.status = "online"
            n.last_sync_at = _now
        elif n.status == "online":
            n.status = "offline"
        node_states.append({
            "node_id": n.node_id,
            "node_type": n.node_type,
            "base_url": n.base_url,
            "csn": csn,
            "in_sync": in_sync if n.node_type != "MASTER" else True,
            "reachable": reachable,
        })
    await db.flush()

    return {
        "master_node_id": next((n.node_id for n, _ in results if n.node_type == "MASTER"), None),
        "master_csn": master_csn,
        "nodes": node_states,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
