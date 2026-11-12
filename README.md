# TrueNAS PostgreSQL Backup Manager 🐘💾

A modern, automated web application designed to take backups of all specified PostgreSQL databases hosted on a TrueNAS server (or any PostgreSQL instance) and download them **one by one** with live progress tracking, error recovery, and batch archive options.

---

## 🚀 Features

- **TrueNAS Environment Integration**: Reads server connection details directly from TrueNAS environment variables (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_SSL`).
- **Interactive Server Discovery**: Auto-discovers all non-template databases directly from your PostgreSQL server catalog (`pg_database`) with a single click.
- **Sequential 1-by-1 Downloads**: Takes backups and triggers automated sequential browser downloads with polite throttling to avoid browser pop-up blockers.
- **Dual Backup Engine**: Uses native `pg_dump` when installed or falls back smoothly to a pure TypeScript/Node.js PostgreSQL dumper.
- **Connection Health Prober**: Test latency and connection to the TrueNAS PostgreSQL server with clear diagnostic hints.
- **GitHub Actions Workflows**: Includes ready-to-run, dependency-resilient workflows for GitHub Pages static deployment and multi-arch Docker image publishing to GitHub Container Registry (`ghcr.io`).

---

## ⚙️ TrueNAS Environment Variables

Configure these environment variables in your TrueNAS SCALE App Settings (**Apps** → **Discover Apps** → **Custom App** or **Docker Compose**):

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `POSTGRES_HOST` | Hostname or IP of PostgreSQL server | `localhost` | `192.168.1.100` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` | `5432` |
| `POSTGRES_USER` | PostgreSQL user with backup permissions | `postgres` | `truenas_backup` |
| `POSTGRES_PASSWORD` | PostgreSQL user password | `""` | `SuperSecretPassword!` |
| `POSTGRES_DATABASE` | Initial database to query `pg_database` | `postgres` | `postgres` |
| `POSTGRES_SSL` | Enable SSL encryption (`true` / `false` / `require`) | `false` | `false` |

*(Note: Aliases prefixed with `TRUENAS_POSTGRES_*` and standard `PGHOST`/`PGUSER` are also supported).*

---

## 🛠️ Deployment on GitHub

This repository includes two GitHub Actions workflows:

1. **Deploy to GitHub Pages (`.github/workflows/deploy.yml`)**:
   - Automatically builds and publishes the web interface to GitHub Pages on every push to `main` or `master`.
   - **Important**: In your GitHub repository, go to **Settings** → **Pages** (in the left sidebar) → set **Source** to **GitHub Actions** (not "Deploy from a branch"). This enables GitHub Actions permissions to publish your Pages site.
   - If a previous run failed with `Get Pages site failed`, setting Source to GitHub Actions and clicking **Re-run all jobs** will immediately resolve it.

2. **Publish Docker Image (`.github/workflows/docker-publish.yml`)**:
   - Builds multi-platform Docker images (`linux/amd64`, `linux/arm64`) and pushes to `ghcr.io/<your-username>/truenas-postgres-backup:latest`.
   - In TrueNAS SCALE, point your Custom App image repository to `ghcr.io/<your-username>/truenas-postgres-backup:latest`.

---

## 🐳 Running with Docker / TrueNAS SCALE

Run directly with Docker:

```bash
docker run -d \
  --name truenas-postgres-backup \
  -p 3000:3000 \
  -e POSTGRES_HOST="192.168.1.100" \
  -e POSTGRES_PORT="5432" \
  -e POSTGRES_USER="postgres" \
  -e POSTGRES_PASSWORD="my_password" \
  ghcr.io/username/truenas-postgres-backup:latest
```

Or deploy using the included `docker-compose.yml`.
