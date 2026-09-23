# Phase 9a Multi-Branch Design - Online POS

**Date:** 2026-09-23
**Source spec:** `G:\Vscode\PLAN.md` sections 16.1 (Multi-branch model), 4.2 (FR-INVENTORY-02 transfer types), 5.3, 5.4, 6.1, 6.4, 6.7, 7, 17 (Phase 9, first half)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-23-phase8-security-stability-design.md` (all Phase 0-8 behavior preserved; every existing suite must stay green)
**Successor (deferred):** Phase 9b offline (catalog cache, command queue, sync, reconcile) — separate cycle per PLAN.md sequencing ("offline ... only after online invariants are proven").

## Goal

Implement PLAN.md 17 Phase 9, first half: branch scope and stock transfers. Branch-scoped registers, central warehouse, stock transfers, branch analytics, and global filters.

**Exit (adapted from PLAN.md 17 + 16.1):** a business runs two branches plus a warehouse: stock transfers move units between locations with dual ledger entries, every operational record carries branch scope, and branch analytics compare locations — with all Phase 0-8 suites still green.

## Architecture

Branch scope added to the existing modular monolith following Phase 1-8 conventions exactly (Zod at edge, `SessionGuard` + `CsrfGuard`, `withScope` tenant scoping extended with branch scoping, append-only audit, memory-DB contract tests):

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  BranchModule     branches + stock transfers (new in Phase 9a)
  CatalogModule    unchanged (catalog stays business-global)
  InventoryModule  extended: balance/movement branch keys (no logic change)
  SalesModule      extended: optional branchId (register-derived default)
  ShiftModule      extended: register branch inheritance
  ReportingModule  extended: branchId filter + branches comparison view
```

No new infra. No offline behavior in 9a (deferred to 9b). No franchise/warehouse-automation beyond one central-warehouse branch type.

## Data Model

All Phase 0-8 models reused as-is. Branch scope is NULLABLE everywhere: existing single-location rows keep `branchId = null` (the implicit head-office scope), so every existing test and behavior is preserved byte-for-byte. New branch-aware writes set an explicit id:

```text
Branch
  id, businessId, name, type (store | warehouse),
  isActive (default true), createdAt, updatedAt
  @@unique([businessId, name])
  @@index([businessId])

StockTransfer
  id, businessId, fromBranchId, toBranchId,
  status (DRAFT | IN_TRANSIT | RECEIVED | CANCELLED),
  requestedBy, dispatchedBy?, receivedBy?,
  requestId, createdAt, updatedAt
  @@index([businessId, status, createdAt])

StockTransferLine
  id, businessId, transferId, productId, qty (int > 0)
  @@index([businessId, transferId])
```

Scoped (nullable `branchId` added, no backfill, no NOT NULL):

```text
Register.branchId?      (register's home branch)
Shift.branchId?         (copied from register at open)
CashMovement.branchId?  (copied from shift)
InventoryBalance        (businessId, branchId?, productId) unique — null branch keeps its own balance row
InventoryMovement.branchId?
Sale.branchId?          (register's branch, else explicit input, else null)
Expense.branchId?       (shift's branch when shift-linked, else explicit input, else null)
```

NOT scoped (business-global by design): Product, Category, Customer, User, Role, AuditLog, Report computations. A shared catalog across branches matches the small-chain model (one menu/price list, per-branch stock).

Why nullable instead of mandatory-with-backfill: PLAN.md 16.1 requires introducing scope, not rewriting history. Mandatory scoping would invalidate every existing fixture and the immutability guarantees on closed sales/shifts. Rejected.

## Stock Transfer Lifecycle (PLAN.md 6.4 movement rules, FR-INVENTORY-02)

```text
DRAFT -- dispatch --> IN_TRANSIT -- receive --> RECEIVED
DRAFT -- cancel --> CANCELLED
IN_TRANSIT -- cancel --> CANCELLED (restores source stock)
```

