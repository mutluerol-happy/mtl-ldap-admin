# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Cluster sync endpoint'leri.

  - /cluster/status                 GET   admin-auth (cluster.read perm)
  - /cluster/nodes                  GET   admin-auth
  - /cluster/queue                  GET   admin-auth
  - /cluster/register               POST  HMAC-auth (slave→master kayıt)
  - /cluster/heartbeat              POST  HMAC-auth (her node)
  - /cluster/sync-receive           POST  HMAC-auth (master→slave audit)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, status, Path
from fastapi.responses import PlainTextResponse, Response

from app.api.deps import CurrentAdmin, DbSession, get_request_meta, require_master, require_permission
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError
from app.core.logging import get_logger
from app.schemas.cluster import (
    AdminNodeAddRequest,
    SyncStateNode,
    SyncStateResponse,
    ClusterNodePublic,
    ClusterStatusSummary,
    HeartbeatRequest,
    HeartbeatResponse,
    NodeRegisterRequest,
    SyncQueueItem,
    SyncReceiveRequest,
    ProvisionRequest,
    ProvisionResponse,
)
from app.services import audit_service, cluster_service, provision_service, settings_service

logger = get_logger(__name__)

router = APIRouter(prefix="/cluster", tags=["cluster"])


# ============================================================================
# HMAC dependency — internal node-to-node calls
# ============================================================================


async def verify_hmac_request(
    request: Request,
    x_mtl_node_id: Annotated[str | None, Header()] = None,
    x_mtl_timestamp: Annotated[str | None, Header()] = None,
    x_mtl_signature: Annotated[str | None, Header()] = None,
) -> str:
    """HMAC imza doğrulaması — başarılıysa node_id döner."""
    settings = get_settings()
    if not all([x_mtl_node_id, x_mtl_timestamp, x_mtl_signature]):
        raise AuthenticationError(
            "HMAC başlıkları eksik (X-MTL-Node-Id, X-MTL-Timestamp, X-MTL-Signature)",
            code="HMAC_HEADERS_MISSING",
        )

    if not cluster_service.verify_request_timestamp(x_mtl_timestamp):
        raise AuthenticationError(
            "Timestamp ±5 dk dışında (replay önleme)",
            code="HMAC_TIMESTAMP_INVALID",
        )

    body = await request.body()
    secret = settings.cluster_secret.get_secret_value()
    if not cluster_service.verify_signature(x_mtl_node_id, x_mtl_timestamp, body,
                                            x_mtl_signature, secret):
        logger.warning("cluster.hmac_invalid", node=x_mtl_node_id)
        raise AuthenticationError("HMAC imzası geçersiz", code="HMAC_INVALID")

    return x_mtl_node_id


@router.get(
    "/settings-export",
    summary="Org ayarlarini slave senkronizasyonu icin disa aktar (HMAC)",
)
async def export_settings_for_sync(
    db: DbSession,
    source_node_id: Annotated[str, Depends(verify_hmac_request)],
) -> dict:
    """Slave'in cektigi org ayarlari. HMAC ile korunur; whitelist kategoriler."""
    items = await settings_service.export_settings(db)
    # Canlilik: cagiran node bizimle simdi konustu -> last_sync_at tazele (panel "online").
    try:
        from sqlalchemy import update as _sa_update
        from app.models.cluster import ClusterNode as _CN
        from datetime import datetime as _dt, timezone as _tz
        await db.execute(
            _sa_update(_CN).where(
                (_CN.node_id == source_node_id)
                | (_CN.node_id.like(source_node_id + ".%"))
            )
            .values(last_sync_at=_dt.now(_tz.utc))
        )
        await db.commit()
    except Exception as _e:  # noqa: BLE001
        logger.warning("cluster.export_touch_failed", node=source_node_id, error=str(_e))
    logger.info("cluster.settings_export", node=source_node_id, count=len(items))
    return {
        "settings": items,
        "categories": sorted(settings_service.SYNC_CATEGORIES),
    }


# ============================================================================
# Admin-auth endpoint'ler
# ============================================================================


