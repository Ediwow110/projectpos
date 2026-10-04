# Implementation Plan: Phase 20 — Loyalty, Gift Cards, and Store Credit

## Overview

Implement Phase 20 as additive vertical slices over the existing customer,
sale, payment, refund, audit, RBAC, reporting, export, memory, and PostgreSQL
architecture. The plan is ordered so every stored-value mutation is covered by
tests before UI and production smoke work.

## Architecture decisions

- Append-only ledgers are the balance authority; cached balances are not used.
- Gift-card bearer codes are generated server-side with 128-bit randomness and
  HMAC lookup hashes; plaintext is returned once only after successful load.
- Internal payment instrument identity uses additive fields, never `providerRef`.
- Sale and refund mutation paths use the existing lock plus `withTransaction`.
- Customer-bound instruments are resolved from authoritative server state.
- Internal tenders are online-only and never produce cash change.

## Task list

### Foundation

- [x] Task 1: Add Phase 20 Prisma models, migration, RLS, validation types, and
  memory/PostgreSQL adapter parity.
- [x] Task 2: Add secure gift-card code generation, masked lookup, append-only
  ledger, rate limiting, lifecycle, and manager-authorized adjustments.
- [x] Task 3: Add customer-bound store-credit accounts, ledger, adjustments,
  balance/history, and tenant/RBAC enforcement.
- [x] Task 4: Add loyalty program/account/ledger, integer earn/redeem math, and
  sale-time snapshots.

### Atomic commerce integration

- [x] Task 5: Add internal payment fields and make sale completion atomic for
  gift-card/store-credit/loyalty redemption, gift-card loads, earning, and
  split tender.
- [x] Task 6: Extend refunds for original internal-tender restoration,
  explicit refund-to-store-credit, and historical loyalty reversal.
- [x] Task 7: Add receipts, reports, ledger export, liability summaries, and
  audit redaction.

### UI and hardening

- [x] Task 8: Add customer value and loyalty settings UI plus `/gift-cards`.
- [ ] Task 9: Add responsive POS internal tenders, gift-card load/print, and
  offline/accessibility behavior.
- [ ] Task 10: Add concurrency, idempotency, injected-failure, security,
  validation, and browser E2E coverage.

### Checkpoints

- [x] Checkpoint A: Foundation tests and migration compile cleanly.
- [x] Checkpoint B: Mixed-tender sale/refund atomicity and accounting tests pass.
- [x] Checkpoint C: UI tests and full regression pass; production smoke remains pending deployed QA access.

## Verification commands

- Focused API/unit tests for each task.
- `pnpm --filter @pos/api exec vitest run --config vitest.pg.config.ts`
- `pnpm test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- Existing scaffold, parity, auth, offline, and browser suites.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Partial internal debit | Critical | One transaction plus injected-failure rollback tests |
| Gift-card secret leakage | Critical | HMAC-only persistence, masked DTOs, log/audit assertions |
| Cross-tenant account access | Critical | Business-scoped adapter methods and RLS tests |
| Concurrent overspend | Critical | Deterministic sorted locks and PG advisory locks |
| Historical loyalty drift | High | Sale snapshots and line allocation tests |
| Revenue misclassification | High | Dedicated ledger/export/report assertions |

## Rulings

- Phase 20 uses the existing `DbPort` abstraction rather than a second storage
  abstraction so memory/PG parity and transaction rollback remain testable.
- Gift-card paid issuance is represented as a sale load line and becomes active
  only in successful completion; manual adjustment remains an admin fallback.

