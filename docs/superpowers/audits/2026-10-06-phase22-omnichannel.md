# Phase 22 — Omnichannel Commerce & Fulfillment Closure Audit

Date: 2026-10-06
Branch: `codex/phase22-omnichannel-design-v2`
Baseline: `fd686025b80f31acb0400a5ade5acc11b400ef78` (merged Phase 21)
Closure commit subject: `test: close phase22 omnichannel verification`

## Result

Phase 22 is verified for the approved first-party omnichannel scope: public guest ordering, reservation-aware inventory, linked Sale settlement, pickup/pay-at-pickup, manual delivery fulfillment, staff Order operations, scoped customer status access, delivery-fee refund accounting, observability, and tenant/branch/RBAC isolation.

No Phase 22 flow introduces a second financial ledger or a second stock authority. Sale remains the financial settlement authority, inventory movements remain the final stock mutation authority, InventoryReservation owns temporary availability, and Fulfillment owns physical handoff state only.

## Implementation commits

| Commit | Scope |
| --- | --- |
| `b485db6` | Revised Phase 22 design |
| `5e7543b` | Closed design review gaps |
| `8c3bdea` | Added implementation plan |
| `3d12cc2` | Omnichannel persistence |
| `998aa87` | Online ordering settings |
| `c6e25fc` | Staff Order reads |
| `41751be` | Reservation-aware inventory protection |
| `0f66301` | Linked WEB Sale settlement |
| `ef30320` | Delivery-fee refund accounting |
| `ced91c1` | Secure guest checkout |
| `6b21600` | Fulfillment workflow |
| `7655eeb` | Customer ordering and secure status UI |
| `33123c5` | Staff Order/fulfillment UI |
| `test: close phase22 omnichannel verification` | Task 11 security, metrics, concurrency, load, PG parity, browser and closure evidence |

## Persistence

- Migration: `packages/database/prisma/migrations/0035_phase22_omnichannel_orders`.
- PostgreSQL and memory ports both cover Order, immutable submitted OrderLine snapshots, InventoryReservation, Fulfillment/FulfillmentLine, OrderAccessToken, storefront-key lookup, bounded Order paging/filtering, and delivery refund fields.
- Historical Sales without Orders remain valid; no historical backfill was introduced.
- Public storefront lookup uses the random storefront key and does not accept a raw public `businessId`.

## Inventory and financial authority

- Canonical mutation lock order remains business Sale lock first, sorted inventory locks second.
- HELD reservations reduce available-to-sell without creating inventory movements.
- The Order's own active reservation is excluded from competing availability at linked Sale completion, then committed atomically with the normal Sale inventory movement.
- Normal POS completion, WEB settlement, transfer dispatch, supplier-return posting, and negative inventory-count posting reject consumption of HELD stock with `RESERVATION_CONFLICT`.
- PayMongo webhook settlement and reconciliation reuse Sale completion semantics and replay without duplicating stock or payment effects.
- Delivery fee and delivery tax are explicit Sale/Refund values; refunds stay in the existing RefundService, Payment and reporting model.

## Security and redaction evidence

Focused Phase 22 security contracts cover:

- exact configured Origin on cookie-authenticated public mutations;
- cross-business storefront/branch rejection;
- checkout token scoped to one Order;
- status token scoped to one Order;
- status lookup by POST body only, not query string;
- redacted public status projection without email, phone or delivery address;
- cross-tenant staff detail denial;
- least-privilege seeded Order permission matrix;
- audited owner/manager CRM mismatch override while submitted contact snapshots remain immutable;
- status-token fragment consumed and synchronously removed from retained browser URL state;
- no status bearer persisted in localStorage/sessionStorage or emitted to browser console.

Metric labels are sanitized before exposition. Tests explicitly reject leakage of email, phone, address/instruction/note/payload-like labels, 32+ hex secret-like values, status/checkout tokens, and the metrics bearer token.

## Concurrency and idempotency evidence

Memory/service contracts prove:

- two last-unit WEB holds have one winner;
- accept versus expiry converges to one coherent terminal outcome;
- WEB hold versus POS Sale rejects stock theft;
- WEB hold versus transfer dispatch rejects stock theft;
- WEB hold versus supplier return rejects stock theft;
- WEB hold versus negative inventory count rejects stock theft;
- cancellation/release replay is effect-once;
- fulfillment transition replay is effect-once.

Existing settlement tests additionally prove PayMongo webhook replay and payment reconciliation replay are effect-once.

PostgreSQL two-instance tests prove:

- two Order reservations racing for the same last unit produce exactly one HELD winner;
- WEB hold versus POS Sale for the last unit produces exactly one authoritative outcome;
- existing Sale last-unit, idempotency-claim and webhook-event races remain effect-once.

Full PostgreSQL result: **16 files, 157 tests passed**.

## Observability

Phase 22 adds low-cardinality metrics for:

