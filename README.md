# MTL LDAP Admin

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Stack](https://img.shields.io/badge/stack-FastAPI%20%7C%20React%20%7C%20OpenLDAP-informational)
![Platform](https://img.shields.io/badge/platform-Rocky%20Linux%209-lightgrey)

Apache-2.0 lisanslı, kurumsal kimlik ve erişim yönetimi (IAM) platformu — OpenLDAP master/slave üzerine kurulu, FastAPI backend + React/TypeScript yönetim konsolu ve self-service kullanıcı portalı.

Open-source enterprise identity & access management (IAM) platform built on OpenLDAP master/slave replication, with a FastAPI backend, a React/TypeScript admin console, and a self-service user portal.

**🌐 Language / Dil:** [English](#english) · [Türkçe](#türkçe)

---

<a name="english"></a>

## English

### Overview

MTL LDAP Admin turns an OpenLDAP directory into a fully managed IAM service. It provides:

- A **management console** for administrators (users, groups, roles, audit, cluster, certificates, settings).
- A **self-service portal** for end users (login, profile, password change, password reset via email/SMS, MFA).
- A **master/slave topology** where all writes go to the master and one or more read-only consumers stay in sync via `refreshAndPersist` replication.

### Features

- **User & group management** backed directly by LDAP, with bulk CSV import.
- **Administrators & RBAC** — granular roles and permissions; assign roles to admin accounts.
- **Multi-factor authentication** (TOTP), with optional MFA enforcement for admins.
- **Password policies** — length/complexity rules, **password expiry with forced change at login**.
- **Self-service password reset** over email and SMS channels.
- **Idle-logout** — configurable session inactivity timeout (default 15 minutes; `0` disables).
- **Audit log** — every privileged action recorded and queryable; slave nodes forward audit events to the master.
- **Cluster & replication** — manage master/slave topology, compare live `contextCSN` sync state, and auto-sync settings from master to slaves.
- **Shield (TLS certificate management)** — generate CSRs, upload certificates, run CA-transition workflows.
- **Internationalisation** — English and Turkish UI out of the box.

### Architecture

| Layer      | Technology |
|------------|-----------|
| Backend    | FastAPI, SQLAlchemy (async), Celery (worker + beat), Fernet, HMAC |
| Frontend   | React, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS |
| Directory  | OpenLDAP 2.6 (`syncprov`, `accesslog`, `ppolicy`, `refreshAndPersist` replication) |
| Data       | PostgreSQL 16 (`mtl_core` + `mtl_cluster` schemas), Redis 7 |
| Infra      | Rocky Linux 9, systemd, Nginx, SELinux |

**Node roles**

- **Master** — full admin console + portal, LDAP provider (read/write), Celery worker/beat.
- **Slave** — read-only LDAP consumer, self-service portal/reset only (no admin UI), runs with `MTL_PROFILE=SLAVE`.

### Repository layout

```
backend/      FastAPI app (api, services, models, schemas, worker) + migrations
frontend/     React/TS console + self-service portal (Vite)
install/      Master/slave install + app-deploy scripts
schema/       LDAP schema (LDIF) + PostgreSQL schema (SQL)
deployment/   systemd units, Nginx configs, Docker Compose, Shield cert-apply
scripts/      Failover (promote/restore) + log-shipping helpers
```

### Requirements

- **Rocky Linux 9** (or a RHEL 9–family distribution), with `root` access.
- Outbound network access to install packages.
- The installer provisions PostgreSQL 16, Redis 7, OpenLDAP 2.6, and Nginx for you.
- **Node.js + npm** are needed on the host that builds the frontend (used by `mtl-deploy-app.sh`).

### Installation

#### 1. Place the source

```bash
sudo mkdir -p /opt/mtl-source
sudo git clone https://github.com/mutluerol-happy/mtl-ldap-admin.git \
  /opt/mtl-source/mtl-ldap-admin
cd /opt/mtl-source/mtl-ldap-admin
```

#### 2. Install the master node

The master installer is **idempotent** (safe to re-run) and runs in 15 steps: system prep, firewall, SELinux, PostgreSQL, Redis, OpenLDAP, TLS certificates, env file, Nginx, and systemd units.

```bash
# Interactive — prompts for IPs, hostnames, base DN, passwords, bootstrap admin
sudo bash install/mtl-master-install.sh
```

It will ask for, among others:

- Master/slave IP and FQDN (defaults like `mtl-master-01.mtl.local`)
- LDAP base DN (default `dc=mtl,dc=local`) and organisation
- LDAP admin / config / replicator passwords
- PostgreSQL and Redis passwords
- The **bootstrap admin** username, password and email (the first account that can sign in to the console)

For unattended installs you can pre-set the same variables in a config file and pass `--config`:

```bash
sudo bash install/mtl-master-install.sh --config /etc/mtl-master-install.conf
```

When it finishes, a summary prints the service status, LDAP `contextCSN`, and the HTTPS check. Generated secrets (`SECRET_KEY`, Fernet key, cluster secret, passwords) are written to **`/root/mtl-secrets.txt`**, and the runtime environment lives at **`/etc/mtl/mtl-ldap-admin.env`**.

#### 3. Deploy the application

The master installer sets up infrastructure and a placeholder web root; this step builds and deploys the real backend + frontend, then restarts the services:

```bash
sudo ./install/mtl-deploy-app.sh
```

#### 4. Sign in

Open **`https://<master-hostname>/`** and log in with the bootstrap admin credentials (the password is in `/root/mtl-secrets.txt`). You may be prompted to set up MFA and/or change the password on first login.

#### 5. Add a slave (optional)

Slaves are read-only consumers. Copy these from the master to the slave first: the CA certificate (`/etc/mtl/ssl/mtl-ca.pem`), the slave server certificate/key, the **replicator password**, and the **cluster secret** (all shown in the master install summary).

```bash
sudo cp install/mtl-slave-install.conf.example /etc/mtl-slave-install.conf
sudo nano /etc/mtl-slave-install.conf      # master IP, base DN, replicator pw, cluster secret, cert paths
sudo bash install/mtl-slave-install.sh --config /etc/mtl-slave-install.conf
```

Then register the slave from the console (**Cluster → Add node**) so the master can track its sync state and push settings to it.

### Configuration

Runtime configuration is the environment file at `/etc/mtl/mtl-ldap-admin.env`. Key values:

| Variable | Purpose |
|----------|---------|
| `MTL_LISTEN_PORT` | Backend listen port (default `8000`, fronted by Nginx) |
| `MTL_LDAP_BASE_DN` | Directory base DN |
| `MTL_LDAP_BIND_DN` / `MTL_LDAP_BIND_PASSWORD` | LDAP manager bind credentials |
| `MTL_SECRET_KEY` / `MTL_FERNET_KEY` | Token signing and at-rest encryption keys |
| `MTL_CLUSTER_SECRET` | HMAC secret shared between master and slaves |
| `MTL_PROFILE` | `MASTER` (default) or `SLAVE` |

> Never commit real secrets. They are generated at install time and stay only on the host (`/etc/mtl/...`, `/root/mtl-secrets.txt`).

**Open ports:** 443 (console/portal over HTTPS), 80 (redirect), 389 (LDAP), 636 (LDAPS), 22 (SSH).

### Usage

**Management console** (`https://<master>/`) — sidebar sections:

- **Dashboard** — directory and system overview.
- **Users / Groups** — create, edit, enable/disable; bulk-import users from CSV.
- **Admins / Roles** — manage admin accounts and assign RBAC roles built from fine-grained permissions.
- **Audit** — search privileged actions; filter by node, actor, and severity.
- **Cluster / Sync** — view nodes, live `contextCSN` comparison, and resolve discrepancies.
- **Shield** — generate a CSR, upload an issued certificate, or run a CA transition.
- **Settings** — password policy, password reset channels, SMS/SMTP, branding, MFA, and **Security → idle-logout timeout**.

**Self-service portal** (same host, end-user routes) — users log in, view/update their profile, change their password, set up MFA, and reset a forgotten password via email or SMS.

**Password expiry behaviour:** when an account's password exceeds `password.max_age_days`, the next login is redirected to a forced password-change screen — the user cannot proceed until they set a new password.

### Development

```bash
# Frontend (hot-reload dev server)
cd frontend
npm install
npm run dev          # http://localhost:5173

# Backend (from a configured host with the env file present)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

systemd services on a deployed host: `mtl-ldap-admin`, `mtl-ldap-admin-worker`, `mtl-ldap-admin-beat` (plus `slapd` and `nginx`).

### Security notes

- All directory writes go to the **master**; slaves are strictly read-only.
- Master and slaves share a single public wildcard certificate for `slapd` + Nginx; applications verify the master via an internal CA trust bundle.
- Rotate the bootstrap admin password after first login and store `/root/mtl-secrets.txt` securely (or delete it once secrets are recorded elsewhere).

### License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<a name="türkçe"></a>

## Türkçe

### Genel Bakış

MTL LDAP Admin, bir OpenLDAP dizinini tam yönetilen bir IAM hizmetine dönüştürür. Sunduğu bileşenler:

- Yöneticiler için bir **yönetim konsolu** (kullanıcılar, gruplar, roller, denetim, cluster, sertifikalar, ayarlar).
- Son kullanıcılar için bir **self-service portal** (giriş, profil, parola değiştirme, e-posta/SMS ile parola sıfırlama, MFA).
- Tüm yazma işlemlerinin master'a gittiği, bir veya daha fazla salt-okunur tüketicinin `refreshAndPersist` replikasyonu ile senkron kaldığı bir **master/slave topolojisi**.

### Öne çıkan özellikler

- Doğrudan LDAP tabanlı **kullanıcı & grup yönetimi**, toplu CSV içe aktarma ile.
- **Yöneticiler & RBAC** — ayrıntılı rol ve izinler; yönetici hesaplarına rol atama.
- **Çok faktörlü kimlik doğrulama** (TOTP), yöneticiler için isteğe bağlı MFA zorunluluğu.
- **Parola politikaları** — uzunluk/karmaşıklık kuralları, **parola yaşı dolunca login'de zorunlu değişim**.
- **Self-service parola sıfırlama** — e-posta ve SMS kanalları üzerinden.
- **Idle-logout** — ayarlanabilir hareketsizlik zaman aşımı (varsayılan 15 dakika; `0` kapatır).
- **Denetim kaydı** — her ayrıcalıklı işlem kaydedilir ve sorgulanabilir; slave node'lar denetim olaylarını master'a iletir.
- **Cluster & replikasyon** — master/slave topolojisini yönet, canlı `contextCSN` senkron durumunu karşılaştır, ayarları master'dan slave'lere otomatik senkronla.
- **Shield (TLS sertifika yönetimi)** — CSR üretimi, sertifika yükleme, CA geçiş akışları.
- **Çok dillilik** — kutudan çıktığı haliyle İngilizce ve Türkçe arayüz.

### Mimari

| Katman    | Teknoloji |
|-----------|-----------|
| Backend   | FastAPI, SQLAlchemy (async), Celery (worker + beat), Fernet, HMAC |
| Frontend  | React, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS |
| Dizin     | OpenLDAP 2.6 (`syncprov`, `accesslog`, `ppolicy`, `refreshAndPersist` replikasyon) |
| Veri      | PostgreSQL 16 (`mtl_core` + `mtl_cluster` şemaları), Redis 7 |
| Altyapı   | Rocky Linux 9, systemd, Nginx, SELinux |

**Node rolleri**

- **Master** — tam yönetim konsolu + portal, LDAP sağlayıcı (okuma/yazma), Celery worker/beat.
- **Slave** — salt-okunur LDAP tüketici, yalnızca self-service portal/sıfırlama (admin arayüzü yok), `MTL_PROFILE=SLAVE` ile çalışır.

### Depo yapısı

```
backend/      FastAPI uygulaması (api, services, models, schemas, worker) + migration'lar
frontend/     React/TS konsol + self-service portal (Vite)
install/      Master/slave kurulum + uygulama dağıtım script'leri
schema/       LDAP şeması (LDIF) + PostgreSQL şeması (SQL)
deployment/   systemd unit'leri, Nginx config'leri, Docker Compose, Shield cert-apply
scripts/      Failover (promote/restore) + log-shipping yardımcıları
```

### Gereksinimler

- **Rocky Linux 9** (veya RHEL 9 ailesinden bir dağıtım), `root` erişimi ile.
- Paket kurulumu için dışarı internet erişimi.
- Kurulum script'i PostgreSQL 16, Redis 7, OpenLDAP 2.6 ve Nginx'i sizin için kurar.
- Frontend'i derleyen host'ta **Node.js + npm** gerekir (`mtl-deploy-app.sh` kullanır).

### Kurulum

#### 1. Kaynağı yerleştir

```bash
sudo mkdir -p /opt/mtl-source
sudo git clone https://github.com/mutluerol-happy/mtl-ldap-admin.git \
  /opt/mtl-source/mtl-ldap-admin
cd /opt/mtl-source/mtl-ldap-admin
```

#### 2. Master node'u kur

Master kurulumu **idempotent**'tir (tekrar çalıştırılabilir) ve 15 adımda ilerler: sistem hazırlığı, firewall, SELinux, PostgreSQL, Redis, OpenLDAP, TLS sertifikaları, env dosyası, Nginx ve systemd unit'leri.

```bash
# Interaktif — IP, hostname, base DN, parolalar, bootstrap admin sorulur
sudo bash install/mtl-master-install.sh
```

Sorduğu başlıca bilgiler:

- Master/slave IP ve FQDN (varsayılanlar `mtl-master-01.mtl.local` gibi)
- LDAP base DN (varsayılan `dc=mtl,dc=local`) ve organizasyon
- LDAP admin / config / replicator parolaları
- PostgreSQL ve Redis parolaları
- **Bootstrap admin** kullanıcı adı, parolası ve e-postası (konsola ilk girebilen hesap)

Otomatik (etkileşimsiz) kurulum için aynı değişkenleri bir config dosyasına yazıp `--config` verebilirsiniz:

```bash
sudo bash install/mtl-master-install.sh --config /etc/mtl-master-install.conf
```

Kurulum bitince bir özet basılır (servis durumu, LDAP `contextCSN`, HTTPS testi). Üretilen sırlar (`SECRET_KEY`, Fernet anahtarı, cluster secret, parolalar) **`/root/mtl-secrets.txt`** dosyasına yazılır; çalışma zamanı ortamı **`/etc/mtl/mtl-ldap-admin.env`** içindedir.

#### 3. Uygulamayı dağıt

Master kurulumu altyapıyı ve bir placeholder web kökünü hazırlar; bu adım gerçek backend + frontend'i derleyip dağıtır ve servisleri yeniden başlatır:

```bash
sudo ./install/mtl-deploy-app.sh
```

#### 4. Giriş yap

Tarayıcıdan **`https://<master-hostname>/`** adresini açın ve bootstrap admin bilgileriyle giriş yapın (parola `/root/mtl-secrets.txt` içinde). İlk girişte MFA kurmanız ve/veya parolayı değiştirmeniz istenebilir.

#### 5. Slave ekle (isteğe bağlı)

Slave'ler salt-okunur tüketicidir. Önce master'dan slave'e şunları kopyalayın: CA sertifikası (`/etc/mtl/ssl/mtl-ca.pem`), slave sunucu sertifikası/anahtarı, **replicator parolası** ve **cluster secret** (hepsi master kurulum özetinde görünür).

```bash
sudo cp install/mtl-slave-install.conf.example /etc/mtl-slave-install.conf
sudo nano /etc/mtl-slave-install.conf      # master IP, base DN, replicator pw, cluster secret, cert yollari
sudo bash install/mtl-slave-install.sh --config /etc/mtl-slave-install.conf
```

Ardından slave'i konsoldan kaydedin (**Cluster → Node ekle**) ki master onun senkron durumunu takip edip ayarları ona aktarabilsin.

### Yapılandırma

Çalışma zamanı yapılandırması `/etc/mtl/mtl-ldap-admin.env` ortam dosyasındadır. Önemli değerler:

| Değişken | Amaç |
|----------|------|
| `MTL_LISTEN_PORT` | Backend dinleme portu (varsayılan `8000`, önünde Nginx) |
| `MTL_LDAP_BASE_DN` | Dizin base DN'i |
| `MTL_LDAP_BIND_DN` / `MTL_LDAP_BIND_PASSWORD` | LDAP yönetici bind bilgileri |
| `MTL_SECRET_KEY` / `MTL_FERNET_KEY` | Token imzalama ve at-rest şifreleme anahtarları |
| `MTL_CLUSTER_SECRET` | Master ve slave'ler arasında paylaşılan HMAC sırrı |
| `MTL_PROFILE` | `MASTER` (varsayılan) veya `SLAVE` |

> Gerçek sırları asla commit etmeyin. Bunlar kurulum sırasında üretilir ve yalnızca host'ta kalır (`/etc/mtl/...`, `/root/mtl-secrets.txt`).

**Açık portlar:** 443 (HTTPS konsol/portal), 80 (yönlendirme), 389 (LDAP), 636 (LDAPS), 22 (SSH).

### Kullanım

**Yönetim konsolu** (`https://<master>/`) — kenar menü bölümleri:

- **Dashboard** — dizin ve sistem genel görünümü.
- **Kullanıcılar / Gruplar** — oluştur, düzenle, etkinleştir/devre dışı bırak; CSV'den toplu kullanıcı içe aktar.
- **Yöneticiler / Roller** — admin hesaplarını yönet, ayrıntılı izinlerden oluşan RBAC rollerini ata.
- **Denetim** — ayrıcalıklı işlemleri ara; node, aktör ve önem derecesine göre filtrele.
- **Cluster / Sync** — node'ları görüntüle, canlı `contextCSN` karşılaştırması yap, tutarsızlıkları çöz.
- **Shield** — CSR üret, verilen sertifikayı yükle veya CA geçişi yap.
- **Ayarlar** — parola politikası, parola sıfırlama kanalları, SMS/SMTP, marka, MFA ve **Güvenlik → idle-logout süresi**.

**Self-service portal** (aynı host, son kullanıcı rotaları) — kullanıcılar giriş yapar, profillerini görüntüler/günceller, parolalarını değiştirir, MFA kurar ve unuttukları parolayı e-posta veya SMS ile sıfırlar.

**Parola expiry davranışı:** bir hesabın parolası `password.max_age_days` değerini aştığında, sonraki giriş zorunlu parola-değiştirme ekranına yönlendirilir — kullanıcı yeni bir parola belirlemeden devam edemez.

### Geliştirme

```bash
# Frontend (hot-reload geliştirme sunucusu)
cd frontend
npm install
npm run dev          # http://localhost:5173

# Backend (env dosyası mevcut, yapılandırılmış bir host'ta)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Dağıtılmış bir host'taki systemd servisleri: `mtl-ldap-admin`, `mtl-ldap-admin-worker`, `mtl-ldap-admin-beat` (ayrıca `slapd` ve `nginx`).

### Güvenlik notları

- Tüm dizin yazma işlemleri **master**'a gider; slave'ler kesinlikle salt-okunurdur.
- Master ve slave'ler `slapd` + Nginx için tek bir public wildcard sertifika paylaşır; uygulamalar master'ı iç bir CA güven paketi ile doğrular.
- İlk girişten sonra bootstrap admin parolasını değiştirin ve `/root/mtl-secrets.txt` dosyasını güvenli saklayın (ya da sırlar başka yere kaydedildikten sonra silin).

### Lisans

**Apache License 2.0** ile lisanslanmıştır — bkz. [LICENSE](LICENSE) ve [NOTICE](NOTICE).
