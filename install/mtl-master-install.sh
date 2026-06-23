#!/usr/bin/env bash
# ============================================================================
# MTL LDAP Admin — Master Sunucu Kurulum Script'i (Rocky Linux 9)
# ============================================================================
# Bu script, master sunucusunda gereken tüm bileşenleri sıfırdan kurar:
#   - Sistem hazırlığı (hostname, /etc/hosts, firewall)
#   - SELinux yapılandırması
#   - PostgreSQL 16 + MTL şeması
#   - Redis 7
#   - OpenLDAP 2.6 (MTL şeması, syncprov, accesslog, ppolicy, replicator)
#   - TLS sertifikaları (CA + master + slave için)
#   - Nginx + placeholder frontend
#   - MTL env dosyası + cluster node kaydı
#   - systemd unit'leri + failover script'leri
#
# Çalıştırma:
#   bash mtl-master-install.sh
#
# Veya config dosyasıyla otomatik:
#   cp mtl-master-install.conf.example /etc/mtl-master-install.conf
#   nano /etc/mtl-master-install.conf
#   bash mtl-master-install.sh --config /etc/mtl-master-install.conf
#
# Idempotent: Aynı script'i tekrar çalıştırabilirsiniz, var olan adımları atlar.
# ============================================================================

set -euo pipefail

SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="mtl-master-install"
LOG_FILE="/var/log/mtl-master-install.log"
CONFIG_FILE=""

# Renkli çıktı
COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_CYAN='\033[0;36m'
COLOR_BOLD='\033[1m'
COLOR_RESET='\033[0m'

# ============================================================================
# Yardımcı Fonksiyonlar
# ============================================================================

log() {
    local level="$1"
    shift
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
    local prompt="$1"
    local var_name="$2"
    local is_secret="${3:-no}"
    local default="${4:-}"
    local value=""
    
    while [[ -z "$value" ]]; do
        if [[ -n "$default" ]]; then
            printf "${COLOR_BOLD}%s${COLOR_RESET} [varsayılan: %s]: " "$prompt" "$default"
        else
            printf "${COLOR_BOLD}%s${COLOR_RESET}: " "$prompt"
        fi
        
        if [[ "$is_secret" == "yes" ]]; then
            read -rs value
            echo
        else
            read -r value
        fi
        
        if [[ -z "$value" && -n "$default" ]]; then
            value="$default"
        fi
        
        if [[ -z "$value" ]]; then
            log WARN "Boş değer kabul edilmez, tekrar girin."
        fi
    done
    
    eval "$var_name='$value'"
}

confirm() {
    local prompt="$1"
    local answer=""
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

require_root() {
    if [[ $EUID -ne 0 ]]; then
        die "Bu script root olarak çalıştırılmalıdır."
    fi
}

require_rocky9() {
    if [[ ! -f /etc/os-release ]]; then
        die "İşletim sistemi tespit edilemedi (/etc/os-release yok)."
    fi
    source /etc/os-release
    if [[ "${ID,,}" != "rocky" ]] || [[ ! "${VERSION_ID}" =~ ^9 ]]; then
        log WARN "Bu script Rocky Linux 9 için tasarlandı. Tespit edilen: $PRETTY_NAME"
        confirm "Yine de devam edilsin mi?" || die "Kurulum iptal edildi."
    fi
}

cmd_exists() {
    command -v "$1" &>/dev/null
}

# ============================================================================
# Argüman Ayrıştırma
# ============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --config|-c)
                CONFIG_FILE="$2"
                shift 2
                ;;
            --help|-h)
                cat <<EOF
MTL LDAP Admin — Master Sunucu Kurulum Script'i v${SCRIPT_VERSION}

Kullanım:
  $0 [SEÇENEKLER]

Seçenekler:
  -c, --config DOSYA    Yapılandırma dosyası kullan (etkileşim olmadan)
  -h, --help            Bu yardım metnini göster
  -v, --version         Script sürümünü göster

Örnekler:
  $0                                       # İnteraktif kurulum
  $0 --config /etc/mtl-master-install.conf  # Otomatik kurulum

Yapılandırma dosyası örneği:
  MASTER_IP=192.0.2.42
  SLAVE_IP=192.0.2.44
  MASTER_HOSTNAME=mtl-master-01.mtl.local
  SLAVE_HOSTNAME=mtl-slave-01.mtl.local
  LDAP_BASE_DN=dc=mtl,dc=local
  LDAP_ORGANIZATION=MTL
  LDAP_ADMIN_PASSWORD=...
  LDAP_CONFIG_PASSWORD=...
  REPLICATOR_PASSWORD=...
  PG_PASSWORD=...
  REDIS_PASSWORD=...
  BOOTSTRAP_ADMIN_USERNAME=happy
  BOOTSTRAP_ADMIN_PASSWORD=...
  BOOTSTRAP_ADMIN_EMAIL=happy@mtl.local
  MTL_SOURCE_DIR=/opt/mtl-source/mtl-ldap-admin

EOF
                exit 0
                ;;
            --version|-v)
                echo "${SCRIPT_NAME} v${SCRIPT_VERSION}"
                exit 0
                ;;
            *)
                die "Bilinmeyen argüman: $1 (yardım için --help)"
                ;;
        esac
    done
}

# ============================================================================
# Yapılandırma Toplama
# ============================================================================

