# Local development — NexPOS

## Normal development

Run:

```text
pnpm dev
```

The launcher intentionally uses persistent PostgreSQL so normal local testing
behaves closer to production and survives API restarts. It will:

1. start `docker/docker-compose.yml`'s PostgreSQL container on host port 5433,
2. create `pos_dev` if it does not exist,
3. apply all pending SQL migrations through `scripts/apply-migrations.mjs`,
4. start the Nest API and Next.js web app together through Turbo.

Default local URLs:

```text
Web: http://localhost:3000
API: http://localhost:3001
DB:  postgres://pos:pos@localhost:5433/pos_dev
```

The web development server uses Turbopack. The first visit to a route can still
compile that route, but later client-side navigation should be much faster.

## Disposable memory mode

For isolated tests or a completely disposable manual session:

```text
pnpm dev:memory
```

This starts the same web/API development processes without `DATABASE_URL`, so
the API uses its development memory store. Data and accounts disappear whenever
the API restarts.

## Custom PostgreSQL

If `DATABASE_URL` is already set in the shell, `pnpm dev` uses that database
instead of starting/creating the default `pos_dev` database. Pending repository
migrations are still applied before the development servers start.

## Troubleshooting

- If Docker is unavailable, `pnpm dev` exits instead of silently falling back
  to memory storage. Use `pnpm dev:memory` only when that behavior is intended.
- If ports 3000, 3001, or 5433 are already occupied, identify the existing
  process/container rather than killing processes broadly.
- `/healthz` checks API liveness and `/readyz` checks PostgreSQL readiness.
- The local service worker file is deliberately fetch-free; it exists only to
  prevent stale localhost browser registrations from forcing Next.js to compile
  the 404 route for `/sw.js`.