@router.get(
    "/status",
    response_model=ClusterStatusSummary,
    summary="Cluster sağlık özeti",
)
async def get_cluster_status(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> ClusterStatusSummary:
    data = await cluster_service.get_cluster_status(db)
    await db.commit()
    return ClusterStatusSummary(
        master_node_id=data["master_node_id"],
        total_nodes=data["total_nodes"],
        online_nodes=data["online_nodes"],
        offline_nodes=data["offline_nodes"],
        degraded_nodes=data["degraded_nodes"],
        queue_pending=data["queue_pending"],
        queue_failed=data["queue_failed"],
        last_sync_at=data["last_sync_at"],
        nodes=[ClusterNodePublic.model_validate(n) for n in data["nodes"]],
    )


@router.get(
    "/nodes",
    response_model=list[ClusterNodePublic],
    summary="Cluster node listesi",
)
async def list_nodes(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> list[ClusterNodePublic]:
    data = await cluster_service.get_cluster_status(db)
    return [ClusterNodePublic.model_validate(n) for n in data["nodes"]]


@router.get(
    "/queue",
    response_model=list[SyncQueueItem],
    summary="Sync queue durumu",
)
async def list_queue(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
    status_filter: str | None = Query(None, alias="status", description="pending/sent/failed/abandoned"),
    limit: int = Query(100, ge=1, le=500),
) -> list[SyncQueueItem]:
    items = await cluster_service.list_queue_items(db, status=status_filter, limit=limit)
    return [SyncQueueItem.model_validate(i) for i in items]


# ============================================================================
# HMAC-auth endpoint'ler (node-to-node)
# ============================================================================


@router.post(
    "/register",
    response_model=ClusterNodePublic,
    summary="Node kendini cluster'a kaydeder (HMAC)",
)
async def register_node(
    payload: NodeRegisterRequest,
    db: DbSession,
    source_node_id: Annotated[str, Depends(verify_hmac_request)],
) -> ClusterNodePublic:
    node = await cluster_service.register_node(
        db,
        node_id=payload.node_id,
        node_type=payload.node_type,
        hostname=payload.hostname,
        base_url=payload.base_url,
        version=payload.version,
        metadata=payload.metadata,
    )
    await db.commit()
    return ClusterNodePublic.model_validate(node)


@router.post(
    "/heartbeat",
    response_model=HeartbeatResponse,
    summary="Node heartbeat (HMAC)",
)
async def heartbeat(
    payload: HeartbeatRequest,
    db: DbSession,
    source_node_id: Annotated[str, Depends(verify_hmac_request)],
) -> HeartbeatResponse:
    await cluster_service.heartbeat(
        db, node_id=payload.node_id, status=payload.status, version=payload.version
    )
    # Master node_id'i de bulup döndür
    from sqlalchemy import select

    from app.models.cluster import ClusterNode
    master_stmt = select(ClusterNode).where(ClusterNode.node_type == "MASTER").limit(1)
    master = (await db.execute(master_stmt)).scalar_one_or_none()
    await db.commit()

    return HeartbeatResponse(
        accepted=True,
        cluster_time=datetime.now(timezone.utc),
        master_node_id=master.node_id if master else None,
    )


@router.post(
    "/sync-receive",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Master'dan gelen audit event'leri al (HMAC)",
)
async def sync_receive(
    payload: SyncReceiveRequest,
    db: DbSession,
    source_node_id: Annotated[str, Depends(verify_hmac_request)],
) -> dict:
    result = await cluster_service.ingest_audit_events(
        db, source_node_id=payload.source_node_id, events=payload.events
    )
    await db.commit()
    return result



# ===== TUR 13 ENDPOINT'LERİ =====


@router.post(
    "/nodes",
    response_model=ClusterNodePublic,
    status_code=status.HTTP_201_CREATED,
    summary="Admin: cluster'a yeni node ekle (admin-auth)",
)
async def admin_add_node(
    payload: AdminNodeAddRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("sync.peer.create"))],
) -> ClusterNodePublic:
    node = await cluster_service.admin_add_node(
        db,
        node_id=payload.node_id,
        node_type=payload.node_type,
        hostname=payload.hostname,
        base_url=payload.base_url,
        version=payload.version,
        metadata=payload.metadata,
    )
    await audit_service.log_event(
        db, category="SYSTEM", event_code="CLUSTER_NODE_ADDED", severity="NOTICE",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="CLUSTER_NODE", target_id=payload.node_id, target_display=payload.hostname,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"node_type": payload.node_type, "base_url": payload.base_url},
    )
    await db.commit()
    return ClusterNodePublic.model_validate(node)


@router.delete(
    "/nodes/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin: cluster'dan node sil (master silinemez)",
)
async def admin_delete_node(
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    node_id: Annotated[str, Path(..., min_length=3, max_length=64)],
    _: Annotated[None, Depends(require_permission("sync.peer.delete"))],
) -> Response:
    await cluster_service.admin_delete_node(db, node_id)
    await audit_service.log_event(
        db, category="SYSTEM", event_code="CLUSTER_NODE_DELETED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="CLUSTER_NODE", target_id=node_id,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/sync-state",
    response_model=SyncStateResponse,
    summary="Node'ların LDAP contextCSN senkron durumu (canlı)",
)
async def get_sync_state(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("sync.topology.read"))],
) -> SyncStateResponse:
    data = await cluster_service.get_sync_state(db)
    await db.commit()
    return SyncStateResponse(
        master_node_id=data["master_node_id"],
        master_csn=data["master_csn"],
        nodes=[SyncStateNode(**n) for n in data["nodes"]],
        checked_at=data["checked_at"],
    )


@router.post(
    "/provision",
    response_model=ProvisionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Admin: yeni consumer provision (cert+token+bootstrap komutu) — master only",
)
async def admin_provision_consumer(
    payload: ProvisionRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    __: Annotated[None, Depends(require_master)],
    _: Annotated[None, Depends(require_permission("sync.peer.create"))],
) -> ProvisionResponse:
    result = await provision_service.create_provision(
        db,
        node_id=payload.node_id,
        hostname=payload.hostname,
        ip=payload.ip,
        created_by=current.username,
    )
    await audit_service.log_event(
        db, category="SYSTEM", event_code="CLUSTER_NODE_PROVISIONED", severity="NOTICE",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="CLUSTER_NODE", target_id=payload.node_id, target_display=payload.hostname,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"ip": payload.ip},
    )
    await db.commit()
    return ProvisionResponse(
        node=ClusterNodePublic.model_validate(result["node"]),
        bootstrap_command=result["bootstrap_command"],
        expires_at=result["expires_at"],
    )


@router.get(
    "/bootstrap/{token}",
    summary="Tek-kullanimlik consumer bootstrap script'i (token-auth, master only)",
)
async def get_consumer_bootstrap(
    db: DbSession,
    token: Annotated[str, Path(..., min_length=20, max_length=128)],
    __: Annotated[None, Depends(require_master)],
) -> PlainTextResponse:
    script = await provision_service.consume_and_render(db, token)
    await db.commit()
    return PlainTextResponse(script, media_type="text/x-shellscript")
