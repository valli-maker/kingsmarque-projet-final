# Kingsmarque — Security (Part 17)

Scope: the controls implemented in this codebase, mapped to OWASP Top 10
(2021), plus deployment guidance. TLS termination itself ships with Part 19's
reverse proxy; this document is the contract it fulfils.

## Authentication & sessions
- Argon2id password hashing; strong-password policy at registration.
- Short-lived JWT access tokens + rotating refresh tokens with token families:
  reuse of a rotated refresh token revokes the whole family (theft detection).
- Email verification before login; account deactivation blocks authentication
  immediately (`is_active` checked on every request).
- Bearer tokens only, sent in the `Authorization` header.

## CSRF — where applicable: nowhere, by design
Classic CSRF rides on credentials the browser attaches automatically
(cookies, HTTP auth). This API authenticates exclusively via the
`Authorization: Bearer` header set by application JavaScript; no
authentication cookie exists, so a cross-site form or image tag cannot make
an authenticated request. CORS additionally restricts which origins may
script the API (single configured frontend origin; explicit methods/headers).
If cookie-based sessions are ever introduced, CSRF tokens become mandatory —
revisit this section then.

## Rate limiting
- Endpoint buckets: login / registration / password-reset per IP (Part 2).
- Global per-IP sliding window across all endpoints → HTTP 429.
- In-process implementation (single node). The keyed async interface
  (`limiter.check(key, limit)`) is Redis-swappable for multi-node without
  touching call sites — the same honestly-stated scope as the job worker.

## Input & file validation
- Every request body is a strict Pydantic schema (types, lengths, patterns);
  unknown enum values and malformed dates are rejected with 422.
- Global request-size cap (413) before handlers run; uploads separately
  bounded (50 MB default).
- Uploads: extension allow-list AND magic-byte verification (content must
  match claimed type), filename sanitization to a safe basename, storage
  under server-generated UUID keys (user input never becomes a path), path
  traversal guarded at the storage layer.
- ZIP handling: in-memory extraction with entry-count and total-size ceilings;
  nested archives skipped; the archive itself is never retained.

## Encryption
- In transit: TLS at the reverse proxy (Part 19); enable
  `KMQ_HSTS_ENABLED=true` once TLS is live — the API then sends
  `Strict-Transport-Security`.
- At rest (documents): optional Fernet encryption (AES-128-CBC + HMAC-SHA256)
  of every stored file. Set `KMQ_STORAGE_ENCRYPTION_KEY` to a Fernet key:
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  Ciphertext is magic-prefixed (`KMQE1`), so enabling the key later leaves
  older plaintext files readable; treat the key as unrecoverable-if-lost.
- At rest (database): use disk/volume encryption for PostgreSQL in deployment;
  passwords are Argon2id hashes, tokens are random 256-bit values stored
  hashed.

## Audit logging (shared with Part 16)
- Closed action registry; entries carry actor, target, detail, IP
  (X-Forwarded-For-aware) and user agent.
- Security events: `login_success`, `login_failed`, role/activation changes,
  destructive deletes, AI model changes, glossary and membership changes.
- Admin-only, filterable endpoint; writes can never break the request path.

## Secure headers (every response)
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'` (API serves no HTML), `Permissions-Policy` (camera,
microphone, geolocation off), `Cross-Origin-Opener-Policy` and
`Cross-Origin-Resource-Policy: same-origin`, HSTS behind the TLS flag.

## HTTPS configuration
- Terminate TLS at nginx (Part 19 ships the config): TLS 1.2+, modern cipher
  suite, HTTP→HTTPS redirect, `proxy_set_header X-Forwarded-For/Proto`.
- Run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy>` so client
  IPs (rate limiting, audit) and scheme are correct behind the proxy.
- Then set `KMQ_HSTS_ENABLED=true`. Never enable HSTS on plain HTTP.

## OWASP Top 10 (2021) mapping
- **A01 Broken Access Control** — ownership + membership checks on every
  resource; cross-tenant probes return 404 (no existence oracle); viewers
  cannot mutate; admin-tier role changes restricted to super admins;
  search/retrieval filter on accessible projects, not raw table scans.
- **A02 Cryptographic Failures** — Argon2id; hashed tokens; optional Fernet
  at-rest document encryption; TLS at the proxy; no home-grown crypto.
- **A03 Injection** — SQLAlchemy bound parameters everywhere, including the
  full-text and vector paths; no string-built SQL from user input; React
  escapes output (no `dangerouslySetInnerHTML`).
- **A04 Insecure Design** — closed registries (audit actions, notification
  kinds, translation languages, OCR/translation engines); jobs fail to
  recorded state rather than crashing pipelines; version-pinned approvals.
- **A05 Security Misconfiguration** — secure headers middleware; OpenAPI docs
  disabled in production; strict CORS; explicit env-driven config with safe
  defaults; `.env.example` documents every knob.
- **A06 Vulnerable Components** — pinned minimum versions; small dependency
  surface; run `pip audit` / `npm audit` in CI (Part 18/19 wiring).
- **A07 Identification & Authentication Failures** — rate-limited auth
  endpoints, token-family revocation on refresh reuse, email verification,
  immediate deactivation, failed logins audited.
- **A08 Software & Data Integrity Failures** — SHA-256 content addressing and
  version records for documents; ZIP hardening; migrations are the only
  schema path.
- **A09 Security Logging & Monitoring Failures** — audit trail with IP/UA;
  admin health endpoint; structured app logging (Part 19 adds aggregation).
- **A10 SSRF** — the API fetches no user-supplied URLs; AI/OCR providers are
  fixed, operator-configured internal endpoints.

## Known gaps (stated, not hidden)
- Rate limiter and job worker are single-node in-process; multi-node needs
  the Redis swap.
- No account lockout beyond IP rate-limiting (deliberate: lockout is a
  denial-of-service lever against known emails).
- Storage-key rotation for at-rest encryption is manual (decrypt/re-encrypt
  script would ship with an ops runbook).
