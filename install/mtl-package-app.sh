#!/usr/bin/env bash
# ============================================================================
# MTL LDAP Admin — Uygulama Paketleyici (Faz A)
# ============================================================================
# ÇALIŞAN master'da çalıştırılır. Backend + frontend + kaynak dosyalarını
# tek bir dağıtılabilir bundle tarball'ına toplar. Yeni ortama bu tarball
# taşınır ve installer + mtl-deploy-app.sh ile kurulur.
#
# Bundle yapısı (= yeni ortamdaki MTL_SOURCE_DIR):
#   mtl-ldap-admin/
#     backend/      <- /opt/mtl/app        (app/, migrations/, requirements.txt, pyproject.toml)
#     frontend/     <- /opt/mtl/web/src-tree (node_modules + dist HARİÇ)
#     schema/       <- mevcut kaynak (PostgreSQL + LDAP şema)
#     deployment/   <- nginx + systemd
#     scripts/      <- failover vb.
#     install/      <- installer'lar (varsa)
#
# Çalıştırma:  bash mtl-package-app.sh
# ============================================================================
set -euo pipefail

BACKEND_SRC="/opt/mtl/app"
FRONTEND_SRC="/opt/mtl/web/src-tree"
SOURCE_DIR="/opt/mtl-source/mtl-ldap-admin"
TS="$(date +%Y%m%d-%H%M%S)"
STAGE="/tmp/mtl-bundle-$TS"
PKG="mtl-ldap-admin"
OUT="/tmp/mtl-app-bundle-$TS.tar.gz"

ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
info(){ printf '\033[36m▸ %s\033[0m\n' "$*"; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root olarak çalıştırın."
command -v rsync >/dev/null || { info "rsync kuruluyor..."; dnf install -y rsync >/dev/null 2>&1 || die "rsync kurulamadı"; }
[[ -d "$BACKEND_SRC/app" ]] || die "Backend bulunamadı: $BACKEND_SRC/app"
[[ -f "$BACKEND_SRC/requirements.txt" ]] || die "requirements.txt yok: $BACKEND_SRC"
[[ -f "$FRONTEND_SRC/package.json" ]] || die "frontend package.json yok: $FRONTEND_SRC"
[[ -d "$SOURCE_DIR/schema" ]] || die "Kaynak şema dizini yok: $SOURCE_DIR/schema"

info "Staging dizini: $STAGE/$PKG"
rm -rf "$STAGE"; mkdir -p "$STAGE/$PKG"

# --- Mevcut kaynak (schema / deployment / scripts / install) ---
info "Kaynak (schema, deployment, scripts) kopyalanıyor..."
for d in schema deployment scripts install; do
    if [[ -d "$SOURCE_DIR/$d" ]]; then
        rsync -a "$SOURCE_DIR/$d" "$STAGE/$PKG/"
        ok "$d/"
    fi
done

# --- Backend ---
info "Backend kopyalanıyor ($BACKEND_SRC -> backend/)..."
rsync -a \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='*.bak' \
    --exclude='*.bak.*' \
    --exclude='.venv' \
    --exclude='venv' \
    "$BACKEND_SRC/" "$STAGE/$PKG/backend/"
ok "backend/ ($(du -sh "$STAGE/$PKG/backend" | cut -f1))"

# --- Frontend (node_modules + dist HARİÇ) ---
info "Frontend kopyalanıyor ($FRONTEND_SRC -> frontend/, node_modules/dist hariç)..."
rsync -a \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='*.bak' \
    --exclude='*.bak.*' \
    "$FRONTEND_SRC/" "$STAGE/$PKG/frontend/"
ok "frontend/ ($(du -sh "$STAGE/$PKG/frontend" | cut -f1))"

# --- Şema dosyaları doğrula (installer bunları arıyor) ---
[[ -f "$STAGE/$PKG/schema/mtl_ldap_admin_schema.sql" ]] || die "Bundle'da PostgreSQL şeması eksik."
[[ -f "$STAGE/$PKG/schema/mtl-openldap-schema.ldif" ]]  || die "Bundle'da LDAP şeması eksik."

# --- Tarball ---
info "Tarball oluşturuluyor..."
tar czf "$OUT" -C "$STAGE" "$PKG"
rm -rf "$STAGE"
ok "Bundle: $OUT ($(du -h "$OUT" | cut -f1))"

cat <<NOTE

──────────────────────────────────────────────────────────────
 Bundle hazır: $OUT

 İçerik: backend/ frontend/ schema/ deployment/ scripts/ install/

 Yeni ortama taşı (kendi makinenden):
   scp <kul>@$(hostname -s):$OUT  <kul>@YENI_HOST:/tmp/

 Yeni kutuda (root):
   mkdir -p /opt/mtl-source
   tar xzf /tmp/$(basename "$OUT") -C /opt/mtl-source
   # -> /opt/mtl-source/mtl-ldap-admin  (= MTL_SOURCE_DIR)

 Sonra:
   1) Sertifikaları yerleştir + .conf doldur
   2) Installer çalıştır (master veya slave)
   3) bash mtl-deploy-app.sh   (backend venv + frontend build + servisler)
──────────────────────────────────────────────────────────────
NOTE
