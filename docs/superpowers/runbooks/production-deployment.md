# Production deployment runbook

Audience: whoever operates the production environment. Read this end to end
before the first deploy; after that, sections 4–7 are the routine path.

## 1. Architecture

| Component | Image / command | Port | Notes |
|---|---|---|---|
| Web (Next.js 15) | `docker/web.Dockerfile` → `next start -p 3000` | 3000 | Browser app; uses same-site API traffic or a same-origin `/api` proxy |
| API (NestJS 11) | `docker/api.Dockerfile` → `tsx src/main.ts` | 3001 | Runs TypeScript from source by design (no build step) |
| PostgreSQL 16 | any managed Postgres | 5432 | Raw `pg` driver; migrations via `scripts/apply-migrations.mjs` |

Key constraints the architecture imposes on any hosting choice:

- Session cookies are `SameSite=Lax`. Browser API traffic must therefore be
  same-site with the web app. The normal production shape is a shared
  registrable domain (e.g. `app.example.com` + `api.example.com`). If a host's
  generated domains are separate sites because their parent is a public
  suffix (Render's `*.onrender.com` is the concrete case), keep browser
  traffic on the **web origin** and proxy `/api/*` server-side to the API.
- `WEB_URL` (API) must be the **exact web origin, https**; it drives CORS and
  every email link. `NEXT_PUBLIC_API_BASE` (web) is the browser-visible API
  origin and is inlined at web **build time**: normally the API origin, but
  for the Render same-origin proxy it is the web origin. `API_PROXY_TARGET`
  is the server-side API origin used only by that proxy shape.
- Production refuses to boot without `DATABASE_URL` and a complete
  transactional-email configuration (`ENV_MISSING_DATABASE_URL` /
  `ENV_MISSING_EMAIL_CONFIG`), and rejects a missing or malformed
  `APPROVAL_QUEUE_ENCRYPTION_KEY` before accepting traffic.
  There is no silent fallback to the in-memory store.
- The API needs **Node >= 24** (see `.nvmrc`).

## 2. Environment variables

Set these in the platform's secret/env store — never in the repository, never
in an image.

| Variable | Secret? | Required in prod | Meaning |
|---|---|---|---|
| `NODE_ENV` | no | yes | `production` (secure cookies, https-strict email config) |
| `DATABASE_URL` | **yes** | yes | Postgres connection string of the production DB |
| `APPROVAL_QUEUE_ENCRYPTION_KEY` | **yes** | yes | Stable 64-character hex encoding of 32 random bytes, used for encrypted manager grants. Generate once; do not rotate without a grant-expiry/rotation plan. |
| `WEB_URL` | no | yes | Public https origin of the web app (CORS + email links) |
| `API_PORT` | no | per platform | API listen port (default 3001; platforms often inject `PORT`) |
| `BREVO_API_KEY` | **yes** | one email transport required | Brevo HTTPS API key; preferred on Railway Free/Hobby because SMTP is blocked there |
| `SMTP_HOST` | no | SMTP alternative | `smtp-relay.brevo.com` |
| `SMTP_PORT` | no | SMTP alternative | `587` (STARTTLS) |
| `SMTP_SECURE` | no | SMTP alternative | `false` on 587 — nodemailer upgrades via STARTTLS |
| `SMTP_USER` | **yes** | SMTP alternative | Brevo SMTP login |
| `SMTP_PASS` | **yes** | SMTP alternative | Brevo SMTP key |
| `EMAIL_FROM` | no | yes | `NexPOS <sender@your-domain>` — must be a Brevo-verified sender |
| `PAYMONGO_SECRET_KEY` | **yes** | if Card/GCash/Maya/QR Ph are enabled | PayMongo server secret key (`sk_test_*` in staging, `sk_live_*` in production) |
| `PAYMONGO_WEBHOOK_SECRET` | **yes** | if Card/GCash/Maya/QR Ph are enabled | Secret for `/api/v1/payments/paymongo/webhook` |
| `PAYMONGO_API_BASE` | no | no | Defaults to `https://api.paymongo.com` |
| `PAYMONGO_WEBHOOK_TOLERANCE_SECONDS` | no | no | Signature timestamp tolerance, default 300 seconds |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | no | recommended (`1`) | Login gate until the emailed verification link is redeemed |
| `NEXT_PUBLIC_API_BASE` | no | yes (build arg) | Browser-visible API origin. Usually `https://api.example.com`; Render's default proxy uses the web origin instead. |
| `API_PROXY_TARGET` | no | only for same-origin proxy deployments | Server-side API target used by the Next.js `/api/*` rewrite. Accepts a full URL or a private `host:port`; Render uses the API service's private `hostport`. |
| `PG_POOL_MAX` | no | no | Pool size, default 30 |
| `PLATFORM_API_KEY` | **yes** | if using platform routes | Timing-safe key for `/api/v1/platform/*` |
| `BILLING_<PROVIDER>_SECRET` | **yes** | if billing webhooks are on | HMAC verification per provider |
| `METRICS_TOKEN` | **yes** | if scraping metrics | Bearer token for `/api/v1/metrics`; unset = endpoint closed |

## 3. Database and migrations

1. Provision a **clean** PostgreSQL 16 database. The SQL migrations are
   tracked in a `_migrations` ledger table, not written with `IF NOT EXISTS`,
   so first application must start from an empty database.
2. Apply all migrations **before first boot and before every schema-changing
   release**, using a separately authorized migration job:
   `node scripts/apply-migrations.mjs` with `DATABASE_URL` provided securely.
   Never use the production API container startup as a migration trigger.
   The runner serializes attempts with a database advisory lock, wraps each
   migration in a transaction, and records it in `_migrations`; re-running
   successful migrations is a no-op. Take and verify a backup before proceeding.
   Review each SQL change for backward compatibility with the still-running
   API; if it is incompatible, schedule maintenance rather than hot-deploying.
3. Never run destructive commands (`DROP`, `pg_restore --clean`) against the
   production database outside the documented restore runbook
   (`docs/superpowers/runbooks/backup-restore.md`).
4. Schedule `scripts/backup.sh` (pg_dump custom format) and rehearse
   `scripts/restore.sh` on a scratch instance.

## 4. Brevo transactional email

1. Generate a **fresh Brevo API key** for hosts using HTTPS delivery (including
   Railway Free/Hobby). The previously leaked keys are considered revoked;
   never paste secrets into chat or tickets — enter them only in the hosting
   platform's secret store as `BREVO_API_KEY`.
2. If the host allows SMTP and SMTP is preferred, generate a fresh SMTP key
   instead and use the SMTP variables from section 2. Configure exactly one
   transport; the API refuses ambiguous API+SMTP configuration.
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

### 5.2 Railway

Railway can run the existing Docker images directly. Use three services in one
project: `web`, `api`, and PostgreSQL. On Railway Free/Hobby, outbound SMTP is
disabled, so configure `BREVO_API_KEY` and do **not** set the SMTP variables.

1. Add Railway PostgreSQL.
2. Create the API service from this repository and set
   `RAILWAY_DOCKERFILE_PATH=/docker/api.Dockerfile`.
3. Add `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `NODE_ENV=production`,
   `WEB_URL`, `BREVO_API_KEY`, `EMAIL_FROM`, and
   `AUTH_REQUIRE_EMAIL_VERIFICATION=1` to the API service.
4. Set the API pre-deploy command to
   `node /app/scripts/apply-migrations.mjs`. A failed migration blocks the
   rollout before new traffic is served.
5. Set the API health check to `/readyz`.
6. Create the web service from the same repository and set
   `RAILWAY_DOCKERFILE_PATH=/docker/web.Dockerfile` plus the build-time
   `NEXT_PUBLIC_API_BASE=https://<api-domain>` variable.
7. Generate HTTPS domains for web and API. Keep them on the same registrable
   custom domain for the current `SameSite=Lax` session model, e.g.
   `app.example.com` and `api.example.com`.

### 5.3 Other platform-managed containers (Render / Fly / Cloud Run …)

1. Create a managed Postgres and note `DATABASE_URL`.
2. Create two services from the repo: web (`docker/web.Dockerfile`) and api
   (`docker/api.Dockerfile`). When the generated hostnames are same-site, build
   web with `NEXT_PUBLIC_API_BASE=https://<api-host>`. When they are not
   same-site, use `NEXT_PUBLIC_API_BASE=https://<web-host>` plus
   `API_PROXY_TARGET=https://<api-host>` so Next.js forwards `/api/*` without
   exposing the session cookie cross-site. Attach the secret env from section
   2 to the API service.
3. Add a one-off release step (or run it manually from an authorized machine)
   that executes `node scripts/apply-migrations.mjs` with `DATABASE_URL` set
   only for the approved target database, **before** new API code receives
   traffic. Do not use a normal API restart for this operation.
4. Health probes: liveness `GET /healthz`, readiness `GET /readyz` on the API
   service. Prefer one registrable custom domain for web/API. If using the
   same-origin proxy shape, the API service can keep its platform hostname
   because browsers never send session cookies to it directly.

#### Render Blueprint

The repository's `render.yaml` uses the same `docker/web.Dockerfile` as other
container deployments and wires the safe proxy shape for Render's generated
domains:

```text
browser -> https://nexpos-web.onrender.com/api/*
        -> Next.js rewrite
        -> http://<render-private-api-host>:10000/api/*
```

`WEB_URL` is the single canonical public web origin in the Blueprint.
`NEXT_PUBLIC_API_BASE` copies that value through a Blueprint `fromService`
reference, while `API_PROXY_TARGET` is derived from the API service's private
`hostport`. Render exposes these non-secret service variables as Docker build
args, so the same generic web image receives the values when Next.js builds.
Do not change the session cookie to `SameSite=None` merely to make the two
generated Render hostnames talk directly from the browser.

**Render Free staged release checklist:** Free web services do not support
`preDeployCommand`, so `render.yaml` disables automatic deploys on both API
and web. (1) Record current commit and back up the database; (2) audit new
migration SQL and verify mixed-version compatibility; (3) configure
`APPROVAL_QUEUE_ENCRYPTION_KEY` in the API service's secret settings (generate
with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`);
(4) on an approved, trusted machine with Node 24, installed dependencies,
and the intended `DATABASE_URL`, manually run `node scripts/apply-migrations.mjs`
**once** and verify `_migrations`; (5) manually deploy the selected API commit,
verify `/readyz` and critical flows, then manually deploy web. Never paste
database credentials or encryption keys into chat or logs. A failed migration
is a release stop; investigate and restore from backup only under the restore
runbook. This checklist is guidance, **not authorization** to access production.

### 5.4 Floot (evaluated, not viable)

Floot is a closed app-builder: per its docs it "cannot run your existing
codebase as-is — it rebuilds it", has no import tool, no terminal/git, and no
custom Node backend or transactional-email configuration. Deploying NexPOS there would mean
rebuilding every backend guarantee (PG locking, idempotency, session/CSRF
model, transactional email) on a proprietary stack. Not supported; see section 1 for
the requirements any real host must meet.

## 6. First-boot checklist

- [ ] `GET https://<api>/healthz` → `{"ok":true}`; `GET /readyz` → `{"ok":true}`
- [ ] API logs show no `ENV_MISSING_*` / `ENV_INVALID_*` errors
- [ ] Register an account; the API returns `verificationRequired: true` and
      the Brevo inbox receives a link to
      `https://<web>/verify-email?token=…`
- [ ] Redeem the link; login succeeds
- [ ] `GET https://<web>` renders the dashboard and authenticated API calls
      succeed. On Render defaults, confirm browser requests target
      `https://<web>/api/*` rather than the API hostname directly.
- [ ] `GET /api/v1/payments/methods` reports Card/GCash/Maya/QR Ph as available only
      when PayMongo is configured
- [ ] PayMongo test-mode checkout redirects to PayMongo and the signed webhook
      completes the local sale; see `docs/superpowers/runbooks/paymongo-payments.md`

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
  Cross-origin deployments must remain same-site, or use the documented
  same-origin web proxy; the default Render blueprint uses the proxy.
- CORS: exactly one origin — `WEB_URL`, `credentials: true`.
- Security headers incl. HSTS applied by middleware; API sets
  `Cache-Control: no-store` on API responses.
- Tokens (sessions, verification, reset) are stored hashed; only hashes hit
  the database; email-provider failures are audit events
  (`auth.*.delivery-failed`) and leak nothing.
- Password reset and verification resend are enumeration-resistant (generic
  responses, 5/min/IP rate limits) and reset revokes all sessions.
- Card / GCash / Maya / QR Ph use PayMongo Hosted Checkout. NexPOS never accepts or
  stores raw card numbers, CVC, or PAN data; browser redirects are not treated
  as payment confirmation, and signed webhooks are the settlement authority.
