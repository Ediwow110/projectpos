# Production-readiness audit — 2026-09-26

## Scope

This pass audited the current `master` application after the premium Figma UI merge, with emphasis on authentication, tenant/RBAC boundaries, payment/idempotency behavior, inventory and branch attribution, offline replay, shift/cash consistency, plan entitlements, production persistence, dependency security, and release verification.

The audit used the repository's memory-backed deterministic tests plus desktop/tablet Playwright flows. A follow-up release gate then ran the PostgreSQL parity, migration, multi-instance, production-boot, browser, and backup/restore checks against the repository's PostgreSQL 16 Docker runtime.

## Critical / high findings fixed

1. **Password-reset credential disclosure.** `POST /api/v1/auth/password-reset/request` returned the reset token to an unauthenticated caller. The HTTP response now returns only the generic success message; a production delivery channel must provide the token out of band.
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

- `pnpm test`: all 7 package tasks passed; after the final email-verification guard regression, the API suite is 71 files / 360 tests and the web suite is 26 files / 81 tests.
- `pnpm typecheck`: all 7 package tasks passed.
- `pnpm build`: production web build passed and generated 31/31 pages.
- `pnpm verify`: `SCAFFOLD_OK`.
- `pnpm audit --prod`: no known vulnerabilities.
- Critical Playwright matrix: desktop + 1024px tablet `critical-path`, `payment-unknown`, and `offline` suites passed 8/8.

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

### 1. Transactional email delivery is not implemented

Password reset and optional email verification create secure, hashed, expiring tokens, but there is no SMTP/email-provider integration in the repository. The HTTP API intentionally does not reveal these credentials. Before production use of password reset—or before enabling `AUTH_REQUIRE_EMAIL_VERIFICATION=1`—connect a transactional email provider and deliver the generated token/link out of band.

### 2. Real card/e-wallet settlement is not integrated

The payment-provider layer currently contains manual/test-double adapters, and the repository explicitly has no real-money provider SDK integration. Cash flows are complete; Card/GCash/Maya should be treated as manual tender recording unless a real provider integration and operational reconciliation process are added. Do not represent those methods as automatically settled by an external provider until that integration exists.

## Release position

The application is materially safer and more internally consistent after this pass, and the memory-backed, PostgreSQL, migration, backup/restore, unit, contract, and desktop/tablet E2E gates are green. The remaining release blockers are external integrations: transactional email delivery for reset/verification credentials and real provider settlement if Card/GCash/Maya are expected to settle automatically rather than operate as manual tenders.
