# Production-readiness audit — 2026-09-26

## Scope

This pass audited the current `master` application after the premium Figma UI merge, with emphasis on authentication, tenant/RBAC boundaries, payment/idempotency behavior, inventory and branch attribution, offline replay, shift/cash consistency, plan entitlements, production persistence, dependency security, and release verification.

The audit used the repository's memory-backed deterministic tests plus desktop/tablet Playwright flows. A follow-up release gate then ran the PostgreSQL parity, migration, multi-instance, production-boot, browser, and backup/restore checks against the repository's PostgreSQL 16 Docker runtime.

## Critical / high findings fixed

1. **Password-reset credential disclosure.** `POST /api/v1/auth/password-reset/request` returned the reset token to an unauthenticated caller. The HTTP response now returns only the generic success message, and the credential is delivered out of band through the transactional-email service.
2. **Production could silently run on ephemeral memory storage.** API startup now fails with `ENV_MISSING_DATABASE_URL` when `NODE_ENV=production` and `DATABASE_URL` is absent.
3. **Password re-authentication did not refresh the sensitive-action window.** Confirming the password now refreshes the session `authenticatedAt` timestamp in both memory and PostgreSQL ports.
4. **Password-reset single-use race.** Concurrent confirmations of one token could both pass the read-before-mark sequence. Reset consumption, password update, token use, and session revocation now run under the shared reset-token lock/transaction.
5. **Sale inventory could be debited from the wrong branch.** Completion now applies stock against the resolved completion branch and rejects branch/register mismatches at draft and completion time.
6. **Concurrent member invites could exceed the plan seat cap.** User lookup/creation and membership creation now run inside the same billing-cap critical section as the seat check.
7. **Cash expense creation could race shift close.** A shift-linked cash expense and its `paid_out` movement now share the same shift lock as close, keeping the closed-shift snapshot consistent.
8. **Cash expense void could race shift close.** The offsetting till adjustment is now serialized with close; if the relevant shift is no longer open the void records `cashAdjusted=false` rather than mutating a closed till.
9. **Known dependency advisories.** Workspace overrides move `multer` to `2.3.0` and `postcss` to `8.5.23`. `pnpm audit --prod` reports no known vulnerabilities after the update.
10. **Email-verification registration-session bypass.** When verification was enabled, login rejected unverified users but the session created during registration could still access authenticated routes. `SessionGuard` now enforces verification too, while the same pending session becomes usable after the token is redeemed.

Each code finding above has a focused regression test that reproduced the pre-fix behavior before the implementation change.

## Verification evidence

- `pnpm test`: all 7 package tasks passed; after transactional-email integration the API suite is **73 files / 368 tests** and the web suite is **26 files / 81 tests**.
- `pnpm typecheck`: all 7 package tasks passed.
- `pnpm build`: production web build passed and generated **32/32 pages**, including `/verify-email`.
- `pnpm verify`: `SCAFFOLD_OK`.
- `pnpm audit --prod`: no known vulnerabilities.
- Critical Playwright matrix: desktop + 1024px tablet `critical-path`, `payment-unknown`, and `offline` suites passed 8/8.
- Registration/billing Playwright matrix after email integration passed **14/14** across desktop and tablet.

## PostgreSQL release gate — passed

- Local runtime: PostgreSQL 16 (`postgres:16-alpine`) through `docker/docker-compose.yml` on port 5433.
- PG parity suite: `pnpm --filter @pos/api test:pg` passed **13 files / 130 tests**.
- Multi-instance proofs passed for last-unit stock, one idempotency key, and one webhook claim.
- A clean disposable `pos_release_gate` database applied **16/16 migrations** from zero; an immediate rerun applied **0**, proving migration idempotency at HEAD.
- PostgreSQL-backed critical Playwright matrix passed **8/8** across desktop and tablet.
- Full PostgreSQL-backed Playwright suite passed **32/32** across desktop and tablet.
- `NODE_ENV=production` API booted successfully against the migrated PostgreSQL database. Its unauthenticated `/api/v1/health` response remained the documented protected-route `401 TENANT_REQUIRED` contract.
- `pg_dump`/`pg_restore` round trip succeeded into a separate `pos_restore_gate` database. Source/restored representative counts matched exactly: `_migrations=16`, `Business=32`, `User=32`, `Product=32`, `Sale=14`, `Payment=12`, `Shift=4`, `Expense=0`.
- Fixed the Phase 12 CI PG harness environment mismatch: the helper reads `PGTEST_BASE`, and CI now sets `PGTEST_BASE` instead of the unused `PGTEST_URL`. `verify-phase12` now asserts this wiring and passes.

## Remaining release blockers / external dependencies

### 1. Transactional email provider deployment configuration

Transactional email is implemented with a shared message layer and two delivery transports: Brevo's HTTPS transactional-email API and provider-agnostic SMTP via Nodemailer. Password-reset links expire in one hour; verification links expire in 24 hours; neither credential is returned by the public HTTP endpoints. Registration reports only `verificationRequired`, resend responses are non-enumerating, and delivery failures are recorded as audit actions without leaking credentials. Production startup fails closed when mail configuration is missing or ambiguous, and production `WEB_URL` must be HTTPS.

The SMTP adapter was exercised end-to-end against a disposable SMTP server (Mailpit): registration emitted a verification email, password reset emitted a reset email, both messages contained the expected web links, the verification link completed successfully in a real browser, and the reset link opened directly on the new-password form. The Brevo HTTPS transport has regression coverage for request shape, secret isolation, provider failures, and production configuration. Before public deployment, configure a fresh Brevo API key (or SMTP credentials on an SMTP-capable host) plus sender-domain authentication and run the smoke procedure in `docs/superpowers/runbooks/email-delivery.md`.

### 2. PayMongo production credentials and live-mode verification

Card, GCash, and Maya now use a PayMongo Hosted Checkout v2 integration rather than direct/manual success recording. Checkout creation is server-side and idempotent; Maya maps to PayMongo's `paymaya` method; local payments remain `PENDING` until a verified `checkout_session.payment.paid` webhook matches the expected business, sale, checkout session, method, and amount. Webhook deliveries use the raw request body for `Paymongo-Signature` verification and the existing webhook-event ledger for deduplication. The POS disables those electronic methods when PayMongo is not configured, and the legacy direct-completion endpoint refuses to mark Card/GCash/Maya successful outside the provider workflow.

The remaining external dependency is operational rather than architectural: configure PayMongo test credentials and a test-mode webhook, run Card/GCash/Maya sandbox flows, then configure fresh live credentials and a separate live webhook only after UAT. The deployment and smoke sequence is documented in `docs/superpowers/runbooks/paymongo-payments.md`.

## Release position

The application is materially safer and more internally consistent after this pass, and the memory-backed, PostgreSQL, migration, backup/restore, unit, contract, SMTP-smoke, and desktop/tablet E2E gates are green. Transactional email code is complete. PayMongo settlement code is now integrated, but public deployment still requires fresh PayMongo test/live credentials, a correctly configured signed webhook endpoint, and real sandbox/live smoke verification in addition to the email sender/domain setup.
