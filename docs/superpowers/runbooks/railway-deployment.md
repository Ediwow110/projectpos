# Railway deployment — NexPOS

This is the shortest production path for the current repository. It uses the existing Dockerfiles and a Railway-managed PostgreSQL database; it does not rebuild the application in another framework.

## Services

Create one Railway project with exactly three services:

1. `postgres` — Railway PostgreSQL
2. `api` — repository service using `/docker/api.Dockerfile`
3. `web` — repository service using `/docker/web.Dockerfile`

The API image already contains `scripts/apply-migrations.mjs`, so no fourth migration service is needed. Use an API pre-deploy command instead.

## API service

Set `RAILWAY_DOCKERFILE_PATH=/docker/api.Dockerfile` and configure:

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
WEB_URL=https://<web-domain>
BREVO_API_KEY=<secret>
EMAIL_FROM=NexPOS <verified-sender@example.com>
AUTH_REQUIRE_EMAIL_VERIFICATION=1
```

Do not set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, or `SMTP_SECURE` on Railway Free/Hobby. Railway blocks outbound SMTP on those plans, while the Brevo HTTPS API works over normal HTTPS.

Set:

```text
Pre-deploy command: node /app/scripts/apply-migrations.mjs
Health check path: /readyz
```

The migration runner is idempotent through `_migrations`; if it exits non-zero, Railway should leave the previous deployment serving traffic.

## Web service

Set `RAILWAY_DOCKERFILE_PATH=/docker/web.Dockerfile` and set this variable **before the image builds**:

```text
NEXT_PUBLIC_API_BASE=https://<api-domain>
```

Next.js inlines `NEXT_PUBLIC_API_BASE` at build time, so changing it requires a rebuild/redeploy of the web service.

## Domains and cookies

The current session cookie is `Secure; SameSite=Lax`. Use web and API hostnames under one registrable domain, for example:

```text
app.example.com
api.example.com
```

Set `WEB_URL` to the exact public web origin and `NEXT_PUBLIC_API_BASE` to the exact public API origin. Railway can provision TLS for custom domains.

## Brevo

Use a newly generated Brevo API key, entered only in Railway's secret-variable UI as `BREVO_API_KEY`. Do not reuse any key that has appeared in chat or source control. Verify the `EMAIL_FROM` sender/domain in Brevo before the first delivery smoke test.

## First deployment checks

1. API deployment shows all migrations applied (or `0 applied` on later deploys).
2. `GET https://<api-domain>/healthz` returns `{"ok":true}`.
3. `GET https://<api-domain>/readyz` returns `{"ok":true}`.
4. Register with verification enabled and confirm no verification token is present in the HTTP response.
5. Confirm Brevo delivers the verification email and its URL uses the exact `WEB_URL`.
6. Redeem verification, log in, complete onboarding, and run one cash-sale/receipt/shift smoke path.
7. Request a password reset, redeem the emailed link, and confirm the new password works.

## Cost caveat

Railway's Free plan is suitable for initial deployment/testing but has a small monthly usage credit and tighter resource limits. Treat it as a launch/testing environment, monitor usage, and move to Hobby/Pro if the workload outgrows the included resources. The application itself does not rely on Railway-specific APIs, so moving to another Docker/PostgreSQL host remains straightforward.
