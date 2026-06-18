# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Consumer provisioning — panel-driven (Method A).

  POST /cluster/provision        → cert uret (root helper) + tek-kullanimlik token + node kaydi
  GET  /cluster/bootstrap/{token}→ consumer bootstrap script'i render et (cert+config gomulu)

Token: mtl_cluster.provision_token — token_hash saklanir (token degil), payload Fernet ile sifreli,
TTL'li, tek kullanim. Backend root degil → cert imzalama `sudo -n mtl-cert-apply provision-consumer`.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import socket
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.core.security import decrypt, encrypt, generate_token
from app.models.cluster import ClusterNode, ProvisionToken

logger = get_logger(__name__)

PROVISION_TTL_MINUTES = 30
_HOST_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9.-]{1,253}[a-zA-Z0-9])?$")
_IP_RE = re.compile(r"^[0-9]{1,3}(\.[0-9]{1,3}){3}$")


def _helper() -> str:
    return str(getattr(get_settings(), "cert_apply_helper", "/opt/mtl/bin/mtl-cert-apply"))


def _run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)  # noqa: S603


def _call_provision_helper(fqdn: str, ip: str) -> dict[str, Any]:
    """sudo -n mtl-cert-apply provision-consumer <fqdn> <ip> → JSON (base64 cert bundle)."""
    proc = _run(["sudo", "-n", _helper(), "provision-consumer", fqdn, ip])
    raw = (proc.stdout or "").strip()
    try:
        line = next((ln for ln in reversed(raw.splitlines()) if ln.startswith("{")), "")
        data = json.loads(line) if line else {}
    except (ValueError, StopIteration):
        data = {}
    if proc.returncode != 0 or not data.get("ok"):
        msg = data.get("message") or (proc.stderr or "").strip()[:300] or "cert uretilemedi"
        logger.error("provision.helper_failed", rc=proc.returncode, msg=msg)
        raise ValidationError(f"Sertifika uretimi basarisiz: {msg}")
    for k in ("ca_pem_b64", "server_pem_b64", "server_key_b64"):
        if not data.get(k):
            raise ValidationError("Helper eksik cert alani dondurdu")
    return data


def _call_replicator_helper(base_dn: str) -> str:
    """sudo -n mtl-cert-apply get-replicator-secret <base_dn> → replicator parolasi (bind ile dogrulanmis)."""
    proc = _run(["sudo", "-n", _helper(), "get-replicator-secret", base_dn])
    raw = (proc.stdout or "").strip()
    try:
        line = next((ln for ln in reversed(raw.splitlines()) if ln.startswith("{")), "")
        data = json.loads(line) if line else {}
    except (ValueError, StopIteration):
        data = {}
    pw = data.get("replicator_password")
    if proc.returncode != 0 or not data.get("ok") or not pw:
        msg = data.get("message") or (proc.stderr or "").strip()[:300] or "replicator parolasi alinamadi"
        logger.error("provision.replicator_failed", rc=proc.returncode, msg=msg)
        raise ValidationError(f"Replicator parolasi alinamadi: {msg}")
    return pw


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _shq(v: str) -> str:
    """Tek-tirnakli bash atamasi icinde guvenli hale getir (' -> '\\'')."""
    return v.replace("'", "'\\''")


async def _master_host(db: AsyncSession) -> str:
    stmt = select(ClusterNode).where(ClusterNode.node_type == "MASTER").limit(1)
    master = (await db.execute(stmt)).scalar_one_or_none()
    if master and master.hostname:
        return master.hostname
    return socket.getfqdn()


async def create_provision(
    db: AsyncSession,
    *,
    node_id: str,
    hostname: str,
    ip: str,
    created_by: str | None = None,
) -> dict[str, Any]:
    if not _HOST_RE.match(hostname):
        raise ValidationError("Gecersiz hostname")
    if not _IP_RE.match(ip):
        raise ValidationError("Gecersiz IP adresi")

    stmt = select(ClusterNode).where(ClusterNode.node_id == node_id)
    node = (await db.execute(stmt)).scalar_one_or_none()
    if node is None:
        node = ClusterNode(
            node_id=node_id, node_type="SLAVE", hostname=hostname,
            base_url=f"https://{hostname}", status="unknown",
            extra_metadata={"provisioning": True},
        )
        db.add(node)
        await db.flush()
    else:
        node.hostname = hostname
        node.base_url = f"https://{hostname}"
        await db.flush()

    token = generate_token(32)
    payload = json.dumps({"hostname": hostname, "ip": ip})
    row = ProvisionToken(
        token_hash=_sha256(token),
        node_id=node_id,
        payload_encrypted=encrypt(payload),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=PROVISION_TTL_MINUTES),
        created_by=created_by,
    )
    db.add(row)
    await db.flush()

    master = await _master_host(db)
    command = f"curl -fsSL https://{master}/api/v1/cluster/bootstrap/{token} | sudo bash"
    logger.info("provision.created", node_id=node_id)
    return {"node": node, "bootstrap_command": command, "expires_at": row.expires_at}


