#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
#
# ============================================================
# MTL LDAP Admin — Slave Promote Failover Script
# ============================================================
# Bu script slave node'u master rolüne yükseltir.
# 
# Tetiklenme: Master sunucusu erişilemez olduğunda, yetkili
# yöneticinin çift onayı ile MTL Console üzerinden çalıştırılır
# veya doğrudan komut satırından sudo ile koşulabilir.
#
# Kullanım:
#   sudo /opt/mtl/scripts/mtl-failover-promote-slave.sh [--force] [--dry-run]
#
# Çıkış kodları:
#   0  Başarılı
#   1  Genel hata
#   2  Yapılandırma sorunu
#   3  slapd ile ilgili sorun
#   4  Doğrulama başarısız
# ============================================================

set -euo pipefail

# ----- Varsayilan degerler -----
MTL_ENV_FILE="${MTL_ENV_FILE:-/etc/mtl/mtl-ldap.env}"
LDAP_CONF_DIR="${LDAP_CONF_DIR:-/etc/ldap/slapd.d}"
LDAP_DATA_DIR="${LDAP_DATA_DIR:-/var/lib/ldap}"
LDAP_ACCESSLOG_DIR="${LDAP_ACCESSLOG_DIR:-/var/lib/ldap-accesslog}"
LDAP_BASE_DN="${LDAP_BASE_DN:-dc=mtl,dc=local}"
LDAP_ADMIN_DN="${LDAP_ADMIN_DN:-cn=admin,dc=mtl,dc=local}"
SLAPD_SERVICE="${SLAPD_SERVICE:-slapd}"
MTL_SERVICE="${MTL_SERVICE:-mtl-ldap}"
MTL_WORKER_SERVICE="${MTL_WORKER_SERVICE:-mtl-ldap-worker}"
LOG_DIR="${LOG_DIR:-/var/log/mtl}"
LOG_FILE="${LOG_DIR}/failover-promote-$(date +%Y%m%d-%H%M%S).log"

FORCE=0
DRY_RUN=0

# ----- Arguman ayristirma -----
while [[ $# -gt 0 ]]; do
    case $1 in
        --force) FORCE=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help)
            echo "Kullanım: $0 [--force] [--dry-run]"
            echo "  --force      Doğrulama hatalarını yoksay (riskli)"
            echo "  --dry-run    Komutları gösterir, çalıştırmaz"
            exit 0
            ;;
        *) echo "Bilinmeyen argüman: $1"; exit 1 ;;
    esac
done

