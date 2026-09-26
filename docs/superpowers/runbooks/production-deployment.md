# Production deployment runbook

Audience: whoever operates the production environment. Read this end to end
before the first deploy; after that, sections 4–7 are the routine path.

## 1. Architecture

| Component | Image / command | Port | Notes |
|---|---|---|---|
| Web (Next.js 15) | `docker/web.Dockerfile` → `next start -p 3000` | 3000 | Browser app; calls the API cross-origin with cookies |
| API (NestJS 11) | `docker/api.Dockerfile` → `tsx src/main.ts` | 3001 | Runs TypeScript from source by design (no build step) |
| PostgreSQL 16 | any managed Postgres | 5432 | Raw `pg` driver; migrations via `scripts/apply-migrations.mjs` |

Key constraints the architecture imposes on any hosting choice:

- **Web and API must share a registrable domain** (e.g. `app.example.com` +
  `api.example.com`). Session cookies are `SameSite=Lax`, so two unrelated
  domains would silently break login.
- `WEB_URL` (API) must be the **exact web origin, https**; it drives CORS and
  every email link. `NEXT_PUBLIC_API_BASE` (web) must be the **exact API
  origin** and is inlined at web **build time**.
- Production refuses to boot without `DATABASE_URL` and a complete SMTP
  configuration (`ENV_MISSING_DATABASE_URL` / `ENV_MISSING_EMAIL_CONFIG`).
  There is no silent fallback to the in-memory store.
- The API needs **Node >= 24** (see `.nvmrc`).

## 2. Environment variables

Set these in the platform's secret/env store — never in the repository, never
in an image.

| Variable | Secret? | Required in prod | Meaning |
|---|---|---|---|
| `NODE_ENV` | no | yes | `production` (secure cookies, https-strict email config) |
| `DATABASE_URL` | **yes** | yes | Postgres connection string of the production DB |
| `WEB_URL` | no | yes | Public https origin of the web app (CORS + email links) |
| `API_PORT` | no | per platform | API listen port (default 3001; platforms often inject `PORT`) |
| `SMTP_HOST` | no | yes | `smtp-relay.brevo.com` |
| `SMTP_PORT` | no | yes | `587` (STARTTLS) |
| `SMTP_SECURE` | no | yes | `false` on 587 — nodemailer upgrades via STARTTLS |
| `SMTP_USER` | **yes** | yes | Brevo SMTP login (Brevo → SMTP & API) |
| `SMTP_PASS` | **yes** | yes | Brevo SMTP key (fresh key; old leaked keys are revoked) |
| `EMAIL_FROM` | no | yes | `NexPOS <sender@your-domain>` — must be a Brevo-verified sender |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | no | recommended (`1`) | Login gate until the emailed verification link is redeemed |
| `NEXT_PUBLIC_API_BASE` | no | yes (build arg) | Public https origin of the API, e.g. `https://api.example.com` |
| `PG_POOL_MAX` | no | no | Pool size, default 30 |
| `PLATFORM_API_KEY` | **yes** | if using platform routes | Timing-safe key for `/api/v1/platform/*` |
| `BILLING_<PROVIDER>_SECRET` | **yes** | if billing webhooks are on | HMAC verification per provider |
| `METRICS_TOKEN` | **yes** | if scraping metrics | Bearer token for `/api/v1/metrics`; unset = endpoint closed |

## 3. Database and migrations

1. Provision a **clean** PostgreSQL 16 database. The SQL migrations are
   tracked in a `_migrations` ledger table, not written with `IF NOT EXISTS`,
   so first application must start from an empty database.
2. Apply all migrations **before first boot**:
   `DATABASE_URL=postgres://… node scripts/apply-migrations.mjs`
   (16 migrations, ~47 tables). Re-running is a no-op — the ledger makes it
   idempotent, which is what makes multi-instance rollouts safe.
3. Never run destructive commands (`DROP`, `pg_restore --clean`) against the
   production database outside the documented restore runbook
   (`docs/superpowers/runbooks/backup-restore.md`).
4. Schedule `scripts/backup.sh` (pg_dump custom format) and rehearse
   `scripts/restore.sh` on a scratch instance.

## 4. Brevo transactional email

1. Generate **fresh** SMTP credentials: Brevo → profile → **SMTP & API** →
   create a new SMTP key. The previously leaked keys are considered revoked;
   never paste secrets into chat or tickets — enter them only in the hosting
   platform's secret store.
