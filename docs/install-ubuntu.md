# Manual install — Ubuntu 22.04 / 24.04

The interactive installer (`sudo ./install/install.sh`) handles everything below.

## 1. System packages

```bash
sudo apt update
sudo apt install -y slapd ldap-utils sqlite3 gcc git curl tar ca-certificates
```

> If `slapd` prompts for an admin password during install, set it — you'll use this as `LDAP_BIND_PASSWORD`.

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
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
node --version  # v20.x.x
```

## 4. OpenLDAP setup

If you didn't set the base DN during `slapd` install:

```bash
sudo dpkg-reconfigure slapd
```

Or manually (replace `dc=example,dc=com`):

```bash
ADMIN_PW=$(slappasswd -s 'YourAdminPassword')

cat > /tmp/init.ldif <<EOF
dn: olcDatabase={1}mdb,cn=config
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

> ⚠ Note: Ubuntu's slapd uses `olcDatabase={1}mdb` (Rocky uses `{2}mdb`). Adjust LDIF accordingly throughout.

Recommended overlays — same as Rocky but with `{1}mdb`:

```bash
cat > /tmp/memberof.ldif <<'EOF'
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: memberof.la

dn: olcOverlay=memberof,olcDatabase={1}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcMemberOf
olcOverlay: memberof
olcMemberOfRefint: TRUE

dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: refint.la

dn: olcOverlay=refint,olcDatabase={1}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcRefintConfig
olcOverlay: refint
olcRefintAttribute: memberof member
EOF
sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f /tmp/memberof.ldif

cat > /tmp/ppolicy.ldif <<EOF
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: ppolicy.la

dn: olcOverlay=ppolicy,olcDatabase={1}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcPPolicyConfig
olcOverlay: ppolicy
olcPPolicyDefault: cn=default,ou=policies,dc=example,dc=com
olcPPolicyHashCleartext: TRUE
olcPPolicyUseLockout: TRUE
EOF
sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f /tmp/ppolicy.ldif

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

For accesslog: see [01-accesslog-overlay.md](01-accesslog-overlay.md).

## 5. Build & install

(Identical to Rocky — see [install-rocky.md](install-rocky.md) sections 5-8.)

Differences for Ubuntu in the systemd unit: nothing — same unit works.

## 6. Firewall (ufw)

```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

For LDAPS port 636:

```bash
sudo ufw allow 636/tcp
```

## 7. AppArmor

Ubuntu's slapd ships with an AppArmor profile. If you have issues with cert paths in non-standard locations:

```bash
sudo aa-status | grep slapd

# Permit /etc/mtl-ldap-admin/ssl/ paths in slapd profile:
sudo tee -a /etc/apparmor.d/local/usr.sbin.slapd >/dev/null <<EOF
/etc/mtl-ldap-admin/ssl/* r,
EOF

sudo systemctl reload apparmor
sudo systemctl restart slapd
```

## 8. First login

(Same as Rocky — section 11.)

## Common gotchas

- Ubuntu's slapd default suffix may be `dc=nodomain` — change with `dpkg-reconfigure slapd`
- Ubuntu uses `{1}mdb` index (Rocky uses `{2}mdb`); use the right one in LDIFs
- Module loader path is `/usr/lib/ldap` (Rocky: `/usr/lib64/openldap`)
- AppArmor blocks paths outside its profile — `/etc/mtl-ldap-admin/ssl/` works only after the rule above
