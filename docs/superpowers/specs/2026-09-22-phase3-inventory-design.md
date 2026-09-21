# Phase 3 Inventory Design - Online POS

**Date:** 2026-09-22
**Source spec:** `G:\Vscode\PLAN.md` sections 4.2 (FR-INVENTORY-01..06), 5.3, 5.4, 6.1, 6.4, 6.7, 17 (Phase 3)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-21-phase2-catalog-design.md` (all Phase 2 primitives reused unchanged)

## Goal

Implement PLAN.md 17 Phase 3: opening stock, receive, adjustment, damage, low stock, movement history, projection/rebuild checks, and concurrency protection.

**Exit (PLAN.md 17 verbatim):** stock balance equals ledger sum after normal and concurrent operations.

## Architecture

One new NestJS module following Phase 1/2 conventions exactly:

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  InventoryModule   movements ledger, balances, rebuild (new in Phase 3)
  CatalogModule     unchanged (products + trackInventory/reorderLevel reused)
```

Pure domain logic lives in framework-free functions under `apps/api/src/inventory/` (unit-tested directly); the controller is a thin adapter tested via `supertest`. `DbPort` is extended with inventory methods; `createMemoryDb` implements them in-memory (single-threaded serialization stands in for row locks, matching the repo's test convention). No Redis, workers, storage, or offline in Phase 3.

## Data Model

```text
InventoryMovement  (append-only ledger, FR-INVENTORY-01)
  id, businessId, productId,
  type (opening_stock | receive | sale | return | damage | adjustment
        | transfer_in | transfer_out | stock_count),
  qtyDelta (signed int, never 0),
  reason? (required for damage + adjustment [SPEC-DEFAULT]),
  referenceType?, referenceId?,
  actorId, requestId, createdAt
  @@index([businessId, productId, createdAt])
  CHECK (qtyDelta <> 0)   -- enforced in migration SQL

InventoryBalance  (transactionally maintained read model, FR-INVENTORY-01)
  id, businessId, productId, qtyOnHand (int), updatedAt
  @@unique([businessId, productId])

Product + preventOversell Boolean @default(true)  [SPEC-DEFAULT] (FR-INVENTORY-04)
```

Movement types cover FR-INVENTORY-02 (sale/return/transfer/stock-count rows are produced by later phases; Phase 3 accepts and enforces signs for all of them). Every movement records tenant, product, signed quantity, type, reference, actor, reason, timestamp (FR-INVENTORY-03).

## Ledger Rules (PLAN.md 6.4)

- Sign policy (`signFor`): opening_stock +1, receive +1, return +1, transfer_in +1; sale -1, damage -1, transfer_out -1; adjustment any sign; stock_count handled as a computed delta.
- `qtyDelta` must be a non-zero integer whose sign matches the type (`VALIDATION` otherwise).
- A movement and its balance update are written together (single service call; one DB transaction in production). The ledger is authoritative; the balance is a projection.
- Oversell guard: when the product has `preventOversell = true` and the resulting balance would go negative, reject with `INSUFFICIENT_STOCK` (409). `adjustment` may drive a balance negative only with explicit `reason` [SPEC-DEFAULT: adjustments also cannot go negative unless reason length >= 3 is supplied].

## Rebuild / Projection Check

`computeBalanceFromLedger(movements)` = sum of `qtyDelta`. `POST /api/v1/inventory/rebuild` recomputes every tracked product's balance from the ledger and returns `{ checked, drifts: [{ productId, balanceOnHand, ledgerSum, drift }] }`. Report-only — no auto-fix [SPEC-DEFAULT]. Exit criterion is verified in tests: after normal and interleaved concurrent operations, drift == 0 for every product.

## Permissions (FR-RBAC-01, FR-RBAC-02)

Reuse Phase 1 `SENSITIVE_ACTIONS` keys; no new permission keys:

| Operation | Required | Owner | Manager | Cashier | Inventory |
|---|---|---|---|---|---|
| View balances / movement history | session + membership | yes | yes | yes | yes |
| Record movement (opening/receive/damage/adjustment) | `inventory.adjust` | yes | yes | no (`FORBIDDEN`) | yes |
| Rebuild/report | `inventory.adjust` | yes | yes | no | yes |

## API Endpoints

All under `/api/v1`, `SessionGuard` everywhere, `CsrfGuard` on mutations:

```text
GET  /api/v1/inventory/balances?page&pageSize&view=all|low|out
GET  /api/v1/inventory/products/:id/movements?page&pageSize
POST /api/v1/inventory/movements          (inventory.adjust)
POST /api/v1/inventory/rebuild            (inventory.adjust)
```

Bounded pagination (default 20, cap 100) per PLAN.md 5.4. Low stock = `qtyOnHand <= reorderLevel` and `trackInventory`; out = `qtyOnHand <= 0` (FR-INVENTORY-06, derived from balance + reorder level).

New stable error codes (added to `CODE_STATUS`): `INSUFFICIENT_STOCK` (409), `PRODUCT_NOT_TRACKED` (400). Missing/cross-tenant product: `NOT_FOUND` (404).

## Web UI

Minimal surfaces reusing Phase 2 patterns (TanStack Query, `apiFetch`, CSRF via `/api/v1/auth/csrf`):

- `/inventory`: balances table (product, on-hand, reorder level, OK/LOW/OUT status), low/out filter tabs, record-movement form (type, qty, reason) for roles with `inventory.adjust`; server stays authoritative.
- `/inventory/[productId]`: movement history (newest first, bounded page) + movement form.
- Dashboard links to `/inventory`.

## Test Strategy

TDD red-green-refactor: Zod schema tests, domain unit tests (signs, apply, low/out derivation, rebuild drift), service tests against memory DB (oversell, untracked product, balance maintenance, audit, history, rebuild), supertest contract tests (auth 401, cashier FORBIDDEN, cross-tenant NOT_FOUND, round-trips), migration proof applied to a live Postgres (`pos-db-phase3`, port 5433) via psql in order 0001→0004, Phase 3 exit test + verify script + CI extension.

## Exit Criteria

- Opening stock → receive → damage → adjustment sequence leaves `balance == ledger sum` (drift 0).
- Oversell rejected with `INSUFFICIENT_STOCK`; balance unchanged; no ledger row.
- Interleaved concurrent movements (Promise.all over the service) leave balance == ledger sum.
- Cross-tenant movement/history reads return `NOT_FOUND`; cashier writes get `FORBIDDEN`.
- Rebuild reports zero drift on a healthy tenant and detects an injected drift.

## Non-Goals (deferred)

Sale/return/transfer/stock-count producers (Phases 4-5), branches/locations, FIFO costing, purchase orders, supplier records, offline, AI. `transfer_*` and `stock_count` types exist in the ledger contract only.
