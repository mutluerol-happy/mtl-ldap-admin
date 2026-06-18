#!/usr/bin/env bash
# ============================================================================
# MTL LDAP Admin — Slave (Consumer) Sunucu Kurulum Script'i (Rocky Linux 9)
# ============================================================================
# Slave sunucusunda parola-reset portali + read-only LDAP consumer kurar:
#   - Sistem hazırlığı (hostname, /etc/hosts, firewall)
#   - SELinux yapılandırması
#   - mtl kullanıcısı + dizinler (TLS dizin-geçiş izni dahil)
#   - PostgreSQL 16 (mtl_slave kullanıcısı, kendi lokal DB'si) + MTL şeması
#   - Redis 7 (lokal)
#   - OpenLDAP 2.6 CONSUMER (MTL şeması ÖNCEDEN, olcSyncrepl refreshAndPersist,
#     olcReadOnly + olcUpdateRef) — master'dan replikasyon
#   - TLS: master'ın ürettiği CA + slave sertifikası
#   - Nginx + placeholder frontend (gerçek SLAVE-profil build sonra deploy edilir)
#   - MTL env (/etc/mtl/mtl-ldap.env, MTL_PROFILE=SLAVE) + systemd unit'leri
#
# ÖNŞART: master kurulu ve ayakta olmalı. Master'dan slave'e taşınması gerekenler:
#   - /etc/mtl/ssl/mtl-ca.pem        (CA)
#   - /etc/mtl/ssl/slave-server.pem  (slave sertifikası)
#   - /etc/mtl/ssl/slave-server.key  (slave özel anahtarı)
#   - REPLICATOR_PASSWORD + CLUSTER_SECRET + FERNET_KEY (master mtl-secrets.txt'ten)
#   - master cn=admin parolası (slave yazımları master'a gider)
#
# Çalıştırma:
#   bash mtl-slave-install.sh
#   bash mtl-slave-install.sh --config /etc/mtl-slave-install.conf
#
# Idempotent: Tekrar çalıştırılabilir. olcSyncrepl ASLA sessizce silinmez
# (kurulum öncesi yedeklenir, sonra doğrulanır).
# ============================================================================

set -euo pipefail

SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="mtl-slave-install"
LOG_FILE="/var/log/mtl-slave-install.log"
CONFIG_FILE=""

COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_CYAN='\033[0;36m'
COLOR_BOLD='\033[1m'
COLOR_RESET='\033[0m'

# ============================================================================
# Yardımcı Fonksiyonlar (master ile aynı)
# ============================================================================

log() {
    local level="$1"; shift
    local msg="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    case "$level" in
        INFO)  printf "${COLOR_CYAN}[%s] [BILGI]${COLOR_RESET} %s\n" "$timestamp" "$msg" ;;
        OK)    printf "${COLOR_GREEN}[%s] [TAMAM]${COLOR_RESET} %s\n" "$timestamp" "$msg" ;;
        WARN)  printf "${COLOR_YELLOW}[%s] [UYARI]${COLOR_RESET} %s\n" "$timestamp" "$msg" ;;
        ERROR) printf "${COLOR_RED}[%s] [HATA] ${COLOR_RESET} %s\n" "$timestamp" "$msg" >&2 ;;
        SKIP)  printf "${COLOR_BLUE}[%s] [ATLA] ${COLOR_RESET} %s\n" "$timestamp" "$msg" ;;
        STEP)  printf "\n${COLOR_BOLD}${COLOR_CYAN}━━━ %s ━━━${COLOR_RESET}\n" "$msg" ;;
        *)     printf "[%s] %s\n" "$timestamp" "$msg" ;;
    esac
    echo "[$timestamp] [$level] $msg" >> "$LOG_FILE" 2>/dev/null || true
}

die() {
    log ERROR "$*"
    log ERROR "Kurulum başarısız. Detaylar için: $LOG_FILE"
    exit 1
}

ask() {
    local prompt="$1"; local var_name="$2"; local is_secret="${3:-no}"; local default="${4:-}"
    local value=""
    while [[ -z "$value" ]]; do
        if [[ -n "$default" ]]; then
            printf "${COLOR_BOLD}%s${COLOR_RESET} [varsayılan: %s]: " "$prompt" "$default"
        else
            printf "${COLOR_BOLD}%s${COLOR_RESET}: " "$prompt"
        fi
        if [[ "$is_secret" == "yes" ]]; then read -rs value; echo; else read -r value; fi
        if [[ -z "$value" && -n "$default" ]]; then value="$default"; fi
        if [[ -z "$value" ]]; then log WARN "Boş değer kabul edilmez, tekrar girin."; fi
    done
    eval "$var_name='$value'"
}

confirm() {
    local prompt="$1"; local answer=""
    while true; do
        printf "${COLOR_YELLOW}%s${COLOR_RESET} [E/h]: " "$prompt"
        read -r answer
        case "$answer" in
            E|e|Evet|evet|EVET|"") return 0 ;;
            H|h|Hayir|hayir|HAYIR) return 1 ;;
            *) echo "Lütfen E veya h yazın." ;;
        esac
    done
}

require_root() { [[ $EUID -eq 0 ]] || die "Bu script root olarak çalıştırılmalıdır."; }

require_rocky9() {
    [[ -f /etc/os-release ]] || die "İşletim sistemi tespit edilemedi (/etc/os-release yok)."
    # shellcheck disable=SC1091
    source /etc/os-release
    if [[ "${ID,,}" != "rocky" ]] || [[ ! "${VERSION_ID}" =~ ^9 ]]; then
        log WARN "Bu script Rocky Linux 9 için tasarlandı. Tespit edilen: $PRETTY_NAME"
        confirm "Yine de devam edilsin mi?" || die "Kurulum iptal edildi."
    fi
}

# ============================================================================
# Argüman Ayrıştırma
# ============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --config|-c) CONFIG_FILE="$2"; shift 2 ;;
            --help|-h)
                cat <<EOF
MTL LDAP Admin — Slave (Consumer) Kurulum Script'i v${SCRIPT_VERSION}

Kullanım:
  $0 [SEÇENEKLER]

Seçenekler:
  -c, --config DOSYA    Yapılandırma dosyası kullan (etkileşim olmadan)
  -h, --help            Bu yardım metnini göster
  -v, --version         Script sürümünü göster

Örnek:
  $0 --config /etc/mtl-slave-install.conf
