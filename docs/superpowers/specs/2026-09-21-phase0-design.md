# Phase 0 Foundation Design - Online POS

**Date:** 2026-09-21
**Source spec:** `G:\Vscode\PLAN.md` sections 5, 6, 11, 17 (Phase 0)
**Status:** Approved design, implementation-ready

## Goal

Establish monorepo, tenant-scoped auth/session, RBAC, API conventions, money/tax rules, audit shape, logging, test harness, migrations, and env config so that a tenant-scoped authenticated request can read a protected resource and cross-tenant access fails safely.

## Architecture

Modular monolith per PLAN.md 5.1: Next.js web -> NestJS REST API (`/api/v1`) -> PostgreSQL (Prisma). Explicit module boundaries with private internals. No Redis, workers, storage, or offline in Phase 0.

```text
Browser -> apps/web (Next.js) -> apps/api (NestJS /api/v1) -> PostgreSQL
```

## Monorepo Layout

```text
online-pos/
  apps/web/             Next.js + React + Tailwind
  apps/api/             NestJS modular monolith
  packages/database/    Prisma schema, migrations, repositories
  packages/types/       Shared domain types and enums
  packages/validation/  Shared Zod schemas
  packages/auth/        Session and permission contracts
  packages/ui/          Design tokens + base components
  packages/config/      TS, lint, test, env helpers
  tests/integration/ e2e/ load/
  docker/ docs/
```

Toolchain: TypeScript strict end-to-end, pnpm 9 + Turborepo, Node 24, Docker Postgres local, Vitest + Playwright, Prisma ORM/migrations.

## Tenant Context

- Every business-owned table includes `businessId`.
- Tenant derived server-side from authenticated membership; never trust client-supplied tenant ID.
- Explicit active business in session/request context; multi-membership via explicit `BusinessMembership` rows.
- Tenant-scoped repository helpers + automated cross-tenant tests (read + write with guessed IDs must 403/404 safely).

## Auth and Sessions

- Stateful sessions: `Session` table (id, userId, businessId, token hash, expires, revoked, device/IP metadata) + httpOnly Secure SameSite cookie.
- Registration creates Business + owner Membership + default settings + onboarding state.
- Password hashing with adaptive algorithm (argon2/bcrypt), password reset via single-use token, session revoke + list, re-auth gate for high-risk settings.
- CSRF protection for cookie mutations, rate limits on login/reset, session expiry.

## RBAC

- `Role`, `Permission`, `BusinessMembership` tables; server checks role/permission + resource scope on every command and read.
- Sensitive actions gated: price/cost edits, discount above threshold, voids, refunds, inventory adjustments, user management, settings, exports, shift closure overrides.
- Platform support access reserved (time-bounded, audited) - model boundary only in Phase 0.

## API Conventions

- Versioned `/api/v1/...`, resource-oriented REST, no raw table exposure.
- Error envelope: `{ code, message, correlationId, fields? }` with stable codes.
- `X-Request-Id` / correlation ID on every request and log; ISO 8601 UTC timestamps on wire.
- Cursor pagination for high-volume lists; bounded page pagination for catalog screens.
- `Idempotency-Key` header contract reserved (enforced Phase 4; schema column reserved Phase 0 where cheap).

## Money, Tax, Rounding

- Integer minor units (centavos) for PHP; no float for authoritative totals.
- Central rounding mode/scale config; same policy client display + server validation.
- Business-level currency + tax config; sale-line snapshot fields reserved (enforced Phase 4).
- Validation: reject negative prices/quantities, excessive discounts at schema level.

## Audit Shape

Append-only `AuditLog`: `businessId, actorId, action, entityType, entityId, beforeSnapshot, afterSnapshot, reason, requestId, ip/device/session, timestamp`. No app-level updates/deletes. Sensitive values redacted. Phase 0 audits: auth, business create, settings, role/permission changes.

## Logging and Config

- Structured JSON logs with correlationId, tenant/user context where permitted, redaction.
- Env separation: local/staging/prod config + secrets outside source control; `docker/` Postgres local + seed.
- Health endpoint protected: requires auth + membership scope.

## Test Harness

- Vitest unit (money, permissions, state guards), integration vs PostgreSQL (tenant scoping, migrations), API contract (validation, auth, error codes, pagination), Playwright skeleton for critical path.
- Phase 0 exit tests: authenticated scoped read passes; cross-tenant read/write blocked; expired/revoked session mutation rejected; manipulated tenant ID rejected.

## Migrations and Env

- Prisma migrations forward-applied, reviewed, with rollback/restore notes.
- CI: type-check, lint, unit/integration, migration check, build, selected E2E.

## Exit Criteria

Tenant-scoped authenticated request can read protected health/profile resource; cross-tenant tests fail safely. No implementation beyond foundation in this phase.

## Non-Goals (Phase 0)

No POS UI, catalog, inventory ledger, payments, shifts, reports, branches, offline, billing, integrations, or AI per PLAN.md.
