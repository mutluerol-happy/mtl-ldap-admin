#!/usr/bin/env bash
# ============================================================================
# MTL LDAP Admin — Uygulama Deploy (Faz B)
# ============================================================================
# Installer (master VEYA slave) çalıştıktan SONRA, YENİ kutuda çalıştırılır.
# Yapar:
#   1) Backend kodunu MTL_SOURCE_DIR/backend -> /opt/mtl/app
#   2) Python 3.12 venv (/opt/mtl/venv) + requirements.txt
#   3) Frontend'i doğru profille (MASTER/SLAVE) build -> /opt/mtl/web/public
#   4) systemd servislerini enable + start
#
# Profil env dosyasından OTOMATİK algılanır:
#   /etc/mtl/mtl-ldap-admin.env  -> MASTER
#   /etc/mtl/mtl-ldap.env        -> SLAVE
#
# Çalıştırma:
#   bash mtl-deploy-app.sh
#   bash mtl-deploy-app.sh --source /opt/mtl-source/mtl-ldap-admin
#   bash mtl-deploy-app.sh --profile SLAVE   (env algılanamazsa elle)
# ============================================================================
set -euo pipefail

SOURCE_DIR="/opt/mtl-source/mtl-ldap-admin"
APP_DIR="/opt/mtl/app"
VENV="/opt/mtl/venv"
WEB_SRC="/opt/mtl/web/src-tree"
WEB_PUBLIC="/opt/mtl/frontend/console/dist"
API_BASE="/api/v1"
PROFILE_OVERRIDE=""
PY="python3.12"

ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
info(){ printf '\033[36m▸ %s\033[0m\n' "$*"; }
warn(){ printf '\033[33m! %s\033[0m\n' "$*"; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source|-s) SOURCE_DIR="$2"; shift 2 ;;
        --profile|-p) PROFILE_OVERRIDE="$2"; shift 2 ;;
        --help|-h) sed -n '2,30p' "$0"; exit 0 ;;
        *) die "Bilinmeyen argüman: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "root olarak çalıştırın."
[[ -d "$SOURCE_DIR/backend/app" ]] || die "Backend kaynağı yok: $SOURCE_DIR/backend/app (bundle açıldı mı?)"
[[ -f "$SOURCE_DIR/frontend/package.json" ]] || die "Frontend kaynağı yok: $SOURCE_DIR/frontend"
id mtl &>/dev/null || die "mtl kullanıcısı yok — önce installer'ı çalıştırın."

# --- Profil algıla ---
ENV_FILE=""; PROFILE=""
if [[ -f /etc/mtl/mtl-ldap-admin.env ]]; then ENV_FILE=/etc/mtl/mtl-ldap-admin.env
elif [[ -f /etc/mtl/mtl-ldap.env ]]; then ENV_FILE=/etc/mtl/mtl-ldap.env
fi
if [[ -n "$PROFILE_OVERRIDE" ]]; then
    PROFILE="$PROFILE_OVERRIDE"
elif [[ -n "$ENV_FILE" ]]; then
    PROFILE="$(grep -E '^MTL_PROFILE=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '[:space:]')"
fi
[[ -z "$PROFILE" ]] && die "Profil algılanamadı. --profile MASTER|SLAVE verin (env: ${ENV_FILE:-yok})."
info "Profil: $PROFILE   (env: ${ENV_FILE:-elle})"

# ============================================================================
# 1) Backend kodu
# ============================================================================
info "1/5  Backend kodu -> $APP_DIR"
command -v rsync >/dev/null || dnf install -y rsync >/dev/null 2>&1 || true
mkdir -p "$APP_DIR"
rsync -a --exclude='__pycache__' --exclude='*.pyc' --exclude='*.bak' --exclude='*.bak.*' \
    "$SOURCE_DIR/backend/" "$APP_DIR/"
chown -R mtl:mtl "$APP_DIR"
[[ -f "$APP_DIR/requirements.txt" ]] || die "requirements.txt yok: $APP_DIR"
ok "backend yerleştirildi"

# ============================================================================
# 2) Python 3.12 venv + bağımlılıklar
# ============================================================================
info "2/5  Python venv + requirements"
if ! command -v "$PY" >/dev/null; then
    info "python3.12 kuruluyor..."
    dnf install -y python3.12 python3.12-devel gcc >/dev/null 2>&1 \
        || die "python3.12 kurulamadı (repo erişimi?)"
fi
if [[ ! -x "$VENV/bin/python" ]]; then
    info "venv oluşturuluyor: $VENV"
    sudo -u mtl "$PY" -m venv "$VENV" || die "venv oluşturulamadı"