EOF
                exit 0 ;;
            --version|-v) echo "${SCRIPT_NAME} v${SCRIPT_VERSION}"; exit 0 ;;
            *) die "Bilinmeyen argüman: $1 (yardım için --help)" ;;
        esac
    done
}

# ============================================================================
# Yapılandırma Toplama
# ============================================================================

collect_config() {
    log STEP "ADIM 1/16: Yapılandırma Toplama"

    if [[ -n "$CONFIG_FILE" ]]; then
        [[ -f "$CONFIG_FILE" ]] || die "Yapılandırma dosyası bulunamadı: $CONFIG_FILE"
        log INFO "Yapılandırma dosyası yükleniyor: $CONFIG_FILE"
        # shellcheck disable=SC1090
        source "$CONFIG_FILE"
        log OK "Yapılandırma yüklendi."
    else
        log INFO "İnteraktif yapılandırma."
        echo
        local detected_ip
        detected_ip=$(ip -4 addr show 2>/dev/null | grep -E "inet [0-9]" | grep -v "127.0.0.1" | head -1 | awk '{print $2}' | cut -d/ -f1)

        echo "—— Sunucu Bilgileri ——"
        ask "Master IP adresi" MASTER_IP
        ask "Slave IP adresi" SLAVE_IP no "$detected_ip"
        ask "Master hostname (FQDN)" MASTER_HOSTNAME no "mtl-master-01.mtl.local"
        ask "Slave hostname (FQDN)" SLAVE_HOSTNAME no "mtl-slave-01.mtl.local"

        echo
        echo "—— LDAP Yapılandırması ——"
        ask "LDAP base DN" LDAP_BASE_DN no "dc=mtl,dc=local"
        ask "LDAP organization (o=)" LDAP_ORGANIZATION no "MTL"
        ask "Slave LOKAL LDAP admin parolası (cn=admin,${LDAP_BASE_DN} lokal rootpw)" SLAVE_LDAP_ADMIN_PASSWORD yes
        ask "Slave cn=config admin parolası" LDAP_CONFIG_PASSWORD yes
        ask "MASTER cn=admin parolası (slave yazımları master'a gider)" MASTER_LDAP_ADMIN_PASSWORD yes
        ask "Replicator parolası (master ile AYNI)" REPLICATOR_PASSWORD yes

        echo
        echo "—— Veritabanı Parolaları ——"
        ask "PostgreSQL mtl_slave parolası" SLAVE_PG_PASSWORD yes
        ask "Redis parolası" SLAVE_REDIS_PASSWORD yes

        echo
        echo "—— Cluster / Şifreleme (master ile AYNI olmalı) ——"
        ask "CLUSTER_SECRET (master mtl-secrets.txt'ten)" CLUSTER_SECRET yes
        ask "FERNET_KEY (master mtl-secrets.txt'ten; MFA sırlarının çözülmesi için master ile aynı olmalı)" FERNET_KEY yes

        echo
        echo "—— Kaynak ve Sertifikalar ——"
        ask "MTL kaynak dizini" MTL_SOURCE_DIR no "/opt/mtl-source/mtl-ldap-admin"
        ask "Master'dan kopyalanan CA dosyası" MTL_CA_SRC no "/opt/mtl-source/certs/mtl-ca.pem"
        ask "Master'dan kopyalanan slave sertifikası" SLAVE_CERT_SRC no "/opt/mtl-source/certs/slave-server.pem"
        ask "Master'dan kopyalanan slave anahtarı" SLAVE_KEY_SRC no "/opt/mtl-source/certs/slave-server.key"
    fi

    # Üretilen / varsayılan
    SECRET_KEY="${SECRET_KEY:-$(openssl rand -hex 32)}"
    MTL_CA_SRC="${MTL_CA_SRC:-/opt/mtl-source/certs/mtl-ca.pem}"
    SLAVE_CERT_SRC="${SLAVE_CERT_SRC:-/opt/mtl-source/certs/slave-server.pem}"
    SLAVE_KEY_SRC="${SLAVE_KEY_SRC:-/opt/mtl-source/certs/slave-server.key}"

    # Doğrulama
    [[ -z "${MASTER_IP:-}" ]]        && die "MASTER_IP boş olamaz."
    [[ -z "${SLAVE_IP:-}" ]]         && die "SLAVE_IP boş olamaz."
    [[ -z "${MASTER_HOSTNAME:-}" ]]  && die "MASTER_HOSTNAME boş olamaz."
    [[ -z "${SLAVE_HOSTNAME:-}" ]]   && die "SLAVE_HOSTNAME boş olamaz."
    [[ -z "${REPLICATOR_PASSWORD:-}" ]] && die "REPLICATOR_PASSWORD boş olamaz (master ile aynı)."
    [[ -z "${CLUSTER_SECRET:-}" ]]   && die "CLUSTER_SECRET boş olamaz (master ile aynı)."
    [[ -z "${FERNET_KEY:-}" ]]       && die "FERNET_KEY boş olamaz (master ile aynı)."
    [[ -z "${MASTER_LDAP_ADMIN_PASSWORD:-}" ]] && die "MASTER_LDAP_ADMIN_PASSWORD boş olamaz."
    [[ ! -d "${MTL_SOURCE_DIR:-/yok}" ]] && die "MTL_SOURCE_DIR bulunamadı: $MTL_SOURCE_DIR"
    [[ ! -f "${MTL_SOURCE_DIR}/schema/mtl_ldap_admin_schema.sql" ]] && \
        die "PostgreSQL şema dosyası yok: ${MTL_SOURCE_DIR}/schema/mtl_ldap_admin_schema.sql"
    [[ ! -f "${MTL_SOURCE_DIR}/schema/mtl-openldap-schema.ldif" ]] && \
        die "MTL LDAP şema dosyası yok: ${MTL_SOURCE_DIR}/schema/mtl-openldap-schema.ldif"
    [[ ! -f "$MTL_CA_SRC" ]]      && die "CA dosyası bulunamadı: $MTL_CA_SRC (master'dan kopyalayın)."
    [[ ! -f "$SLAVE_CERT_SRC" ]] && die "Slave sertifikası bulunamadı: $SLAVE_CERT_SRC (master'dan kopyalayın)."
    [[ ! -f "$SLAVE_KEY_SRC" ]]  && die "Slave anahtarı bulunamadı: $SLAVE_KEY_SRC (master'dan kopyalayın)."

    echo
    log INFO "Toplanan yapılandırma özeti:"
    cat <<EOF

  Master Sunucu     : ${MASTER_HOSTNAME} (${MASTER_IP})
  Slave Sunucu      : ${SLAVE_HOSTNAME} (${SLAVE_IP})
  LDAP Base DN      : ${LDAP_BASE_DN}
  Profil            : SLAVE (parola-reset portali, read-only consumer)
  Kaynak Dizini     : ${MTL_SOURCE_DIR}
  CA / Sertifika    : ${MTL_CA_SRC} / ${SLAVE_CERT_SRC}

  Parolalar gizli — /root/mtl-slave-secrets.txt'e yazılacak.
EOF
    echo
    if [[ -z "$CONFIG_FILE" ]]; then
        confirm "Bu yapılandırmayla kuruluma başlayalım mı?" || die "Kullanıcı iptal etti."
    fi
}

