#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
#
# ============================================================
# MTL LDAP — Manuel Log Gönderim Yardımcısı
# ============================================================
# Slave'in lokal audit kayıtlarını master'a manuel olarak gönderir.
# Normal şartlarda mtl-ldap-worker (Celery beat) bu işi periyodik
# olarak (varsayılan 30 sn) otomatik yapar. Bu script şu durumlar
# için faydalıdır:
#   - Worker çalışmıyorken acil log gönderimi
#   - Sorun giderme (verbose çıktı ile)
#   - Bir kerelik toplu gönderim
#
# Kullanım:
#   sudo /opt/mtl/scripts/mtl-log-shipping.sh [--limit 1000] [--dry-run]
# ============================================================

set -euo pipefail

MTL_ENV_FILE="${MTL_ENV_FILE:-/etc/mtl/mtl-ldap.env}"
BATCH_LIMIT=500
DRY_RUN=0
VERBOSE=0

while [[ $# -gt 0 ]]; do
    case $1 in
        --limit) BATCH_LIMIT="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -v|--verbose) VERBOSE=1; shift ;;
        -h|--help)
            cat <<EOF
Kullanım: $0 [--limit N] [--dry-run] [--verbose]
  --limit N     Tek seferde gönderilecek maksimum kayıt (varsayılan 500)
  --dry-run     Bekleyen kayıtları say ama gönderme
  --verbose     Detaylı log
EOF
            exit 0
            ;;
        *) echo "Bilinmeyen argüman: $1"; exit 1 ;;
    esac
