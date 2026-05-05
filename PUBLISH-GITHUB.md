# Publishing to GitHub

This is the step-by-step for releasing the project to GitHub for the first time. Skip steps you've already done.

## 1. Create the GitHub repository

1. Go to https://github.com/new
2. **Owner**: `mutluerol-happy` (your account)
3. **Repository name**: `mtl-ldap-admin`
4. **Description**: "Modern OpenLDAP admin panel with self-service password reset, MFA, and audit logging"
5. **Visibility**: Public
6. ⚠ Do **not** check "Initialize this repository with README/.gitignore/license" — we already have those locally.
7. Click **Create repository**.

GitHub shows you a URL like `https://github.com/mutluerol-happy/mtl-ldap-admin.git`. Copy it.

## 2. Initialize git locally and push

From the unpacked release folder (where this `PUBLISH-GITHUB.md` lives):

```bash
git init -b main
git add -A
git commit -m "initial release: v0.1.0"
git remote add origin https://github.com/mutluerol-happy/mtl-ldap-admin.git
git push -u origin main
```

You'll need to authenticate. GitHub no longer accepts password auth — use a [Personal Access Token](https://github.com/settings/tokens) (classic, with `repo` scope) as your password, or use SSH:

```bash
git remote set-url origin git@github.com:mutluerol-happy/mtl-ldap-admin.git
git push -u origin main
```

## 3. Set up GitHub Sponsors

The heart button (❤️) in the app's top-right links to your GitHub Sponsors page. To activate it:

1. Go to https://github.com/sponsors/mutluerol-happy
2. Complete the sponsor profile setup (a few clicks; KYC may be required for receiving payments)
3. Add a `FUNDING.yml` file:

```bash
mkdir -p .github
cat > .github/FUNDING.yml <<EOF
github: mutluerol-happy
EOF
git add .github/FUNDING.yml
git commit -m "add github sponsors funding link"
git push
```

This adds a "Sponsor" button to your repo's main page.

## 4. Push the first release tag

GitHub Actions will build a release tarball and create a GitHub Release automatically when you push a tag.

```bash
git tag -a v0.1.0 -m "MTL LDAP Admin v0.1.0 — initial public release"
git push origin v0.1.0
```

Watch the workflow at:
`https://github.com/mutluerol-happy/mtl-ldap-admin/actions`

After it completes (~2-3 minutes), the release shows up at:
`https://github.com/mutluerol-happy/mtl-ldap-admin/releases`

The release will include:
- `mtl-ldap-admin-v0.1.0-linux-amd64.tar.gz` — pre-built binary + frontend dist
- `.sha256` checksum
- Auto-generated release notes from commits

## 5. Configure repo settings

On `https://github.com/mutluerol-happy/mtl-ldap-admin/settings`:

- **Description**: same as the repo description above
- **Website**: (your demo URL if you have one)
- **Topics**: `ldap`, `openldap`, `golang`, `react`, `admin-panel`, `password-reset`, `self-service`, `mfa`, `audit-log`
- **Features**: keep Issues, Discussions, Wiki as you prefer
- **Pull Requests**: enable "Allow squash merging" only (cleaner history)
- **Branches → main**: turn on "Require status checks to pass before merging" once CI is green

## 6. Add a screenshot to the README

Once you have a live deployment, take screenshots of:

- Dashboard
- Users page
- Settings page (SMTP/SMS/LDAPS)

Upload them to a folder like `docs/img/` and update README.md to reference them.

## 7. Announce

- Post in [r/openldap](https://reddit.com/r/openldap)
- Hacker News "Show HN"
- Tweet/post the repo link
- Tag relevant people who might find it useful

## Updating later

For new releases:

```bash
# make some changes, commit, push
git push origin main

# bump version
git tag -a v0.2.0 -m "v0.2.0 — new features"
git push origin v0.2.0
```

CI builds and publishes automatically.

## Common issues

### `! [rejected] main → main (fetch first)`

Repo isn't empty; pull first:

```bash
git pull origin main --rebase --allow-unrelated-histories
```

If GitHub auto-created a README/LICENSE that conflicts, delete those files locally and force-push:

```bash
git push -f origin main
```

(Only safe on the very first push, when no one else has cloned.)

### `permission denied (publickey)`

Use HTTPS + PAT instead, or set up SSH keys: https://docs.github.com/en/authentication/connecting-to-github-with-ssh

### Workflow failed: missing `web/package-lock.json`

Make sure `npm install` was run locally at least once before committing — `package-lock.json` should be in the repo. Add it:

```bash
cd web && npm install && cd ..
git add web/package-lock.json
git commit -m "add package-lock.json"
git push
```