# ============================================================================
# Kurulum Adımları
# ============================================================================

step_system_prep() {
    log STEP "ADIM 2/16: Sistem Hazırlığı"

    log INFO "Sistem güncellemeleri kontrol ediliyor..."
    dnf -y update --refresh >> "$LOG_FILE" 2>&1 || log WARN "Sistem güncellemesi atlandı"

    log INFO "Temel paketler kuruluyor..."
    dnf install -y epel-release >> "$LOG_FILE" 2>&1
    dnf install -y vim curl wget git tar jq policycoreutils-python-utils \
                   firewalld chrony bind-utils nano \
                   openssl-devel cyrus-sasl-devel python3 \
                   >> "$LOG_FILE" 2>&1
    log OK "Temel paketler kuruldu."

    systemctl enable --now chronyd >> "$LOG_FILE" 2>&1
    log OK "chronyd aktif."

    local current_hostname
    current_hostname=$(hostname -f 2>/dev/null || hostname)
    if [[ "$current_hostname" != "$SLAVE_HOSTNAME" ]]; then
        log INFO "Hostname ayarlanıyor: $SLAVE_HOSTNAME"
        hostnamectl set-hostname "$SLAVE_HOSTNAME"
    else
        log SKIP "Hostname zaten doğru: $SLAVE_HOSTNAME"
    fi

    if ! grep -q "$SLAVE_HOSTNAME" /etc/hosts; then
        log INFO "/etc/hosts kayıtları ekleniyor..."
        cat >> /etc/hosts <<EOF
${MASTER_IP}  ${MASTER_HOSTNAME} ${MASTER_HOSTNAME%%.*}
${SLAVE_IP}   ${SLAVE_HOSTNAME}  ${SLAVE_HOSTNAME%%.*}
EOF
        log OK "/etc/hosts güncellendi."
    else
        log SKIP "/etc/hosts kayıtları zaten mevcut."
    fi
}

step_firewall() {
    log STEP "ADIM 3/16: Firewall Yapılandırması"
    systemctl enable --now firewalld >> "$LOG_FILE" 2>&1
    for service in https http ssh; do
        firewall-cmd --permanent --add-service="$service" >> "$LOG_FILE" 2>&1 || true
    done
    for port in 389/tcp 636/tcp; do
        firewall-cmd --permanent --add-port="$port" >> "$LOG_FILE" 2>&1 || true
    done
    firewall-cmd --reload >> "$LOG_FILE" 2>&1
    log OK "Firewall: 80, 443, 389, 636, 22 açık."
}

step_selinux_permissive() {
    log STEP "ADIM 4/16: SELinux Geçici Permissive"
    if [[ "$(getenforce)" == "Enforcing" ]]; then
        setenforce 0
        log OK "SELinux geçici permissive."
    else
        log SKIP "SELinux zaten permissive: $(getenforce)"
    fi
    sed -i 's/^SELINUX=enforcing/SELINUX=permissive/' /etc/selinux/config
}

step_mtl_base() {
    log STEP "ADIM 5/16: MTL Kullanıcısı ve Dizinler"
    if ! id mtl &>/dev/null; then
        useradd --system --shell /bin/false --home /opt/mtl --create-home mtl
        log OK "mtl sistem kullanıcısı oluşturuldu."
    else
        log SKIP "mtl kullanıcısı zaten mevcut."
    fi
    mkdir -p /etc/mtl /etc/mtl/ssl /opt/mtl /var/lib/mtl/backups /var/log/mtl /opt/mtl/scripts /opt/mtl/web/public
    chown -R mtl:mtl /etc/mtl /opt/mtl /var/lib/mtl /var/log/mtl
    # /etc/mtl 0750: sahibi+grubu girebilir (slapd 'ldap' grubu üzerinden); env yine 0640.
    chmod 0750 /etc/mtl /etc/mtl/ssl
    chmod 0750 /var/lib/mtl/backups
    log OK "Dizinler hazır."
}