done

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
err() { printf '[%s] HATA: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }

# Ortam değişkenlerini yükle
if [[ ! -f "${MTL_ENV_FILE}" ]]; then
    err "Ortam dosyası bulunamadı: ${MTL_ENV_FILE}"
    exit 2
fi
# shellcheck disable=SC1090
set -a; source "${MTL_ENV_FILE}"; set +a

: "${MTL_NODE_ID:?MTL_NODE_ID gerekli}"
: "${MTL_MASTER_URL:?MTL_MASTER_URL gerekli}"
: "${MTL_CLUSTER_SECRET:?MTL_CLUSTER_SECRET gerekli}"
: "${MTL_DB_URL:?MTL_DB_URL gerekli}"

log "Node ID: ${MTL_NODE_ID}"
log "Master URL: ${MTL_MASTER_URL}"
log "Batch limit: ${BATCH_LIMIT}"

# Master ulaşılabilir mi
log "Master sağlık kontrolü..."
if ! curl -sf -o /dev/null -m 10 "${MTL_MASTER_URL}/healthz"; then
    err "Master'a ulaşılamıyor: ${MTL_MASTER_URL}/healthz"
    exit 3
fi
log "Master ulaşılabilir"

# Python tek satır yardımcısı (DB'den okuma + HMAC + POST)
# Not: mtl venv'i ${MTL_VENV:-/opt/mtl/mtl-ldap/venv} üzerinden çalışır.
MTL_VENV="${MTL_VENV:-/opt/mtl/mtl-ldap/venv}"
PYTHON="${MTL_VENV}/bin/python"

if [[ ! -x "${PYTHON}" ]]; then
    err "Python bulunamadı: ${PYTHON}"
    err "MTL_VENV ortam değişkenini ayarlayın veya mtl-ldap kurulumunu kontrol edin"
    exit 2
fi

# Python script'i — DB'den oku, HMAC imzala, master'a POST et, başarılıları işaretle
"${PYTHON}" - <<PYEOF
import os
import sys
import json
import time
import hmac
import hashlib
from datetime import datetime, timezone
import psycopg
import httpx

NODE_ID = os.environ["MTL_NODE_ID"]
MASTER_URL = os.environ["MTL_MASTER_URL"].rstrip("/")
CLUSTER_SECRET = os.environ["MTL_CLUSTER_SECRET"]
DB_URL = os.environ["MTL_DB_URL"]
BATCH_LIMIT = int("${BATCH_LIMIT}")
DRY_RUN = ${DRY_RUN}
VERBOSE = ${VERBOSE}

# Async DSN'i sync'e çevir (asyncpg yerine psycopg)
if DB_URL.startswith("postgresql+asyncpg://"):
    DB_URL = DB_URL.replace("postgresql+asyncpg://", "postgresql://")

def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

with psycopg.connect(DB_URL) as conn:
    with conn.cursor() as cur:
        # Bekleyen kayıt sayısı
        cur.execute("SELECT count(*) FROM mtl_audit.event_log WHERE shipped_at IS NULL")
        pending = cur.fetchone()[0]
        log(f"Bekleyen kayıt sayısı: {pending}")
        
        if pending == 0:
            log("Gönderilecek kayıt yok.")
            sys.exit(0)
        
        if DRY_RUN:
            log("dry-run: kayıt gönderilmedi.")
            sys.exit(0)
        
        total_sent = 0
        while True:
            cur.execute("""
                SELECT id, occurred_at, server_node, category, event_code, severity,
                       actor_type, actor_id, actor_display,
                       target_type, target_id, target_display,
                       ip_address, user_agent, country_code, request_id, details
                FROM mtl_audit.event_log
                WHERE shipped_at IS NULL
                  AND ship_attempts < 10
                ORDER BY occurred_at ASC
                LIMIT %s
            """, (BATCH_LIMIT,))
            rows = cur.fetchall()
            if not rows:
                break
            
            ids = [r[0] for r in rows]
            events = []
            for r in rows:
                events.append({
                    "occurred_at": r[1].isoformat(),
                    "server_node": r[2],
                    "category": r[3],
                    "event_code": r[4],
                    "severity": r[5],
                    "actor_type": r[6],
                    "actor_id": r[7],
                    "actor_display": r[8],
                    "target_type": r[9],
                    "target_id": r[10],
                    "target_display": r[11],
                    "ip_address": str(r[12]) if r[12] else None,
                    "user_agent": r[13],
                    "country_code": r[14],
                    "request_id": str(r[15]) if r[15] else None,
                    "details": r[16] or {},
                })
            
            payload = {"server_node": NODE_ID, "events": events}
            body = json.dumps(payload).encode("utf-8")
            timestamp = str(int(time.time()))
            sig = hmac.new(
                CLUSTER_SECRET.encode("utf-8"),
                timestamp.encode("utf-8") + body,
                hashlib.sha256
            ).hexdigest()
            
            if VERBOSE:
                log(f"POST /api/v1/cluster/log-ingest — {len(events)} olay")
            
            try:
                resp = httpx.post(
                    f"{MASTER_URL}/api/v1/cluster/log-ingest",
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "X-MTL-Node-Id": NODE_ID,
                        "X-MTL-Timestamp": timestamp,
                        "X-MTL-Signature": sig,
                    },
                    timeout=30.0,
                )
                resp.raise_for_status()
                
                # Başarılıları işaretle
                cur.execute(
                    "UPDATE mtl_audit.event_log SET shipped_at = now() WHERE id = ANY(%s)",
                    (ids,)
                )
                conn.commit()
                total_sent += len(ids)
                log(f"Başarıyla gönderildi: {len(ids)} olay (toplam {total_sent})")
                
            except httpx.HTTPError as e:
                err_msg = str(e)[:500]
                cur.execute(
                    """UPDATE mtl_audit.event_log
                       SET ship_attempts = ship_attempts + 1,
                           last_ship_error = %s
                       WHERE id = ANY(%s)""",
                    (err_msg, ids)
                )
                conn.commit()
                log(f"HATA: gönderim başarısız: {err_msg}")
                sys.exit(4)
        
        log(f"TAMAMLANDI: {total_sent} olay master'a gönderildi.")
PYEOF

exit_code=$?
if [[ $exit_code -eq 0 ]]; then
    log "Log gönderim başarıyla tamamlandı."
fi
exit $exit_code
