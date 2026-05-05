<div align="center">

# MTL LDAP Admin

**A modern, self-hosted OpenLDAP management console with self-service password reset, MFA, and audit logging.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Go Version](https://img.shields.io/badge/Go-1.22%2B-00ADD8.svg)](https://go.dev/)
[![Node Version](https://img.shields.io/badge/Node-20%2B-339933.svg)](https://nodejs.org/)
[![CI](https://github.com/mutluerol-happy/mtl-ldap-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/mutluerol-happy/mtl-ldap-admin/actions/workflows/ci.yml)

[Sponsor ❤️](https://github.com/sponsors/mutluerol-happy) · [Issues](https://github.com/mutluerol-happy/mtl-ldap-admin/issues) · [Discussions](https://github.com/mutluerol-happy/mtl-ldap-admin/discussions)

</div>

---

## Features

- **User & group management** — full CRUD, bulk operations, CSV import/export, LDIF
- **Self-service password reset** (MTL Password Reset) — security questions, email, SMS
- **Multi-factor authentication** (TOTP) — admin-enforceable
- **Audit logging** — both internal actions and slapd `accesslog` overlay
- **Schema browser** — attribute types, object classes, syntax
- **DN tree explorer** — view + edit any entry
- **OU/group operations** — create, delete, move, rename
- **Webhooks** — push events to Slack, Discord, or any HTTP endpoint
- **SMTP / SMS / LDAPS UI management** — encrypted credentials, in-app cert upload
- **Internationalization** — English, Turkish (more easily added)
- **Replication monitoring** — placeholder; full UI when paired with second server

## Quick start

### Requirements

- Linux (Rocky 9 / RHEL 9 / Ubuntu 22.04+ tested)
- OpenLDAP 2.5+ (`slapd`) running and reachable
- Go 1.22+ (for building)
- Node.js 20+ and npm (for building the frontend)
- Optional: SMTP server (for email reset), HTTP SMS gateway

### Install

```bash
git clone https://github.com/mutluerol-happy/mtl-ldap-admin.git
cd mtl-ldap-admin
sudo ./install/install.sh
```

The installer asks for your domain, admin DN, etc. and:

1. Detects your distro and installs build deps
2. Generates random `JWT_SECRET` and admin password
3. Builds the binary and frontend
4. Installs the systemd unit and starts the service
5. **Prints the admin password once.** Save it.

Open `http://your-server:8080` and sign in.

### Manual install

- [docs/install-rocky.md](docs/install-rocky.md) — Rocky 9 / RHEL 9
- [docs/install-ubuntu.md](docs/install-ubuntu.md) — Ubuntu 22.04 / 24.04

### Optional setup

- [docs/01-accesslog-overlay.md](docs/01-accesslog-overlay.md) — slapd accesslog (external audit feed)
- [docs/02-ldaps-listen.md](docs/02-ldaps-listen.md) — make slapd listen on LDAPS port

## Configuration

All runtime config lives in `/opt/mtl-ldap-admin/.env`:

```env
LDAP_URL=ldap://localhost:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=...
LDAP_BASE_DN=dc=example,dc=com
LDAP_USERS_DN=ou=users,dc=example,dc=com

HTTP_LISTEN=:8080
PUBLIC_URL=https://ldap.example.com
JWT_SECRET=...                # 32+ char random; rotate to invalidate sessions

SELF_SERVICE_METHODS=questions,email,sms

# Optional .env-only fallback (UI-managed values take precedence)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_STARTTLS=true
```

SMTP, SMS, and LDAPS are configurable via the **Settings** page. Credentials are AES-GCM encrypted at rest with a key derived from `JWT_SECRET`.

## Development

```bash
# Backend
go run ./cmd/server

# Frontend (in another shell)
cd web
npm install
npm run dev          # http://localhost:5173 (proxies API to :8080)
```

## Internationalization

UI is available in English and Turkish. To add a language:

1. Copy `web/src/locales/en.ts` to `web/src/locales/<lang>.ts`
2. Translate the strings
3. Register the language in `web/src/lib/i18n.tsx`

PRs for additional languages welcome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions are welcome — code, docs, translations, bug reports.

## License

[Apache License 2.0](LICENSE) · Copyright 2026 Mutlu Erol

## Sponsor

If MTL LDAP Admin saves you time, consider [sponsoring on GitHub ❤️](https://github.com/sponsors/mutluerol-happy).

---

<sub>Built for OpenLDAP. Not affiliated with the OpenLDAP Foundation.</sub>