step_postgresql() {
    log STEP "ADIM 6/16: PostgreSQL 16 (slave lokal DB)"

    if rpm -q postgresql16-server >/dev/null 2>&1; then
        log SKIP "PostgreSQL 16 zaten kurulu."
    else
        dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm >> "$LOG_FILE" 2>&1
        dnf -qy module disable postgresql >> "$LOG_FILE" 2>&1 || true
        dnf install -y postgresql16-server postgresql16-contrib >> "$LOG_FILE" 2>&1
        log OK "PostgreSQL paketleri kuruldu."
    fi

    if [[ ! -f /var/lib/pgsql/16/data/postgresql.conf ]]; then
        /usr/pgsql-16/bin/postgresql-16-setup initdb >> "$LOG_FILE" 2>&1
        log OK "PostgreSQL initdb tamamlandı."
    else
        log SKIP "PostgreSQL zaten başlatılmış."
    fi

    systemctl enable --now postgresql-16 >> "$LOG_FILE" 2>&1
    log OK "postgresql-16 aktif."

    local user_exists
    user_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_user WHERE usename='mtl_slave'" 2>/dev/null || echo "")
    if [[ -z "$user_exists" ]]; then
        log INFO "mtl_slave kullanıcısı ve mtl_admin veritabanı oluşturuluyor..."
        sudo -u postgres psql >> "$LOG_FILE" 2>&1 <<EOF
CREATE USER mtl_slave WITH PASSWORD '${SLAVE_PG_PASSWORD}';
CREATE DATABASE mtl_admin OWNER mtl_slave;
EOF
        log OK "mtl_slave + mtl_admin DB oluşturuldu."
    else
        log SKIP "mtl_slave zaten var. Parola güncelleniyor..."
        sudo -u postgres psql -c "ALTER USER mtl_slave WITH PASSWORD '${SLAVE_PG_PASSWORD}';" >> "$LOG_FILE" 2>&1
    fi

    local pghba=/var/lib/pgsql/16/data/pg_hba.conf
    if ! grep -q "mtl_slave" "$pghba"; then
        cp "$pghba" "${pghba}.orig"
        sed -i "/^# IPv4 local connections:/i \\
host    mtl_admin       mtl_slave       127.0.0.1\\/32           scram-sha-256" "$pghba"
        systemctl restart postgresql-16
        log OK "pg_hba.conf güncellendi."
    else
        log SKIP "pg_hba.conf zaten yapılandırılmış."
    fi

    if PGPASSWORD="$SLAVE_PG_PASSWORD" psql -h 127.0.0.1 -U mtl_slave -d mtl_admin -c '\q' >/dev/null 2>&1; then
        log OK "PostgreSQL bağlantı testi başarılı."
    else
        die "PostgreSQL bağlantı testi başarısız."
    fi

    local schema_count
    schema_count=$(PGPASSWORD="$SLAVE_PG_PASSWORD" psql -h 127.0.0.1 -U mtl_slave -d mtl_admin -tAc \
        "SELECT count(*) FROM information_schema.schemata WHERE schema_name IN ('mtl_core','mtl_audit','mtl_signal')" 2>/dev/null || echo "0")
    if [[ "$schema_count" != "3" ]]; then
        log INFO "MTL şeması yükleniyor (slave lokal DB)..."
        PGPASSWORD="$SLAVE_PG_PASSWORD" psql -h 127.0.0.1 -U mtl_slave -d mtl_admin \
            -f "${MTL_SOURCE_DIR}/schema/mtl_ldap_admin_schema.sql" >> "$LOG_FILE" 2>&1
        log OK "MTL şeması yüklendi."
    else
        log SKIP "MTL şemaları zaten yüklü."
    fi
    log OK "PostgreSQL hazır."
}

step_redis() {
    log STEP "ADIM 7/16: Redis 7 (lokal)"
    if rpm -q redis >/dev/null 2>&1; then
        log SKIP "Redis zaten kurulu."
    else
        dnf module install -y redis:7 >> "$LOG_FILE" 2>&1
        log OK "Redis kuruldu."
    fi
    systemctl enable redis >> "$LOG_FILE" 2>&1

    if ! grep -q "^requirepass ${SLAVE_REDIS_PASSWORD}$" /etc/redis/redis.conf; then
        sed -i "s/^# requirepass .*/requirepass ${SLAVE_REDIS_PASSWORD}/" /etc/redis/redis.conf
        sed -i "s/^requirepass .*/requirepass ${SLAVE_REDIS_PASSWORD}/" /etc/redis/redis.conf
        sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
        sed -i 's/^protected-mode .*/protected-mode yes/' /etc/redis/redis.conf
        systemctl restart redis
        log OK "Redis yapılandırıldı."
    else
        log SKIP "Redis zaten yapılandırılmış."
        systemctl is-active redis >/dev/null || systemctl start redis
    fi
    if redis-cli -a "$SLAVE_REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
        log OK "Redis PING başarılı."
    else
        die "Redis PING başarısız."
    fi
}

step_openldap_install() {
    log STEP "ADIM 8/16: OpenLDAP 2.6 Kurulumu"
    if rpm -q openldap-servers >/dev/null 2>&1; then
        log SKIP "OpenLDAP servers zaten kurulu."
    else
        dnf config-manager --set-enabled plus >> "$LOG_FILE" 2>&1
        dnf install -y openldap openldap-servers openldap-clients >> "$LOG_FILE" 2>&1
        log OK "OpenLDAP kuruldu: $(slapd -VV 2>&1 | head -1)"
    fi
}

