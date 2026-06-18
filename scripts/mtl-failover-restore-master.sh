#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
#
# ============================================================
# MTL LDAP Admin — Master Restore Script
# ============================================================
# Bu script eski master'ı yeni master'ın (önceden slave olan)
# slave'i olarak geri getirir.
#
# Tetiklenme: Eski master sunucusu fiziksel/sanal olarak tekrar
# ayağa kaldırıldıktan sonra çalıştırılır.
#
# AKIŞ:
#   1. Eski master'ın slapd'sini durdurur
#   2. Mevcut LDAP verisini yedekler
#   3. syncprov / accesslog overlay'lerini kaldırır
#   4. syncrepl consumer config'i ekler (yeni master'a)
#   5. Read-only mod aktive eder
#   6. Mevcut LDAP DB dosyalarını temizler
#   7. slapd'yi başlatır, ilk senkronu bekler
#   8. mtl-ldap servisini SLAVE profili ile yeniden başlatır
#
# Kullanım:
#   sudo /opt/mtl/scripts/mtl-failover-restore-master.sh \
#        --new-master-host mtl-slave-01.mtl.local \
#        [--force] [--dry-run]
#
# Çıkış kodları:
#   0  Başarılı
#   1  Genel hata
#   2  Yapılandırma sorunu
#   3  slapd ile ilgili sorun
#   4  Replikasyon başlatılamadı
# ============================================================

set -euo pipefail

# ----- Varsayilan degerler -----
MTL_ENV_FILE="${MTL_ENV_FILE:-/etc/mtl/mtl-ldap.env}"
LDAP_CONF_DIR="${LDAP_CONF_DIR:-/etc/ldap/slapd.d}"
LDAP_DATA_DIR="${LDAP_DATA_DIR:-/var/lib/ldap}"
LDAP_ACCESSLOG_DIR="${LDAP_ACCESSLOG_DIR:-/var/lib/ldap-accesslog}"
LDAP_BASE_DN="${LDAP_BASE_DN:-dc=mtl,dc=local}"
LDAP_ADMIN_DN="${LDAP_ADMIN_DN:-cn=admin,dc=mtl,dc=local}"
LDAP_CA_PATH="${LDAP_CA_PATH:-/etc/mtl/ssl/mtl-ca.pem}"
SLAPD_SERVICE="${SLAPD_SERVICE:-slapd}"
MTL_SERVICE="${MTL_SERVICE:-mtl-ldap}"
MTL_WORKER_SERVICE="${MTL_WORKER_SERVICE:-mtl-ldap-worker}"
LOG_DIR="${LOG_DIR:-/var/log/mtl}"
LOG_FILE="${LOG_DIR}/failover-restore-$(date +%Y%m%d-%H%M%S).log"

REPLICATOR_DN="${REPLICATOR_DN:-cn=replicator,${LDAP_BASE_DN}}"

FORCE=0
DRY_RUN=0
NEW_MASTER_HOST=""
NEW_MASTER_PORT="636"
REPLICATOR_PWD=""

# ----- Arguman ayristirma -----
while [[ $# -gt 0 ]]; do
    case $1 in
        --new-master-host) NEW_MASTER_HOST="$2"; shift 2 ;;
        --new-master-port) NEW_MASTER_PORT="$2"; shift 2 ;;
        --replicator-password) REPLICATOR_PWD="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help)
            cat <<EOF
Kullanım: $0 --new-master-host <host> [--new-master-port 636]
              [--replicator-password <pwd>] [--force] [--dry-run]

  --new-master-host        Yeni master'ın FQDN'i (zorunlu)
  --new-master-port        LDAPS portu (varsayılan 636)
  --replicator-password    Replikatör hesabı parolası (verilmezse sorulur)
  --force                  Doğrulama hatalarını yoksay
  --dry-run                Komutları gösterir, çalıştırmaz
EOF
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
  MTL LDAP Admin — Master Restore (eski master → slave)
============================================================
BANNER

require_root

