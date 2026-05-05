# 1. accesslog overlay — external audit feed

**Hedef:** slapd'a `accesslog` overlay'i kur. mtl-ldap-admin dışından (3rd party app, manuel `ldapadd`, replication consumer vs.) gelen tüm LDAP operasyonları `cn=accesslog` altında loglanır. mtl-ldap-admin Dashboard'da counter, Audit sayfasında "external" tab'ında listelenir.

> Module zaten v0.9'da yüklendi (`/usr/lib64/openldap/accesslog.la` — Rocky 9 stock paketinde gelir). Bu doc accesslog **database** + **overlay**'i kuruyor.

## 1.1 Module yüklü mü kontrol

```bash
ldapsearch -Y EXTERNAL -H ldapi:/// -b "cn=module{0},cn=config" \
  olcModuleLoad -LLL | grep accesslog
```

Boş geliyorsa şunu çalıştır:

```bash
cat <<EOF | ldapmodify -Y EXTERNAL -H ldapi:///
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: accesslog.la
EOF
```

## 1.2 accesslog database'i için dizin

slapd accesslog'u ayrı bir mdb DB'sine yazar. Veri dizini önceden oluşmalı:

```bash
mkdir -p /var/lib/ldap/accesslog
chown ldap:ldap /var/lib/ldap/accesslog
chmod 0700 /var/lib/ldap/accesslog
```

## 1.3 accesslog database + overlay LDIF

```bash
cat > /tmp/accesslog.ldif <<'EOF'
# 1. accesslog DB'si (cn=accesslog suffix)
dn: olcDatabase=mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: mdb
olcDbDirectory: /var/lib/ldap/accesslog
olcSuffix: cn=accesslog
olcRootDN: cn=admin,dc=example,dc=com
olcAccess: {0}to dn.subtree="cn=accesslog"
  by dn.exact="cn=admin,dc=example,dc=com" read
  by * none
olcLimits: dn.exact="cn=admin,dc=example,dc=com" size.soft=unlimited size.hard=unlimited
olcDbMaxsize: 1073741824

# 2. Overlay'i ana mdb'ye ({2}mdb) bağla
dn: olcOverlay=accesslog,olcDatabase={2}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcAccessLogConfig
olcOverlay: accesslog
olcAccessLogDB: cn=accesslog
olcAccessLogOps: writes reads
olcAccessLogSuccess: TRUE
olcAccessLogPurge: 30+00:00 01+00:00
EOF

ldapadd -Y EXTERNAL -H ldapi:/// -f /tmp/accesslog.ldif
```

### Anlamı

| Attribute | Değer | Anlam |
|---|---|---|
| `olcDbMaxsize` | 1 GiB | Accesslog DB'sinin max boyutu |
| `olcAccessLogOps` | `writes reads` | Hem write (add/modify/delete) hem read (search/bind/compare) loglanır |
| `olcAccessLogSuccess` | TRUE | Sadece başarılı ops loglanır (hatalı bind'ler de görünsün istersen FALSE) |
| `olcAccessLogPurge` | `30+00:00 01+00:00` | 30 günden eski kayıtlar günde 1 kez purge edilir |

## 1.4 Doğrulama

```bash
# DB erişilebilir mi?
ldapsearch -x -D "cn=admin,dc=example,dc=com" -W -H ldap://localhost \
  -b "cn=accesslog" -s base -LLL dn

# Şu anda kayıt var mı? (overlay yeni eklendi, biraz trafik gerek)
ldapsearch -x -D "cn=admin,dc=example,dc=com" -W -H ldap://localhost \
  -b "cn=accesslog" "(reqType=*)" reqType reqDN -LLL | head -30
```

mtl-ldap-admin'da:
1. **Dashboard** → "external LDAP traffic (accesslog)" paneli artık counter göstermeli
2. **Audit** → sağ üstte "external (slapd accesslog)" tab → event listesi

## 1.5 Disk monitoring

`olcDbMaxsize: 1073741824` (1GB) küçük envanmentlarda 30 gün için yeterli; yüksek trafikli sunucuda büyütülebilir. Disk kullanımını izle:

```bash
du -sh /var/lib/ldap/accesslog/
```

## 1.6 Kapatma / kaldırma

```bash
# Önce overlay'i kaldır:
INDEX=$(ldapsearch -Y EXTERNAL -H ldapi:/// -b "olcDatabase={2}mdb,cn=config" \
  "(olcOverlay=accesslog)" dn -LLL | awk -F: '/^dn:/ {print $2}' | xargs)
echo "Overlay DN: $INDEX"

cat <<EOF | ldapmodify -Y EXTERNAL -H ldapi:///
dn: $INDEX
changetype: delete
EOF

# Sonra DB'yi kaldır (DN index slapd tarafından atanmış olabilir, find et):
DBI=$(ldapsearch -Y EXTERNAL -H ldapi:/// -b cn=config \
  "(olcSuffix=cn=accesslog)" dn -LLL | awk -F: '/^dn:/ {print $2}' | xargs)
cat <<EOF | ldapmodify -Y EXTERNAL -H ldapi:///
dn: $DBI
changetype: delete
EOF

# Veri dizinini sil (opsiyonel):
rm -rf /var/lib/ldap/accesslog
```
