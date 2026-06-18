# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Shield (sertifika/TLS) business logic.

Tasarım ilkeleri:
  - public PEM → DB (pem_data); ÖZEL ANAHTAR → diskte (/etc/mtl/ssl/staging), DB'de DEĞİL.
  - Sertifika parse: openssl subprocess (yeni Python bağımlılığı yok — system_info_service
    zaten subprocess kullanıyor).
  - Ayrıcalıklı aktivasyon (canlı server.pem/mtl-ca.pem değişimi + slapd/nginx reload):
    backend (mtl) DOĞRUDAN YAPMAZ → root-sahipli /opt/mtl/bin/mtl-cert-apply helper'ını
    `sudo -n` ile çağırır. Helper atomik swap + restorecon + reload + doğrula + rollback yapar.
  - slapd cn=config'e DOKUNULMAZ: olcTLS* yolları sabit (server.pem/server.key/mtl-ca.pem),
    yalnızca dosya İÇERİĞİ değişir.
"""

from __future__ import annotations
import secrets
import time

import asyncio
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.certificate import CertificateInventory, CertificateSigningRequest

logger = get_logger(__name__)

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


# ============================================================================
# Yol yardımcıları
# ============================================================================
def _ssl_dir() -> Path:
    return Path(getattr(get_settings(), "ssl_dir", Path("/etc/mtl/ssl")))


def _staging_dir() -> Path:
    return Path(getattr(get_settings(), "cert_staging_dir", _ssl_dir() / "staging"))


def _helper() -> str:
    return str(getattr(get_settings(), "cert_apply_helper", Path("/opt/mtl/bin/mtl-cert-apply")))


def _cert_staging(cert_id: UUID) -> Path:
    return _staging_dir() / str(cert_id)


def _csr_staging() -> Path:
    return _staging_dir() / "csr"


# ============================================================================
# subprocess yardımcıları (senkron — async fonksiyonlardan to_thread ile çağrılır)
# ============================================================================
def _run(args: list[str], input_text: str | None = None, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(  # noqa: S603 — sabit komutlar, shell=False, arg-list
        args,
        input=input_text,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


async def _run_async(args: list[str], input_text: str | None = None, timeout: int = 30):
    return await asyncio.to_thread(_run, args, input_text, timeout)


# ============================================================================
# Sertifika parse (openssl)
# ============================================================================
def _strip_prefix(line: str, prefix: str) -> str:
    line = line.strip()
    return line[len(prefix):].strip() if line.startswith(prefix) else line


def _parse_openssl_date(raw: str) -> datetime:
    """'May 14 08:06:21 2026 GMT' → aware datetime (UTC)."""
    s = raw.strip()
    for suffix in (" GMT", " UTC"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
            break
    s = " ".join(s.split())  # çift boşlukları (tek haneli gün) normalize et
    dt = datetime.strptime(s, "%b %d %H:%M:%S %Y")
    return dt.replace(tzinfo=timezone.utc)


def parse_certificate(pem: str) -> dict[str, Any]:
    """PEM public sertifikadan metadata çıkar. Geçersizse ValidationError."""
    if "BEGIN CERTIFICATE" not in pem:
        raise ValidationError("Geçerli bir PEM sertifikası değil (BEGIN CERTIFICATE yok)")

    res = _run([
        "openssl", "x509", "-noout",
        "-subject", "-issuer", "-serial",
        "-startdate", "-enddate",
        "-fingerprint", "-sha256",
    ], input_text=pem)
    if res.returncode != 0:
        raise ValidationError(f"Sertifika çözümlenemedi: {res.stderr.strip()[:200]}")

    out: dict[str, Any] = {}
    for line in res.stdout.splitlines():
        if line.startswith("subject="):
            out["subject"] = _strip_prefix(line, "subject=")
        elif line.startswith("issuer="):
            out["issuer"] = _strip_prefix(line, "issuer=")
        elif line.startswith("serial="):
            out["serial_number"] = _strip_prefix(line, "serial=")
        elif line.startswith("notBefore="):
            out["not_before"] = _parse_openssl_date(_strip_prefix(line, "notBefore="))
        elif line.startswith("notAfter="):
            out["not_after"] = _parse_openssl_date(_strip_prefix(line, "notAfter="))
        elif "Fingerprint=" in line:
            out["fingerprint_sha256"] = line.split("Fingerprint=", 1)[1].strip()

    required = {"subject", "issuer", "serial_number", "not_before", "not_after", "fingerprint_sha256"}
    missing = required - out.keys()
    if missing:
        raise ValidationError(f"Sertifika alanları eksik: {', '.join(sorted(missing))}")

    # CA mı?
    ext = _run(["openssl", "x509", "-noout", "-ext", "basicConstraints"], input_text=pem)
    out["is_ca"] = "CA:TRUE" in (ext.stdout or "")
    out["is_self_signed"] = out["subject"] == out["issuer"]
    return out


def _pubkey_of_cert(pem: str) -> str | None:
    r = _run(["openssl", "x509", "-noout", "-pubkey"], input_text=pem)
    return r.stdout.strip() if r.returncode == 0 else None


def _pubkey_of_key(key_pem: str) -> str | None:
    r = _run(["openssl", "pkey", "-pubout"], input_text=key_pem)
    return r.stdout.strip() if r.returncode == 0 else None


def _key_matches_cert(cert_pem: str, key_pem: str) -> bool:
    a = _pubkey_of_cert(cert_pem)
    b = _pubkey_of_key(key_pem)
    return bool(a) and a == b


# ============================================================================
# Türetilmiş alanlar (response zenginleştirme)
# ============================================================================
def _enrich(cert: CertificateInventory) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    na = cert.not_after
    if na is not None and na.tzinfo is None:
        na = na.replace(tzinfo=timezone.utc)
    days = int((na - now).total_seconds() // 86400) if na else None
    return {
        "days_remaining": days,
        "is_expired": (na < now) if na else None,
        "is_self_signed": (cert.subject == cert.issuer),
    }


def _to_public(cert: CertificateInventory) -> dict[str, Any]:
    base = {
        "id": cert.id,
        "name": cert.name,
        "type": cert.type,
        "serial_number": cert.serial_number,
        "subject": cert.subject,
        "issuer": cert.issuer,
        "not_before": cert.not_before,
        "not_after": cert.not_after,
        "fingerprint_sha256": cert.fingerprint_sha256,
        "is_active": cert.is_active,
        "has_private_key": cert.has_private_key,
        "description": cert.description,
        "source": cert.source,
        "activated_at": cert.activated_at,
        "uploaded_at": cert.uploaded_at,
    }
    base.update(_enrich(cert))
    return base


# ============================================================================
# Listeleme / detay
# ============================================================================
async def list_certificates(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(CertificateInventory).order_by(
            CertificateInventory.type, CertificateInventory.is_active.desc(),
            CertificateInventory.not_after.desc(),
        )
    )).scalars().all()
    return [_to_public(c) for c in rows]


async def get_certificate(db: AsyncSession, cert_id: UUID) -> CertificateInventory:
    cert = await db.get(CertificateInventory, cert_id)
    if cert is None:
        raise NotFoundError("Sertifika bulunamadı", details={"id": str(cert_id)})
    return cert


async def _get_active(db: AsyncSession, cert_type: str) -> CertificateInventory | None:
    return (await db.execute(
        select(CertificateInventory).where(
            CertificateInventory.type == cert_type,
            CertificateInventory.is_active.is_(True),
        ).limit(1)
    )).scalar_one_or_none()


# ============================================================================
# Canlı endpoint kontrolü (openssl s_client)
# ============================================================================
def _live_fingerprint(host: str, port: int, timeout: int = 6) -> tuple[bool, str | None, str | None]:
    """(reachable, fingerprint, error)"""
    try:
        sc = _run(
            ["openssl", "s_client", "-connect", f"{host}:{port}", "-servername", host],
            input_text="", timeout=timeout,
        )
        if sc.returncode != 0 and "CERTIFICATE" not in (sc.stdout or ""):
            return False, None, (sc.stderr.strip()[:160] or "bağlanılamadı")
        fp = _run(["openssl", "x509", "-noout", "-fingerprint", "-sha256"], input_text=sc.stdout)
        if fp.returncode != 0:
            return False, None, "canlı sertifika okunamadı"
        val = fp.stdout.split("Fingerprint=", 1)[1].strip() if "Fingerprint=" in fp.stdout else None
        return True, val, None
    except subprocess.TimeoutExpired:
        return False, None, "zaman aşımı"
    except Exception as e:  # noqa: BLE001
        return False, None, str(e)[:160]


async def get_overview(db: AsyncSession) -> dict[str, Any]:
    s = get_settings()
    active_ca = await _get_active(db, "CA")
    active_server = await _get_active(db, "SERVER")
    total = (await db.execute(select(CertificateInventory))).scalars().all()
    pending_csr = (await db.execute(
        select(CertificateSigningRequest).where(CertificateSigningRequest.status == "PENDING")
    )).scalars().all()

    host = getattr(s, "ldaps_host", "127.0.0.1")
    ldaps_port = int(getattr(s, "ldaps_port", 636))
    https_port = int(getattr(s, "https_port", 443))

    endpoints: list[dict[str, Any]] = []
    warnings: list[str] = []

    for name, port in (("ldaps", ldaps_port), ("https", https_port)):
        reachable, fp, err = await asyncio.to_thread(_live_fingerprint, host, port)
        matches = None
        if fp and active_server:
            matches = (fp == active_server.fingerprint_sha256)
            if not matches:
                warnings.append(
                    f"{name}:{port} canlı sertifika parmak izi aktif SERVER sertifikasıyla UYUŞMUYOR "
                    f"(servis yeniden başlatılmamış olabilir)."
                )
        endpoints.append({
            "name": name, "host": host, "port": port,
            "reachable": reachable, "fingerprint_sha256": fp,
            "matches_active": matches, "error": err,
        })

    # Süre uyarıları
    for cert in (active_ca, active_server):
        if cert:
            d = _enrich(cert)["days_remaining"]
            if d is not None and d < 30:
                warnings.append(f"'{cert.name}' ({cert.type}) {d} gün içinde doluyor.")

    # Self-signed CA uyarısı (kurumsal CA'ya geçiş hatırlatması)
    if active_ca and active_ca.subject == active_ca.issuer:
        warnings.append(
            "Aktif CA self-signed (MTL Root CA). Kurumsal CA'ya geçiş için CA Geçişi sekmesini kullanın."
        )

    return {
        "active_ca": _to_public(active_ca) if active_ca else None,
        "active_server": _to_public(active_server) if active_server else None,
        "total_certificates": len(total),
        "pending_csr": len(pending_csr),
        "endpoints": endpoints,
        "warnings": warnings,
    }


# ============================================================================
# Yükleme
# ============================================================================
def _write_private(path: Path, key_pem: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(key_pem)
    path.chmod(0o600)


async def upload_certificate(
    db: AsyncSession,
    *,
    name: str,
    cert_type: str,
    pem: str,
    private_key: str | None,
    csr_id: UUID | None,
    description: str | None,
    admin_id: UUID,
) -> CertificateInventory:
    meta = await asyncio.to_thread(parse_certificate, pem)

    # CA tip tutarlılığı
    if cert_type == "CA" and not meta["is_ca"]:
        raise ValidationError("Yüklenen sertifika bir CA değil (basicConstraints CA:TRUE değil).")
    if cert_type in ("SERVER", "CLIENT") and meta["is_ca"]:
        logger.warning("shield.upload.server_is_ca", name=name)

    # Fingerprint çakışması
    existing = (await db.execute(
        select(CertificateInventory).where(
            CertificateInventory.fingerprint_sha256 == meta["fingerprint_sha256"]
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "Bu sertifika (aynı SHA256 parmak izi) zaten kayıtlı.",
            details={"existing_id": str(existing.id), "name": existing.name},
        )

    # Özel anahtarı çöz (SERVER için)
    has_key = False
    key_pem: str | None = None
    if cert_type == "SERVER":
        if csr_id is not None:
            csr = await db.get(CertificateSigningRequest, csr_id)
            if csr is None:
                raise NotFoundError("CSR bulunamadı", details={"csr_id": str(csr_id)})
            kp = Path(csr.key_path)
            if not kp.exists():
                raise ValidationError("CSR özel anahtarı diskte bulunamadı.")
            key_pem = kp.read_text()
        elif private_key:
            key_pem = private_key
        else:
            raise ValidationError("SERVER sertifikası için özel anahtar (veya csr_id) gerekli.")

        if not await asyncio.to_thread(_key_matches_cert, pem, key_pem):
            raise ValidationError("Özel anahtar sertifikayla EŞLEŞMİYOR (public key uyuşmuyor).")
        has_key = True

    source = "GENERATED" if csr_id is not None else "UPLOAD"
    cert = CertificateInventory(
        name=name,
        type=cert_type,
        pem_data=pem,
        serial_number=meta["serial_number"],
        subject=meta["subject"],
        issuer=meta["issuer"],
        not_before=meta["not_before"],
        not_after=meta["not_after"],
        fingerprint_sha256=meta["fingerprint_sha256"],
        is_active=False,
        has_private_key=has_key,
        description=description,
        source=source,
        uploaded_by=admin_id,
    )
    db.add(cert)
    await db.flush()  # cert.id

    # Staging'e yaz (aktivasyon helper'ı buradan okuyacak)
    sdir = _cert_staging(cert.id)
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / "cert.pem").write_text(pem)
    (sdir / "cert.pem").chmod(0o644)
    if has_key and key_pem:
        _write_private(sdir / "cert.key", key_pem)

    # CSR'ı fulfilled işaretle
    if csr_id is not None:
        csr = await db.get(CertificateSigningRequest, csr_id)
        if csr is not None:
            csr.status = "FULFILLED"
            csr.fulfilled_cert_id = cert.id
            csr.fulfilled_at = datetime.now(timezone.utc)

    return cert


# ============================================================================
# Silme
# ============================================================================
async def delete_certificate(db: AsyncSession, cert_id: UUID) -> CertificateInventory:
    cert = await get_certificate(db, cert_id)
    if cert.is_active:
        raise ConflictError("Aktif sertifika silinemez. Önce başka bir sertifika aktive edin.")
    # Staging temizliği (best-effort)
    try:
        await asyncio.to_thread(shutil.rmtree, _cert_staging(cert_id), True)
    except Exception:  # noqa: BLE001
        logger.warning("shield.delete.staging_cleanup_failed", id=str(cert_id))
    await db.delete(cert)
    return cert


# ============================================================================
# Aktivasyon (ayrıcalıklı helper çağrısı)
# ============================================================================
# ============================================================================
# Aktivasyon transport: ayricalikli helper'a QUEUE uzerinden ulasilir.
# Web servisi (mtl, NNP'li, sudo yok) /var/lib/mtl/shield/queue/<id>.req yazar;
# root systemd .path->oneshot runner helper'i calistirir, <id>.result yazar.
# ============================================================================
import os as _os

_SHIELD_QUEUE_DIR = Path(_os.environ.get("MTL_SHIELD_QUEUE_DIR", "/var/lib/mtl/shield/queue"))
_SHIELD_DISPATCH_TIMEOUT = float(_os.environ.get("MTL_SHIELD_DISPATCH_TIMEOUT", "150"))
_SHIELD_POLL_INTERVAL = 0.25


def _dispatch(action: str, ids: list[str]) -> dict[str, Any]:
    """Aksiyon+id'leri kuyruga yaz, root runner'in <id>.result'ini bekle, parse et.

    Sozlesme (eski _invoke_helper ile ayni): rc==0 AND data['ok'] ister; aksi
    halde ValidationError. Helper STDOUT'unun son '{'-satiri JSON'dur.
    """
    _SHIELD_QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    rid = secrets.token_hex(16)
    req = _SHIELD_QUEUE_DIR / f"{rid}.req"
    tmp = _SHIELD_QUEUE_DIR / f"{rid}.req.tmp"
    res = _SHIELD_QUEUE_DIR / f"{rid}.result"
    tmp.write_text(json.dumps({"action": action, "args": ids}))
    _os.replace(tmp, req)  # atomik rename -> .path tetiklenir, kismi dosya gorunmez
    deadline = time.time() + _SHIELD_DISPATCH_TIMEOUT
    try:
        while time.time() < deadline:
            if res.exists():
                try:
                    payload = json.loads(res.read_text())
                except ValueError:
                    time.sleep(_SHIELD_POLL_INTERVAL); continue
                rc = int(payload.get("rc", 1))
                raw = (payload.get("stdout") or "").strip()
                try:
                    line = next((ln for ln in reversed(raw.splitlines()) if ln.startswith("{")), "")
                    data = json.loads(line) if line else {}
                except (ValueError, StopIteration):
                    data = {}
                if rc != 0 or not data.get("ok"):
                    msg = data.get("message") or (payload.get("stderr") or "").strip()[:300] or "Aktivasyon basarisiz."
                    logger.error("shield.helper_failed", action=action, rc=rc, msg=msg)
                    raise ValidationError(f"Aktivasyon basarisiz: {msg}")
                return data
            time.sleep(_SHIELD_POLL_INTERVAL)
        logger.error("shield.helper_timeout", action=action, timeout=_SHIELD_DISPATCH_TIMEOUT)
        raise ValidationError("Aktivasyon zaman asimi — yetkili runner yanit vermedi.")
    finally:
        for p in (tmp, req, res):
            try:
                p.unlink()
            except FileNotFoundError:
                pass


def _call_helper(action: str, cert_id: UUID) -> dict[str, Any]:
    if not _UUID_RE.match(str(cert_id)):
        raise ValidationError("Geçersiz sertifika id (uuid değil).")
    return _dispatch(action, [str(cert_id)])


def _call_helper_bundle(ca_id: UUID, server_id: UUID) -> dict[str, Any]:
    if not (_UUID_RE.match(str(ca_id)) and _UUID_RE.match(str(server_id))):
        raise ValidationError("Geçersiz sertifika id (uuid değil).")
    return _dispatch("activate-bundle", [str(ca_id), str(server_id)])


def _invoke_helper(args: list[str], action: str) -> dict[str, Any]:
    proc = _run(args, timeout=120)
    raw = (proc.stdout or "").strip()
    data: dict[str, Any]
    try:
        json_line = next((ln for ln in reversed(raw.splitlines()) if ln.startswith("{")), "")
        data = json.loads(json_line) if json_line else {}
    except (ValueError, StopIteration):
        data = {}
    if proc.returncode != 0 or not data.get("ok"):
        msg = data.get("message") or (proc.stderr or "").strip()[:300] or "Aktivasyon başarısız."
        logger.error("shield.helper_failed", action=action, rc=proc.returncode, msg=msg)
        raise ValidationError(f"Aktivasyon başarısız: {msg}")
    return data


async def activate_certificate(db: AsyncSession, cert_id: UUID, admin_id: UUID) -> dict[str, Any]:
    cert = await get_certificate(db, cert_id)

    now = datetime.now(timezone.utc)
    if _enrich(cert)["is_expired"]:
        raise ValidationError("Süresi dolmuş sertifika aktive edilemez.")
    if cert.type == "SERVER" and not cert.has_private_key:
        raise ValidationError("SERVER sertifikasının özel anahtarı yok — aktive edilemez.")

    action = "activate-ca" if cert.type == "CA" else "activate-server"

    # Staging dosyalarının varlığını garanti et (yeniden materyalize)
    sdir = _cert_staging(cert_id)
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / "cert.pem").write_text(cert.pem_data)
    (sdir / "cert.pem").chmod(0o644)

    result = await asyncio.to_thread(_call_helper, action, cert_id)

    # DB: tip başına tek aktif → önce eskiyi indir, sonra yeniyi kaldır
    old = await _get_active(db, cert.type)
    if old is not None and old.id != cert.id:
        old.is_active = False
    cert.is_active = True
    cert.activated_at = now
    cert.activated_by = admin_id

    replication_warning = None
    if cert.type == "CA":
        replication_warning = (
            "CA değiştirildi. Bu master CA'sına bağlı slave/consumer node'lar, yeni CA kendilerine "
            "dağıtılmadan replikasyonu DOĞRULAYAMAZ. CA dışa aktarımını indirip her slave'e "
            "(/etc/mtl/ssl/mtl-ca.pem) elle taşıyın ve slapd'yi yeniden başlatın."
        )

    return {
        "certificate": _to_public(cert),
        "slapd_reloaded": bool(result.get("slapd_reloaded")),
        "nginx_reloaded": bool(result.get("nginx_reloaded")),
        "ca_trust_updated": bool(result.get("ca_trust_updated")),
        "live_ldaps_fingerprint": result.get("ldaps_fingerprint"),
        "live_https_fingerprint": result.get("https_fingerprint"),
        "message": result.get("message") or "Aktivasyon tamamlandı.",
        "replication_warning": replication_warning,
    }


async def activate_bundle(
    db: AsyncSession, *, ca_id: UUID, server_id: UUID, admin_id: UUID
) -> dict[str, Any]:
    """CA geçişi: yeni CA + yeni SERVER sertifikasını ATOMİK aktive et."""
    ca = await get_certificate(db, ca_id)
    server = await get_certificate(db, server_id)
    if ca.type != "CA":
        raise ValidationError("ca_id bir CA sertifikası değil.")
    if server.type != "SERVER":
        raise ValidationError("server_id bir SERVER sertifikası değil.")
    if not server.has_private_key:
        raise ValidationError("SERVER sertifikasının özel anahtarı yok — aktive edilemez.")
    for c in (ca, server):
        if _enrich(c)["is_expired"]:
            raise ValidationError(f"'{c.name}' süresi dolmuş — aktive edilemez.")

    # Staging'leri yeniden materyalize et (cert.key zaten upload'ta yazıldı)
    for c in (ca, server):
        sdir = _cert_staging(c.id)
        sdir.mkdir(parents=True, exist_ok=True)
        (sdir / "cert.pem").write_text(c.pem_data)
        (sdir / "cert.pem").chmod(0o644)

    result = await asyncio.to_thread(_call_helper_bundle, ca_id, server_id)

    now = datetime.now(timezone.utc)
    for cert in (ca, server):
        old = await _get_active(db, cert.type)
        if old is not None and old.id != cert.id:
            old.is_active = False
        cert.is_active = True
        cert.activated_at = now
        cert.activated_by = admin_id

    return {
        "certificate": _to_public(server),
        "slapd_reloaded": bool(result.get("slapd_reloaded")),
        "nginx_reloaded": bool(result.get("nginx_reloaded")),
        "ca_trust_updated": bool(result.get("ca_trust_updated")),
        "live_ldaps_fingerprint": result.get("ldaps_fingerprint"),
        "live_https_fingerprint": result.get("https_fingerprint"),
        "message": result.get("message") or "CA geçişi tamamlandı (CA + SERVER atomik aktive edildi).",
        "replication_warning": (
            "CA değiştirildi. Slave/consumer node'lar yeni CA dağıtılmadan replikasyonu DOĞRULAYAMAZ. "
            "CA dışa aktarımını indirip her slave'e (/etc/mtl/ssl/mtl-ca.pem) taşıyın ve slapd'yi "
            "yeniden başlatın. Yeni slave kurulumları Tur 15 installer'ı ile bu CA'ya bağlanmalı."
        ),
    }


# ============================================================================
# CSR üretimi
# ============================================================================
def _build_csr(req: dict[str, Any], key_path: Path) -> tuple[str, str]:
    """(csr_pem, key_fingerprint) — openssl ile anahtar+CSR üret. Anahtar diske yazılır."""
    key_path.parent.mkdir(parents=True, exist_ok=True)
    # 1) anahtar üret
    genr = _run(["openssl", "genrsa", str(req["key_bits"])])
    if genr.returncode != 0:
        raise ValidationError(f"Anahtar üretilemedi: {genr.stderr.strip()[:160]}")
    key_pem = genr.stdout
    key_path.write_text(key_pem)
    key_path.chmod(0o600)

    # 2) SAN config
    san_entries = []
    idx_dns = 1
    san_entries.append(f"DNS.{idx_dns} = {req['common_name']}")
    for d in req["san_dns"]:
        idx_dns += 1
        san_entries.append(f"DNS.{idx_dns} = {d}")
    idx_ip = 0
    for ip in req["san_ip"]:
        idx_ip += 1
        san_entries.append(f"IP.{idx_ip} = {ip}")
    subj = f"/C={req['country']}/O={req['organization']}/CN={req['common_name']}"
    cfg = (
        "[req]\ndistinguished_name=dn\nreq_extensions=v3_req\nprompt=no\n"
        "[dn]\n"
        f"C={req['country']}\nO={req['organization']}\nCN={req['common_name']}\n"
        "[v3_req]\n"
        "basicConstraints=CA:FALSE\n"
        "keyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment\n"
        "subjectAltName=@alt_names\n"
        "[alt_names]\n" + "\n".join(san_entries) + "\n"
    )
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".cnf", delete=False) as tf:
        tf.write(cfg)
        cfg_path = tf.name
    try:
        csr = _run([
            "openssl", "req", "-new", "-key", str(key_path),
            "-subj", subj, "-config", cfg_path,
        ])
        if csr.returncode != 0:
            raise ValidationError(f"CSR üretilemedi: {csr.stderr.strip()[:200]}")
        csr_pem = csr.stdout
    finally:
        Path(cfg_path).unlink(missing_ok=True)

    # anahtar parmak izi (public key sha256)
    pub = _run(["openssl", "pkey", "-pubout"], input_text=key_pem)
    kfp = None
    if pub.returncode == 0:
        h = _run(["openssl", "dgst", "-sha256"], input_text=pub.stdout)
        if h.returncode == 0:
            kfp = h.stdout.strip().split("=")[-1].strip()
    return csr_pem, kfp


async def generate_csr(db: AsyncSession, req: dict[str, Any], admin_id: UUID) -> tuple[CertificateSigningRequest, str]:
    csr = CertificateSigningRequest(
        name=req["name"],
        subject=f"/C={req['country']}/O={req['organization']}/CN={req['common_name']}",
        csr_pem="",  # birazdan
        key_path="",  # birazdan
        status="PENDING",
        created_by=admin_id,
    )
    db.add(csr)
    await db.flush()  # csr.id

    key_path = _csr_staging() / f"{csr.id}.key"
    csr_pem, kfp = await asyncio.to_thread(_build_csr, req, key_path)
    csr.csr_pem = csr_pem
    csr.key_path = str(key_path)
    csr.key_fingerprint = kfp

    # CSR metnini de staging'e bırak (indirilebilir kalsın)
    (_csr_staging() / f"{csr.id}.csr").write_text(csr_pem)
    return csr, csr_pem


async def list_csr(db: AsyncSession) -> list[CertificateSigningRequest]:
    return list((await db.execute(
        select(CertificateSigningRequest).order_by(CertificateSigningRequest.created_at.desc())
    )).scalars().all())


# ============================================================================
# CA dışa aktarımı (slave dağıtımı için)
# ============================================================================
async def export_active_ca(db: AsyncSession) -> dict[str, Any]:
    ca = await _get_active(db, "CA")
    if ca is None:
        # Aktif CA kaydı yoksa diskten oku (kurulumdan gelen mtl-ca.pem)
        ca_file = _ssl_dir() / "mtl-ca.pem"
        if ca_file.exists():
            pem = ca_file.read_text()
            meta = await asyncio.to_thread(parse_certificate, pem)
            return {
                "name": "mtl-ca.pem (disk)",
                "pem": pem,
                "fingerprint_sha256": meta["fingerprint_sha256"],
                "subject": meta["subject"],
                "not_after": meta["not_after"],
                "note": "Bu CA henüz envantere kayıtlı değil; diskten okundu. Her slave'in "
                        "/etc/mtl/ssl/mtl-ca.pem dosyasına yazın ve slapd'yi yeniden başlatın.",
            }
        raise NotFoundError("Aktif CA bulunamadı.")
    return {
        "name": ca.name,
        "pem": ca.pem_data,
        "fingerprint_sha256": ca.fingerprint_sha256,
        "subject": ca.subject,
        "not_after": ca.not_after,
        "note": "Her slave node'un /etc/mtl/ssl/mtl-ca.pem dosyasına yazın, ardından slapd'yi "
                "yeniden başlatın. Yeni slave kurulumlarında installer bu CA'yı kullanmalı (Tur 15).",
    }


# ============================================================================
# MTL CA ile yeniden imzalama (geçiş/test — saf openssl, mtl-ca.key okunabilir)
# ============================================================================
def _resign(csr_pem: str, days: int) -> str:
    ssl = _ssl_dir()
    ca_pem = ssl / "mtl-ca.pem"
    ca_key = ssl / "mtl-ca.key"
    if not ca_pem.exists() or not ca_key.exists():
        raise ValidationError("MTL CA anahtarı/sertifikası bulunamadı (/etc/mtl/ssl).")
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".csr", delete=False) as tf:
        tf.write(csr_pem)
        csr_path = tf.name
    try:
        out = _run([
            "openssl", "x509", "-req", "-in", csr_path,
            "-CA", str(ca_pem), "-CAkey", str(ca_key), "-CAcreateserial",
            "-days", str(days), "-sha256", "-copy_extensions", "copyall",
        ])
        if out.returncode != 0:
            raise ValidationError(f"İmzalama başarısız: {out.stderr.strip()[:200]}")
        return out.stdout
    finally:
        Path(csr_path).unlink(missing_ok=True)


async def resign_csr_with_mtl_ca(
    db: AsyncSession, *, csr_id: UUID, name: str, description: str | None, days: int, admin_id: UUID
) -> CertificateInventory:
    csr = await db.get(CertificateSigningRequest, csr_id)
    if csr is None:
        raise NotFoundError("CSR bulunamadı", details={"csr_id": str(csr_id)})
    key_path = Path(csr.key_path)
    if not key_path.exists():
        raise ValidationError("CSR özel anahtarı diskte bulunamadı.")

    cert_pem = await asyncio.to_thread(_resign, csr.csr_pem, days)
    key_pem = key_path.read_text()

    return await upload_certificate(
        db,
        name=name,
        cert_type="SERVER",
        pem=cert_pem,
        private_key=key_pem,
        csr_id=None,
        description=description or f"MTL CA ile yeniden imzalandı (CSR {csr.name})",
        admin_id=admin_id,
    )
