# Contributing to MTL LDAP Admin

Thanks for your interest in contributing! This project is small and pragmatic — we welcome bug reports, feature ideas, code, docs, and translations.

## Bug reports

Open an issue with:

- What you tried
- What happened
- What you expected
- Output from `journalctl -u mtl-ldap-admin -n 50` if applicable
- Server distro (Rocky 9, Ubuntu 24.04, etc.) and OpenLDAP version (`slapd -V`)

## Feature requests

Start with a [discussion](https://github.com/mutluerol-happy/mtl-ldap-admin/discussions) to gauge interest before sending a large PR.

## Pull requests

### Setup

```bash
git clone https://github.com/<your-fork>/mtl-ldap-admin.git
cd mtl-ldap-admin
go mod download
cd web && npm install && cd ..
```

### Development loop

```bash
# Backend
go run ./cmd/server

# Frontend (separate shell)
cd web
npm run dev   # http://localhost:5173
```

### Before submitting

- `go vet ./...` clean
- `go build ./...` clean
- `cd web && npx tsc -b` clean
- `cd web && npm run build` clean
- Manual smoke test: log in, create a user, change password, sign out

### Style

- Go: standard `gofmt`. No external linter required, but match the existing style.
- TypeScript / React: follow patterns in nearby files. Tailwind for styling.
- Commit messages: short imperative subject, details in the body if relevant.

## Translations

To add a new language:

1. Copy `web/src/locales/en.ts` to `web/src/locales/<lang>.ts`
2. Translate the strings (keep the same key tree)
3. Register the language in `web/src/lib/i18n.tsx`:
   ```ts
   import { mylang } from '../locales/<lang>'
   const DICTS = { en, tr: tr as Dict, mylang: mylang as Dict }
   type Lang = 'en' | 'tr' | 'mylang'
   ```
4. Add the option to the `<select>` in `web/src/components/Layout.tsx`

You don't need to translate everything in one PR — partial translations fall back to English for missing keys.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