async def consume_and_render(db: AsyncSession, token: str) -> str:
    th = _sha256(token)
    row = (await db.execute(
        select(ProvisionToken).where(ProvisionToken.token_hash == th)
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        raise NotFoundError("Gecersiz provision token", code="PROVISION_TOKEN_INVALID")
    if row.used_at is not None:
        raise NotFoundError("Bu provision token zaten kullanildi", code="PROVISION_TOKEN_USED")
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp < now:
        raise NotFoundError("Provision token suresi dolmus", code="PROVISION_TOKEN_EXPIRED")

    # tek kullanim: hemen isaretle (replay onleme)
    row.used_at = now
    await db.flush()

    data = json.loads(decrypt(row.payload_encrypted))
    hostname = data["hostname"]
    ip = data["ip"]

    cert = await asyncio.to_thread(_call_provision_helper, hostname, ip)
    settings = get_settings()
    master = await _master_host(db)
    replicator_pw = await asyncio.to_thread(_call_replicator_helper, settings.ldap_base_dn)

    repl = {
        "__NODE_ID__": row.node_id,
        "__FQDN__": hostname,
        "__IP__": ip,
        "__MASTER_HOST__": master,
        "__BASE_DN__": settings.ldap_base_dn,
        "__REPLICATOR_PW__": replicator_pw,
        "__CLUSTER_SECRET__": settings.cluster_secret.get_secret_value(),
        "__CA_PEM_B64__": cert["ca_pem_b64"],
        "__SERVER_PEM_B64__": cert["server_pem_b64"],
        "__SERVER_KEY_B64__": cert["server_key_b64"],
    }
    script = BOOTSTRAP_TEMPLATE
    for k, v in repl.items():
        script = script.replace(k, _shq(v))
    logger.info("provision.bootstrap_rendered", node_id=row.node_id)
    return script


BOOTSTRAP_TEMPLATE = r"""#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# MTL — Consumer Bootstrap (master tarafından render edilir, yeni node'da `curl … | sudo bash`).
#
# SADECE OpenLDAP read-only consumer kurar:
#   - cert (b64 gömülü) + cert tuzağı fix'i
#   - back_mdb + ppolicy, mdb db, olcTLS
#   - kanıtlanmış refreshAndPersist syncrepl + olcReadOnly + olcUpdateRef
#   - replikasyon doğrulama (contextCSN)
#   - master'a HMAC ile self-register (POST /cluster/register)
# PG/Redis/backend/nginx YOK — saf yedek (kullanıcı kararı).
#
# __PLACEHOLDER__ değerleri backend bootstrap render'ında doldurulur.
set -euo pipefail

# ---- render-edilen değerler ----
NODE_ID='__NODE_ID__'
FQDN='__FQDN__'
IP='__IP__'
MASTER_HOST='__MASTER_HOST__'
BASE_DN='__BASE_DN__'
REPLICATOR_PW='__REPLICATOR_PW__'
CLUSTER_SECRET='__CLUSTER_SECRET__'
CA_PEM_B64='__CA_PEM_B64__'
SERVER_PEM_B64='__SERVER_PEM_B64__'
SERVER_KEY_B64='__SERVER_KEY_B64__'
# --------------------------------

SSL=/etc/mtl/ssl
SLAPDD=/etc/openldap/slapd.d

ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
info(){ printf '\033[36m▸ %s\033[0m\n' "$*"; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root gerekli (curl ... | sudo bash)"
command -v openssl >/dev/null || die "openssl yok"
command -v ldapmodify >/dev/null || { info "openldap-clients kuruluyor..."; dnf install -y openldap-clients >/dev/null 2>&1 || true; }

info "1/6  OpenLDAP server kontrolü"
if ! rpm -q openldap-servers >/dev/null 2>&1; then
  info "openldap-servers kurulu değil, kuruluyor..."
  dnf config-manager --set-enabled plus >/dev/null 2>&1 || true
  dnf install -y openldap openldap-servers openldap-clients >/dev/null 2>&1 || die "openldap kurulamadı"
fi
id ldap >/dev/null 2>&1 || die "ldap kullanıcısı yok"
ok "openldap-servers hazır"
grep -q "$FQDN" /etc/hosts 2>/dev/null || echo "${IP}  ${FQDN} ${NODE_ID}" >> /etc/hosts
getent hosts "$MASTER_HOST" >/dev/null 2>&1 || info "UYARI: ${MASTER_HOST} DNS'te çözülemiyor — /etc/hosts'a master IP kaydı ekleyin"

info "2/6  Sertifikalar + CERT TUZAĞI FIX'i"
mkdir -p "$SSL"
printf '%s' "$CA_PEM_B64"     | base64 -d > "$SSL/mtl-ca.pem"  || die "CA decode hatası"
printf '%s' "$SERVER_PEM_B64" | base64 -d > "$SSL/server.pem"  || die "server.pem decode hatası"
printf '%s' "$SERVER_KEY_B64" | base64 -d > "$SSL/server.key"  || die "server.key decode hatası"
openssl verify -CAfile "$SSL/mtl-ca.pem" "$SSL/server.pem" >/dev/null 2>&1 \
  || die "server sertifikası CA'ya zincirlenmiyor (bundle bozuk)"
getent group mtl >/dev/null 2>&1 || groupadd -r mtl
usermod -aG mtl ldap
chown root:ldap "$SSL"/mtl-ca.pem "$SSL"/server.pem "$SSL"/server.key
chmod 0644 "$SSL"/mtl-ca.pem "$SSL"/server.pem
cat "$SSL/mtl-ca.pem" /etc/pki/tls/certs/ca-bundle.crt > "$SSL/ldap-trust.pem"; chmod 0644 "$SSL/ldap-trust.pem"  # master Sectigo + ic mtl-ca birlesik trust
chmod 0640 "$SSL"/server.key
chown mtl:mtl /etc/mtl "$SSL" 2>/dev/null || true
chmod 0750 /etc/mtl "$SSL"
command -v restorecon >/dev/null 2>&1 && restorecon -RF /etc/mtl >/dev/null 2>&1 || true
if [[ ! -f /etc/pki/ca-trust/source/anchors/mtl-ca.pem ]]; then
  cp "$SSL/mtl-ca.pem" /etc/pki/ca-trust/source/anchors/mtl-ca.pem; update-ca-trust extract || true
fi
ok "certler yerleşti (root:ldap, key 640) · ldap∈mtl · /etc/mtl 750"

info "3/6  OpenLDAP consumer yapılandırması"
if slapcat -F "$SLAPDD" -b cn=config 2>/dev/null | grep -q "olcSuffix: ${BASE_DN}"; then
  ok "mdb zaten yapılandırılmış (idempotent)"
else
  ADMIN_HASH="$(slappasswd -h '{SSHA}' -s "$(openssl rand -base64 18)")"  # lokal rootDN (kullanılmaz, read-only)
  CFG_HASH="$(slappasswd -h '{SSHA}' -s "$(openssl rand -base64 18)")"
  systemctl stop slapd 2>/dev/null || true
  rm -rf "${SLAPDD:?}/"* /var/lib/ldap/*
  cat > /tmp/consumer-init.ldif <<LDIF
dn: cn=config
objectClass: olcGlobal
cn: config
olcArgsFile: /var/run/openldap/slapd.args
olcPidFile: /var/run/openldap/slapd.pid
olcLogLevel: stats sync
olcTLSCertificateFile: /etc/mtl/ssl/server.pem
olcTLSCertificateKeyFile: /etc/mtl/ssl/server.key
olcTLSCACertificateFile: /etc/mtl/ssl/mtl-ca.pem

dn: cn=schema,cn=config
objectClass: olcSchemaConfig
cn: schema

include: file:///etc/openldap/schema/core.ldif
include: file:///etc/openldap/schema/cosine.ldif
include: file:///etc/openldap/schema/nis.ldif
include: file:///etc/openldap/schema/inetorgperson.ldif

dn: olcDatabase=frontend,cn=config
objectClass: olcDatabaseConfig
objectClass: olcFrontendConfig
olcDatabase: frontend

dn: cn=module{0},cn=config
objectClass: olcModuleList
cn: module{0}
olcModulePath: /usr/lib64/openldap
olcModuleLoad: back_mdb.la
olcModuleLoad: ppolicy.la

dn: olcDatabase=config,cn=config
objectClass: olcDatabaseConfig
olcDatabase: config
olcRootDN: cn=admin,cn=config
olcRootPW: ${CFG_HASH}
olcAccess: to * by dn.exact="cn=admin,cn=config" manage by * none

dn: olcDatabase=mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: mdb
olcDbDirectory: /var/lib/ldap
olcSuffix: ${BASE_DN}
olcRootDN: cn=admin,${BASE_DN}
olcRootPW: ${ADMIN_HASH}
olcDbMaxSize: 1073741824
olcDbIndex: objectClass eq
olcDbIndex: cn,uid,mail eq,sub
olcDbIndex: entryCSN,entryUUID eq
olcAccess: to attrs=userPassword by self write by anonymous auth by * none
olcAccess: to * by self write by users read by anonymous auth
LDIF
  slapadd -F "$SLAPDD" -n 0 -l /tmp/consumer-init.ldif >/dev/null 2>&1 || die "slapadd başarısız"
  chown -R ldap:ldap "$SLAPDD" /var/lib/ldap
  rm -f /tmp/consumer-init.ldif
  systemctl enable --now slapd >/dev/null 2>&1
  sleep 2
  systemctl is-active --quiet slapd || die "slapd başlamadı (cert izinleri?)"
  ok "consumer mdb hazır (boş — replikasyon dolduracak)"
fi

info "4/6  Replikasyon (refreshAndPersist + read-only)"
DBDN="$(ldapsearch -Y EXTERNAL -H ldapi:/// -b cn=config -s sub '(&(objectClass=olcMdbConfig)(olcSuffix='"${BASE_DN}"'))' dn 2>/dev/null | awk '/^dn: /{print substr($0,5); exit}')"
[[ -n "$DBDN" ]] || die "mdb config DN bulunamadı"
if slapcat -F "$SLAPDD" -b cn=config 2>/dev/null | grep -q 'olcSyncrepl:'; then
  ok "syncrepl zaten var"
else
  cat > /tmp/syncrepl.ldif <<LDIF
dn: ${DBDN}
changetype: modify
add: olcSyncrepl
olcSyncrepl: rid=001 provider=ldaps://${MASTER_HOST} type=refreshAndPersist retry="5 5 60 +" searchbase="${BASE_DN}" scope=sub schemachecking=on bindmethod=simple binddn="cn=replicator,${BASE_DN}" credentials=${REPLICATOR_PW} tls_cacert=/etc/mtl/ssl/ldap-trust.pem tls_reqcert=demand
-
add: olcUpdateRef
olcUpdateRef: ldaps://${MASTER_HOST}
-
add: olcReadOnly
olcReadOnly: TRUE
LDIF
  ldapmodify -Y EXTERNAL -H ldapi:/// -f /tmp/syncrepl.ldif >/dev/null 2>&1 || die "syncrepl ldapmodify başarısız"
  rm -f /tmp/syncrepl.ldif
  systemctl restart slapd; sleep 3
  systemctl is-active --quiet slapd || die "syncrepl sonrası slapd başlamadı"
  ok "syncrepl + olcReadOnly + olcUpdateRef eklendi"
fi

info "5/6  Replikasyon doğrulama (contextCSN)"
MCSN="$(LDAPTLS_CACERT="$SSL/ldap-trust.pem" ldapsearch -LLL -H "ldaps://${MASTER_HOST}:636" -x -b "$BASE_DN" -s base contextCSN 2>/dev/null | awk -F': ' '/^contextCSN/{print $2}' | sort | tail -1)"
CCSN=""
for _ in $(seq 1 12); do
  CCSN="$(ldapsearch -LLL -Y EXTERNAL -H ldapi:/// -b "$BASE_DN" -s base contextCSN 2>/dev/null | awk -F': ' '/^contextCSN/{print $2}' | sort | tail -1)"
  [[ -n "$CCSN" && "$CCSN" == "$MCSN" ]] && break
  sleep 3
done
info "master:   ${MCSN:-<okunamadı>}"
info "consumer: ${CCSN:-<henüz boş>}"
if [[ -n "$CCSN" && "$CCSN" == "$MCSN" ]]; then ok "SENKRON"; else info "henüz tam senkron değil (büyük dizinde normal; panelden izleyin)"; fi

info "6/6  Master'a self-register (HMAC)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BODY="$(printf '{"node_id":"%s","node_type":"SLAVE","hostname":"%s","base_url":"https://%s","version":"consumer-bootstrap","metadata":{"provisioned":true}}' "$NODE_ID" "$FQDN" "$FQDN")"
BODY_HASH="$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $NF}')"
SIG="$(printf '%s' "${NODE_ID}|${TS}|${BODY_HASH}" | openssl dgst -sha256 -hmac "$CLUSTER_SECRET" | awk '{print $NF}')"
if curl -fsS --cacert "$SSL/ldap-trust.pem" -X POST "https://${MASTER_HOST}/api/v1/cluster/register" \
     -H "Content-Type: application/json" \
     -H "X-MTL-Node-Id: ${NODE_ID}" -H "X-MTL-Timestamp: ${TS}" -H "X-MTL-Signature: ${SIG}" \
     --data "$BODY" >/dev/null 2>&1; then
  ok "master'a kaydoldu — panelde 'online' görünecek"
else
  info "self-register başarısız (panelde zaten kayıtlı olabilir; replikasyon yine de çalışır)"
fi

echo ""
ok "BİTTİ — ${NODE_ID} read-only consumer olarak çalışıyor, replikasyon master'dan akıyor."
echo "    Panel → Cluster → Senkron Durumu'ndan contextCSN'i izleyebilirsin."
"""
