# Phase 1 Authentication and Business Setup Design - Online POS

**Date:** 2026-09-21
**Source spec:** `G:\Vscode\PLAN.md` sections 4.1, 5.1, 5.3, 5.4, 6.1, 6.7, 7, 8, 9.1, 11, 13, 14, 17 (Phase 1)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-21-phase0-design.md` (all Phase 0 primitives are reused unchanged)

## Goal

Implement PLAN.md 17 Phase 1: registration, login/logout, password reset, business creation, onboarding wizard, business settings, owner membership, default roles, and session management.

**Exit (PLAN.md 17 verbatim):** an owner can create a business and reach an empty dashboard without configuration dead ends.

## Architecture

NestJS modular monolith per PLAN.md 5.1 and 11. Three modules, matching the §5.1 module list:

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  AuthModule      registration, login, logout, password reset, sessions, re-auth gate
  TenantModule    business creation, memberships, default role/permission seed, active-business switch
  BusinessModule  business settings, onboarding state
```

Cross-module calls use NestJS services only, never direct table access (PLAN.md 5.3). Phase 0 packages reused unchanged: `@pos/auth` guards, `@pos/database` tenant helper, `@pos/types` envelope, `@pos/validation` schemas, `@pos/config` env. No Redis, workers, storage, or offline in Phase 1 (PLAN.md 5.1).

## Data Model

All Phase 0 models reused as-is. One addition required by FR-AUTH-01 (password reset):

```text
PasswordResetToken
  id, userId, tokenHash (sha256 of opaque token, never plaintext),
  expiresAt, usedAt (null until consumed, single-use),
  createdAt, requestId, ip
```

`PasswordResetToken` is scoped by `userId`, not `businessId`: it is issued pre-authentication when no tenant context exists. It is never readable across users (lookup is by token hash only).

Onboarding state is stored in the existing `Setting` table under key `onboarding` (JSON, see wizard section). No other schema changes. Default roles and permissions are seed rows in `Role`, `Permission`, `RolePermission` created transactionally at registration.

## Auth Flows

### Registration (FR-AUTH-02)

`POST /api/v1/auth/register` accepts `{ ownerName, email, password, businessName }` and creates in one transaction: `User` (argon2id hash), `Business` (currency default `PHP`), `BusinessMembership` (owner role), default `Setting` rows, onboarding state with `businessDetails` marked done. Returns `201` with user/business profile and sets the session cookie: the owner is signed in immediately. Email verification is disabled by default (FR-AUTH-01: "verify email when enabled"); the verification toggle is reserved, no mail infrastructure in Phase 1.

Password policy `[SPEC-DEFAULT]`: minimum 12 characters, maximum 128, no other composition rules.

### Login / Logout (FR-AUTH-01)

`POST /api/v1/auth/login` accepts `{ email, password }`, verifies the argon2id hash in constant time, creates a `Session` row (random 32-byte opaque token, sha256 `tokenHash`, `expiresAt` 30 days `[SPEC-DEFAULT]`, IP/user-agent metadata), and sets the session cookie. Wrong credentials return `AUTH_INVALID_CREDENTIALS` with no indication of which field failed. Rate limit `[SPEC-DEFAULT]`: 5 attempts per minute per IP on login and reset endpoints (PLAN.md 7 requires rate limiting; number is spec-chosen).

`POST /api/v1/auth/logout` sets `revokedAt` and clears the cookie.

### Sessions

`GET /api/v1/auth/sessions` lists active sessions for device visibility. `DELETE /api/v1/auth/sessions/:id` revokes one. Session enforcement reuses Phase 0 `isSessionExpired` / `isSessionRevoked`. Tenant is derived from the session's membership via `deriveTenantFromMembership`, never from a client claim (FR-TENANT-01).

### Password Reset (FR-AUTH-01)

`POST /api/v1/auth/password-reset/request` accepts `{ email }`, issues a single-use token (hashed, 1-hour expiry `[SPEC-DEFAULT]`), and always returns the same success message whether or not the email exists (no user enumeration). `POST /api/v1/auth/password-reset/confirm` accepts `{ token, newPassword }`, sets the new hash, marks the token used, and revokes all other sessions for the user. Token reuse returns `AUTH_TOKEN_USED`.

### Cookies and CSRF (PLAN.md 7)

Cookie name `pos_session`, httpOnly, `Secure` in production, `SameSite=Lax`, `Path=/`. Cookie-authenticated mutations require an `X-CSRF-Token` double-submit header; the token is issued at login and on `GET /api/v1/auth/csrf`.

### Re-auth Gate (PLAN.md 7)

High-risk operations (role assignment, business settings write) require a session authenticated within the last 15 minutes `[SPEC-DEFAULT]` or a fresh password confirmation at `POST /api/v1/auth/confirm-password`. Otherwise `AUTH_REAUTH_REQUIRED`.

### Active Business (FR-TENANT-02)

`POST /api/v1/auth/active-business` accepts `{ businessId }`, verifies an explicit `BusinessMembership` row for the caller, and re-issues the session row's `businessId`. Tenant remains server-derived at every step.