step_tls_setup() {
    log STEP "ADIM 9/16: TLS (master CA + slave sertifikası)"

    cp -f "$MTL_CA_SRC"      /etc/mtl/ssl/mtl-ca.pem
    cp -f "$SLAVE_CERT_SRC"  /etc/mtl/ssl/server.pem
    cp -f "$SLAVE_KEY_SRC"   /etc/mtl/ssl/server.key
    log OK "Sertifikalar /etc/mtl/ssl/ altına yerleştirildi."

    # --- TLS dizin-geçiş düzeltmesi (1 Haziran sahadaki tuzak) ---
    # slapd 'ldap' kullanıcısı olarak çalışır; /etc/mtl 0750 mtl:mtl olduğundan
    # 'ldap'i mtl grubuna ekleyip SSL'e grup-okuma/geçiş veriyoruz. Aksi halde
    # her slapd restart'ında TLS "Permission denied" alınır.
    if id ldap &>/dev/null; then
        usermod -aG mtl ldap 2>/dev/null || true
        log OK "ldap kullanıcısı mtl grubuna eklendi (TLS dizin-geçiş izni)."
    fi
    chown -R mtl:mtl /etc/mtl/ssl
    chmod 0750 /etc/mtl/ssl
    chmod 0644 /etc/mtl/ssl/*.pem 2>/dev/null || true
    chmod 0640 /etc/mtl/ssl/*.key 2>/dev/null || true

    if [[ ! -f /etc/pki/ca-trust/source/anchors/mtl-ca.pem ]]; then
        cp /etc/mtl/ssl/mtl-ca.pem /etc/pki/ca-trust/source/anchors/mtl-ca.pem
        update-ca-trust extract
        log OK "MTL CA sistem güvenine eklendi."
    else
        log SKIP "MTL CA zaten sistem güvenine ekli."
    fi
}

step_ldaps_listener() {
    log STEP "ADIM 10/16: slapd LDAPS Dinleyicisi (636)"
    # slapd'nin ldaps://:636 dinlemesini garantiye al (Rocky varsayılanına güvenme).
    local target="ldapi:/// ldap:/// ldaps:///"
    local envfile=""
    if [[ -f /etc/openldap/slapd.env ]]; then
        envfile=/etc/openldap/slapd.env
    elif [[ -f /etc/sysconfig/slapd ]]; then
        envfile=/etc/sysconfig/slapd
    fi

    if [[ -n "$envfile" ]]; then
        if grep -q 'ldaps:///' "$envfile" 2>/dev/null; then
            log SKIP "LDAPS dinleyicisi zaten ayarlı ($envfile)."
        else
            cp "$envfile" "${envfile}.orig.$(date +%s)" 2>/dev/null || true
            if grep -q '^SLAPD_URLS=' "$envfile"; then
                sed -i "s|^SLAPD_URLS=.*|SLAPD_URLS=\"${target}\"|" "$envfile"
            else
                echo "SLAPD_URLS=\"${target}\"" >> "$envfile"
            fi
            log OK "LDAPS dinleyicisi $envfile içine yazıldı."
        fi
    else
        # EnvironmentFile yoksa systemd drop-in ile ayarla
        mkdir -p /etc/systemd/system/slapd.service.d
        cat > /etc/systemd/system/slapd.service.d/10-ldaps.conf <<EOF
[Service]
Environment=SLAPD_URLS="${target}"
EOF
        systemctl daemon-reload
        log OK "LDAPS dinleyicisi systemd drop-in ile ayarlandı."
        log WARN "slapd unit'i \${SLAPD_URLS} kullanmıyorsa bu etkisiz olabilir — özet adımında 636 testi kontrol edilecek."
    fi
}

step_openldap_config() {
    log STEP "ADIM 11/16: OpenLDAP CONSUMER Yapılandırması"

    # --- olcSyncrepl SİLİNME KORUMASI ---
    # Mevcut config varsa, herhangi bir yıkıcı işlemden ÖNCE tam yedek al.
    if [[ -d /etc/openldap/slapd.d/cn=config ]]; then
        local backup
        backup="/var/lib/mtl/backups/slapd-config-$(date +%Y%m%d-%H%M%S).ldif"
        if slapcat -F /etc/openldap/slapd.d/ -b cn=config > "$backup" 2>/dev/null; then
            chmod 600 "$backup"
            log OK "Mevcut cn=config yedeklendi: $backup"
            if grep -q "olcSyncrepl" "$backup"; then
                log INFO "Yedekte olcSyncrepl mevcut (gerekirse buradan geri yüklenebilir)."
            fi
        fi
    fi

    # Zaten bizim suffix + syncrepl ile yapılandırılmışsa: KORU, yeniden kurma (idempotent guard).
    if [[ -d /etc/openldap/slapd.d/cn=config ]] && \
       slapcat -F /etc/openldap/slapd.d/ -b cn=config 2>/dev/null | grep -q "olcSuffix: ${LDAP_BASE_DN}"; then
        if slapcat -F /etc/openldap/slapd.d/ -b cn=config 2>/dev/null | grep -q "olcSyncrepl"; then
            log SKIP "Consumer zaten yapılandırılmış ve olcSyncrepl mevcut — KORUNUYOR (yeniden kurulmuyor)."
            systemctl is-active slapd >/dev/null 2>&1 || { systemctl enable --now slapd >> "$LOG_FILE" 2>&1; sleep 2; }
            return 0
        else
            log WARN "Config mevcut ama olcSyncrepl YOK — base korunuyor; syncrepl adımında eklenecek."
            systemctl is-active slapd >/dev/null 2>&1 || { systemctl enable --now slapd >> "$LOG_FILE" 2>&1; sleep 2; }
            return 0
        fi
    fi

    log INFO "Hash'ler üretiliyor..."
    local admin_hash config_hash
    admin_hash=$(slappasswd -h '{SSHA}' -s "$SLAVE_LDAP_ADMIN_PASSWORD")
    config_hash=$(slappasswd -h '{SSHA}' -s "$LDAP_CONFIG_PASSWORD")

    log INFO "slapd durduruluyor (varsa) ve temiz config kuruluyor..."
    systemctl stop slapd 2>/dev/null || true
    rm -rf /etc/openldap/slapd.d/*
    rm -rf /var/lib/ldap/*
    mkdir -p /var/lib/ldap
    chown -R ldap:ldap /etc/openldap/slapd.d /var/lib/ldap

    cat > /tmp/slapd-init.ldif <<EOF
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
olcModuleLoad: syncprov.la
olcModuleLoad: accesslog.la
olcModuleLoad: ppolicy.la

dn: olcDatabase=config,cn=config
objectClass: olcDatabaseConfig
olcDatabase: config
olcRootDN: cn=admin,cn=config
olcRootPW: ${config_hash}
olcAccess: to * by dn.exact="cn=admin,cn=config" manage by * none

dn: olcDatabase=mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: mdb
olcDbDirectory: /var/lib/ldap
olcSuffix: ${LDAP_BASE_DN}
olcRootDN: cn=admin,${LDAP_BASE_DN}
olcRootPW: ${admin_hash}
olcDbMaxSize: 1073741824
olcDbIndex: objectClass eq
olcDbIndex: cn,uid,mail eq,sub
olcDbIndex: entryCSN,entryUUID eq
olcAccess: to attrs=userPassword by self write by anonymous auth by * none
olcAccess: to * by self write by users read by anonymous auth
EOF

    slapadd -F /etc/openldap/slapd.d/ -n 0 -l /tmp/slapd-init.ldif >> "$LOG_FILE" 2>&1
    chown -R ldap:ldap /etc/openldap/slapd.d/

    if ! slaptest -u -F /etc/openldap/slapd.d/ >> "$LOG_FILE" 2>&1; then
        die "slapd config doğrulaması başarısız. Log: $LOG_FILE"
    fi

    systemctl enable --now slapd >> "$LOG_FILE" 2>&1
    sleep 2
    systemctl is-active slapd >/dev/null || die "slapd başlatılamadı (TLS/sertifika izinlerini kontrol edin)."
    log OK "slapd çalışıyor (consumer base hazır, syncrepl henüz yok)."
    rm -f /tmp/slapd-init.ldif
}

step_openldap_schema() {
    log STEP "ADIM 12/16: MTL Şeması (syncrepl ÖNCESİ — schemachecking=on)"
    # syncrepl şema TAŞIMAZ; mtl* attribute'leri replike olan entry'lerde
    # schemacheck'ten geçsin diye şema slave'e ÖNCEDEN yüklenmeli.
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "cn=schema,cn=config" "(cn=*mtl-schema*)" cn 2>/dev/null | grep -q "mtl-schema"; then
        log SKIP "MTL şeması zaten yüklü."
    else
        log INFO "MTL özel şeması yükleniyor..."
        ldapadd -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                -f "${MTL_SOURCE_DIR}/schema/mtl-openldap-schema.ldif" >> "$LOG_FILE" 2>&1
        log OK "MTL şeması yüklendi."
    fi
}

step_syncrepl() {
    log STEP "ADIM 13/16: Syncrepl (refreshAndPersist) + ReadOnly + UpdateRef"

    local mdb_dn="olcDatabase={1}mdb,cn=config"

    # olcSyncrepl ekle (yoksa)
    if slapcat -F /etc/openldap/slapd.d/ -b cn=config 2>/dev/null | grep -q "olcSyncrepl"; then
        log SKIP "olcSyncrepl zaten mevcut — korunuyor."
    else
        log INFO "olcSyncrepl ekleniyor (rid=001, provider=${MASTER_HOSTNAME})..."
        cat > /tmp/syncrepl.ldif <<EOF
dn: ${mdb_dn}
changetype: modify
add: olcSyncrepl
olcSyncrepl: rid=001 provider=ldaps://${MASTER_HOSTNAME} type=refreshAndPersist retry="5 5 60 +" searchbase="${LDAP_BASE_DN}" scope=sub schemachecking=on bindmethod=simple binddn="cn=replicator,${LDAP_BASE_DN}" credentials=${REPLICATOR_PASSWORD} tls_cacert=/etc/mtl/ssl/mtl-ca.pem tls_reqcert=demand
EOF
        ldapmodify -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                   -f /tmp/syncrepl.ldif >> "$LOG_FILE" 2>&1 \
            || die "olcSyncrepl eklenemedi (master erişilebilir mi? replicator parolası doğru mu?)"
        rm -f /tmp/syncrepl.ldif
        log OK "olcSyncrepl eklendi."
    fi

    # İlk refresh'i bekle (master'dan veri çekilsin)
    log INFO "Master'dan ilk senkronizasyon bekleniyor..."
    local i csn=""
    for i in $(seq 1 12); do
        sleep 5
        csn=$(ldapsearch -x -H ldap://localhost -D "cn=admin,${LDAP_BASE_DN}" \
              -w "$SLAVE_LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s base contextCSN 2>/dev/null \
              | grep "^contextCSN:" | head -1 | awk '{print $2}' || echo "")
        if [[ -n "$csn" ]]; then
            log OK "Senkronizasyon başladı (contextCSN: $csn)."
            break
        fi
        log INFO "  bekleniyor... ($i/12)"
    done
    [[ -z "$csn" ]] && log WARN "contextCSN henüz görünmüyor — replikasyon asenkron, özet adımında tekrar kontrol edilecek."

    # ReadOnly + UpdateRef (yoksa)
    if slapcat -F /etc/openldap/slapd.d/ -b cn=config 2>/dev/null | grep -q "olcReadOnly: TRUE"; then
        log SKIP "olcReadOnly zaten TRUE."
    else
        log INFO "olcUpdateRef + olcReadOnly ayarlanıyor..."
        cat > /tmp/readonly.ldif <<EOF
dn: ${mdb_dn}
changetype: modify
add: olcUpdateRef
olcUpdateRef: ldaps://${MASTER_HOSTNAME}
-
add: olcReadOnly
olcReadOnly: TRUE
EOF
        ldapmodify -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                   -f /tmp/readonly.ldif >> "$LOG_FILE" 2>&1 \
            || die "olcReadOnly/olcUpdateRef ayarlanamadı."
        rm -f /tmp/readonly.ldif
        log OK "olcReadOnly TRUE + olcUpdateRef ayarlandı."
    fi

    # KORUMA DOĞRULAMASI: olcSyncrepl gerçekten var mı?
    if slapcat -F /etc/openldap/slapd.d/ -b cn=config 2>/dev/null | grep -q "olcSyncrepl"; then
        log OK "DOĞRULAMA: olcSyncrepl config'te mevcut."
    else
        die "DOĞRULAMA BAŞARISIZ: olcSyncrepl config'te YOK! (replikasyon kurulmamış)"
    fi
}

step_mtl_env() {
    log STEP "ADIM 14/16: MTL Env Dosyası (/etc/mtl/mtl-ldap.env)"

    if [[ -f /etc/mtl/mtl-ldap.env ]]; then
        log SKIP "Env dosyası zaten mevcut: /etc/mtl/mtl-ldap.env"
    else
        cat > /etc/mtl/mtl-ldap.env <<EOF
# ===== MTL LDAP — Slave Profile (Parola Reset Portali) =====
# Üretildi: $(date)
MTL_NODE_ID=${SLAVE_HOSTNAME%%.*}
MTL_PROFILE=SLAVE
MTL_SECRET_KEY=${SECRET_KEY}
MTL_FERNET_KEY=${FERNET_KEY}
MTL_LISTEN_HOST=127.0.0.1
MTL_LISTEN_PORT=8000
# Veritabanı (slave kendi local DB'si)
MTL_DB_URL=postgresql+asyncpg://mtl_slave:${SLAVE_PG_PASSWORD}@127.0.0.1:5432/mtl_admin
# Redis (slave kendi local Redis'i)
MTL_REDIS_URL=redis://:${SLAVE_REDIS_PASSWORD}@127.0.0.1:6379/0
# LDAP — YAZIM master'a, OKUMA lokal slave'e
MTL_LDAP_URL=ldaps://${MASTER_HOSTNAME}:636
MTL_LDAP_READ_URL=ldaps://127.0.0.1:636
MTL_LDAP_BIND_DN=cn=admin,${LDAP_BASE_DN}
MTL_LDAP_BIND_PASSWORD=${MASTER_LDAP_ADMIN_PASSWORD}
MTL_LDAP_BASE_DN=${LDAP_BASE_DN}
MTL_LDAP_CA_PATH=/etc/mtl/ssl/mtl-ca.pem
MTL_LDAP_TLS_VERIFY=true
# Cluster — master ile AYNI cluster secret
MTL_MASTER_URL=https://${MASTER_HOSTNAME}
MTL_CLUSTER_SECRET=${CLUSTER_SECRET}
MTL_API_PREFIX=/api/v1
EOF
        chown root:mtl /etc/mtl/mtl-ldap.env
        chmod 0640 /etc/mtl/mtl-ldap.env
        log OK "Env dosyası: /etc/mtl/mtl-ldap.env"
    fi

    cat > /root/mtl-slave-secrets.txt <<EOF
===== MTL SLAVE SECRETS — ÖNEMLİ, KAYBETMEYIN =====
Üretildi: $(date)

Slave Sunucu       : ${SLAVE_HOSTNAME} (${SLAVE_IP})
Master Sunucu      : ${MASTER_HOSTNAME} (${MASTER_IP})

Slave LDAP admin   : cn=admin,${LDAP_BASE_DN} / ${SLAVE_LDAP_ADMIN_PASSWORD}  (LOKAL)
Slave cn=config    : cn=admin,cn=config / ${LDAP_CONFIG_PASSWORD}
Master LDAP admin  : cn=admin,${LDAP_BASE_DN} / ${MASTER_LDAP_ADMIN_PASSWORD}  (yazım için)
Replicator         : cn=replicator,${LDAP_BASE_DN} / ${REPLICATOR_PASSWORD}

PostgreSQL         : mtl_slave / ${SLAVE_PG_PASSWORD}  (DB: mtl_admin)
Redis              : ${SLAVE_REDIS_PASSWORD}

SECRET_KEY         : ${SECRET_KEY}
FERNET_KEY         : ${FERNET_KEY}  (master ile aynı)
CLUSTER_SECRET     : ${CLUSTER_SECRET}  (master ile aynı)
EOF
    chmod 600 /root/mtl-slave-secrets.txt
    log OK "Secrets: /root/mtl-slave-secrets.txt"

    # Slave kendi DB'sinde cluster node kayıtları (varsa)
    PGPASSWORD="$SLAVE_PG_PASSWORD" psql -h 127.0.0.1 -U mtl_slave -d mtl_admin >> "$LOG_FILE" 2>&1 <<EOF || log WARN "cluster_node kaydı atlandı (tablo farklı olabilir)."
INSERT INTO mtl_core.cluster_node
    (node_id, role, host, ldap_port, ldaps_port, api_url, health_status, is_self)
VALUES
    ('${MASTER_HOSTNAME%%.*}', 'MASTER', '${MASTER_HOSTNAME}', 389, 636,
     'https://${MASTER_HOSTNAME}', 'UNKNOWN', false),
    ('${SLAVE_HOSTNAME%%.*}',  'SLAVE',  '${SLAVE_HOSTNAME}',  389, 636,
     'https://${SLAVE_HOSTNAME}',  'HEALTHY', true)
ON CONFLICT (node_id) DO UPDATE SET
    role = EXCLUDED.role, host = EXCLUDED.host, api_url = EXCLUDED.api_url;
EOF
    log OK "Cluster node kayıtları işlendi."
}

step_nginx() {
    log STEP "ADIM 15/16: Nginx (portal)"
    if rpm -q nginx >/dev/null 2>&1; then
        log SKIP "Nginx zaten kurulu."
    else
        dnf install -y nginx >> "$LOG_FILE" 2>&1
        systemctl enable nginx >> "$LOG_FILE" 2>&1
        log OK "Nginx kuruldu."
    fi

    log INFO "Nginx ana yapılandırması yazılıyor..."
    cat > /etc/nginx/nginx.conf <<'NGINX_CONF_EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

include /usr/share/nginx/modules/*.conf;

events {
    worker_connections 1024;
}

http {
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';
    access_log  /var/log/nginx/access.log  main;
    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   65;
    types_hash_max_size 4096;
    include             /etc/nginx/mime.types;
    default_type        application/octet-stream;
    include /etc/nginx/conf.d/*.conf;
}
NGINX_CONF_EOF

    rm -f /etc/nginx/conf.d/default.conf
    cp "${MTL_SOURCE_DIR}/deployment/nginx/mtl-ldap-admin.conf" \
       /etc/nginx/conf.d/mtl-ldap-admin.conf

    # Hostname'i slave'e ayarla
    sed -i "s/mtl-master-01.mtl.local/${SLAVE_HOSTNAME}/g" /etc/nginx/conf.d/mtl-ldap-admin.conf
    sed -i "s/mtl-slave-01.mtl.local/${SLAVE_HOSTNAME}/g" /etc/nginx/conf.d/mtl-ldap-admin.conf
    # Nginx 1.20 uyarlaması
    sed -i 's|^    listen 443 ssl;|    listen 443 ssl http2;|' /etc/nginx/conf.d/mtl-ldap-admin.conf
    sed -i 's|^    listen \[::\]:443 ssl;|    listen [::]:443 ssl http2;|' /etc/nginx/conf.d/mtl-ldap-admin.conf
    sed -i '/^    http2 on;$/d' /etc/nginx/conf.d/mtl-ldap-admin.conf
    sed -i '/ssl_stapling/d' /etc/nginx/conf.d/mtl-ldap-admin.conf

    # Frontend kök dizinini conf'tan oku (layout'a bağımlı kalma) ve placeholder koy
    local web_root
    web_root=$(grep -oP '^\s*root\s+\K[^;]+' /etc/nginx/conf.d/mtl-ldap-admin.conf | head -1 | tr -d ' ')
    [[ -z "$web_root" ]] && web_root="/opt/mtl/web/public"
    mkdir -p "$web_root"
    if [[ ! -f "$web_root/index.html" ]]; then
        cat > "$web_root/index.html" <<EOF
<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MTL Ldap</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#f3f4f6;color:#0f172a;margin:0;padding:50px;line-height:1.6}
.brand{color:#2563eb;margin:0 0 16px}.sub{color:#64748b;margin-top:24px;font-size:14px}
code{background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:13px}</style></head>
<body><h1 class="brand">MTL Ldap</h1>
<p>Parola-reset portali yükleniyor. Backend API <code>/api/v1/</code> altında.</p>
<p class="sub">Bu placeholder'dır — SLAVE-profil frontend build deploy edilince değişecek.</p>
<p class="sub">Sunucu: <code>${SLAVE_HOSTNAME}</code> (SLAVE)</p></body></html>
EOF
    fi
    chown -R mtl:mtl "$web_root"
    find "$web_root" -type d -exec chmod 755 {} \;
    find "$web_root" -type f -exec chmod 644 {} \;
    chmod 755 /opt /opt/mtl 2>/dev/null || true
    log OK "Frontend placeholder: $web_root"

    if nginx -t >> "$LOG_FILE" 2>&1; then
        log OK "Nginx config testi başarılı."
    else
        die "Nginx config testi başarısız. Log: $LOG_FILE"
    fi
    systemctl restart nginx
    sleep 2
    systemctl is-active nginx >/dev/null && log OK "Nginx çalışıyor." || die "Nginx başlatılamadı."
}

step_systemd_scripts() {
    log STEP "ADIM 16/16: systemd Unit'leri ve Failover Script'leri"

    for unit in mtl-ldap-admin.service mtl-ldap-admin-worker.service mtl-ldap-admin-beat.service; do
        cp "${MTL_SOURCE_DIR}/deployment/systemd/${unit}" /etc/systemd/system/
        # Slave env dosyası master'dan farklı: EnvironmentFile'ı garantiye al.
        sed -i 's|^EnvironmentFile=.*|EnvironmentFile=/etc/mtl/mtl-ldap.env|' "/etc/systemd/system/${unit}"
    done
    systemctl daemon-reload
    log OK "systemd unit'leri yerleştirildi (EnvironmentFile=/etc/mtl/mtl-ldap.env)."
    log INFO "Backend kodu + venv deploy edildikten sonra: systemctl enable --now mtl-ldap-admin{,-worker,-beat}"

    if [[ -d "${MTL_SOURCE_DIR}/scripts" ]]; then
        cp "${MTL_SOURCE_DIR}/scripts/"*.sh /opt/mtl/scripts/ 2>/dev/null || true
        chmod +x /opt/mtl/scripts/*.sh 2>/dev/null || true
        for f in /opt/mtl/scripts/mtl-failover-*.sh; do
            [[ -f "$f" ]] && sed -i 's|/etc/ldap/slapd.d|/etc/openldap/slapd.d|g' "$f"
        done
        log OK "Failover script'leri yerleştirildi."
    fi

    # SELinux kalıcı
    semanage fcontext -a -t httpd_sys_content_t "/opt/mtl/web/public(/.*)?" 2>/dev/null || true
    restorecon -Rv /opt/mtl/web/public/ >> "$LOG_FILE" 2>&1 || true
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    setsebool -P httpd_read_user_content 1 2>/dev/null || true
    setsebool -P nis_enabled 1 2>/dev/null || true

    setenforce 1 2>/dev/null || true
    sed -i 's/^SELINUX=permissive/SELINUX=enforcing/' /etc/selinux/config
    log OK "SELinux Enforcing moduna alındı."
}

# ============================================================================
# Final Sağlık Özeti
# ============================================================================

print_summary() {
    log STEP "KURULUM ÖZETİ"

    echo
    echo "1. SELinux: $(getenforce)"

    echo
    echo "2. Servisler"
    for s in postgresql-16 redis slapd nginx firewalld; do
        printf "   %-15s : %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null || echo 'unknown')"
    done

    echo
    echo "3. LDAPS dinleyici (636)"
    local ldaps_ok="?"
    if ldapsearch -H "ldaps://127.0.0.1:636" -x -D "cn=admin,${LDAP_BASE_DN}" \
                  -w "$SLAVE_LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s base 2>/dev/null | grep -q "^dn:"; then
        ldaps_ok="ÇALIŞIYOR"
    else
        ldaps_ok="ERİŞİLEMEDİ (636 dinleyici / TLS izinlerini kontrol edin)"
    fi
    echo "   ldaps://127.0.0.1:636 : $ldaps_ok"

    echo
    echo "4. Replikasyon (contextCSN karşılaştırması)"
    local slave_csn master_csn
    slave_csn=$(ldapsearch -x -H ldap://127.0.0.1 -D "cn=admin,${LDAP_BASE_DN}" \
                -w "$SLAVE_LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s base contextCSN 2>/dev/null \
                | grep "^contextCSN:" | head -1 | awk '{print $2}' || echo "?")
    master_csn=$(ldapsearch -x -H "ldaps://${MASTER_HOSTNAME}:636" -D "cn=admin,${LDAP_BASE_DN}" \
                 -w "$MASTER_LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s base contextCSN 2>/dev/null \
                 | grep "^contextCSN:" | head -1 | awk '{print $2}' || echo "?")
    echo "   Slave  contextCSN: ${slave_csn:-yok}"
    echo "   Master contextCSN: ${master_csn:-erişilemedi}"
    if [[ -n "$slave_csn" && "$slave_csn" == "$master_csn" ]]; then
        echo "   → SENKRON (eşit)"
    else
        echo "   → Henüz eşit değil olabilir (refreshAndPersist asenkron; birkaç sn sonra tekrar bakın)."
    fi

    echo
    echo "5. Dosyalar"
    echo "   Env       : /etc/mtl/mtl-ldap.env"
    echo "   Secrets   : /root/mtl-slave-secrets.txt"
    echo "   Sertifika : /etc/mtl/ssl/{mtl-ca.pem,server.pem,server.key}"
    echo "   Config yedek: /var/lib/mtl/backups/"
    echo "   Log       : $LOG_FILE"

    echo
    echo "6. KALAN ADIMLAR (uygulama katmanı — installer kapsamı dışında):"
    echo "   a) Backend kodu + venv deploy et, sonra:"
    echo "      systemctl enable --now mtl-ldap-admin mtl-ldap-admin-worker mtl-ldap-admin-beat"
    echo "   b) Frontend'i SLAVE profille build edip /opt/mtl/web/public'e deploy et"
    echo "      (VITE_MTL_PROFILE=SLAVE — mevcut build-slave akışı)."

    echo
    log OK "Slave kurulumu (altyapı) tamamlandı."
    echo "Tarayıcıdan: https://${SLAVE_HOSTNAME}/"
    echo
}

# ============================================================================
# Ana Akış
# ============================================================================

main() {
    cat <<'BANNER'

╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   MTL LDAP Admin — Slave (Consumer) Kurulum Script'i        ║
║   Rocky Linux 9 | OpenLDAP 2.6 syncrepl | PostgreSQL 16     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

BANNER

    require_root
    require_rocky9

    : > "$LOG_FILE"
    chmod 600 "$LOG_FILE"
    log INFO "Slave kurulumu başlıyor — log: $LOG_FILE"

    parse_args "$@"
    collect_config

    step_system_prep
    step_firewall
    step_selinux_permissive
    step_mtl_base
    step_postgresql
    step_redis
    step_openldap_install
    step_tls_setup
    step_ldaps_listener
    step_openldap_config
    step_openldap_schema
    step_syncrepl
    step_mtl_env
    step_nginx
    step_systemd_scripts

    print_summary
}

main "$@"
