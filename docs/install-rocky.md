# Manual install — Rocky 9 / RHEL 9 / AlmaLinux 9

The interactive installer (`sudo ./install/install.sh`) handles everything below. This page is for those who prefer manual steps or hit a specific step in the auto installer.

## 1. System packages

```bash
sudo dnf install -y openldap-servers openldap-clients sqlite gcc git curl tar
```

Optional but useful:

```bash
sudo dnf install -y vim-enhanced jq htop
```

## 2. Go (1.22+)

Distro packages may lag. Install upstream:

```bash
GO_VER=1.22.10
curl -sSL "https://go.dev/dl/go${GO_VER}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf /tmp/go.tar.gz
sudo ln -sf /usr/local/go/bin/go /usr/local/bin/go
sudo ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
go version  # go1.22.10 linux/amd64
```

## 3. Node.js 20

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node --version  # v20.x.x
```

## 4. OpenLDAP setup

If you don't already have a working slapd:

```bash
sudo systemctl enable --now slapd
sudo systemctl status slapd
```

Set up your base DN (replace `dc=example,dc=com`):

```bash
ADMIN_PW=$(slappasswd -s 'YourAdminPassword')

cat > /tmp/init.ldif <<EOF
dn: olcDatabase={2}mdb,cn=config
changetype: modify
replace: olcSuffix
olcSuffix: dc=example,dc=com
-
replace: olcRootDN
olcRootDN: cn=admin,dc=example,dc=com
-
replace: olcRootPW
olcRootPW: $ADMIN_PW
EOF
sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f /tmp/init.ldif
```

Recommended overlays:

```bash
# memberOf — auto-update memberOf attribute on user entries
cat > /tmp/memberof.ldif <<EOF
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: memberof.la

dn: olcOverlay=memberof,olcDatabase={2}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcMemberOf
olcOverlay: memberof
olcMemberOfRefint: TRUE

dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: refint.la

dn: olcOverlay=refint,olcDatabase={2}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcRefintConfig
olcOverlay: refint
olcRefintAttribute: memberof member
EOF
sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f /tmp/memberof.ldif

# ppolicy — password policy enforcement
cat > /tmp/ppolicy.ldif <<EOF
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: ppolicy.la

dn: olcOverlay=ppolicy,olcDatabase={2}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcPPolicyConfig
olcOverlay: ppolicy
olcPPolicyDefault: cn=default,ou=policies,dc=example,dc=com
olcPPolicyHashCleartext: TRUE
olcPPolicyUseLockout: TRUE
EOF
sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f /tmp/ppolicy.ldif

# Create policies OU + default policy
cat > /tmp/policy.ldif <<EOF
dn: ou=policies,dc=example,dc=com
objectClass: organizationalUnit
ou: policies

dn: cn=default,ou=policies,dc=example,dc=com
objectClass: pwdPolicy
objectClass: device
cn: default
pwdAttribute: userPassword
pwdMinLength: 10
pwdMaxFailure: 5
pwdLockout: TRUE
pwdLockoutDuration: 1800
pwdInHistory: 5
EOF
sudo ldapadd -x -D "cn=admin,dc=example,dc=com" -W -f /tmp/policy.ldif
```

For accesslog overlay (external audit feed): see [01-accesslog-overlay.md](01-accesslog-overlay.md).

## 5. Build MTL LDAP Admin

```bash
git clone https://github.com/mutluerol-happy/mtl-ldap-admin.git
cd mtl-ldap-admin

# Frontend
cd web
npm install
npm run build
cd ..

# Backend
go build -trimpath -ldflags "-s -w" -o mtl-ldap-admin ./cmd/server
```

## 6. Install layout

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin mtlldap

sudo mkdir -p /opt/mtl-ldap-admin
sudo cp -r ./* /opt/mtl-ldap-admin/src/
sudo cp /opt/mtl-ldap-admin/src/mtl-ldap-admin /opt/mtl-ldap-admin/

sudo mkdir -p /etc/mtl-ldap-admin/ssl
sudo chown root:mtlldap /etc/mtl-ldap-admin/ssl
sudo chmod 0750 /etc/mtl-ldap-admin/ssl
```

## 7. .env

```bash
JWT_SECRET=$(openssl rand -hex 32)
sudo tee /opt/mtl-ldap-admin/.env >/dev/null <<EOF
LDAP_URL=ldap://localhost:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=YourAdminPassword
LDAP_BASE_DN=dc=example,dc=com
LDAP_USERS_DN=ou=users,dc=example,dc=com
LDAP_ADMIN_GROUP_DN=cn=ldap-admins,ou=groups,dc=example,dc=com

HTTP_LISTEN=:8080
PUBLIC_URL=http://$(hostname -f):8080
JWT_SECRET=$JWT_SECRET

SELF_SERVICE_METHODS=questions,email,sms
RESET_TOKEN_TTL_MIN=30

AUDIT_DB_PATH=/opt/mtl-ldap-admin/audit.db
EOF

sudo chmod 0600 /opt/mtl-ldap-admin/.env
sudo chown root:mtlldap /opt/mtl-ldap-admin/.env
sudo chown -R mtlldap:mtlldap /opt/mtl-ldap-admin
```

## 8. systemd unit

```bash
sudo tee /etc/systemd/system/mtl-ldap-admin.service >/dev/null <<'EOF'
[Unit]
Description=MTL LDAP Admin — OpenLDAP Management Console
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mtlldap
Group=mtlldap
WorkingDirectory=/opt/mtl-ldap-admin
EnvironmentFile=/opt/mtl-ldap-admin/.env
ExecStart=/opt/mtl-ldap-admin/mtl-ldap-admin
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/mtl-ldap-admin /etc/mtl-ldap-admin
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mtl-ldap-admin
sudo systemctl status mtl-ldap-admin
```

## 9. Firewall

```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

For LDAPS (port 636): see [02-ldaps-listen.md](02-ldaps-listen.md).

## 10. SELinux

If SELinux is enforcing and the service won't bind:

```bash
sudo setsebool -P httpd_can_network_connect 1
sudo semanage port -a -t http_port_t -p tcp 8080 2>/dev/null \
  || sudo semanage port -m -t http_port_t -p tcp 8080
```

## 11. First login

Open `http://your-server:8080`. Create the admin via LDIF:

```bash
ADMIN_PW=$(openssl rand -base64 16)
ADMIN_HASH=$(slappasswd -s "$ADMIN_PW")

cat > /tmp/admin.ldif <<EOF
dn: ou=groups,dc=example,dc=com
objectClass: organizationalUnit
ou: groups

dn: ou=users,dc=example,dc=com
objectClass: organizationalUnit
ou: users

dn: uid=happy,ou=users,dc=example,dc=com
objectClass: inetOrgPerson
uid: happy
cn: Happy Admin
sn: Admin
givenName: Happy
mail: happy@example.com
userPassword: $ADMIN_HASH

dn: cn=ldap-admins,ou=groups,dc=example,dc=com
objectClass: groupOfNames
cn: ldap-admins
member: uid=happy,ou=users,dc=example,dc=com
EOF

ldapadd -x -D "cn=admin,dc=example,dc=com" -W -f /tmp/admin.ldif
echo "Admin password: $ADMIN_PW"
```

Sign in with `happy` / `$ADMIN_PW`.