- Order lifecycle by channel/status;
- reservation held/released/expired/committed/conflict outcomes;
- aged non-expiring operational holds;
- WEB/POS Sale completion channel;
- payment handoff started/failed/unknown/reconciled;
- fulfillment outcomes and transition-latency buckets;
- idempotency conflicts;
- guest access failures/revocations.

No PII or bearer material is intended as a metric label.

## Disposable local load cohort

Harness: `scripts/load/phase22-orders.mjs`
Deterministic harness tests: **2/2 passed**.
Environment label: `local_or_staging_disposable`; `productionLatencyClaim=false`.

Two local samples were retained on 2026-10-06:

**Rate-limit saturation cohort**

- duration: 3 seconds;
- concurrency: 2;
- total operations: 1,076;
- public catalog: 269/269 success, p50 2.19 ms, p95 15.61 ms, p99 16.15 ms;
- bounded staff list: 269/269 success, p50 2.77 ms, p95 16.13 ms, p99 17.38 ms;
- submit/hold: 29/270 success; the remaining 241 requests were HTTP 429 from the intentional public mutation rate limiter;
- status lookup: 120/268 success; the remaining 148 requests were HTTP 429 from the intentional status rate limiter.

**Under-limit latency cohort**

- duration: 1 second;
- concurrency: 1;
- total operations: 46;
- public catalog: 12/12 success, p50 15.25 ms, p95/p99 16.68 ms;
- submit/hold: 12/12 success, p50 46.70 ms, p95/p99 47.99 ms;
- bounded staff list: 11/11 success, p50 14.41 ms, p95/p99 15.63 ms;
- status lookup: 11/11 success, p50 15.64 ms, p95/p99 16.35 ms;
- aggregate error rate: 0%.

The saturated submit/status error rates are rate-limit evidence, not production reliability or latency claims. The under-limit cohort is local-only evidence and is explicitly not a production latency claim. Failure samples contain only operation/class/redacted detail and do not retain request credentials, contact data, URLs, storefront keys, status tokens or cookies.

## Verification matrix

| Gate | Result |
| --- | --- |
| `pnpm verify` | PASS — `SCAFFOLD_OK` |
| `pnpm test` | PASS — 7/7 packages; API 130 files / 629 tests; web 65 files / 245 tests |
| `pnpm test:exit` | PASS — 16 files / 68 tests |
| `pnpm typecheck` | PASS — 7/7 packages |
| `pnpm lint` | PASS — 0 errors, 0 warnings |
| `pnpm build` | PASS — production web build and static generation complete |
| `pnpm audit --prod --audit-level critical` | PASS — 0 critical; 1 high advisory below configured threshold |
| `pnpm --filter @pos/api test:pg` | PASS — 16 files / 157 tests |
| `pnpm e2e` | PASS — 204/204 Playwright tests across desktop/tablet/mobile |
| Focused Phase 22 API security/metrics/concurrency | PASS — 17/17 |
| Focused Phase 22 browser smoke | PASS — 6/6 across desktop/tablet/mobile |

The final local Windows Playwright run uses a deterministic E2E runner with one browser worker, a prebuilt production Next server, package-local API `tsx` resolution, explicit server readiness checks, process-tree cleanup, and a single-run lock. This avoids the earlier Windows-only connection-refused cascades caused by test-server process teardown; the terminal Playwright result is `passed` with zero failed tests.

## Browser smoke coverage and provider limitation

The real local browser/API harness verifies owner setup, public storefront, guest pickup submission, staff acceptance, ready transition, existing POS tender at collection, completed Order, responsive Order surfaces, secure status-token scrubbing, and neutral provider-return copy with no false payment-success claim.

The local Playwright server intentionally starts with PayMongo disabled and has no runtime PayMongo test double. Therefore prepaid pickup/delivery signed-settlement is not fabricated in browser smoke. It is verified at API/service level using the existing injected FakePayMongo contracts, including signed webhook settlement, reservation commit, Order confirmation and duplicate webhook handling. The browser separately verifies that a provider return is never treated as payment authority. Adding a production-adjacent PayMongo browser stub solely for this closure was intentionally avoided.

## Dependency audit follow-up

`pnpm audit --prod` reports one high-severity transitive advisory:

- `source-map-js@1.2.1` through `next@15.5.26 -> postcss@8.5.23`;
- advisory: `GHSA-68fv-2mgg-jv7q`;
- patched in `source-map-js >=1.2.2`;
- no critical advisories are present, so the approved `--audit-level critical` gate passes.

This is a non-blocking dependency-maintenance follow-up, not silently waived.

## Out of scope remains out of scope

Phase 22 does **not** add:

- consumer account/login;
- online gift-card issue/reload/redemption;
- online loyalty or store-credit tender;
- courier integration, route optimization, distance pricing or cash-on-delivery;
- automatic cross-branch routing or automatic fulfillment assignment;
- force-post reservation overrides;
- a generic fee framework;
- historical Sale-to-Order backfill.

## Closure

The approved Phase 22 implementation and its production-safety gates are complete on the isolated worktree. Integration/deployment is a separate branch-finishing decision; this audit does not claim production deployment.