if [[ -z "${NEW_MASTER_HOST}" ]]; then
    err "--new-master-host argümanı zorunludur."
    err "Örnek: $0 --new-master-host mtl-slave-01.mtl.local"
    exit 2
fi

log "Yeni master: ${NEW_MASTER_HOST}:${NEW_MASTER_PORT}"
log "Log dosyası: ${LOG_FILE}"

# 1) Ortam dosyasını oku
if [[ ! -f "${MTL_ENV_FILE}" ]]; then
    err "Ortam dosyası bulunamadı: ${MTL_ENV_FILE}"
    exit 2
fi
# shellcheck disable=SC1090
set -a; source "${MTL_ENV_FILE}"; set +a

# 2) Replikatör parolasını al
if [[ -z "${REPLICATOR_PWD}" ]]; then
    read -rsp "Replikatör (${REPLICATOR_DN}) parolası: " REPLICATOR_PWD
    echo
fi
if [[ -z "${REPLICATOR_PWD}" ]]; then
    err "Replikatör parolası verilmedi"
    exit 2
fi

# 3) Yeni master'a erişilebiliyor mu testi
log "Yeni master'a bağlantı testi (LDAPS)..."
if [[ "${DRY_RUN}" -eq 0 ]]; then
    if ! ldapsearch -H "ldaps://${NEW_MASTER_HOST}:${NEW_MASTER_PORT}" \
        -D "${REPLICATOR_DN}" -w "${REPLICATOR_PWD}" \
        -b "${LDAP_BASE_DN}" -s base -o nettimeout=10 \
        objectClass 2>&1 | grep -q "objectClass"; then
        err "Yeni master'a LDAPS bağlantısı başarısız."
        err "Kontrol edin: host erişilebilirliği, sertifika, replikatör parolası"
        if [[ "${FORCE}" -eq 0 ]]; then
            exit 4
        fi
    fi
fi
ok "Yeni master erişilebilir"

# 4) Onay
if [[ "${FORCE}" -eq 0 ]]; then
    cat <<EOF

DİKKAT: Bu işlem AŞAĞIDAKİ DEĞİŞİKLİKLERİ YAPAR — geri alınması zordur:

  - slapd durdurulacak
  - Mevcut LDAP veritabanı yedek alınıp temizlenecek
  - syncprov + accesslog overlay'leri kaldırılacak
  - Yeni bir syncrepl consumer config eklenecek (provider: ${NEW_MASTER_HOST})
  - Slapd read-only mode aktive edilecek
  - mtl-ldap servisi SLAVE profili ile yeniden başlatılacak
  - Yeni master'dan tüm dizin verisi senkronize edilecek

Devam etmek için 'EVET RESTORE' yazıp Enter'a basın:
EOF
    read -r confirm
    if [[ "${confirm}" != "EVET RESTORE" ]]; then
        err "Onay alınamadı. İptal."
        exit 1
    fi
fi

# 5) Yedek
BACKUP_DIR="/var/lib/mtl/backups/restore-$(date +%Y%m%d-%H%M%S)"
log "Yedek dizini: ${BACKUP_DIR}"
run mkdir -p "${BACKUP_DIR}"

log "slapd config yedekleniyor..."
run cp -a "${LDAP_CONF_DIR}" "${BACKUP_DIR}/slapd.d.backup"

log "LDAP veritabanı slapcat ile yedekleniyor..."
if [[ "${DRY_RUN}" -eq 0 ]]; then
    slapcat -b "${LDAP_BASE_DN}" -l "${BACKUP_DIR}/ldap-data.ldif" 2>/dev/null || \
        log "UYARI: slapcat başarısız (slapd çalışmıyor olabilir)"
fi

# 6) MTL servislerini durdur
log "MTL servisleri durduruluyor..."
run systemctl stop "${MTL_SERVICE}" || true
run systemctl stop "${MTL_WORKER_SERVICE}" || true

# 7) slapd'yi durdur
log "slapd durduruluyor..."
run systemctl stop "${SLAPD_SERVICE}"