collect_config() {
    log STEP "ADIM 1/15: Yapılandırma Toplama"
    
    if [[ -n "$CONFIG_FILE" ]]; then
        if [[ ! -f "$CONFIG_FILE" ]]; then
            die "Yapılandırma dosyası bulunamadı: $CONFIG_FILE"
        fi
        log INFO "Yapılandırma dosyası yükleniyor: $CONFIG_FILE"
        # shellcheck disable=SC1090
        source "$CONFIG_FILE"
        log OK "Yapılandırma yüklendi."
    else
        log INFO "İnteraktif yapılandırma — gereken bilgileri sorulacak."
        echo
        
        # Tespit edilen IP
        local detected_ip
        detected_ip=$(ip -4 addr show 2>/dev/null | grep -E "inet [0-9]" | grep -v "127.0.0.1" | head -1 | awk '{print $2}' | cut -d/ -f1)
        
        echo "—— Sunucu Bilgileri ——"
        ask "Master IP adresi" MASTER_IP no "$detected_ip"
        ask "Slave IP adresi (henüz kurulmamış olabilir)" SLAVE_IP
        ask "Master hostname (FQDN)" MASTER_HOSTNAME no "mtl-master-01.mtl.local"
        ask "Slave hostname (FQDN)" SLAVE_HOSTNAME no "mtl-slave-01.mtl.local"
        
        echo
        echo "—— LDAP Yapılandırması ——"
        ask "LDAP base DN" LDAP_BASE_DN no "dc=mtl,dc=local"
        ask "LDAP organization (o=)" LDAP_ORGANIZATION no "MTL"
        ask "LDAP admin parolası (cn=admin,${LDAP_BASE_DN})" LDAP_ADMIN_PASSWORD yes
        ask "LDAP config admin parolası (cn=admin,cn=config)" LDAP_CONFIG_PASSWORD yes
        ask "Replicator parolası (slave bunu kullanacak)" REPLICATOR_PASSWORD yes
        
        echo
        echo "—— Veritabanı Parolaları ——"
        ask "PostgreSQL mtl_admin parolası" PG_PASSWORD yes
        ask "Redis parolası" REDIS_PASSWORD yes
        
        echo
        echo "—— Bootstrap Admin (MTL Console'a ilk girecek hesap) ——"
        ask "Bootstrap admin kullanıcı adı" BOOTSTRAP_ADMIN_USERNAME no "happy"
        ask "Bootstrap admin parolası" BOOTSTRAP_ADMIN_PASSWORD yes
        ask "Bootstrap admin e-postası" BOOTSTRAP_ADMIN_EMAIL no "${BOOTSTRAP_ADMIN_USERNAME}@mtl.local"
        
        echo
        echo "—— Kaynak Dosyalar ——"
        ask "MTL kaynak dosya dizini" MTL_SOURCE_DIR no "/opt/mtl-source/mtl-ldap-admin"
    fi
    
    # Otomatik üretilen değerler
    SECRET_KEY="${SECRET_KEY:-$(openssl rand -hex 32)}"
    FERNET_KEY="${FERNET_KEY:-$(python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())")}"
    CLUSTER_SECRET="${CLUSTER_SECRET:-$(openssl rand -hex 32)}"
    
    # Doğrulama
    [[ -z "${MASTER_IP:-}" ]] && die "MASTER_IP boş olamaz."
    [[ -z "${SLAVE_IP:-}" ]] && die "SLAVE_IP boş olamaz."
    [[ -z "${MASTER_HOSTNAME:-}" ]] && die "MASTER_HOSTNAME boş olamaz."
    [[ ! -d "${MTL_SOURCE_DIR:-/yok}" ]] && die "MTL_SOURCE_DIR bulunamadı: $MTL_SOURCE_DIR"
    [[ ! -f "${MTL_SOURCE_DIR}/schema/mtl_ldap_admin_schema.sql" ]] && \
        die "Şema dosyası bulunamadı: ${MTL_SOURCE_DIR}/schema/mtl_ldap_admin_schema.sql"
    
    # Onay
    echo
    log INFO "Toplanan yapılandırma özeti:"
    echo
    cat <<EOF
  Master Sunucu     : ${MASTER_HOSTNAME} (${MASTER_IP})
  Slave Sunucu      : ${SLAVE_HOSTNAME} (${SLAVE_IP})
  LDAP Base DN      : ${LDAP_BASE_DN}
  LDAP Organization : ${LDAP_ORGANIZATION}
  Bootstrap Admin   : ${BOOTSTRAP_ADMIN_USERNAME} (${BOOTSTRAP_ADMIN_EMAIL})
  Kaynak Dizini     : ${MTL_SOURCE_DIR}
  
  Parolalar: gizli — script tamamlandığında /root/mtl-secrets.txt'de görünecek
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
    log STEP "ADIM 2/15: Sistem Hazırlığı"
    
    log INFO "Sistem güncellemeleri kontrol ediliyor..."
    dnf -y update --refresh >> "$LOG_FILE" 2>&1 || log WARN "Sistem güncellemesi atlandı"
    
    log INFO "Temel paketler kuruluyor..."
    dnf install -y epel-release >> "$LOG_FILE" 2>&1
    dnf install -y vim curl wget git tar jq policycoreutils-python-utils \
                   firewalld chrony bind-utils nano \
                   openssl-devel cyrus-sasl-devel python3 \
                   >> "$LOG_FILE" 2>&1
    log OK "Temel paketler kuruldu."
    
    log INFO "Zaman senkronizasyonu aktive ediliyor..."
    systemctl enable --now chronyd >> "$LOG_FILE" 2>&1
    log OK "chronyd aktif."
    
    # Hostname
    local current_hostname
    current_hostname=$(hostname -f 2>/dev/null || hostname)
    if [[ "$current_hostname" != "$MASTER_HOSTNAME" ]]; then
        log INFO "Hostname ayarlanıyor: $MASTER_HOSTNAME"
        hostnamectl set-hostname "$MASTER_HOSTNAME"
    else
        log SKIP "Hostname zaten doğru: $MASTER_HOSTNAME"
    fi
    
    # /etc/hosts
    if ! grep -q "$MASTER_HOSTNAME" /etc/hosts; then
        log INFO "/etc/hosts dosyasına kayıtlar ekleniyor..."
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
    log STEP "ADIM 3/15: Firewall Yapılandırması"
    
    systemctl enable --now firewalld >> "$LOG_FILE" 2>&1
    
    for service in https http ssh; do
        firewall-cmd --permanent --add-service="$service" >> "$LOG_FILE" 2>&1 || true
    done
    for port in 389/tcp 636/tcp; do
        firewall-cmd --permanent --add-port="$port" >> "$LOG_FILE" 2>&1 || true
    done
    
    firewall-cmd --reload >> "$LOG_FILE" 2>&1
    log OK "Firewall: 80, 443, 389, 636, 22 portları açık."
}

step_selinux_permissive() {
    log STEP "ADIM 4/15: SELinux Geçici Permissive"
    
    if [[ "$(getenforce)" == "Enforcing" ]]; then
        setenforce 0
        log OK "SELinux geçici olarak permissive moda alındı."
    else
        log SKIP "SELinux zaten permissive: $(getenforce)"
    fi
    sed -i 's/^SELINUX=enforcing/SELINUX=permissive/' /etc/selinux/config
}

