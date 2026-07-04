# Kingsmarque — Production Deployment (Part 19)

Single-server deployment of the full stack — nginx (TLS edge), FastAPI,
React, PostgreSQL + pgvector, Ollama — via `docker-compose.prod.yml`.
Security posture this fulfils: `SECURITY.md`.

## 1. Server requirements

- Linux host with Docker Engine + Compose v2.
- RAM: **8 GB minimum, 16 GB recommended** — the 7B chat model plus the
  bge-m3 embedding model dominate. With an NVIDIA GPU, uncomment the GPU
  block on the `ollama` service for order-of-magnitude faster inference.
- Disk: 30 GB+ (models ~5–8 GB, plus documents, database, backups).
- Ports 80 and 443 reachable (public deployments). LAN-only deployments
  need neither public DNS nor Let's Encrypt — see §3b.
- This stack is **single-node by design** (in-process job worker and rate
  limiter, one backend replica, `--workers 1`). Scale vertically; horizontal
  scaling requires the documented Redis swap first.

## 2. Install

```bash
git clone <your-repo> /opt/kingsmarque && cd /opt/kingsmarque
cp .env.production.example .env.production
# Fill EVERY secret — generation commands are in the file's comments:
#   KMQ_DB_PASSWORD, KMQ_SECRET_KEY, KMQ_STORAGE_ENCRYPTION_KEY (recommended),
#   KMQ_DOMAIN, KMQ_FRONTEND_ORIGIN, SMTP settings.
chmod 600 .env.production
```

## 3a. TLS — public domain (Let's Encrypt)

Point your domain's A record at the server, then:

```bash
export KMQ_LE_EMAIL=admin@yourfirm.in
./scripts/init-letsencrypt.sh due-diligence.yourfirm.in
```

The `certbot` sidecar renews automatically (checks twice daily).

## 3b. TLS — LAN / offline office server

```bash
./scripts/gen-self-signed.sh kingsmarque.lan
```

Remove the `certbot` service from `docker-compose.prod.yml` (nothing to
renew). Browsers warn once on the self-signed cert — expected; distribute
the cert to office machines to silence it.

## 4. First boot

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# Migrations apply automatically on start (KMQ_MIGRATE_ON_START=true).

# Pull the AI models into the ollama volume (~5-8 GB, once):
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec ollama ollama pull qwen2.5:7b
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec ollama ollama pull bge-m3

# Create the first super admin + seed the legal-terminology glossary:
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend python -m app.cli create-superadmin --email you@firm.in --name "Your Name"
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend python -m app.cli seed-glossary
```

Visit `https://<KMQ_DOMAIN>` — log in, then Admin → System Health should be
all green. Consider Admin → Organization → closing self-registration.

## 5. Backups

```bash
./scripts/backup.sh          # pg_dump (custom format) + storage tarball
```

Nightly cron (as the deploy user):

```
30 2 * * * cd /opt/kingsmarque && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Rules that matter:
- **Sync `backups/` off the server** (rsync/rclone/object storage) — on-box
  backups don't survive the box.
- If `KMQ_STORAGE_ENCRYPTION_KEY` is set, store that key with your offline
  backups: encrypted documents are unrecoverable without it.
- **Rehearse restore before you need it**: `./scripts/restore.sh
  backups/db-<stamp>.dump backups/storage-<stamp>.tar.gz` (prompts for
  confirmation; restores database and documents, verified roundtrip).
- Retention: `KMQ_BACKUP_RETENTION_DAYS` (default 14) prunes old sets.

## 6. Monitoring

- Every service has a compose healthcheck and `restart: unless-stopped`;
  `docker compose -f docker-compose.prod.yml ps` shows health at a glance.
- External uptime: point any pinger (UptimeRobot, healthchecks.io, your
  NOC) at `https://<domain>/api/v1/health`.
- In-app: Admin → System Health (DB latency, disk space, AI provider, OCR
  engines, job queue depths).
- Resource watch: `docker stats`. Ollama RAM pressure is the usual suspect.
- Optional growth (not shipped, deliberately): Prometheus + Grafana +
  node-exporter if you want dashboards/alerting beyond the above.

## 7. Logging

- All services log to stdout; the compose json-file driver caps each at
  10 MB × 5 files — logs cannot fill the disk.
- Tail: `docker compose -f docker-compose.prod.yml logs -f backend`
- The audit trail (who did what, from which IP) is in-app: Admin → Audit
  Logs. The proxy passes `X-Forwarded-For`, and uvicorn runs with
  `--proxy-headers`, so audited IPs are real client IPs.

## 8. Updating

```bash
cd /opt/kingsmarque
./scripts/backup.sh                                   # always before updating
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run on start. Rollback = `git checkout <previous-tag>` + rebuild +
restore the pre-update backup if a migration changed data shape.

## 9. Hard-won operational notes

- `client_max_body_size` (proxy, 64 m) must stay ≥ `KMQ_MAX_BODY_BYTES`
  (60 MB) or large uploads die at nginx with a bare 413.
- `http2 on;` in the proxy config requires nginx ≥ 1.25 — the pinned
  `nginx:1.27-alpine` image satisfies it; don't downgrade the image.
- Keep `KMQ_HSTS_ENABLED=true` only while TLS is actually live.
- Ollama's first request after a cold start loads the model into RAM
  (30–90 s CPU); subsequent requests are fast. The admin AI health check
  will show this as a slow first probe — normal.
