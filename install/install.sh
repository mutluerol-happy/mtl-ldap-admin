#!/bin/bash
# MTL LDAP Admin — interactive installer
#
# Detects distro, installs dependencies, prompts for config, builds, installs
# systemd unit, and starts the service.
#
# Usage:
#   sudo ./install/install.sh           # interactive
#   sudo ./install/install.sh --yes     # accept defaults where possible (still prompts for required values)
#
# Idempotent: re-running on an existing install will preserve .env and audit.db,
# only updating binaries and unit file.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: please run as root (sudo)" >&2
  exit 1
fi

# ── distro detection ──────────────────────────────────────────────────────────
. /etc/os-release || { echo "ERROR: cannot read /etc/os-release"; exit 1; }
DISTRO_FAMILY=""
case "${ID,,}" in
  rocky|rhel|almalinux|centos|fedora) DISTRO_FAMILY="rhel" ;;
  ubuntu|debian)                       DISTRO_FAMILY="debian" ;;
  *)
    echo "ERROR: unsupported distro: $ID" >&2
    echo "Tested on: Rocky 9, RHEL 9, Ubuntu 22.04+. PRs welcome for others." >&2
    exit 1
    ;;
esac
echo "→ detected: $PRETTY_NAME ($DISTRO_FAMILY family)"

INSTALL_DIR="/opt/mtl-ldap-admin"
SERVICE_NAME="mtl-ldap-admin"
SERVICE_USER="mtlldap"
DEFAULT_LISTEN=":8080"

# ── deps ──────────────────────────────────────────────────────────────────────
echo "→ installing build dependencies..."
case "$DISTRO_FAMILY" in
  rhel)
    dnf install -y --quiet curl tar gcc git openldap-clients sqlite >/dev/null
    # Go: prefer distro package if 1.22+ available, else manual tarball
    if ! command -v go &>/dev/null || [[ "$(go version 2>/dev/null | grep -oP '\d+\.\d+' | head -1)" < "1.22" ]]; then
      echo "  → installing Go 1.22 from upstream tarball..."
      GO_VER="1.22.10"
      curl -sSL "https://go.dev/dl/go${GO_VER}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
      rm -rf /usr/local/go
      tar -C /usr/local -xzf /tmp/go.tar.gz
      ln -sf /usr/local/go/bin/go /usr/local/bin/go
      ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
    fi
    if ! command -v node &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      dnf install -y --quiet nodejs >/dev/null
    fi
    ;;
  debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends curl tar gcc git ldap-utils sqlite3 ca-certificates >/dev/null
    if ! command -v go &>/dev/null || [[ "$(go version 2>/dev/null | grep -oP '\d+\.\d+' | head -1)" < "1.22" ]]; then
      echo "  → installing Go 1.22 from upstream tarball..."
      GO_VER="1.22.10"
      curl -sSL "https://go.dev/dl/go${GO_VER}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
      rm -rf /usr/local/go
      tar -C /usr/local -xzf /tmp/go.tar.gz
      ln -sf /usr/local/go/bin/go /usr/local/bin/go
      ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
    fi
    if ! command -v node &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y --no-install-recommends nodejs >/dev/null
    fi
    ;;
esac

echo "  ✓ go: $(go version | cut -d' ' -f3)"
echo "  ✓ node: $(node --version)"

# ── interactive prompts ───────────────────────────────────────────────────────
echo
echo "═══ Configuration ═══"

prompt() {
  local var="$1" question="$2" default="${3:-}" silent="${4:-}"
  if [[ -n "$default" ]]; then
    if [[ "$silent" == "silent" ]]; then
      read -r -s -p "$question [$default]: " value || true; echo
    else
      read -r -p "$question [$default]: " value || true
    fi
    value="${value:-$default}"
  else
    while [[ -z "${value:-}" ]]; do
      if [[ "$silent" == "silent" ]]; then
        read -r -s -p "$question: " value || true; echo
      else
        read -r -p "$question: " value || true
      fi
    done
  fi
  printf -v "$var" '%s' "$value"
  unset value
}

prompt LDAP_BASE_DN     "LDAP base DN (e.g. dc=example,dc=com)" "dc=example,dc=com"
prompt LDAP_BIND_DN     "LDAP bind DN (admin to use for app's own ops)" "cn=admin,$LDAP_BASE_DN"
prompt LDAP_BIND_PW     "LDAP bind password" "" silent
prompt LDAP_USERS_DN    "Users DN (where new users will be created)" "ou=users,$LDAP_BASE_DN"
prompt LDAP_URL         "LDAP server URL" "ldap://localhost:389"
prompt PUBLIC_URL       "Public URL (used in reset emails)" "http://$(hostname -f 2>/dev/null || hostname):8080"

echo
echo "Self-service password reset methods (comma-separated): questions, email, sms"
prompt SS_METHODS       "Methods" "questions"

# generate random secrets
JWT_SECRET="$(openssl rand -hex 32)"
ADMIN_GROUP_DN="cn=ldap-admins,ou=groups,$LDAP_BASE_DN"

echo
echo "═══ Summary ═══"
echo "  install dir : $INSTALL_DIR"
echo "  base DN     : $LDAP_BASE_DN"
echo "  bind DN     : $LDAP_BIND_DN"
echo "  users DN    : $LDAP_USERS_DN"
echo "  LDAP URL    : $LDAP_URL"
echo "  public URL  : $PUBLIC_URL"
echo "  methods     : $SS_METHODS"
echo "  admin group : $ADMIN_GROUP_DN"
echo
read -r -p "Continue? [y/N] " confirm
[[ "${confirm,,}" == "y" || "${confirm,,}" == "yes" ]] || { echo "aborted"; exit 1; }