- **Create** (`POST /api/v1/transfers { fromBranchId, toBranchId, lines: [{ productId, qty }] }`): branches must differ, both belong to the business and be active (else `VALIDATION`); lines validated (product exists, qty positive int); status `DRAFT`; audit `transfer.create`. Gate: `inventory.adjust` (owner/manager/inventory hold it; cashiers don't — matches movement-write policy).
- **Dispatch** (`POST /api/v1/transfers/:id/dispatch`): `DRAFT` only (else `TRANSFER_INVALID_STATE` 409); per line, source `(business, fromBranch, product)` balance must cover qty or `INSUFFICIENT_STOCK` with nothing written; writes `transfer_out` movements (negative, `referenceType: "StockTransfer"`) + decrements source balances atomically; audit `transfer.dispatch`.
- **Receive** (`POST /api/v1/transfers/:id/receive`): `IN_TRANSIT` only; writes `transfer_in` movements (positive, same reference) + increments destination balances; audit `transfer.receive`.
- **Cancel from DRAFT**: terminal, no movements, audit `transfer.cancel`.
- **Cancel from IN_TRANSIT**: posts compensating `transfer_in` movements back to the SOURCE branch (restoring its balance) with `referenceType: "StockTransfer"` and reason `cancel:<transferId>`; audit `transfer.cancel`. Destination is untouched (it never received stock).
- `RECEIVED`/`CANCELLED` are terminal. Double dispatch/receive/cancel → `TRANSFER_INVALID_STATE`.
- Transfers never touch sales, payments, or cash. Oversell protection reuses the Phase 3 guard per branch key.
- Idempotency: dispatch/receive/cancel accept `Idempotency-Key` (commandTypes `transfer.dispatch`, `transfer.receive`, `transfer.cancel`); replays return the current transfer with `replayed: true`.

## Branch-Scoped Operations

- **Registers**: create/update accept optional `branchId` (validated against the business, else `VALIDATION`); list/detail embed the branch name. Owner/manager gate unchanged.
- **Shifts**: `openShift` copies the register's `branchId` onto the shift and its `opening_float` movement; shift report shows the branch.
- **Sales**: `createDraft`/`completeSale` accept optional `branchId`; effective branch = input ?? register's branch ?? null (stored on the sale). Cash auto-post inherits the shift's branch automatically (movement already carries `registerId`; `branchId` copied from the shift row).
- **Inventory**: `recordMovement` accepts optional `branchId`; balances keyed `(business, branch, product)` with null-branch rows preserved; oversell guard per key; rebuild groups by branch.
- **Expenses**: `createExpense` accepts optional `branchId`; shift-linked expenses inherit the shift's branch.
- **Customers**: unscoped (business-global), unchanged.
- **Refunds**: inherit the sale's branch implicitly through the sale's movements (return movements post to the branch of the original `sale` movements... precise rule: refund `return` movements and `cash_refund` postings use the branchId of the sale being refunded [SPEC-DEFAULT]; when the sale's branch is null they post null-scoped like Phase 6).

## Branch Analytics (PLAN.md 16.1, 9.2 Branches view)

- Global filter: `branchId` query param on overview, sales, products, inventory, cash reports (filters the underlying settled-sale/movement/shift sets; absent = all branches including null scope). Customer/cashier reports stay business-global [SPEC-DEFAULT: staff and customers span branches in v1].
- New `GET /api/v1/reports/branches?dateFrom&dateTo&compare`: per-branch `{ branchId, name, type, sales, orders, margin }` table (`margin` omitted without `cost.view`, same rule as products report) plus an `unscoped` row for null-branch activity so totals reconcile [SPEC-DEFAULT].
- Branch-scoped attention: low/out-of-stock counts computed per branch when a filter is active (global view keeps current business-wide counts).

## Permissions (FR-RBAC-01/02)

Reuse Phase 1 keys; no new permission keys. Role-set gates where the matrix has no key:

| Operation | Required | Owner | Manager | Cashier | Inventory |
|---|---|---|---|---|---|
| Branch create/rename/archive | owner/manager role | yes | yes | no (`FORBIDDEN`) | no |
| Branch list | session + membership | yes | yes | yes | yes |
| Transfer create/dispatch/receive/cancel | `inventory.adjust` | yes | yes | no | yes |
| Transfer list/detail | session + membership | yes | yes | yes | yes |

## API Endpoints

All under `/api/v1`, `SessionGuard` everywhere, `CsrfGuard` on mutations, envelope `{ code, message, correlationId, fields? }`:

```text
GET    /api/v1/branches
POST   /api/v1/branches                       (owner/manager)
PATCH  /api/v1/branches/:id                   (owner/manager)
GET    /api/v1/transfers?status
POST   /api/v1/transfers                      (inventory.adjust)
GET    /api/v1/transfers/:id
POST   /api/v1/transfers/:id/dispatch         (inventory.adjust, Idempotency-Key)
POST   /api/v1/transfers/:id/receive          (inventory.adjust, Idempotency-Key)
POST   /api/v1/transfers/:id/cancel           (inventory.adjust, Idempotency-Key)
GET    /api/v1/reports/branches?dateFrom&dateTo&compare
```

Extended (backward compatible): register create/update (`branchId?`), shift report (`branch`), draft/complete (`branchId?`), movement create (`branchId?`), expense create (`branchId?`), overview/sales/products/inventory/cash reports (`branchId?` filter).

New stable codes: `TRANSFER_INVALID_STATE` (409). Reuse `INSUFFICIENT_STOCK`, `IDEMPOTENCY_MISMATCH`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`. All timestamps ISO 8601 UTC.

## Web UI (PLAN.md 8.2, 9.1)

Same appliance language (TanStack Query + `apiFetch`, CSRF from `/api/v1/auth/csrf`, tabular numerals, text+shape states, no gradients):

- `/branches`: list + create/rename/archive (owner/manager only; others read-only).
- `/transfers`: create form (from/to branch pickers, product lines with qty) + status-filtered list; `/transfers/[id]`: detail with lifecycle buttons (dispatch/receive/cancel) gated by permission, dual-location movement trail.
- Dashboard: global branch filter dropdown; branches report page (`/reports/branches`) with the comparison table.
- Registers/shifts/sales/inventory pages: show branch names where rows carry them; no layout changes.
- Dashboard links extended with Branches and Transfers.

## Audit (PLAN.md 6.7)

Append-only rows for `branch.create`, `branch.update`, `transfer.create`, `transfer.dispatch`, `transfer.receive`, `transfer.cancel`, each with snapshots, actorId, requestId, idempotency key where applicable. No updates/deletes.

## Test Strategy

TDD throughout. Vitest unit (lifecycle transitions, branch fallback resolution, margin math with branch filter), memory-DB integration (dual-location ledger entries sum correctly per branch, oversell at source writes nothing, cancel-in-transit restores source, replay idempotency), supertest contract (auth, validation codes, permission gates, cross-tenant `NOT_FOUND` on branches/transfers, double-dispatch, receive-before-dispatch), exit test + verify script, CI extended. Abuse additions: transfer between same branch, transfer with unknown branch, dispatch with insufficient source stock, receive twice, cancel received, cashier transfer attempt, cross-tenant branch access.

## Performance Budgets (PLAN.md 12)

Transfer dispatch/receive p95 < 500 ms (bounded lines, single-branch lock scope); branch-filtered reports reuse existing scan budgets; branches comparison is one additional grouped pass over settled sales. No new indexes except `(businessId, branchId)` coverage review: balances/movements already index `(businessId, productId)`-family keys — branch filtering happens in memory post-scope... for the memory DB this is free; for a future Postgres port, note as a follow-up that composite branch indexes may be needed (documented, not migrated — the existing `@@index([businessId, ...])` family covers the tenant prefix).

## Exit Criteria

- Owner creates two branches + warehouse, transfers stock A→B (dispatch posts source `transfer_out`, receive posts dest `transfer_in`, balances match per branch).
- Oversell dispatch rejected with nothing written; double dispatch/receive rejected; cancel-in-transit restores source.
- Replay of dispatch/receive keys posts nothing twice.
- Cross-tenant branch/transfer access returns `NOT_FOUND`; cashier transfer attempts `FORBIDDEN`.
- Branch-filtered reports and the branches comparison table reconcile with the unfiltered totals.
- Migrations 0001→0009 apply cleanly on live Postgres (0009: Branch + StockTransfer(+Line) tables + nullable `branchId` columns).
- All Phase 0-8 suites still green (nullable scoping preserves every fixture).

## Non-Goals (deferred)

Phase 9b offline (explicitly next cycle), franchise management, inter-branch pricing/cost differences (shared catalog/costs), branch-level users/permissions (membership stays business-level; shifts already attribute actors), branch cash consolidation, supplier/warehouse automation, AI (deferred patch).