step_postgresql() {
    log STEP "ADIM 5/15: PostgreSQL 16 Kurulumu"
    
    if rpm -q postgresql16-server >/dev/null 2>&1; then
        log SKIP "PostgreSQL 16 zaten kurulu."
    else
        log INFO "PostgreSQL repo ekleniyor..."
        dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm >> "$LOG_FILE" 2>&1
        dnf -qy module disable postgresql >> "$LOG_FILE" 2>&1 || true
        log INFO "PostgreSQL 16 paketleri kuruluyor..."
        dnf install -y postgresql16-server postgresql16-contrib >> "$LOG_FILE" 2>&1
        log OK "PostgreSQL paketleri kuruldu."
    fi
    
    # Initdb
    if [[ ! -f /var/lib/pgsql/16/data/postgresql.conf ]]; then
        log INFO "PostgreSQL veritabanı başlatılıyor..."
        /usr/pgsql-16/bin/postgresql-16-setup initdb >> "$LOG_FILE" 2>&1
        log OK "PostgreSQL initdb tamamlandı."
    else
        log SKIP "PostgreSQL veritabanı zaten başlatılmış."
    fi
    
    systemctl enable --now postgresql-16 >> "$LOG_FILE" 2>&1
    log OK "postgresql-16 servisi aktif."
    
    # DB kullanıcı ve veritabanı
    local user_exists
    user_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_user WHERE usename='mtl_admin'" 2>/dev/null || echo "")
    if [[ -z "$user_exists" ]]; then
        log INFO "PostgreSQL kullanıcı ve veritabanı oluşturuluyor..."
        sudo -u postgres psql >> "$LOG_FILE" 2>&1 <<EOF
CREATE USER mtl_admin WITH PASSWORD '${PG_PASSWORD}';
CREATE DATABASE mtl_admin OWNER mtl_admin;
EOF
        log OK "PostgreSQL: mtl_admin kullanıcısı ve veritabanı oluşturuldu."
    else
        log SKIP "mtl_admin kullanıcısı zaten var. Parola güncelleniyor..."
        sudo -u postgres psql -c "ALTER USER mtl_admin WITH PASSWORD '${PG_PASSWORD}';" >> "$LOG_FILE" 2>&1
    fi
    
    # pg_hba
    local pghba=/var/lib/pgsql/16/data/pg_hba.conf
    if ! grep -q "mtl_admin" "$pghba"; then
        cp "$pghba" "${pghba}.orig"
        sed -i "/^# IPv4 local connections:/i \\
host    mtl_admin       mtl_admin       127.0.0.1\\/32           scram-sha-256" "$pghba"
        systemctl restart postgresql-16
        log OK "pg_hba.conf güncellendi ve PostgreSQL yeniden başlatıldı."
    else
        log SKIP "pg_hba.conf zaten yapılandırılmış."
    fi
    
    # Bağlantı testi
    if PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin -c '\q' >/dev/null 2>&1; then
        log OK "PostgreSQL bağlantı testi başarılı."
    else
        die "PostgreSQL bağlantı testi başarısız."
    fi
    
    # Şema yükle
    local schema_count
    schema_count=$(PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin -tAc \
        "SELECT count(*) FROM information_schema.schemata WHERE schema_name IN ('mtl_core','mtl_audit','mtl_signal')" 2>/dev/null || echo "0")
    
    if [[ "$schema_count" != "3" ]]; then
        log INFO "MTL şeması yükleniyor..."
        PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin \
            -f "${MTL_SOURCE_DIR}/schema/mtl_ldap_admin_schema.sql" >> "$LOG_FILE" 2>&1
        log OK "MTL şeması yüklendi."
    else
        log SKIP "MTL şemaları zaten yüklü."
    fi
    
    # Doğrula
    local perm_count
    perm_count=$(PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin -tAc \
        "SELECT count(*) FROM mtl_core.permission" 2>/dev/null || echo "0")
    log OK "PostgreSQL hazır: $perm_count yetki kaydı bulundu."
}

step_redis() {
    log STEP "ADIM 6/15: Redis 7 Kurulumu"
    
    if rpm -q redis >/dev/null 2>&1; then
        log SKIP "Redis zaten kurulu."
    else
        log INFO "Redis 7 modülü kuruluyor..."
        dnf module install -y redis:7 >> "$LOG_FILE" 2>&1
        log OK "Redis kuruldu."
    fi
    
    systemctl enable redis >> "$LOG_FILE" 2>&1
    
    # Parola ve bind ayarı
    if ! grep -q "^requirepass ${REDIS_PASSWORD}$" /etc/redis/redis.conf; then
        log INFO "Redis yapılandırılıyor (parola + localhost-only)..."
        sed -i "s/^# requirepass .*/requirepass ${REDIS_PASSWORD}/" /etc/redis/redis.conf
        sed -i "s/^requirepass .*/requirepass ${REDIS_PASSWORD}/" /etc/redis/redis.conf
        sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
        sed -i 's/^protected-mode .*/protected-mode yes/' /etc/redis/redis.conf
        systemctl restart redis
        log OK "Redis yapılandırıldı ve yeniden başlatıldı."
    else
        log SKIP "Redis zaten yapılandırılmış."
        systemctl is-active redis >/dev/null || systemctl start redis
    fi
    
    if redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
        log OK "Redis PING başarılı."
    else
        die "Redis PING başarısız."
    fi
}

step_openldap_install() {
    log STEP "ADIM 7/15: OpenLDAP 2.6 Kurulumu"
    
    if rpm -q openldap-servers >/dev/null 2>&1; then
        log SKIP "OpenLDAP servers zaten kurulu."
    else
        log INFO "Rocky Linux 'plus' reposu aktive ediliyor..."
        dnf config-manager --set-enabled plus >> "$LOG_FILE" 2>&1
        log INFO "OpenLDAP 2.6 kuruluyor..."
        dnf install -y openldap openldap-servers openldap-clients >> "$LOG_FILE" 2>&1
        log OK "OpenLDAP kuruldu: $(slapd -VV 2>&1 | head -1)"
    fi
}