# ── service user ──────────────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  echo "→ creating service user: $SERVICE_USER"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ── install dir + source layout ───────────────────────────────────────────────
PATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$INSTALL_DIR/src"
echo "→ copying sources to $INSTALL_DIR/src..."
rsync -a --delete \
  --exclude='.git' --exclude='node_modules' --exclude='dist' \
  --exclude='*.bak-*' --exclude='audit.db*' --exclude='.env' \
  "$PATCH_DIR/" "$INSTALL_DIR/src/"

# ── ssl dir for LDAPS uploads ─────────────────────────────────────────────────
mkdir -p /etc/mtl-ldap-admin/ssl
chown root:"$SERVICE_USER" /etc/mtl-ldap-admin/ssl
chmod 0750 /etc/mtl-ldap-admin/ssl

# ── .env (preserve if exists) ─────────────────────────────────────────────────
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "→ writing $INSTALL_DIR/.env"
  cat > "$INSTALL_DIR/.env" <<EOF
LDAP_URL=$LDAP_URL
LDAP_BIND_DN=$LDAP_BIND_DN
LDAP_BIND_PASSWORD=$LDAP_BIND_PW
LDAP_BASE_DN=$LDAP_BASE_DN
LDAP_USERS_DN=$LDAP_USERS_DN
LDAP_ADMIN_GROUP_DN=$ADMIN_GROUP_DN

HTTP_LISTEN=$DEFAULT_LISTEN
PUBLIC_URL=$PUBLIC_URL
JWT_SECRET=$JWT_SECRET

SELF_SERVICE_METHODS=$SS_METHODS
RESET_TOKEN_TTL_MIN=30

AUDIT_DB_PATH=$INSTALL_DIR/audit.db

# Optional .env-only SMTP/SMS fallback (UI-managed values take precedence)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_STARTTLS=true
EOF
  chmod 0600 "$INSTALL_DIR/.env"
  chown root:"$SERVICE_USER" "$INSTALL_DIR/.env"
else
  echo "→ keeping existing $INSTALL_DIR/.env"
fi

# ── build ─────────────────────────────────────────────────────────────────────
echo "→ building frontend..."
(cd "$INSTALL_DIR/src/web" && npm install --no-fund --no-audit --silent && npm run build)

echo "→ building backend..."
(cd "$INSTALL_DIR/src" && go build -trimpath -ldflags "-s -w" -o "$INSTALL_DIR/mtl-ldap-admin" ./cmd/server)
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/mtl-ldap-admin"

# ── systemd unit ──────────────────────────────────────────────────────────────
cat > /etc/systemd/system/mtl-ldap-admin.service <<EOF
[Unit]
Description=MTL LDAP Admin — OpenLDAP Management Console
Documentation=https://github.com/mutluerol-happy/mtl-ldap-admin
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/mtl-ldap-admin
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR /etc/mtl-ldap-admin
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
EOF

# ── ownership ─────────────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
# audit.db will be created on first run; ensure parent is writable
chmod 0750 "$INSTALL_DIR"

# ── seed admin user ───────────────────────────────────────────────────────────
echo
echo "→ seeding admin (uid=happy) and admin group..."
ADMIN_PW="$(openssl rand -base64 18 | tr -d '=+/' | head -c 16)"
ADMIN_PW_HASH="$(slappasswd -s "$ADMIN_PW")"

LDIF=$(mktemp)
cat > "$LDIF" <<EOF
dn: ou=groups,$LDAP_BASE_DN
changetype: add
objectClass: organizationalUnit
ou: groups

dn: ou=users,$LDAP_BASE_DN
changetype: add
objectClass: organizationalUnit
ou: users

dn: uid=happy,$LDAP_USERS_DN
changetype: add
objectClass: inetOrgPerson
objectClass: organizationalPerson
objectClass: person
objectClass: top
uid: happy
cn: Happy Admin
sn: Admin
givenName: Happy
mail: happy@example.com
userPassword: $ADMIN_PW_HASH

dn: $ADMIN_GROUP_DN
changetype: add
objectClass: groupOfNames
cn: ldap-admins
description: MTL LDAP Admin administrators
member: uid=happy,$LDAP_USERS_DN
EOF

# Try to add; ignore "already exists" errors.
ldapadd -x -D "$LDAP_BIND_DN" -w "$LDAP_BIND_PW" -H "$LDAP_URL" -f "$LDIF" 2>&1 \
  | grep -v "Already exists" || true
rm -f "$LDIF"

# ── start service ─────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now mtl-ldap-admin
sleep 2

if systemctl is-active --quiet mtl-ldap-admin; then
  echo
  echo "════════════════════════════════════════════════════════════════════════"
  echo "  ✓ MTL LDAP Admin is running"
  echo "════════════════════════════════════════════════════════════════════════"
  echo
  echo "  URL:      $PUBLIC_URL"
  echo "  Username: happy"
  echo "  Password: $ADMIN_PW"
  echo
  echo "  ⚠ This password is displayed only once. Save it now."
  echo
  echo "  Service:  systemctl status mtl-ldap-admin"
  echo "  Logs:     journalctl -u mtl-ldap-admin -f"
  echo "  Config:   $INSTALL_DIR/.env"
  echo
  echo "  Next steps:"
  echo "    • Sign in and configure SMTP/SMS in Settings"
  echo "    • For LDAPS: docs/02-ldaps-listen.md"
  echo "    • For external audit: docs/01-accesslog-overlay.md"
  echo
else
  echo "ERROR: service failed to start" >&2
  echo "Check logs: journalctl -u mtl-ldap-admin -n 50 --no-pager" >&2
  exit 1
fi