# 8) Mevcut LDAP verisini temizle (yedek alındı)
log "LDAP verisi temizleniyor: ${LDAP_DATA_DIR}"
if [[ "${DRY_RUN}" -eq 0 ]]; then
    find "${LDAP_DATA_DIR}" -mindepth 1 ! -name 'DB_CONFIG' -delete 2>/dev/null || true
fi

log "Accesslog verisi temizleniyor: ${LDAP_ACCESSLOG_DIR}"
if [[ "${DRY_RUN}" -eq 0 ]]; then
    find "${LDAP_ACCESSLOG_DIR}" -mindepth 1 -delete 2>/dev/null || true
fi

# 9) slapd'yi başlat (boş DB ile)
log "slapd başlatılıyor (boş)..."
run systemctl start "${SLAPD_SERVICE}"
sleep 3
if ! systemctl is-active --quiet "${SLAPD_SERVICE}"; then
    err "slapd başlatılamadı: journalctl -u ${SLAPD_SERVICE}"
    exit 3
fi
ok "slapd çalışıyor"

# 10) syncprov overlay'i kaldır
log "syncprov overlay kaldırılıyor (varsa)..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: olcOverlay={0}syncprov,olcDatabase={1}mdb,cn=config
changetype: delete
EOF

# 11) accesslog overlay'i kaldır
log "accesslog overlay kaldırılıyor (varsa)..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: olcOverlay={1}accesslog,olcDatabase={1}mdb,cn=config
changetype: delete
EOF

# 12) accesslog DB'sini kaldır
log "accesslog veritabanı kaldırılıyor (varsa)..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///} 2>/dev/null || true
dn: olcDatabase={2}mdb,cn=config
changetype: delete
EOF

