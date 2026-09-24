# Phase 11 Requirement Closures and Operational Hardening Design - Online POS

**Date:** 2026-09-25
**Source spec:** `G:\Vscode\PLAN.md` — FR-AUTH-01, FR-TENANT-02, FR-RBAC-02, FR-PLATFORM-01, FR-PAY-01, FR-REFUND-02, FR-CASH-04, FR-RECEIPT-01, §6.7, §13.3, §14.2, §18 #10/#12/#14
**Status:** Implementation-ready, derived from the 2026-09-25 PLAN.md compliance audit. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-24-phase10-saas-design.md` (all Phase 0-10 behavior preserved; every existing suite must stay green)
**Out of scope (owned elsewhere):** all UI/UX and frontend design — another workstream owns `apps/web` pages, styling, and interaction design. This phase is backend/API/ops only; where a gap needs UI wiring, the API surface ships here and the UI is left to the frontend workstream.
**Successor (deferred):** Phase 12 — PostgreSQL-backed `DbPort` at runtime (the audit's top-ranked divergence; own spec and plan to follow). Shared rate limiting also lands there, because a cross-process limiter needs the shared store.

## Goal

Close every non-UI requirement gap the 2026-09-25 audit found between PLAN.md and the implementation: payment methods as tenant configuration, the runtime audit shape, `settings.write` enforcement, membership management (the `users`-cap caller), refund approval thresholds, the post-close correction workflow, session-persisted active business, email verification behind a flag, time-bounded platform support grants, receipt download/share, plus the missing §13.3 threat tests, CI hygiene (lint, build, dependency audit), and a metrics endpoint.

**Exit:** every FR in scope has a verdict "followed" against PLAN.md with contract or unit proof; `pnpm test`, `pnpm test:exit`, and `pnpm typecheck` stay green; CI runs lint, build, and a production dependency audit; `/metrics` emits the §14.2 counters the runbooks name.

## Architecture

Same modular monolith, additive only. One new migration (`0012_phase11_closures`) adds three small tables (`EmailVerificationToken`, `PlatformSupportGrant`, `ShiftCorrection`) and one nullable column (`Session.activeBusinessId`). New behavior hangs off existing services; the only new route families are memberships, platform grants, receipt share, and metrics. `AuditEntry` grows optional fields (`at`, `reason`, `before`, `after`) — additive, so every existing audit call site stays valid; the memory store stamps `at` when the caller omits it, aligning the runtime shape with the Prisma `AuditLog` table that already has these columns.

```text
NestJS /api/v1
  sales      payment methods resolve from business settings (fallback defaults)
  business   settings.write permission enforced; settings patch audited with snapshots
  tenant     membership management (user.manage), users cap enforced via BillingService
  refunds    approval threshold from settings
  shifts     post-close correction records (append-only), report surfaces them
  auth       email verification behind a flag; active business persisted on session
  billing/platform   support grants (time-bounded, purpose-bound, audited)
  receipts   download (text) + share token endpoints
  metrics    Prometheus text counters, bearer-gated
```

## Key decisions

1. **Payment methods are data (FR-PAY-01).** Business settings gain `paymentMethods: Array<{ key, label }>`, seeded with the plan's six methods at business creation. Sale/expense validation resolves against the business's configured list, falling back to the built-in defaults when unset — so existing businesses and tests see exactly today's behavior. `GET /payments/methods` returns the configured list. The static zod enum for `method` widens to a string; the service rejects unconfigured methods with `VALIDATION`.
2. **Audit shape (§6.7, §18 #10).** `AuditEntry` gains `at: Date` (required, stamped by the store when omitted), and optional `reason?: string`, `before?: unknown`, `after?: unknown`. Settings patches, plan changes, and refund decisions write before/after snapshots and reasons. Timestamps make audit rows orderable; snapshots make them explainable — both are required by PLAN.md 6.7 and acceptance criterion 10.
3. **Membership management closes the `users` cap seam (FR-RBAC-02, §16.2).** `POST /memberships` (permission `user.manage`) creates the user (if new) with a one-time random temp password and an active membership; `GET /memberships` lists; `POST /memberships/:id/deactivate` ends the membership. Creation runs through `BillingService.requireCreate(businessId, ..., "users")`, giving the plan cap its live caller — a Free business past 3 users gets 402 `PLAN_LIMIT` with machine fields.
4. **Refund threshold (FR-REFUND-02).** Settings key `refundApprovalThresholdMinor` (integer, default `null` = policy unchanged). When set and the refund total exceeds it, only a role holding `refund.override` may approve; the requester≠approver rule still applies. Owners hold `refund.override` in the role seed.
5. **Post-close corrections (FR-CASH-04).** A closed shift is never mutated. `POST /shifts/:id/corrections` (manager roles + `shift.close.override`, reason required) appends a `ShiftCorrection` row; `GET /shifts/:id` returns corrections and a corrected expected figure (`expectedCash + Σ corrections`). The next shift's opening state is unaffected — corrections are a documented, audited ledger of the closed shift's true variance.
6. **Active business on the session (FR-TENANT-02).** `Session.activeBusinessId` (nullable). `POST /auth/active-business` validates membership and persists the choice; `SessionGuard` resolves the tenant from it, falling back to the first membership when null — existing sessions behave unchanged. Login keeps pinning the first membership.
7. **Email verification is opt-in (FR-AUTH-01 "when enabled").** Settings flag `requireEmailVerification` (default false → zero behavior change). When enabled at registration: the user is created `emailVerified: false`, a single-use token row is written, and login answers `EMAIL_UNVERIFIED` until `POST /auth/verify-email { token }` flips the flag and revokes the session's pending state. The endpoint that would email the token is out of scope (no mail infra); the token is returned in the registration response body marked `verificationToken` so the flow is testable — a real mailer is a Phase 12+ integration.
8. **Support grants (FR-PLATFORM-01).** `POST /platform/grants`, authenticated by `PLATFORM_API_KEY`, creates `{ purpose, ttlMinutes ≤ 60 [SPEC-DEFAULT], actorId }` and returns a one-time bearer token (`sup_...`, sha256 at rest). Platform routes accept `x-support-grant: <token>` instead of the platform key only while the grant is unexpired and unused; every action taken under a grant audits with `grantId` and `purpose`. This adds the missing time-bound and purpose-bound legs of FR-PLATFORM-01.
9. **Receipt download/share (FR-RECEIPT-01).** `GET /receipts/:saleId/download` streams `text/plain` with `Content-Disposition: attachment` (the rendered receipt text). `POST /receipts/:saleId/share` mints a share token (32-byte hex, sha256 at rest, 24 h expiry `[SPEC-DEFAULT]`); `GET /receipts/shared/:token` needs no session and returns the minimal receipt JSON. Both are permissioned like receipt view.
10. **Metrics (§14.2).** `GET /api/v1/metrics` emits Prometheus text format: `pos_http_requests_total{route,status}`, `pos_auth_failures_total`, `pos_sales_completed_total`, `pos_payment_unknown_total`, `pos_inventory_failures_total`. Gated by bearer `METRICS_TOKEN` (403 when unset) — no tenant data leaves the process, only counters.
11. **CI hygiene (§18 #14).** Add lint (`pnpm lint`), build (`pnpm build`), and `pnpm audit --prod --audit-level critical` steps; plus the missing §13.3 threat tests: unauthorized export (role without `export.run` → 403) and unauthorized close-with-override.
