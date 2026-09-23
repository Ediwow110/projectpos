# Phase 5 Registers and Shifts Design - Online POS

**Date:** 2026-09-23
**Source spec:** `G:\Vscode\PLAN.md` sections 4.5 (FR-CASH-01..04, FR-EXPENSE-01), 5.3, 5.4, 6.1, 6.6, 6.7, 7, 17 (Phase 5)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-23-phase4-pos-payments-design.md` (all Phase 0-4 primitives reused unchanged; Phase 4 `completeSale`/`reconcilePayment` extended, not rewritten)

## Goal

Implement PLAN.md 17 Phase 5: register setup, open shift, cash movements, close/count, expected cash, variance, permissions, and shift report.

**Exit (PLAN.md 17 verbatim):** opening-to-closing cash can be reconciled from immutable movements.

## Architecture

One new NestJS module following Phase 1-4 conventions exactly:

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  ShiftModule      registers + shifts + cash movements + close/report (new in Phase 5)
  SalesModule      extended: optional registerId on draft/complete, auto-posts
                   cash_sale movements to the register's open shift (no other changes)
  InventoryModule  unchanged
  CatalogModule    unchanged
```

Cross-module calls use NestJS services via `DbPort` only (PLAN.md 5.3). Pure domain logic lives in framework-free functions under `apps/api/src/shifts/` and is unit-tested directly; the controller is a thin adapter tested via `supertest`. `DbPort` is extended with register/shift/movement methods; `createMemoryDb` implements them in-memory (single-threaded serialization stands in for row locks, matching the repo's test convention). No Redis, workers, storage, offline, branches, billing, or AI in Phase 5.

## Data Model

All Phase 0-4 models reused as-is, plus `registerId String?` on `Sale` (nullable; see Cash-Sale Linkage). Three additions, all tenant-scoped per FR-TENANT-01:

```text
Register
  id, businessId, name, isActive (default true), createdAt, updatedAt
  @@unique([businessId, name])   // register names unique per tenant
  @@index([businessId])

Shift
  id, businessId, registerId,
  status (OPEN | CLOSED),
  openedBy (userId), closedBy (userId, null until close),
  openingFloatMinor (int >= 0),
  countedCashMinor (int >= 0, null until close),
  varianceMinor (int, signed, null until close),
  cashSalesMinor, cashRefundsMinor, cashExpensesMinor,
    cashDepositsMinor, cashWithdrawalsMinor, adjustmentsMinor
    (component snapshots persisted at close, all int, default 0),
  expectedCashMinor (int, persisted at close),
  closeNotes? (max 500),
  openedAt, closedAt?,
  @@index([businessId, registerId, status])
  @@index([businessId, status, openedAt])

CashMovement
  id, businessId, shiftId, registerId,
  type (opening_float | cash_sale | cash_refund | paid_out
        | cash_deposit | cash_withdrawal | adjustment),
  amountMinor (signed int, never 0; inflows positive, outflows negative),
  reason? (required for paid_out, cash_withdrawal, adjustment [SPEC-DEFAULT]),
  referenceType?, referenceId? (e.g. Sale/<id> for cash_sale),
  actorId, requestId, createdAt
  @@index([businessId, shiftId, createdAt])
  @@index([businessId, registerId, createdAt])
```

Movement sign policy (`signForCash`): `opening_float` +1, `cash_sale` +1, `cash_refund` −1, `paid_out` −1, `cash_deposit` +1, `cash_withdrawal` −1, `adjustment` any sign. `amountMinor` must be a non-zero integer whose sign matches the type (`VALIDATION` otherwise), mirroring the Phase 3 ledger convention.

## Shift Lifecycle (FR-CASH-01, FR-CASH-04)

```text
(no shift) -- open --> OPEN -- cash movements --> OPEN -- close --> CLOSED (terminal)
```

- One OPEN shift per register (FR-CASH-01 default; no multi-operator policy in Phase 5). Opening a register with an OPEN shift returns `SHIFT_ALREADY_OPEN` (409).
- `CLOSED` is terminal and immutable: any mutation targeting a closed shift (movements, re-close, edits) is rejected with `SHIFT_CLOSED_IMMUTABLE` (403). Corrections use new `adjustment` movements on a *new* open shift, never edits (FR-CASH-04) [SPEC-DEFAULT: adjustments reference the closed shift via referenceType `Shift`/referenceId for traceability].
- Double close returns `SHIFT_ALREADY_CLOSED` (409).
- Closing another actor's open shift requires `shift.close.override` (existing Phase 1 key, FR-RBAC-02 "shift closure overrides"); closing your own shift needs session + membership only. Cashiers may open/close their own shifts.
- Register CRUD (create/rename/archive) is restricted to `owner`/`manager` roles [SPEC-DEFAULT: role-set gate like Phase 4 `SELL_ROLES`, because the permission matrix gives managers no setup key and cashiers must be excluded].

## Expected Cash and Variance (PLAN.md 6.6)

Computed from the movement ledger at close, then persisted as snapshots on the shift:

```text
expectedCash = openingFloat
             + cashSales
             - cashRefunds
             - cashExpenses(paid_out)
             + cashDeposits
             - cashWithdrawals
             + adjustments(signed sum)

variance = countedCash - expectedCash
```

- Each component is the signed sum of its movement type within the shift; the application persists every component as movements, never only the final number.
- `cash_refund` movements are produced only by the Phase 6 refund workflow (type reserved here; sums to 0 in Phase 5).
- Variance is recorded as-is (positive = over, negative = short); no auto-adjustment entry is created [SPEC-DEFAULT].

## Cash-Sale Linkage (PLAN.md 5.3 critical path, FR-CASH-02)

- `draftCreateSchema`/`completeSchema` gain optional `registerId`. `Sale` gains nullable `registerId` (migration alters Sale; existing sales keep null).
- When `completeSale` (or `reconcilePayment` with SUCCEEDED outcome) settles **cash-method** payments and `registerId` is present: the register must have exactly one OPEN shift (else `SHIFT_NO_OPEN_SHIFT`, 409, nothing written), and a single `cash_sale` movement for the cash portion is posted to that shift with `referenceType: "Sale"`, `referenceId: <saleId>`, inside the same atomic service call.
- When `registerId` is absent, the sale completes exactly as in Phase 4 with no cash movement (backward compatible; existing Phase 4 tests unchanged).
- Non-cash payments never post cash movements.
- The POS web always sends the active register; the API does not guess shifts across registers.

## Cash In/Out and Paid-Out (FR-CASH-02, FR-EXPENSE-01 split)

- `POST /api/v1/shifts/:id/cash` accepts `{ kind: paid_out | cash_deposit | cash_withdrawal | adjustment, amountMinor, reason }`. `paid_out`/`cash_withdrawal`/`adjustment` require `reason` (min 3 chars); `adjustment` additionally requires `shift.close.override`.
- Full `Expense` entity (category, attachment, expense reports) stays in Phase 6 per PLAN.md phasing; `paid_out` movements carry a free-text reason and are the Phase 5 record of cash expenses. The shift report labels them "paid out (reason)".
- Opening float is posted as an `opening_float` movement at open (amount = opening float; zero float allowed and posts no movement [SPEC-DEFAULT]).

## Permissions (FR-RBAC-01/02)

Reuse Phase 1 `SENSITIVE_ACTIONS`; no new permission keys. Role-set gates (`owner`/`manager` for registers, mirroring `SELL_ROLES` precedent) where the matrix has no fitting key:

| Operation | Required | Owner | Manager | Cashier | Inventory |
|---|---|---|---|---|---|
| Create/rename/archive register | owner/manager role | yes | yes | no (`FORBIDDEN`) | no |
| List registers | session + membership | yes | yes | yes | yes |
| Open shift | session + membership (own shift) | yes | yes | yes | no (`FORBIDDEN`) |
| Cash in/out/paid_out on open shift | session + membership | yes | yes | yes | no |
| Adjustment movement | `shift.close.override` | yes | yes | no | no |
| Close own shift | session + membership | yes | yes | yes | no |
| Close another's shift | `shift.close.override` | yes | yes | no | no |
| Shift list/report | session + membership | yes | yes | yes (own shifts only [SPEC-DEFAULT]) | yes |

## API Endpoints

All under `/api/v1`, `SessionGuard` everywhere, `CsrfGuard` on mutations, envelope `{ code, message, correlationId, fields? }`:

```text
GET    /api/v1/registers
POST   /api/v1/registers                    (owner/manager)
PATCH  /api/v1/registers/:id                (owner/manager)
POST   /api/v1/registers/:id/open           { openingFloatMinor } -> 201 Shift (OPEN)
GET    /api/v1/shifts?status&registerId     (cursor page, newest first)
GET    /api/v1/shifts/:id                   (shift report with components + movements)
POST   /api/v1/shifts/:id/cash              { kind, amountMinor, reason? }
POST   /api/v1/shifts/:id/close             { countedCashMinor, closeNotes? } -> 200 Shift (CLOSED)
```

Modified: `POST /api/v1/sales/drafts` and `POST /api/v1/sales/complete` accept optional `registerId` (must belong to the same business, else `VALIDATION`).

New stable codes: `SHIFT_ALREADY_OPEN` (409), `SHIFT_NO_OPEN_SHIFT` (409), `SHIFT_ALREADY_CLOSED` (409), `SHIFT_CLOSED_IMMUTABLE` (403), `REGISTER_NOT_FOUND` via `NOT_FOUND` (404). Cross-tenant/missing rows `NOT_FOUND` (404). All timestamps ISO 8601 UTC. Close is idempotent-safe under double submit only in that the second call gets `SHIFT_ALREADY_CLOSED`, never a second close.

## Shift Report

`GET /api/v1/shifts/:id` returns the shift row plus `components { openingFloat, cashSales, cashRefunds, cashExpenses, cashDeposits, cashWithdrawals, adjustments, expectedCash, countedCash, variance }` (counted/variance null while OPEN), the movement list (oldest first), opener/closer ids, and timestamps. For CLOSED shifts this is the reconcile-from-movements proof: components recomputed live from movements must equal persisted snapshots (verified in tests; drift would indicate a bug since shifts are append-only).

## Web UI (PLAN.md 8.2, 9.1)

Registers/shifts surfaces reusing Phase 1-4 web patterns (TanStack Query + `apiFetch`, CSRF from `/api/v1/auth/csrf`):

- `/registers`: list + create/rename/archive (owner/manager only; others see read-only list).
- `/shifts`: register picker + opening-float form (open), active-shift card with cash in/out/paid_out form and close form (counted cash + notes → variance display), shift history list.
- `/shifts/:id`: full report (components table with tabular numerals, movement ledger, variance callout as text + shape, never color alone).
- POS (`/pos`): register dropdown sourced from `/api/v1/registers`; `registerId` sent on draft/complete so cash auto-posts. Cashiers with no open shift see the `SHIFT_NO_OPEN_SHIFT` error with direction to open one (link to `/shifts`).
- Dashboard `/` gets a Registers/Shifts link (replacing no placeholder; Team remains later-phase).
- Frontend-design direction: same appliance language as POS — tabular numerals, explicit text states, no gradients, motion limited to open/close confirmations.

## Audit (PLAN.md 6.7)

Append-only rows for `register.create`, `register.update`, `shift.open`, `shift.cash`, `shift.adjust`, `shift.close`, each with before/after snapshots, actorId, requestId. Cash_sale movements posted by sales carry the sale's actor/requestId. No updates/deletes.

## Test Strategy

TDD throughout. Vitest unit (cash signs, expected-cash arithmetic, variance, shift permission predicates), memory-DB integration (single-open-shift invariant, closed-shift immutability, auto-post atomicity with sales, idempotent replay posts no second movement), supertest contract (auth, validation codes, permission gates, cross-tenant `NOT_FOUND`, double-close, close-after-cash reconciliation), exit test + verify script, CI extended. Abuse cases: open twice, close twice, mutate closed shift, cash sale with no open shift, cash sale on another tenant's register, close another's shift without override, negative/zero amounts, adjustment without override, double submit of close.

## Performance Budgets (PLAN.md 12)

Shift open/close p95 < 500ms; close recomputes components from at most hundreds of movements (single shift scope) — no pagination needed in v1 reporting path [SPEC-DEFAULT: cap movement list at 500 rows, newest last for ledger readability]. POS complete path keeps its Phase 4 budget (one extra indexed lookup + one movement write).

## Exit Criteria

- Owner creates register → cashier opens shift with float → completes cash sale (movement auto-posted) → records paid_out + deposit → closes with count → report shows components, expected, counted, variance reconciling from immutable movements.
- Double open rejected; double close rejected; closed-shift mutation rejected; no-open-shift cash sale rejected with nothing written.
- Replay of a completed sale's idempotency key posts no second cash movement.
- Cross-tenant register/shift access returns `NOT_FOUND`.
- Migrations 0001→0006 apply cleanly on live Postgres.

## Non-Goals (deferred)

Full Expense entity + expense reports (Phase 6), refund compensating cash records (Phase 6; `cash_refund` type reserved), multi-operator concurrent shifts per register (explicit policy, later), branch-scoped registers (Phase 9), printer/customer-display integration (Phase 10), offline shift handling (Phase 9), AI (deferred patch).
