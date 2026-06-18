# MTL LDAP Admin

Apache-2.0 lisanslı, kurumsal kimlik ve erişim yönetimi (IAM) platformu.
OpenLDAP (master/slave replikasyon) üzerine kurulu; FastAPI backend ve
React/TypeScript frontend ile yönetim konsolu + self-service kullanıcı portalı sağlar.

## Öne çıkan özellikler

- Kullanıcı / grup / yönetici yönetimi, RBAC (rol & izin), audit kayıtları
- Çok faktörlü kimlik doğrulama (TOTP), yönetici oturumu için MFA zorunluluğu
- Parola politikaları: uzunluk/karmaşıklık kuralları, **parola yaşı (expiry) + login'de zorunlu değişim**
- Self-service parola sıfırlama (e-posta / SMS kanalları)
- **Oturum idle-logout** (ayarlanabilir hareketsizlik süresi)
- Cluster: master/slave topoloji, contextCSN senkron durumu, master→slave ayar senkronizasyonu
- TLS / sertifika yönetimi (Shield): CSR üretimi, sertifika yükleme/aktivasyon
- Ayarlar tek noktadan (Settings) yönetilir; hassas değerler şifreli saklanır

## Mimari

| Katman    | Teknoloji |
|-----------|-----------|
| Backend   | FastAPI, SQLAlchemy (async), Celery, PostgreSQL, Redis |
| Frontend  | React, TypeScript, TanStack Query, Zustand, Tailwind CSS |
| Dizin     | OpenLDAP 2.6 (refreshAndPersist replikasyon, ppolicy) |
| Altyapı   | systemd, Nginx, SELinux (Rocky/RHEL 9) |

Depo yapısı: `backend/` (FastAPI app + migrations), `frontend/` (React/Vite),
`install/` (kurulum + deploy scriptleri), `schema/` (LDAP şeması),
`deployment/` (systemd + yardımcılar), `scripts/`.

## Kurulum (özet)

> Varsayılan değerler generic'tir (örn. base DN `dc=mtl,dc=local`). Kendi ortamınıza
> göre kurulum conf dosyasını düzenleyin; gerçek sırlar yalnızca kurulan sistemde
> (`/etc/mtl/...`) tutulur, depoda bulunmaz.

```bash
# 1) Sistem kurulumu (PostgreSQL, Redis, OpenLDAP, TLS, Nginx, systemd)
sudo ./install/mtl-master-install.sh <kendi-conf-dosyaniz>
#    örnek conf için: install/*.conf.example

# 2) Uygulama dağıtımı (backend + frontend build)
sudo ./install/mtl-deploy-app.sh
```

## Lisans

Apache License 2.0 — bkz. [LICENSE](LICENSE).