2. Note the **SMTP login** shown on the same page (this is `SMTP_USER`).
3. Verify the sending identity: Brevo → **Senders, Domains & IP** → add and
   verify the sender used in `EMAIL_FROM` (single-sender verification is
   enough to send; domain authentication below is what keeps mail out of
   spam).
4. **Domain authentication (recommended for a custom domain)** — Brevo →
   Senders, Domains & IP → Domains → *Add a domain*, then publish at your DNS
   host exactly what Brevo displays (values are per-domain; copy them from
   Brevo, do not invent them):
   - **SPF**: add `include:spf.brevo.com` to your existing TXT record at the
     apex, e.g. `v=spf1 include:spf.brevo.com ~all` (merge into one record if
     SPF already exists).
   - **DKIM**: the TXT record Brevo generates for the domain (a
     `k=rsa;p=…`-style value Brevo shows after you add the domain).
   - **DMARC**: TXT at `_dmarc.your-domain`, starting with
     `v=DMARC1; p=none; rua=mailto:postmaster@your-domain` and tightening to
     `p=quarantine`/`p=reject` once reports look clean.
   DNS changes need no code deploy; Brevo shows a "check authentication"
   action once records propagate.

## 5. Deploy options

### 5.1 Docker Compose (VPS or any Docker host)

`docker/production-compose.example.yml` brings up web, api, postgres and a
one-shot migration job. Copy it, fill in the environment block from section 2
(never commit the filled copy), then:

```
docker compose -f production-compose.yml up -d --wait
```

### 5.2 Platform-managed containers (Railway / Render / Fly / Cloud Run …)

1. Create a managed Postgres and note `DATABASE_URL`.
2. Create two services from the repo: web (Dockerfile `docker/web.Dockerfile`,
   build arg `NEXT_PUBLIC_API_BASE=https://<api-host>`) and api
   (`docker/api.Dockerfile`). Attach the secret env from section 2 to the API
   service.
3. Add a one-off release step (or run it once manually) that executes
   `node scripts/apply-migrations.mjs` with `DATABASE_URL` set — before the
   API receives traffic.
4. Health probes: liveness `GET /healthz`, readiness `GET /readyz` on the API
   service. Point platform HTTPS domains at the two services and keep them on
   one registrable domain (section 1).

### 5.3 Floot (evaluated, not viable)

Floot is a closed app-builder: per its docs it "cannot run your existing
codebase as-is — it rebuilds it", has no import tool, no terminal/git, and no
custom Node backend or SMTP configuration. Deploying NexPOS there would mean
rebuilding every backend guarantee (PG locking, idempotency, session/CSRF
model, Brevo SMTP) on a proprietary stack. Not supported; see section 1 for
the requirements any real host must meet.

## 6. First-boot checklist

- [ ] `GET https://<api>/healthz` → `{"ok":true}`; `GET /readyz` → `{"ok":true}`
- [ ] API logs show no `ENV_MISSING_*` / `ENV_INVALID_*` errors
- [ ] Register an account; the API returns `verificationRequired: true` and
      the Brevo inbox receives a link to
      `https://<web>/verify-email?token=…`
- [ ] Redeem the link; login succeeds
- [ ] `GET https://<web>` renders the dashboard and calls the API with
      credentials (cookies stick across the two origins)

## 7. Smoke suite (every deploy)

Full list lives in the delivery checklist: home page → register → verify
email → login → onboarding → create product → inventory → open shift → cash
sale → receipt → close shift → password reset request → email → reset →
login with the new password. Scripted checks:

```
curl -fsS https://<api>/healthz
curl -fsS https://<api>/readyz
curl -fsS -o /dev/null -w '%{http_code}\n' https://<web>
node scripts/load/dashboard-mix.mjs   # optional latency budget check
```

## 8. Security posture in production

- Cookies: `httpOnly`, `secure` (NODE_ENV=production forces it), `SameSite=Lax`.
- CORS: exactly one origin — `WEB_URL`, `credentials: true`.
- Security headers incl. HSTS applied by middleware; API sets
  `Cache-Control: no-store` on API responses.
- Tokens (sessions, verification, reset) are stored hashed; only hashes hit
  the database; responses never echo them; SMTP failures are audit events
  (`auth.*.delivery-failed`) and leak nothing.
- Password reset and verification resend are enumeration-resistant (generic
  responses, 5/min/IP rate limits) and reset revokes all sessions.
- Payment methods are recorded as tender types; no card numbers or PAN data
  are stored anywhere.