## RBAC Seeding (FR-RBAC-01, FR-RBAC-02)

Registration seeds four roles matching PLAN.md 1.2 target users, using Phase 0 `SENSITIVE_ACTIONS` keys:

| Role | Grants |
|---|---|
| Owner | all permissions |
| Manager | all except `user.manage`, `settings.write` |
| Cashier | sell-scoped only: no `price.edit`, `cost.view`, `sale.refund`, `sale.void`, `settings.write`, `user.manage`, `export.run` |
| Inventory | catalog + `inventory.adjust`: no `sale.refund`, `user.manage`, `settings.write` |

Server checks role/permission plus resource scope on every command and read via Phase 0 `hasPermission` (FR-RBAC-01).

## Business Settings and Onboarding Wizard (PLAN.md 9.1)

Onboarding covers the five §9.1 areas in order: business details, tax/currency, receipt setup, first products, employees. Steps one to three are required; products and employees are skippable so the owner always reaches the dashboard (Phase 1 exit: "without configuration dead ends"). Progress persists server-side in `Setting` key `onboarding` as `{ currentStep, steps: { <step>: done | skipped } }`.

- `GET /api/v1/business` returns the current business profile plus settings.
- `PATCH /api/v1/business/settings` writes currency/tax/receipt fields (re-auth gated, audited).
- `GET /api/v1/onboarding` returns wizard state; `PATCH /api/v1/onboarding` advances or skips a step.
- `GET /api/v1/me` exposes the Phase 0 `me` shape over HTTP (tenant-scoped profile).

## API Endpoint Summary

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:id
POST   /api/v1/auth/password-reset/request
POST   /api/v1/auth/password-reset/confirm
POST   /api/v1/auth/active-business
POST   /api/v1/auth/confirm-password
GET    /api/v1/auth/csrf
GET    /api/v1/me
GET    /api/v1/business
PATCH  /api/v1/business/settings
GET    /api/v1/onboarding
PATCH  /api/v1/onboarding
GET    /api/v1/health (protected, Phase 0 shape)
```

All routes versioned, resource-oriented, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC on wire, `X-Request-Id` correlation (PLAN.md 5.4). `Idempotency-Key` remains reserved for Phase 4 (PLAN.md 5.4, 6.5).

## Error Codes

`AUTH_INVALID_CREDENTIALS`, `AUTH_EMAIL_TAKEN`, `AUTH_WEAK_PASSWORD`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_USED`, `AUTH_REAUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `TENANT_REQUIRED`, `TENANT_MISMATCH`, `VALIDATION`, `RATE_LIMITED`, `FORBIDDEN`.

## Audit (PLAN.md 6.7)

Append-only `AuditLog` via Phase 0 `appendAudit`, covering: registration, business create, login, logout, password-reset request/confirm, session revoke, role assignments, settings changes, active-business switch. Password hashes and reset tokens are redacted (never stored in snapshots).

## Web (PLAN.md 8, 9.1, 11)

Next.js + React + Tailwind per PLAN.md 11, server state via TanStack Query. Routes: `/login`, `/register`, `/password-reset`, `/onboarding` (5-step wizard, skippable products/employees), `/` empty dashboard (no dead ends: every empty state links to its future phase area or back to settings). Phase 0's status shell is superseded by the real app. No POS UI, catalog, or other phase surfaces (Non-Goals).

## Security Controls (PLAN.md 7)

Password hashing argon2id (OWASP first choice for "modern adaptive algorithm"; params `[SPEC-DEFAULT]`: memory 64 MiB, time 3, parallelism 4). Secure session cookies, CSRF on mutations, server-side authorization on every route, tenant-scoped queries via `withScope`, input validation with shared Zod schemas, rate limits on login/reset, secrets outside source control. No card data anywhere.

## Test Plan (PLAN.md 13)

- Unit: password policy, onboarding transitions, per-role permission matrix, session guards (extends Phase 0).
- API contract: validation, auth, stable error codes, pagination on sessions list.
- Abuse cases (PLAN.md 13.3 subset for Phase 1): cashier attempts settings change, manipulated tenant ID, expired/revoked session mutation, duplicate registration, reset-token reuse, login rate-limit breach.
- Exit proof: register -> complete or skip wizard steps -> empty dashboard reachable; cross-tenant access blocked throughout.

## Non-Goals (Phase 1)

No catalog, inventory ledger, POS UI, payments, shifts, reports, branches, offline, billing, integrations, or AI. Email verification stays disabled. Multi-branch and SaaS commercial layers are untouched (PLAN.md 16, Phase 9-10).

## Decisions to Preserve

- TypeScript strict end-to-end; NestJS modular monolith before any service split.
- Tenant isolation and authorization remain backend invariants; nothing in Phase 1 trusts client claims.
- `[SPEC-DEFAULT]` numbers (password 12-128, 30-day sessions, 15-minute re-auth, 5/min rate limit, 1-hour reset tokens, argon2id params) are changeable without breaking the design; they are recorded here so implementers use exact values.
