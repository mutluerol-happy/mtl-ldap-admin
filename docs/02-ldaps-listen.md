# 2. LDAPS — slapd port 636'da dinlemek için

mtl-ldap-admin Settings → LDAPS sekmesinden cert dosyalarını yükleyince **cert + cn=config** otomatik ayarlanır. Ama slapd'ın `ldaps://` URL'inde dinlemesi için ayrıca **sysconfig** dosyasını edit etmek gerek (bu UI'dan yapılmıyor).

## 2.1 Sertifikayı UI'dan yükle (önce)

1. mtl-ldap-admin → **Settings → LDAPS**
2. server certificate, private key (varsa CA chain) PEM olarak yükle
3. ✅ "apply to slapd cn=config" işaretli kalsın
4. **Upload** tıkla

UI sana şunu gösterir:
- **enabled: ✓ applied to slapd** → cert + key + cn=config OK
- subject, issuer, valid until tarihi

Bu adım **slapd'ı bozmaz**, sadece olcTLS* attribute'larını set eder.

## 2.2 Listen URL'i ekle

Cert ayarlandıktan sonra slapd'ın 636 portunda dinlemesi için:

```bash
sudo -e /etc/sysconfig/slapd
```

Şu satırı bul:

```sh
SLAPD_URLS="ldapi:/// ldap:///"
```

Buna `ldaps:///` ekle:

```sh
SLAPD_URLS="ldapi:/// ldap:/// ldaps:///"
```

Kaydet, sonra:

```bash
sudo systemctl restart slapd
sudo systemctl status slapd --no-pager | head -10
```

`active (running)` görmen gerek. **Restart başarısızsa** cert + key dosyaları okunamıyor olabilir:

```bash
journalctl -u slapd -n 30 --no-pager | tail -15
```

Tipik hatalar:
- `unable to read certificate file` — `/etc/mtl-ldap-admin/ssl/server.crt` dosya yok veya `ldap` user okuyamıyor
- `private key does not match certificate` — yanlış key yüklenmiş
- `unsupported certificate purpose` — cert serverAuth EKU içermiyor

Düzeltmek için mtl-ldap-admin Settings'ten doğru cert/key tekrar upload et.

## 2.3 Doğrulama

```bash
# Port 636 dinleniyor mu?
ss -tlnp | grep 636
# beklenen: LISTEN 0.0.0.0:636 ... slapd

# TLS handshake çalışıyor mu? (cert verify hata verirse self-signed/CA chain eksik)
echo | openssl s_client -connect localhost:636 -servername $(hostname -f) 2>&1 | head -20

# LDAPS ile bind:
ldapsearch -x -H ldaps://localhost -D "cn=admin,dc=example,dc=com" -W \
  -b "dc=example,dc=com" -s base "(objectClass=*)" -LLL
```

Eğer **self-signed** cert kullanıyorsan client'ta `LDAPTLS_REQCERT=never` ile bypass:

```bash
LDAPTLS_REQCERT=never ldapsearch -x -H ldaps://localhost ...
```

CA chain'i `/etc/openldap/ldap.conf`'a `TLS_CACERT /etc/mtl-ldap-admin/ssl/ca.crt` olarak da koyabilirsin.

## 2.4 Firewall

LDAPS public yapacaksan:

```bash
sudo firewall-cmd --permanent --add-port=636/tcp
sudo firewall-cmd --reload
```

## 2.5 mtl-ldap-admin'nin kendisi LDAPS kullansın mı?

mtl-ldap-admin, slapd ile aynı host'tasa `ldap://localhost:389` üzerinden bağlanmaya devam edebilir (loopback, encryption gerekmez). LDAPS'i **3rd party app**'ler ve **uzak istemciler** için aç.

mtl-ldap-admin'yi de LDAPS'e geçirmek istersen:

```bash
sudo -e /opt/mtl-ldap-admin/.env  # veya /opt/mtl-ldap-admin/.env
```

```sh
LDAP_URL=ldaps://your-host.example.com:636
LDAP_TLS_INSECURE=false   # true sadece self-signed test için
```

```bash
sudo systemctl restart mtl-ldap-admin   # veya mtl-ldap-admin
```

## 2.6 Cert yenileme

Cert süresi dolmadan mtl-ldap-admin Settings'ten yeni cert yükle. cn=config zaten yeni dosya path'lerini gösterir; restart gerekmez (slapd dosyayı her bind'de okur).

UI'da Settings → LDAPS, "valid until" alanı **30 günden az** kaldıysa sarı, **0 gün** kaldıysa kırmızı gösterilir.
