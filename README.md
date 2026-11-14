# TrueNAS PostgreSQL Backup Manager

A secure, automated web application designed to take backups of PostgreSQL databases hosted on a TrueNAS server (or any PostgreSQL instance) and download them **one by one** with live progress tracking, error recovery, batch ZIP archive options, strict RBAC, and mandatory TOTP Multi-Factor Authentication.

---

## Security & Access Control

- **Strict Two-Role RBAC**:
  - **IT (Full Admin)**: Full access to backups, User Management (create, edit, unlock, delete accounts, reset MFA), Audit Log viewer & JSON export, TrueNAS environment config, and Deployment docs.
  - **Manager (View/Backup Access)**: Access to database discovery, connection health tests, sequential backups, and archive downloads. Blocked from User Management, Audit Logs, and admin API endpoints.
- **No Public Signup**: Account registration is completely disabled. Only `IT` administrators can provision accounts. The first `IT` administrator is automatically bootstrapped from `.env` on first boot.
- **Mandatory TOTP MFA**: Every user must enroll an authenticator app (QR code + 6-digit OTP) and save 8 single-use recovery backup codes on first login. `IT` admins can reset MFA for any user to force re-enrollment.
- **Hardened Session & Transport Security**:
  - Passwords hashed with `bcryptjs` (cost 12) and TOTP secrets encrypted at rest with AES-256-GCM.
  - `HttpOnly`, `SameSite=Lax`, `Secure` (over HTTPS) session cookies with sliding inactivity timeout (default 15 minutes).
  - CSRF protection (`X-CSRF-Token` verified with `crypto.timingSafeEqual`) on all state-changing requests.
  - Account lockout (5 failed password or OTP attempts → 15-minute lock) and per-IP rate limiting.
  - Persistent audit log recording logins, MFA actions, lockouts, user admin CRUD, connection tests, discoveries, and backups.

---

## Backup Features

- **TrueNAS Environment Integration**: Reads server connection details directly from TrueNAS environment variables (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_SSL`).
- **Interactive Server Discovery**: Auto-discovers all non-template databases directly from your PostgreSQL server catalog (`pg_database`) with a single click.
- **Sequential 1-by-1 Downloads**: Takes backups and triggers automated sequential browser downloads with polite throttling to avoid browser pop-up blockers.
- **Dual Backup Engine**: Uses native `pg_dump` via `execFile` (no shell interpolation) or falls back smoothly to a pure TypeScript/Node.js PostgreSQL dumper.
- **GitHub Actions Workflows**: Includes ready-to-run workflows for GitHub Pages static preview and multi-arch Docker image publishing to GitHub Container Registry (`ghcr.io`).

---

## Environment Variables

Configure these environment variables in your TrueNAS SCALE App Settings (**Apps** → **Discover Apps** → **Custom App** or **Docker Compose**):

### PostgreSQL Connection
| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `POSTGRES_HOST` | Hostname or IP of PostgreSQL server | `localhost` | `192.168.1.100` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` | `5432` |
| `POSTGRES_USER` | PostgreSQL user with backup permissions | `postgres` | `truenas_backup` |
| `POSTGRES_PASSWORD` | PostgreSQL user password | `""` | `SuperSecretPassword!` |
| `POSTGRES_DATABASE` | Initial database to query `pg_database` | `postgres` | `postgres` |
| `POSTGRES_SSL` | Enable SSL encryption (`true` / `false` / `require`) | `false` | `false` |

*(Aliases prefixed with `TRUENAS_POSTGRES_*` and standard `PGHOST`/`PGUSER` are also supported).*

### Login Credentials & Security (TrueNAS Environment Variables)
| Variable | Description | Default |
| :--- | :--- | :--- |
| `TRUENAS_ADMIN_USERNAME` *(or `IT_ADMIN_USERNAME`)* | IT Admin login username (synced automatically when updated) | `it-admin` |
| `TRUENAS_ADMIN_EMAIL` *(or `IT_ADMIN_EMAIL`)* | IT Admin login email address | `it-admin@truenas.local` |
| `TRUENAS_ADMIN_PASSWORD` *(or `IT_ADMIN_PASSWORD`)* | IT Admin login password (synced automatically when updated) | `TrueNAS-Admin-2026!` |
| `TRUENAS_MANAGER_USERNAME` / `_PASSWORD` | Optional Manager login credentials managed via TrueNAS env | `None` |
| `TRUENAS_RESET_ADMIN_MFA` | Set to `true` on container boot to reset IT Admin TOTP MFA | `false` |
| `SESSION_SECRET` | Secret key used to sign CSRF tokens and derive store encryption | Auto-generated in `AUTH_DATA_DIR` |
| `SESSION_INACTIVITY_MINUTES` | Sliding idle session timeout in minutes | `15` |
| `AUTH_DATA_DIR` | Persistent directory for users, encrypted TOTP secrets, and audit logs | `./data` |

---

## Deployment on GitHub

This repository includes two GitHub Actions workflows:

1. **Deploy to GitHub Pages (`.github/workflows/deploy.yml`)**:
   - Builds and publishes the static frontend to GitHub Pages on push to `main` or `master`.
   - In your GitHub repository, go to **Settings** → **Pages** → set **Source** to **GitHub Actions**.

2. **Publish Docker Image (`.github/workflows/docker-publish.yml`)**:
   - Builds multi-platform Docker images (`linux/amd64`, `linux/arm64`) and pushes to `ghcr.io/<your-username>/truenas-postgres-backup:latest`.
   - In TrueNAS SCALE, point your Custom App image repository to `ghcr.io/<your-username>/truenas-postgres-backup:latest` and mount a persistent host path to `/app/data`.

---

## Running with Docker / TrueNAS SCALE

Run directly with Docker (note the `/app/data` volume to persist users, MFA secrets, and audit logs across container restarts):

```bash
docker run -d \
  --name truenas-postgres-backup \
  -p 3000:3000 \
  -v truenas_pg_backup_data:/app/data \
  -e POSTGRES_HOST="192.168.1.100" \
  -e POSTGRES_PORT="5432" \
  -e POSTGRES_USER="postgres" \
  -e POSTGRES_PASSWORD="my_password" \
  -e TRUENAS_ADMIN_USERNAME="it-admin" \
  -e TRUENAS_ADMIN_PASSWORD="ChangeMe_StrongPassword_2026!" \
  -e SESSION_SECRET="replace-with-32-byte-random-hex" \
  ghcr.io/username/truenas-postgres-backup:latest
```

Or deploy using the included `docker-compose.yml`.