# ----- Yardımcı fonksiyonlar -----
mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
err()  { printf '[%s] HATA: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
ok()   { printf '[%s] OK: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
run()  {
    log "+ $*"
    if [[ "${DRY_RUN}" -eq 0 ]]; then
        "$@"
    fi
}

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        err "Bu script root olarak çalıştırılmalıdır."
        exit 1
    fi
}

# ----- Ana akış -----

cat <<'BANNER'
============================================================
  MTL LDAP Admin — Failover: Slave → Master Promote
============================================================
BANNER

require_root

log "Log dosyası: ${LOG_FILE}"

# 1) Ortam değişkenlerini yükle
if [[ ! -f "${MTL_ENV_FILE}" ]]; then
    err "Ortam dosyası bulunamadı: ${MTL_ENV_FILE}"
    exit 2
fi
log "Ortam dosyası okunuyor: ${MTL_ENV_FILE}"
# shellcheck disable=SC1090
set -a; source "${MTL_ENV_FILE}"; set +a

# Beklenen değişkenleri kontrol et
if [[ "${MTL_PROFILE:-}" != "SLAVE" ]]; then
    if [[ "${FORCE}" -eq 0 ]]; then
        err "MTL_PROFILE 'SLAVE' değil (mevcut: ${MTL_PROFILE:-tanımsız}). --force ile zorlayabilirsiniz."
        exit 2
    fi
    log "UYARI: MTL_PROFILE 'SLAVE' değil ama --force verildi"
fi

LDAP_BIND_PWD="${MTL_LDAP_BIND_PASSWORD:?MTL_LDAP_BIND_PASSWORD env değişkeni gerekli}"

# 2) Onay (interaktif veya --force)
if [[ "${FORCE}" -eq 0 ]]; then
    cat <<EOF

DİKKAT: Bu işlem geri alınamaz değil ancak aşağıdaki değişiklikleri yapar:
  - slapd read-only modunu kaldırır
  - Slave syncrepl yapılandırmasını siler
  - syncprov (provider) overlay'ini ekler
  - accesslog DB'yi oluşturur (yoksa)
  - mtl-ldap servisini MASTER profili ile yeniden başlatır

Devam etmek için 'EVET PROMOTE' yazıp Enter'a basın:
EOF
    read -r confirm
    if [[ "${confirm}" != "EVET PROMOTE" ]]; then
        err "Onay alınamadı. İptal."
        exit 1
    fi
fi

# 3) slapd çalışıyor mu kontrolü
log "slapd servis durumu kontrol ediliyor..."
if ! systemctl is-active --quiet "${SLAPD_SERVICE}"; then
    err "slapd servisi çalışmıyor. Önce slapd'yi başlatın: systemctl start ${SLAPD_SERVICE}"
    exit 3
fi
ok "slapd çalışıyor"

# 4) Mevcut contextCSN'i yedek olarak kaydet
log "Mevcut contextCSN okunuyor..."
CURRENT_CSN=$(ldapsearch -Q -Y EXTERNAL -H ldapi:/// \
    -b "${LDAP_BASE_DN}" -s base contextCSN 2>/dev/null | grep '^contextCSN:' || echo "")
log "Mevcut contextCSN: ${CURRENT_CSN}"

# 5) slapd config yedeği
BACKUP_DIR="/var/lib/mtl/backups/failover-$(date +%Y%m%d-%H%M%S)"
log "slapd yapılandırması yedekleniyor: ${BACKUP_DIR}"
run mkdir -p "${BACKUP_DIR}"
run cp -a "${LDAP_CONF_DIR}" "${BACKUP_DIR}/slapd.d.backup"

# 6) read-only'i kaldır
log "slapd read-only modu kaldırılıyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///}
dn: olcDatabase={1}mdb,cn=config
changetype: modify
replace: olcReadOnly
olcReadOnly: FALSE
EOF
ok "Read-only kaldırıldı"

# 7) syncrepl consumer config'ini sil
log "syncrepl consumer yapılandırması kaldırılıyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///}
dn: olcDatabase={1}mdb,cn=config
changetype: modify
delete: olcSyncrepl
EOF
log "syncrepl kaldırıldı (yoksa sessizce geçilir)"

cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///} || true
dn: olcDatabase={1}mdb,cn=config
changetype: modify
delete: olcUpdateRef
EOF
ok "olcUpdateRef kaldırıldı (yoksa sessizce geçilir)"

# 8) syncprov modülünü yükle
log "syncprov modülü yükleniyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapadd -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: syncprov.la
EOF
# Modül zaten yüklü ise yukarıdaki başarısız olur — sessizce devam
ok "syncprov modülü hazır"

# 9) accesslog modülünü yükle
log "accesslog modülü yükleniyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: accesslog.la
EOF
ok "accesslog modülü hazır"

# 10) accesslog DB'sini oluştur (yoksa)
if [[ ! -d "${LDAP_ACCESSLOG_DIR}" || -z "$(ls -A "${LDAP_ACCESSLOG_DIR}" 2>/dev/null)" ]]; then
    log "accesslog veri dizini oluşturuluyor: ${LDAP_ACCESSLOG_DIR}"
    run mkdir -p "${LDAP_ACCESSLOG_DIR}"
    run chown openldap:openldap "${LDAP_ACCESSLOG_DIR}"
    
    log "accesslog veritabanı yapılandırılıyor..."
    cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapadd -Y EXTERNAL -H ldapi:///}
dn: olcDatabase={2}mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: {2}mdb
olcDbDirectory: ${LDAP_ACCESSLOG_DIR}
olcSuffix: cn=accesslog
olcRootDN: cn=admin,cn=accesslog
olcAccess: to *
  by dn.exact="cn=replicator,${LDAP_BASE_DN}" read
  by * none
EOF
    ok "accesslog DB oluşturuldu"
else
    log "accesslog dizini zaten mevcut, atlanıyor"
fi

# 11) syncprov overlay'ini ana DB'ye ekle
log "syncprov overlay ekleniyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapadd -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: olcOverlay=syncprov,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcSyncProvConfig
olcOverlay: syncprov
olcSpCheckpoint: 100 10
olcSpSessionLog: 10000
EOF
ok "syncprov overlay hazır"

# 12) accesslog overlay'ini ana DB'ye ekle (delta-syncrepl için)
log "accesslog overlay ekleniyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapadd -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: olcOverlay=accesslog,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcAccessLogConfig
olcOverlay: accesslog
olcAccessLogDB: cn=accesslog
olcAccessLogOps: writes
olcAccessLogSuccess: TRUE
olcAccessLogPurge: 30+00:00 01+00:00
EOF
ok "accesslog overlay hazır"

# 13) slapd'yi yeniden başlat
log "slapd yeniden başlatılıyor..."
run systemctl restart "${SLAPD_SERVICE}"
sleep 3
if ! systemctl is-active --quiet "${SLAPD_SERVICE}"; then
    err "slapd yeniden başlatılamadı. Log dosyalarına bakın: journalctl -u ${SLAPD_SERVICE}"
    exit 3
fi
ok "slapd çalışıyor"

# 14) Doğrulama: yazılabilir mi
log "Yazılabilirlik testi yapılıyor..."
TEST_DN="cn=mtl-failover-test-$(date +%s),${LDAP_BASE_DN}"
TEST_OUTPUT=$(ldapadd -x -D "${LDAP_ADMIN_DN}" -w "${LDAP_BIND_PWD}" 2>&1 <<EOF || true
dn: ${TEST_DN}
objectClass: applicationProcess
cn: mtl-failover-test-$(date +%s)
description: MTL failover yazma testi - silinebilir
EOF
)
if echo "${TEST_OUTPUT}" | grep -qE "(adding new entry|Success)"; then
    ok "Yazma testi başarılı"
    ldapdelete -x -D "${LDAP_ADMIN_DN}" -w "${LDAP_BIND_PWD}" "${TEST_DN}" >/dev/null 2>&1 || true
else
    err "Yazma testi başarısız:"
    echo "${TEST_OUTPUT}"
    if [[ "${FORCE}" -eq 0 ]]; then
        exit 4
    fi
fi

# 15) MTL servisini MASTER profili ile yeniden başlat
log "MTL servisleri MASTER profili ile yeniden başlatılıyor..."
log "Ortam dosyasında profil güncelleniyor: ${MTL_ENV_FILE}"
if [[ "${DRY_RUN}" -eq 0 ]]; then
    sed -i.bak "s/^MTL_PROFILE=.*/MTL_PROFILE=MASTER/" "${MTL_ENV_FILE}"
    
    # MTL_LDAP_URL'i lokal slapd'ye yönlendir
    if grep -q '^MTL_LDAP_URL=' "${MTL_ENV_FILE}"; then
        sed -i "s|^MTL_LDAP_URL=.*|MTL_LDAP_URL=ldaps://127.0.0.1:636|" "${MTL_ENV_FILE}"
    fi
    
    # MTL_MASTER_URL satırı varsa yorum satırına çevir
    sed -i 's/^MTL_MASTER_URL=/#MTL_MASTER_URL=/' "${MTL_ENV_FILE}"
fi
ok "Ortam dosyası güncellendi"

run systemctl restart "${MTL_SERVICE}"
run systemctl restart "${MTL_WORKER_SERVICE}" || log "Worker servisi tanımlı değil, atlanıyor"

sleep 3
if ! systemctl is-active --quiet "${MTL_SERVICE}"; then
    err "${MTL_SERVICE} başlatılamadı. journalctl -u ${MTL_SERVICE}"
    exit 1
fi
ok "MTL servisi çalışıyor"

# 16) Final özet
cat <<EOF

============================================================
  PROMOTE TAMAMLANDI
============================================================

Bu node artık MASTER olarak hizmet vermektedir.

Yapılması gerekenler:
  1. DNS / yük dengeleyici trafiği bu node'a yönlendirsin
  2. Eski master'ı düzelttikten sonra şu komutla geri getirin:
     sudo $(dirname "$0")/mtl-failover-restore-master.sh
  3. Diğer aktif slave node'lar varsa onların syncrepl provider'ı
     bu node'a yönlendirilmelidir
  4. MTL Console'da /replication sayfasından topolojiyi doğrulayın
  5. Yeni master için yedek alın

Log: ${LOG_FILE}

EOF

# Audit kaydı için ortam değişkenine basit bir işaret bırak
echo "MTL_FAILOVER_PROMOTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${MTL_ENV_FILE}"

ok "Failover promote başarıyla tamamlandı"
exit 0