# 13) syncrepl consumer ekle
log "syncrepl consumer yapılandırılıyor..."
cat <<EOF | ${DRY_RUN:+cat} ${DRY_RUN:-ldapmodify -Y EXTERNAL -H ldapi:///}
dn: olcDatabase={1}mdb,cn=config
changetype: modify
add: olcSyncrepl
olcSyncrepl: rid=001
  provider=ldaps://${NEW_MASTER_HOST}:${NEW_MASTER_PORT}
  type=refreshAndPersist
  retry="60 +"
  searchbase="${LDAP_BASE_DN}"
  scope=sub
  schemachecking=on
  bindmethod=simple
  binddn="${REPLICATOR_DN}"
  credentials=${REPLICATOR_PWD}
  tls_reqcert=demand
  tls_cacert=${LDAP_CA_PATH}
  logbase="cn=accesslog"
  logfilter="(&(objectClass=auditWriteObject)(reqResult=0))"
  syncdata=accesslog
-
add: olcUpdateRef
olcUpdateRef: ldaps://${NEW_MASTER_HOST}:${NEW_MASTER_PORT}
-
replace: olcReadOnly
olcReadOnly: TRUE
EOF
ok "syncrepl consumer config eklendi"

# 14) slapd yeniden başlat
log "slapd yeniden başlatılıyor..."
run systemctl restart "${SLAPD_SERVICE}"
sleep 5
if ! systemctl is-active --quiet "${SLAPD_SERVICE}"; then
    err "slapd yeniden başlatılamadı"
    exit 3
fi
ok "slapd çalışıyor"

# 15) İlk senkronu bekle (en fazla 5 dakika)
log "İlk senkron tamamlanması bekleniyor (en fazla 300 sn)..."
SYNC_OK=0
if [[ "${DRY_RUN}" -eq 0 ]]; then
    for i in $(seq 1 60); do
        ENTRIES=$(ldapsearch -x -H "ldaps://127.0.0.1:636" \
            -D "${LDAP_ADMIN_DN}" -w "${MTL_LDAP_BIND_PASSWORD:-}" \
            -b "${LDAP_BASE_DN}" -s sub objectClass 2>/dev/null | grep -c "^dn:" || echo "0")
        if [[ "${ENTRIES}" -gt 0 ]]; then
            log "Senkron tamamlandı, ${ENTRIES} entry mevcut"
            SYNC_OK=1
            break
        fi
        log "Bekleniyor... (${i}/60)"
        sleep 5
    done

    if [[ "${SYNC_OK}" -eq 0 ]]; then
        err "İlk senkron 5 dakika içinde tamamlanmadı"
        err "Manuel kontrol gerekli: journalctl -u ${SLAPD_SERVICE}"
        if [[ "${FORCE}" -eq 0 ]]; then
            exit 4
        fi
    fi
fi

# 16) MTL ortam dosyasını SLAVE profiline çevir
log "MTL ortam dosyası SLAVE profili için güncelleniyor..."
if [[ "${DRY_RUN}" -eq 0 ]]; then
    sed -i.bak "s/^MTL_PROFILE=.*/MTL_PROFILE=SLAVE/" "${MTL_ENV_FILE}"
    
    # MTL_LDAP_URL'i yeni master'a yönlendir (yazma için)
    if grep -q '^MTL_LDAP_URL=' "${MTL_ENV_FILE}"; then
        sed -i "s|^MTL_LDAP_URL=.*|MTL_LDAP_URL=ldaps://${NEW_MASTER_HOST}:${NEW_MASTER_PORT}|" "${MTL_ENV_FILE}"
    fi
    
    # MTL_MASTER_URL ekle veya güncelle
    if grep -q '^#\?MTL_MASTER_URL=' "${MTL_ENV_FILE}"; then
        sed -i "s|^#\?MTL_MASTER_URL=.*|MTL_MASTER_URL=https://${NEW_MASTER_HOST}|" "${MTL_ENV_FILE}"
    else
        echo "MTL_MASTER_URL=https://${NEW_MASTER_HOST}" >> "${MTL_ENV_FILE}"
    fi
    
    # Failover işareti ekle
    if ! grep -q '^MTL_FAILOVER_RESTORED_AT=' "${MTL_ENV_FILE}"; then
        echo "MTL_FAILOVER_RESTORED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${MTL_ENV_FILE}"
    else
        sed -i "s|^MTL_FAILOVER_RESTORED_AT=.*|MTL_FAILOVER_RESTORED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)|" "${MTL_ENV_FILE}"
    fi
fi
ok "Ortam dosyası güncellendi"

# 17) MTL servislerini başlat
log "MTL servisleri başlatılıyor..."
run systemctl start "${MTL_SERVICE}"
run systemctl start "${MTL_WORKER_SERVICE}" || log "Worker servisi tanımlı değil"

sleep 3
if ! systemctl is-active --quiet "${MTL_SERVICE}"; then
    err "${MTL_SERVICE} başlatılamadı: journalctl -u ${MTL_SERVICE}"
    exit 1
fi
ok "MTL servisi çalışıyor"

# 18) Final özet
cat <<EOF

============================================================
  RESTORE TAMAMLANDI
============================================================

Bu node artık SLAVE olarak çalışmaktadır.
Yeni master: ${NEW_MASTER_HOST}:${NEW_MASTER_PORT}

Doğrulamalar:
  - Replikasyon: ldapsearch ile contextCSN karşılaştırın
  - Servis: systemctl status ${MTL_SERVICE}
  - MTL Console'da /replication sayfasında topolojiyi görün

Opsiyonel — rolleri tekrar değiştirmek (bu node'u tekrar master yapmak):
  Bu işlem genelde gerekli değildir. Mevcut master master olarak kalsın.
  Eğer istenirse iki adım:
    1. Mevcut master'da: mtl-failover-promote-slave.sh ÇALIŞTIRILMAZ
       çünkü o zaten master.
    2. Bu node'da promote-slave çalıştırılır ve mevcut master'a
       restore çalıştırılır.

Log: ${LOG_FILE}

EOF

ok "Failover restore başarıyla tamamlandı"
exit 0