fi
sudo -u mtl "$VENV/bin/pip" install --upgrade pip wheel >/dev/null 2>&1 || warn "pip upgrade atlandı"
info "pip install -r requirements.txt (biraz sürebilir)..."
sudo -u mtl "$VENV/bin/pip" install -r "$APP_DIR/requirements.txt" \
    || die "pip install başarısız (derleme bağımlılığı gerekiyorsa loga bakın)"
chown -R mtl:mtl "$VENV"
ok "venv hazır ($("$VENV/bin/python" --version 2>&1))"

# ============================================================================
# 3) Frontend build (profile göre) -> public
# ============================================================================
info "3/5  Frontend build (VITE_MTL_PROFILE=$PROFILE)"
if ! command -v node >/dev/null; then
    info "Node.js kuruluyor (nodejs:20)..."
    dnf module reset -y nodejs >/dev/null 2>&1 || true
    dnf module install -y nodejs:20 >/dev/null 2>&1 || dnf install -y nodejs npm >/dev/null 2>&1 \
        || die "Node.js kurulamadı"
fi
mkdir -p "$WEB_SRC"
rsync -a --exclude='node_modules' --exclude='dist' --exclude='*.bak' --exclude='*.bak.*' \
    "$SOURCE_DIR/frontend/" "$WEB_SRC/"
chown -R mtl:mtl "$WEB_SRC"

cd "$WEB_SRC"
info "npm ci..."
if [[ -f package-lock.json ]]; then
    sudo -u mtl npm ci >/dev/null 2>&1 || sudo -u mtl npm install >/dev/null 2>&1 || die "npm ci/install başarısız"
else
    sudo -u mtl npm install >/dev/null 2>&1 || die "npm install başarısız"
fi
info "npm run build..."
rm -rf "$WEB_SRC/dist"
sudo -u mtl --preserve-env=VITE_API_BASE_URL,VITE_MTL_PROFILE \
    VITE_API_BASE_URL="$API_BASE" VITE_MTL_PROFILE="$PROFILE" npm run build \
    || die "frontend build başarısız"
[[ -f "$WEB_SRC/dist/index.html" ]] || die "build çıktısı yok (dist/index.html)"

# public'e güvenli kopya (boş kaynaktan silme kazası olmasın)
mkdir -p "$WEB_PUBLIC"
rsync -a --delete "$WEB_SRC/dist/" "$WEB_PUBLIC/"
chown -R mtl:mtl "$WEB_PUBLIC"
find "$WEB_PUBLIC" -type d -exec chmod 755 {} \;
find "$WEB_PUBLIC" -type f -exec chmod 644 {} \;
command -v restorecon >/dev/null && restorecon -R "$WEB_PUBLIC" >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx
ok "frontend yayında -> $WEB_PUBLIC"

# ============================================================================
# 4) Servisler
# ============================================================================
info "4/5  systemd servisleri enable + start"
systemctl daemon-reload
for svc in mtl-ldap-admin mtl-ldap-admin-worker mtl-ldap-admin-beat; do
    if [[ -f "/etc/systemd/system/${svc}.service" ]]; then
        systemctl enable "$svc" >/dev/null 2>&1 || true
        systemctl restart "$svc" || warn "$svc başlatılamadı (journalctl -u $svc)"
    else
        warn "Unit yok: ${svc}.service (installer çalıştı mı?)"
    fi
done
sleep 3
ok "servis komutları gönderildi"

# ============================================================================
# 5) Özet / doğrulama
# ============================================================================
info "5/5  Durum"
echo
for svc in mtl-ldap-admin mtl-ldap-admin-worker mtl-ldap-admin-beat nginx; do
    printf "   %-25s : %s\n" "$svc" "$(systemctl is-active "$svc" 2>/dev/null || echo unknown)"
done
echo
HOST="$(hostname -f 2>/dev/null || hostname)"
api_code=$(curl -sk -o /dev/null -w "%{http_code}" "https://${HOST}${API_BASE}/health" 2>/dev/null || echo "?")
front_code=$(curl -sk -o /dev/null -w "%{http_code}" "https://${HOST}/" 2>/dev/null || echo "?")
echo "   API   ${API_BASE}/health : HTTP $api_code"
echo "   Front /                  : HTTP $front_code"
echo
if [[ "$PROFILE" == "MASTER" ]]; then
    echo "   Bootstrap admin ilk açılışta env'deki MTL_BOOTSTRAP_ADMIN_* ile oluşur."
    echo "   Giriş: https://${HOST}/"
else
    echo "   SLAVE: parola-reset portali. Giriş: https://${HOST}/"
fi
echo
ok "Uygulama deploy tamam (profil: $PROFILE)."
echo "Servis logu: journalctl -u mtl-ldap-admin -f"