step_openldap_config() {
    log STEP "ADIM 8/15: OpenLDAP Yapılandırması"
    
    # Eğer config zaten varsa (idempotent), atla
    if [[ -d /etc/openldap/slapd.d/cn=config ]] && \
       slapcat -F /etc/openldap/slapd.d/ -b "cn=config" 2>/dev/null | grep -q "olcSuffix: ${LDAP_BASE_DN}"; then
        log SKIP "OpenLDAP zaten yapılandırılmış (idempotent atlama)."
        return 0
    fi
    
    log INFO "Hash'ler üretiliyor..."
    local admin_hash config_hash repl_hash
    admin_hash=$(slappasswd -h '{SSHA}' -s "$LDAP_ADMIN_PASSWORD")
    config_hash=$(slappasswd -h '{SSHA}' -s "$LDAP_CONFIG_PASSWORD")
    repl_hash=$(slappasswd -h '{SSHA}' -s "$REPLICATOR_PASSWORD")
    
    log INFO "slapd durduruluyor (varsa)..."
    systemctl stop slapd 2>/dev/null || true
    
    log INFO "Eski config ve veri temizleniyor..."
    rm -rf /etc/openldap/slapd.d/*
    rm -rf /var/lib/ldap/*
    rm -rf /var/lib/ldap-accesslog/*
    mkdir -p /var/lib/ldap-accesslog
    chown -R ldap:ldap /etc/openldap/slapd.d /var/lib/ldap /var/lib/ldap-accesslog
    
    log INFO "Init LDIF oluşturuluyor..."
    cat > /tmp/slapd-init.ldif <<EOF
dn: cn=config
objectClass: olcGlobal
cn: config
olcArgsFile: /var/run/openldap/slapd.args
olcPidFile: /var/run/openldap/slapd.pid
olcLogLevel: stats

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
olcAccess: to * by self read by anonymous auth

dn: olcDatabase=mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: mdb
olcDbDirectory: /var/lib/ldap-accesslog
olcSuffix: cn=accesslog
olcRootDN: cn=admin,cn=accesslog
olcRootPW: ${admin_hash}
olcDbMaxSize: 536870912
olcDbIndex: entryCSN,objectClass,reqEnd,reqResult,reqStart eq
olcAccess: to * by * none
EOF
    
    log INFO "Init LDIF yükleniyor..."
    slapadd -F /etc/openldap/slapd.d/ -n 0 -l /tmp/slapd-init.ldif >> "$LOG_FILE" 2>&1
    chown -R ldap:ldap /etc/openldap/slapd.d/
    
    log INFO "Config doğrulanıyor..."
    if ! slaptest -u -F /etc/openldap/slapd.d/ >> "$LOG_FILE" 2>&1; then
        die "slapd config doğrulaması başarısız. Log: $LOG_FILE"
    fi
    
    log INFO "slapd başlatılıyor..."
    systemctl enable --now slapd >> "$LOG_FILE" 2>&1
    sleep 2
    
    if ! systemctl is-active slapd >/dev/null; then
        die "slapd başlatılamadı."
    fi
    log OK "slapd çalışıyor."
    
    # Repl hash'i sonra kullanmak için /tmp'ye sakla
    echo "$repl_hash" > /tmp/.repl_hash
    chmod 600 /tmp/.repl_hash
}

step_openldap_base() {
    log STEP "ADIM 9/15: LDAP Base DN ve OU'lar"
    
    # Base DN var mı?
    if ldapsearch -x -H ldap://localhost -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" \
                  -b "$LDAP_BASE_DN" -s base 2>/dev/null | grep -q "^dn: $LDAP_BASE_DN"; then
        log SKIP "Base DN zaten mevcut."
    else
        local dc_value="${LDAP_BASE_DN#dc=}"
        dc_value="${dc_value%%,*}"
        log INFO "Base DN ve OU'lar oluşturuluyor..."
        ldapadd -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" >> "$LOG_FILE" 2>&1 <<EOF
dn: ${LDAP_BASE_DN}
objectClass: top
objectClass: dcObject
objectClass: organization
o: ${LDAP_ORGANIZATION}
dc: ${dc_value}

dn: ou=people,${LDAP_BASE_DN}
objectClass: organizationalUnit
ou: people

dn: ou=groups,${LDAP_BASE_DN}
objectClass: organizationalUnit
ou: groups

dn: ou=policies,${LDAP_BASE_DN}
objectClass: organizationalUnit
ou: policies
EOF
        log OK "Base DN ve OU'lar oluşturuldu."
    fi
}

step_openldap_schema_acl() {
    log STEP "ADIM 10/15: MTL Şeması, Replicator, Overlay'ler ve ACL'ler"
    
    # MTL şeması
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "cn=schema,cn=config" "(cn=*mtl-schema*)" cn 2>/dev/null | grep -q "mtl-schema"; then
        log SKIP "MTL şeması zaten yüklü."
    else
        log INFO "MTL özel şeması yükleniyor..."
        ldapadd -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                -f "${MTL_SOURCE_DIR}/schema/mtl-openldap-schema.ldif" >> "$LOG_FILE" 2>&1
        log OK "MTL şeması yüklendi."
    fi
    
    # mtlMfaSecret ACL'i
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "olcDatabase={1}mdb,cn=config" olcAccess 2>/dev/null | grep -q "mtlMfaSecret"; then
        log SKIP "mtlMfaSecret ACL zaten ekli."
    else
        cat > /tmp/mfa-acl.ldif <<'EOF'
dn: olcDatabase={1}mdb,cn=config
changetype: modify
add: olcAccess
olcAccess: {0}to attrs=mtlMfaSecret,mtlPasswordHistory by self write by * none
EOF
        ldapmodify -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                   -f /tmp/mfa-acl.ldif >> "$LOG_FILE" 2>&1
        log OK "mtlMfaSecret ACL eklendi."
    fi
    
    # Replicator hesabı
    if ldapsearch -LLL -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" \
                  -b "cn=replicator,${LDAP_BASE_DN}" -s base 2>/dev/null | grep -q "^dn:"; then
        log SKIP "Replicator hesabı zaten mevcut."
    else
        local repl_hash
        repl_hash=$(cat /tmp/.repl_hash 2>/dev/null || slappasswd -h '{SSHA}' -s "$REPLICATOR_PASSWORD")
        log INFO "Replicator hesabı oluşturuluyor..."
        ldapadd -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" >> "$LOG_FILE" 2>&1 <<EOF
dn: cn=replicator,${LDAP_BASE_DN}
objectClass: simpleSecurityObject
objectClass: organizationalRole
cn: replicator
userPassword: ${repl_hash}
description: MTL Sync Grid replikasyon servis hesabi
EOF
        log OK "Replicator hesabı oluşturuldu."
    fi
    
    # Replicator ACL'i
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "olcDatabase={1}mdb,cn=config" olcAccess 2>/dev/null | grep -q "replicator,${LDAP_BASE_DN}"; then
        log SKIP "Replicator ACL zaten ekli."
    else
        cat > /tmp/repl-acl.ldif <<EOF
dn: olcDatabase={1}mdb,cn=config
changetype: modify
add: olcAccess
olcAccess: {1}to dn.subtree="${LDAP_BASE_DN}"
  by dn.exact="cn=replicator,${LDAP_BASE_DN}" read
  by * break
EOF
        ldapmodify -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                   -f /tmp/repl-acl.ldif >> "$LOG_FILE" 2>&1
        log OK "Replicator ACL eklendi."
    fi
    
    # syncprov overlay
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "olcDatabase={1}mdb,cn=config" "(olcOverlay=syncprov)" 2>/dev/null | grep -q "syncprov"; then
        log SKIP "syncprov overlay zaten ekli."
    else
        cat > /tmp/syncprov.ldif <<'EOF'
dn: olcOverlay=syncprov,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcSyncProvConfig
olcOverlay: syncprov
olcSpCheckpoint: 100 10
olcSpSessionLog: 10000
EOF
        ldapadd -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                -f /tmp/syncprov.ldif >> "$LOG_FILE" 2>&1
        log OK "syncprov overlay eklendi."
    fi
    
    # accesslog overlay
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "olcDatabase={1}mdb,cn=config" "(olcOverlay=accesslog)" 2>/dev/null | grep -q "accesslog"; then
        log SKIP "accesslog overlay zaten ekli."
    else
        cat > /tmp/accesslog.ldif <<'EOF'
dn: olcOverlay=accesslog,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcAccessLogConfig
olcOverlay: accesslog
olcAccessLogDB: cn=accesslog
olcAccessLogOps: writes
olcAccessLogSuccess: TRUE
olcAccessLogPurge: 30+00:00 01+00:00
EOF
        ldapadd -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                -f /tmp/accesslog.ldif >> "$LOG_FILE" 2>&1
        log OK "accesslog overlay eklendi."
    fi
    
    # ppolicy overlay
    if ldapsearch -LLL -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                  -b "olcDatabase={1}mdb,cn=config" "(olcOverlay=ppolicy)" 2>/dev/null | grep -q "ppolicy"; then
        log SKIP "ppolicy overlay zaten ekli."
    else
        cat > /tmp/ppolicy-overlay.ldif <<EOF
dn: olcOverlay=ppolicy,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcPPolicyConfig
olcOverlay: ppolicy
olcPPolicyDefault: cn=default,ou=policies,${LDAP_BASE_DN}
olcPPolicyUseLockout: TRUE
olcPPolicyHashCleartext: TRUE
EOF
        ldapadd -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                -f /tmp/ppolicy-overlay.ldif >> "$LOG_FILE" 2>&1
        log OK "ppolicy overlay eklendi."
    fi
    
    # Default password policy entry
    if ldapsearch -LLL -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" \
                  -b "cn=default,ou=policies,${LDAP_BASE_DN}" -s base 2>/dev/null | grep -q "^dn:"; then
        log SKIP "Default password policy zaten mevcut."
    else
        log INFO "Default password policy ekleniyor..."
        ldapadd -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" >> "$LOG_FILE" 2>&1 <<EOF
dn: cn=default,ou=policies,${LDAP_BASE_DN}
objectClass: device
objectClass: pwdPolicy
cn: default
pwdAttribute: userPassword
pwdMinAge: 0
pwdMaxAge: 7776000
pwdInHistory: 5
pwdCheckQuality: 1
pwdMinLength: 8
pwdMaxFailure: 5
pwdLockout: TRUE
pwdLockoutDuration: 900
pwdGraceAuthnLimit: 0
pwdMustChange: TRUE
pwdAllowUserChange: TRUE
pwdSafeModify: FALSE
EOF
        log OK "Default password policy eklendi."
    fi
    
    # Temizlik
    rm -f /tmp/.repl_hash /tmp/mfa-acl.ldif /tmp/repl-acl.ldif /tmp/syncprov.ldif \
          /tmp/accesslog.ldif /tmp/ppolicy-overlay.ldif /tmp/slapd-init.ldif
}

step_tls_certs() {
    log STEP "ADIM 11/15: TLS Sertifikaları"
    
    mkdir -p /etc/mtl/ssl
    cd /etc/mtl/ssl
    
    # CA
    if [[ -f mtl-ca.pem && -f mtl-ca.key ]]; then
        log SKIP "MTL CA sertifikası zaten mevcut."
    else
        log INFO "MTL Root CA üretiliyor (10 yıl)..."
        openssl genrsa -out mtl-ca.key 4096 >> "$LOG_FILE" 2>&1
        openssl req -x509 -new -nodes -key mtl-ca.key -sha256 -days 3650 \
            -subj "/C=TR/O=${LDAP_ORGANIZATION}/CN=${LDAP_ORGANIZATION} Root CA" \
            -out mtl-ca.pem >> "$LOG_FILE" 2>&1
        log OK "MTL Root CA üretildi."
    fi
    
    # Master sertifikası
    if [[ -f server.pem && -f server.key ]]; then
        log SKIP "Master server sertifikası zaten mevcut."
    else
        log INFO "Master server sertifikası üretiliyor..."
        openssl genrsa -out server.key 4096 >> "$LOG_FILE" 2>&1
        openssl req -new -key server.key \
            -subj "/C=TR/O=${LDAP_ORGANIZATION}/CN=${MASTER_HOSTNAME}" \
            -out server.csr >> "$LOG_FILE" 2>&1
        
        cat > server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${MASTER_HOSTNAME}
DNS.2 = ${MASTER_HOSTNAME%%.*}
IP.1  = ${MASTER_IP}
IP.2  = 127.0.0.1
EOF
        
        openssl x509 -req -in server.csr -CA mtl-ca.pem -CAkey mtl-ca.key \
            -CAcreateserial -out server.pem -days 1825 -sha256 \
            -extfile server.ext >> "$LOG_FILE" 2>&1
        log OK "Master sertifikası üretildi."
    fi
    
    # Slave sertifikası (gelecek için hazır)
    if [[ -f slave-server.pem && -f slave-server.key ]]; then
        log SKIP "Slave server sertifikası zaten mevcut."
    else
        log INFO "Slave server sertifikası üretiliyor (slave için sonra kullanılacak)..."
        openssl genrsa -out slave-server.key 4096 >> "$LOG_FILE" 2>&1
        openssl req -new -key slave-server.key \
            -subj "/C=TR/O=${LDAP_ORGANIZATION}/CN=${SLAVE_HOSTNAME}" \
            -out slave-server.csr >> "$LOG_FILE" 2>&1
        
        cat > slave-server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${SLAVE_HOSTNAME}
DNS.2 = ${SLAVE_HOSTNAME%%.*}
IP.1  = ${SLAVE_IP}
IP.2  = 127.0.0.1
EOF
        
        openssl x509 -req -in slave-server.csr -CA mtl-ca.pem -CAkey mtl-ca.key \
            -CAcreateserial -out slave-server.pem -days 1825 -sha256 \
            -extfile slave-server.ext >> "$LOG_FILE" 2>&1
        log OK "Slave sertifikası üretildi (slave kurulumunda kullanılacak)."
    fi
    
    # --- Public (Sectigo vb.) cert override: PUBLIC_CERT_PATH/PUBLIC_KEY_PATH verilirse ---
    if [[ -n "${PUBLIC_CERT_PATH:-}" && -n "${PUBLIC_KEY_PATH:-}" \
          && -f "${PUBLIC_CERT_PATH}" && -f "${PUBLIC_KEY_PATH}" ]]; then
        log INFO "Public sertifika kuruluyor (slapd+nginx tam zincir)..."
        cp -f "${PUBLIC_CERT_PATH}" /etc/mtl/ssl/server.pem
        cp -f "${PUBLIC_KEY_PATH}"  /etc/mtl/ssl/server.key
        log OK "Public sertifika server.pem/server.key olarak kuruldu."
    fi

    # --- ldap-trust.pem: ic CA + sistem ca-bundle (app/consumer dogrulamasi) ---
    if [[ -f /etc/pki/tls/certs/ca-bundle.crt ]]; then
        cat /etc/mtl/ssl/mtl-ca.pem /etc/pki/tls/certs/ca-bundle.crt > /etc/mtl/ssl/ldap-trust.pem
    else
        cp -f /etc/mtl/ssl/mtl-ca.pem /etc/mtl/ssl/ldap-trust.pem
    fi
    log OK "ldap-trust.pem uretildi (mtl-ca + ca-bundle)."

    chown -R ldap:ldap /etc/mtl/ssl
    chmod 0644 /etc/mtl/ssl/*.pem
    chmod 0600 /etc/mtl/ssl/*.key
    
    # CA'yı sistem güvenine ekle
    if [[ ! -f /etc/pki/ca-trust/source/anchors/mtl-ca.pem ]]; then
        cp /etc/mtl/ssl/mtl-ca.pem /etc/pki/ca-trust/source/anchors/mtl-ca.pem
        update-ca-trust extract
        log OK "MTL CA sistem güvenine eklendi."
    else
        log SKIP "MTL CA zaten sistem güvenine ekli."
    fi
    
    # LDAPS aktif mi?
    if slapcat -F /etc/openldap/slapd.d/ -b cn=config 2>/dev/null | grep -q "olcTLSCertificateFile"; then
        log SKIP "LDAPS zaten aktif."
    else
        log INFO "slapd'ye TLS yapılandırması ekleniyor..."
        cat > /tmp/tls-config.ldif <<'EOF'
dn: cn=config
changetype: modify
add: olcTLSCertificateFile
olcTLSCertificateFile: /etc/mtl/ssl/server.pem
-
add: olcTLSCertificateKeyFile
olcTLSCertificateKeyFile: /etc/mtl/ssl/server.key
-
add: olcTLSCACertificateFile
olcTLSCACertificateFile: /etc/mtl/ssl/mtl-ca.pem
EOF
        ldapmodify -x -D "cn=admin,cn=config" -w "$LDAP_CONFIG_PASSWORD" -H ldap://localhost \
                   -f /tmp/tls-config.ldif >> "$LOG_FILE" 2>&1
        systemctl restart slapd
        sleep 2
        log OK "LDAPS aktive edildi, slapd yeniden başlatıldı."
    fi
    rm -f /tmp/tls-config.ldif
    
    # LDAPS testi
    if ldapsearch -H "ldaps://${MASTER_HOSTNAME}:636" -D "cn=admin,${LDAP_BASE_DN}" \
                  -w "$LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s base 2>/dev/null | grep -q "^dn:"; then
        log OK "LDAPS bağlantı testi başarılı."
    else
        log WARN "LDAPS bağlantı testi başarısız. Log: $LOG_FILE"
    fi
}

step_test_user() {
    log STEP "ADIM 12/15: Test LDAP Kullanıcısı"
    
    if ldapsearch -LLL -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" \
                  -b "uid=testuser,ou=people,${LDAP_BASE_DN}" -s base 2>/dev/null | grep -q "^dn:"; then
        log SKIP "Test kullanıcısı zaten mevcut."
    else
        local test_hash
        test_hash=$(slappasswd -h '{SSHA}' -s 'TestParola123!')
        log INFO "Test kullanıcısı oluşturuluyor (uid=testuser)..."
        ldapadd -x -D "cn=admin,${LDAP_BASE_DN}" -w "$LDAP_ADMIN_PASSWORD" >> "$LOG_FILE" 2>&1 <<EOF
dn: uid=testuser,ou=people,${LDAP_BASE_DN}
objectClass: inetOrgPerson
objectClass: mtlPersonExtension
uid: testuser
cn: Test Kullanici
sn: Kullanici
givenName: Test
displayName: Test Kullanici
mail: testuser@${LDAP_BASE_DN#dc=}
mail: testuser@$(echo ${LDAP_BASE_DN} | sed 's/dc=//g;s/,/./g')
telephoneNumber: +90 555 000 0000
userPassword: ${test_hash}
mtlMfaEnabled: FALSE
mtlPreferredLanguage: tr
mtlSecurityFlags: ACTIVE
EOF
        log OK "Test kullanıcısı oluşturuldu (parola: TestParola123!)."
    fi
}

step_mtl_user_env() {
    log STEP "ADIM 13/15: MTL Kullanıcı, Dizinler ve Env Dosyası"
    
    # mtl kullanıcısı
    if ! id mtl &>/dev/null; then
        useradd --system --shell /bin/false --home /opt/mtl --create-home mtl
        log OK "mtl sistem kullanıcısı oluşturuldu."
    else
        log SKIP "mtl kullanıcısı zaten mevcut."
    fi
    
    # Dizinler
    mkdir -p /etc/mtl /opt/mtl /var/lib/mtl/backups /var/log/mtl /opt/mtl/scripts
    chown -R mtl:mtl /etc/mtl /opt/mtl /var/lib/mtl /var/log/mtl
    # /etc/mtl 0750: yalnız sahibi (mtl) + grubu girebilir; env dosyasi yine 0600 ile gizli kalir.
    chmod 0750 /etc/mtl
    chmod 0750 /var/lib/mtl/backups

    # --- TLS dizin-geçiş düzeltmesi (1 Haziran sahadaki tuzak) ---
    # slapd "ldap" kullanicisi olarak calisir ve /etc/mtl/ssl altindaki sertifika+anahtari
    # okumak zorunda. Yukaridaki chown ile /etc/mtl 0750 mtl:mtl oldugundan, "ldap"i mtl
    # grubuna ekleyip SSL dizinine grup-okuma/gecis veriyoruz. Aksi halde ilk kurulum
    # sonrasi HER slapd restart'inda TLS "Permission denied" alinir.
    if id ldap &>/dev/null; then
        usermod -aG mtl ldap 2>/dev/null || true
        log OK "ldap kullanicisi mtl grubuna eklendi (TLS dizin-gecis izni)."
    fi
    if [[ -d /etc/mtl/ssl ]]; then
        chown -R mtl:mtl /etc/mtl/ssl
        chmod 0750 /etc/mtl/ssl
        chmod 0644 /etc/mtl/ssl/*.pem 2>/dev/null || true
        chmod 0640 /etc/mtl/ssl/*.key 2>/dev/null || true
    fi
    
    # Env dosyası
    if [[ -f /etc/mtl/mtl-ldap-admin.env ]]; then
        log SKIP "Env dosyası zaten mevcut: /etc/mtl/mtl-ldap-admin.env"
    else
        log INFO "MTL env dosyası oluşturuluyor..."
        cat > /etc/mtl/mtl-ldap-admin.env <<EOF
# ===== MTL LDAP Admin — Master Profile =====
# Üretildi: $(date)

MTL_NODE_ID=${MASTER_HOSTNAME%%.*}
MTL_PROFILE=MASTER
MTL_SECRET_KEY=${SECRET_KEY}
MTL_FERNET_KEY=${FERNET_KEY}
MTL_LISTEN_HOST=127.0.0.1
MTL_LISTEN_PORT=8000

# Veritabanı
MTL_DB_URL=postgresql+asyncpg://mtl_admin:${PG_PASSWORD}@127.0.0.1:5432/mtl_admin

# Redis
MTL_REDIS_URL=redis://:${REDIS_PASSWORD}@127.0.0.1:6379/0

# LDAP
MTL_LDAP_URL=ldaps://127.0.0.1:636
MTL_LDAP_BIND_DN=cn=admin,${LDAP_BASE_DN}
MTL_LDAP_BIND_PASSWORD=${LDAP_ADMIN_PASSWORD}
MTL_LDAP_BASE_DN=${LDAP_BASE_DN}
MTL_LDAP_CA_PATH=/etc/mtl/ssl/ldap-trust.pem
MTL_LDAP_TLS_VERIFY=true

# Cluster
MTL_CLUSTER_SECRET=${CLUSTER_SECRET}

# Bootstrap admin
MTL_BOOTSTRAP_ADMIN_USERNAME=${BOOTSTRAP_ADMIN_USERNAME}
MTL_BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_ADMIN_PASSWORD}
MTL_BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL}
EOF
        chown mtl:mtl /etc/mtl/mtl-ldap-admin.env
        chmod 0600 /etc/mtl/mtl-ldap-admin.env
        log OK "Env dosyası: /etc/mtl/mtl-ldap-admin.env"
    fi
    
    # Secrets özeti (root için)
    cat > /root/mtl-secrets.txt <<EOF
===== MTL SECRETS — ÖNEMLİ, KAYBETMEYIN =====
Üretildi: $(date)

Master Sunucu  : ${MASTER_HOSTNAME} (${MASTER_IP})
Slave Sunucu   : ${SLAVE_HOSTNAME} (${SLAVE_IP})

LDAP Base DN   : ${LDAP_BASE_DN}
LDAP Admin     : cn=admin,${LDAP_BASE_DN} / ${LDAP_ADMIN_PASSWORD}
LDAP Config    : cn=admin,cn=config / ${LDAP_CONFIG_PASSWORD}
LDAP Replicator: cn=replicator,${LDAP_BASE_DN} / ${REPLICATOR_PASSWORD}

PostgreSQL     : mtl_admin / ${PG_PASSWORD}
Redis          : ${REDIS_PASSWORD}

Bootstrap Admin: ${BOOTSTRAP_ADMIN_USERNAME} / ${BOOTSTRAP_ADMIN_PASSWORD}
Email          : ${BOOTSTRAP_ADMIN_EMAIL}

SECRET_KEY     : ${SECRET_KEY}
FERNET_KEY     : ${FERNET_KEY}
CLUSTER_SECRET : ${CLUSTER_SECRET}

==== SLAVE KURULUMU İÇİN ÖNEMLİ ====
Slave'de şu değerler AYNI olmalı:
  - REPLICATOR_PASSWORD = ${REPLICATOR_PASSWORD}
  - CLUSTER_SECRET      = ${CLUSTER_SECRET}

Slave'e kopyalanacak dosyalar:
  - /etc/mtl/ssl/mtl-ca.pem
  - /etc/mtl/ssl/slave-server.pem -> /etc/mtl/ssl/server.pem
  - /etc/mtl/ssl/slave-server.key -> /etc/mtl/ssl/server.key
EOF
    chmod 600 /root/mtl-secrets.txt
    log OK "Secrets özet dosyası: /root/mtl-secrets.txt"
    
    # Cluster node tablosuna kayıt
    log INFO "Cluster node tablosu güncelleniyor..."
    PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin >> "$LOG_FILE" 2>&1 <<EOF
INSERT INTO mtl_core.cluster_node 
    (node_id, role, host, ldap_port, ldaps_port, api_url, health_status, is_self)
VALUES 
    ('${MASTER_HOSTNAME%%.*}', 'MASTER', '${MASTER_HOSTNAME}', 389, 636, 
     'https://${MASTER_HOSTNAME}', 'HEALTHY', true),
    ('${SLAVE_HOSTNAME%%.*}',  'SLAVE',  '${SLAVE_HOSTNAME}',  389, 636, 
     'https://${SLAVE_HOSTNAME}',  'UNKNOWN', false)
ON CONFLICT (node_id) DO UPDATE SET
    role = EXCLUDED.role,
    host = EXCLUDED.host,
    api_url = EXCLUDED.api_url;
EOF
    log OK "Cluster node kayıtları eklendi."
}

step_nginx() {
    log STEP "ADIM 14/15: Nginx Kurulumu"
    
    if rpm -q nginx >/dev/null 2>&1; then
        log SKIP "Nginx zaten kurulu."
    else
        log INFO "Nginx kuruluyor..."
        dnf install -y nginx >> "$LOG_FILE" 2>&1
        systemctl enable nginx >> "$LOG_FILE" 2>&1
        log OK "Nginx kuruldu."
    fi
    
    # Default'ları temizle ve temiz nginx.conf yaz
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
    
    # MTL config'i kopyala
    rm -f /etc/nginx/conf.d/default.conf
    cp "${MTL_SOURCE_DIR}/deployment/nginx/mtl-ldap-admin.conf" \
       /etc/nginx/conf.d/mtl-ldap-admin.conf
    
    # Hostname'i config'e yaz
    sed -i "s/mtl-master-01.mtl.local/${MASTER_HOSTNAME}/g" /etc/nginx/conf.d/mtl-ldap-admin.conf
    
    # Nginx 1.20 uyumluluk: 'http2 on' direktifi yok, 'listen ... ssl http2' kullan
    sed -i 's|^    listen 443 ssl;|    listen 443 ssl http2;|' /etc/nginx/conf.d/mtl-ldap-admin.conf
    sed -i 's|^    listen \[::\]:443 ssl;|    listen [::]:443 ssl http2;|' /etc/nginx/conf.d/mtl-ldap-admin.conf
    sed -i '/^    http2 on;$/d' /etc/nginx/conf.d/mtl-ldap-admin.conf
    
    # ssl_stapling self-signed CA ile çalışmaz, kaldır
    sed -i '/ssl_stapling/d' /etc/nginx/conf.d/mtl-ldap-admin.conf
    
    # Frontend placeholder
    mkdir -p /opt/mtl/frontend/console/dist
    cat > /opt/mtl/frontend/console/dist/index.html <<EOF
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MTL LDAP Admin</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
       background: #f3f4f6; color: #0f172a; margin: 0; padding: 50px; line-height: 1.6; }
.brand { color: #2563eb; margin: 0 0 16px 0; }
.sub { color: #64748b; margin-top: 24px; font-size: 14px; }
code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style>
</head>
<body>
<h1 class="brand">MTL LDAP Admin</h1>
<p>Frontend yükleniyor. Backend API <code>/api/v1/</code> altında.</p>
<p class="sub">Bu placeholder sayfasıdır — gerçek frontend kodu deploy edildiğinde otomatik değişecek.</p>
<p class="sub">Sunucu: <code>${MASTER_HOSTNAME}</code></p>
</body>
</html>
EOF
    chown -R mtl:mtl /opt/mtl/frontend
    chmod 755 /opt /opt/mtl /opt/mtl/frontend /opt/mtl/frontend/console /opt/mtl/frontend/console/dist
    chmod 644 /opt/mtl/frontend/console/dist/index.html
    
    # Nginx test
    if nginx -t >> "$LOG_FILE" 2>&1; then
        log OK "Nginx yapılandırma testi başarılı."
    else
        die "Nginx yapılandırma testi başarısız. Log: $LOG_FILE"
    fi
    
    systemctl restart nginx
    sleep 2
    
    if systemctl is-active nginx >/dev/null; then
        log OK "Nginx çalışıyor."
    else
        die "Nginx başlatılamadı."
    fi
}

step_systemd_scripts() {
    log STEP "ADIM 15/15: systemd Unit'leri ve Failover Script'leri"
    
    # systemd unit'leri
    log INFO "systemd unit dosyaları yerleştiriliyor..."
    for unit in mtl-ldap-admin.service mtl-ldap-admin-worker.service mtl-ldap-admin-beat.service; do
        cp "${MTL_SOURCE_DIR}/deployment/systemd/${unit}" /etc/systemd/system/
    done
    systemctl daemon-reload
    log OK "systemd unit'leri yerleştirildi (backend kodu deploy edilince enable edilebilir)."
    
    # Failover script'leri
    log INFO "Failover script'leri yerleştiriliyor..."
    cp "${MTL_SOURCE_DIR}/scripts/"*.sh /opt/mtl/scripts/
    chmod +x /opt/mtl/scripts/*.sh
    
    # Rocky 9 yollarına uyarla
    for f in /opt/mtl/scripts/mtl-failover-*.sh; do
        sed -i 's|/etc/ldap/slapd.d|/etc/openldap/slapd.d|g' "$f"
    done
    log OK "Failover script'leri yerleştirildi ve Rocky 9 yollarına uyarlandı."
    
    # SELinux kalıcı context'leri
    log INFO "SELinux kalıcı context kuralları ekleniyor..."
    semanage fcontext -a -t httpd_sys_content_t "/opt/mtl/frontend(/.*)?" 2>/dev/null || true
    restorecon -Rv /opt/mtl/frontend/ >> "$LOG_FILE" 2>&1 || true

    # slapd accesslog custom path -> slapd_db_t (yoksa slapd restart Permission denied)
    semanage fcontext -a -t slapd_db_t "/var/lib/ldap-accesslog(/.*)?" 2>/dev/null || true
    restorecon -Rv /var/lib/ldap-accesslog/ >> "$LOG_FILE" 2>&1 || true
    
    # SELinux boolean'ları
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    setsebool -P httpd_read_user_content 1 2>/dev/null || true
    setsebool -P nis_enabled 1 2>/dev/null || true

    # --- MTL Shield cert-apply altyapisi (UI-driven TLS cert rotasyonu) ---
    # Kaynak dosyalar bundle'da deployment/shield/ altinda; installer konumundan turetilir.
    _shield_src="$(cd "$(dirname "${BASH_SOURCE[0]}")/../deployment/shield" 2>/dev/null && pwd)"
    if [[ -n "${_shield_src:-}" && -f "$_shield_src/mtl-cert-apply" ]]; then
        log INFO "Shield cert-apply altyapisi kuruluyor..."
        install -d -o root -g root -m 0750 /opt/mtl/bin
        install -o root -g root -m 0750 "$_shield_src/mtl-cert-apply"        /opt/mtl/bin/mtl-cert-apply
        install -o root -g root -m 0750 "$_shield_src/mtl-cert-apply-runner" /opt/mtl/bin/mtl-cert-apply-runner
        install -d -o mtl -g mtl -m 0750 /var/lib/mtl/shield /var/lib/mtl/shield/queue
        command -v restorecon >/dev/null 2>&1 && restorecon -Rv /var/lib/mtl/shield >> "$LOG_FILE" 2>&1 || true
        install -o root -g root -m 0644 "$_shield_src/mtl-cert-apply.path"    /etc/systemd/system/mtl-cert-apply.path
        install -o root -g root -m 0644 "$_shield_src/mtl-cert-apply.service" /etc/systemd/system/mtl-cert-apply.service
        systemctl daemon-reload
        systemctl enable --now mtl-cert-apply.path >> "$LOG_FILE" 2>&1 || true
        log OK "Shield cert-apply altyapisi kuruldu (helper+runner+systemd+queue)."
    else
        log WARN "Shield cert-apply kaynaklari yok (${_shield_src:-bulunamadi}) — atlandi."
    fi
    log OK "SELinux yapılandırması güncellendi."
    
    # Enforcing'e geri al
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
    echo "1. SELinux"
    echo "   $(getenforce)"
    
    echo
    echo "2. Servisler"
    for s in postgresql-16 redis slapd nginx firewalld; do
        printf "   %-15s : %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null || echo 'unknown')"
    done
    
    echo
    echo "3. PostgreSQL"
    local roles perms nodes
    roles=$(PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin -tAc \
            "SELECT count(*) FROM mtl_core.role" 2>/dev/null || echo "?")
    perms=$(PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin -tAc \
            "SELECT count(*) FROM mtl_core.permission" 2>/dev/null || echo "?")
    nodes=$(PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U mtl_admin -d mtl_admin -tAc \
            "SELECT count(*) FROM mtl_core.cluster_node" 2>/dev/null || echo "?")
    echo "   Roller    : $roles"
    echo "   Yetkiler  : $perms"
    echo "   Node'lar  : $nodes"
    
    echo
    echo "4. LDAP"
    local csn entries
    csn=$(ldapsearch -x -H "ldaps://localhost:636" -D "cn=admin,${LDAP_BASE_DN}" \
                     -w "$LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s base contextCSN 2>/dev/null \
                     | grep "^contextCSN:" | awk '{print $2}' || echo "?")
    entries=$(ldapsearch -x -H "ldaps://localhost:636" -D "cn=admin,${LDAP_BASE_DN}" \
                         -w "$LDAP_ADMIN_PASSWORD" -b "$LDAP_BASE_DN" -s sub dn 2>/dev/null \
                         | grep -c "^dn:" || echo "?")
    echo "   contextCSN: $csn"
    echo "   Entry sayısı: $entries"
    
    echo
    echo "5. Nginx"
    local https_code redirect_code
    https_code=$(curl -sk -o /dev/null -w "%{http_code}" "https://${MASTER_HOSTNAME}/" || echo "?")
    redirect_code=$(curl -s -o /dev/null -w "%{http_code}" "http://${MASTER_HOSTNAME}/" || echo "?")
    echo "   HTTPS GET / : HTTP $https_code"
    echo "   HTTP redirect: HTTP $redirect_code"
    
    echo
    echo "6. Dosyalar"
    echo "   Env       : /etc/mtl/mtl-ldap-admin.env"
    echo "   Secrets   : /root/mtl-secrets.txt"
    echo "   Sertifika : /etc/mtl/ssl/"
    echo "   Backups   : /var/lib/mtl/backups/"
    echo "   Script'ler: /opt/mtl/scripts/"
    echo "   Frontend  : /opt/mtl/frontend/console/dist/"
    echo "   Log       : $LOG_FILE"
    
    echo
    echo "7. Slave kurulumu için ihtiyaç duyulanlar"
    echo "   CA sertifikası      : /etc/mtl/ssl/mtl-ca.pem"
    echo "   Slave sertifikası   : /etc/mtl/ssl/slave-server.pem"
    echo "   Slave özel anahtar  : /etc/mtl/ssl/slave-server.key"
    echo "   Replicator parolası : ${REPLICATOR_PASSWORD}"
    echo "   Cluster secret      : ${CLUSTER_SECRET}"
    
    echo
    log OK "Master kurulumu başarıyla tamamlandı."
    echo
    echo "Tarayıcıdan: https://${MASTER_HOSTNAME}/"
    echo "Bootstrap admin: ${BOOTSTRAP_ADMIN_USERNAME} / (mtl-secrets.txt'e bakın)"
    echo
}

# ============================================================================
# Ana Akış
# ============================================================================

main() {
    # Banner
    cat <<'BANNER'

╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   MTL LDAP Admin — Master Kurulum Script'i                   ║
║   Rocky Linux 9 | OpenLDAP 2.6 | PostgreSQL 16 | Redis 7     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

BANNER
    
    require_root
    require_rocky9
    
    # Log dosyasını başlat
    : > "$LOG_FILE"
    chmod 600 "$LOG_FILE"
    log INFO "Kurulum başlıyor — log: $LOG_FILE"
    
    parse_args "$@"
    collect_config
    
    step_system_prep
    step_firewall
    step_selinux_permissive
    step_postgresql
    step_redis
    step_openldap_install
    step_openldap_config
    step_openldap_base
    step_openldap_schema_acl
    step_tls_certs
    step_test_user
    step_mtl_user_env
    step_nginx
    step_systemd_scripts
    
    print_summary
}

main "$@"
