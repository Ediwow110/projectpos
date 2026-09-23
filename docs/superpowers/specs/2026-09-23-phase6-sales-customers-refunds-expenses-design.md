# Phase 6 Sales, Customers, Refunds, and Expenses Design - Online POS

**Date:** 2026-09-23
**Source spec:** `G:\Vscode\PLAN.md` sections 4.3 (FR-SALE-01, FR-REFUND-01/02), 4.4 (FR-PAY-01), 4.5 (FR-CASH-02, FR-EXPENSE-01), 4.6 (FR-ANALYTICS-04), 5.3, 5.4, 6.1, 6.3, 6.4, 6.5, 6.7, 7, 17 (Phase 6)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-23-phase5-registers-shifts-design.md` (all Phase 0-5 primitives reused unchanged; `SalesService` extended with refund approval, `ShiftService` reused for cash postings)

## Goal

Implement PLAN.md 17 Phase 6: transaction history/detail, customer profiles, refund workflow, returns, expense entry, filters, exports, and permission-sensitive detail.

**Exit (PLAN.md 17 verbatim):** an owner can explain a sale, refund, expense, and customer history from source records.

## Architecture

Three subsystem additions inside the existing modular monolith, following Phase 1-5 conventions exactly (Zod at the edge, `SessionGuard` + `CsrfGuard`, `withScope` scoping, append-only audit, memory-DB contract tests):

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  CustomerModule   Customer CRUD + purchase history (new)
  RefundModule     approve/reject + compensating records (new; writes via
                   SalesService, InventoryService, ShiftService through DbPort)
  ExpenseModule    Expense entry + void (new; optional shift-linked paid_out)
  SalesModule      extended: history filters (customer/date), detail with
                   refunds, CSV export; state machine gains
                   REFUND_REQUESTED -> PARTIALLY_REFUNDED -> REFUNDED
```

No new infra. No provider settlement calls (refunds of non-cash methods are recorded as internal compensating rows; external settlement is Phase 10). No file uploads (attachment is a URL string, matching the Phase 2 `imageUrl` precedent).

## Data Model

All Phase 0-5 models reused as-is. Three additions, all tenant-scoped per FR-TENANT-01:

```text
Customer
  id, businessId, name, phone?, email?, address?, notes?,
  isActive (default true), createdAt, updatedAt
  @@index([businessId, isActive])
  @@index([businessId, name])

Refund
  id, businessId, saleId,
  status (APPROVED — terminal; REJECTED requests return the sale to COMPLETED [SPEC-DEFAULT]),
  totalMinor (int >= 0),
  reason, requestedBy, approvedBy,
  requestId, approvedRequestId,
  createdAt
  @@index([businessId, saleId])
  @@index([businessId, createdAt])

RefundItem
  id, businessId, refundId, saleItemId, productId,
  qty (int > 0), amountMinor (int >= 0, price snapshot × qty minus proportional line discount),
  restocked (bool: inventory movement written or product untracked)
  @@index([businessId, refundId])

Expense
  id, businessId, category, amountMinor (int > 0),
  description?, method (cash | card | gcash | maya | bank_transfer | other),
  shiftId? (nullable; set when cash-posted to a shift),
  expenseDate (DateTime, defaults to now),
  actorId, requestId, attachmentUrl?,
  voidedAt?, voidReason?,
  createdAt
  @@index([businessId, category, expenseDate])
  @@index([businessId, expenseDate])
```

Customer identity rules: `phone`, when present, is unique per business (`@@unique([businessId, phone])` with nulls allowed — Postgres permits multiple NULLs). No national-ID or loyalty machinery in Phase 6. Existing sales keep their `customerName` snapshot; `customerId` values that match a Customer row link live history, others render as recorded (no backfill rewrite of history, per immutability).

## Refund Workflow (FR-REFUND-01/02, PLAN.md 6.3)

State transitions (added to `VALID_TRANSITIONS`; original sale never deleted):

```text
COMPLETED -- request --> REFUND_REQUESTED -- approve --> PARTIALLY_REFUNDED | REFUNDED
REFUND_REQUESTED -- reject --> COMPLETED (request withdrawn, audited)
COMPLETED -- approve (single-step) --> PARTIALLY_REFUNDED | REFUNDED
```

- **Request** (exists from Phase 4): any holder of `sale.refund`, reason required. Unchanged.
- **Approve** (`POST /api/v1/sales/:id/refund-approve { items: [{ saleItemId, qty }], reason? }`, `Idempotency-Key` required, commandType `refund.approve`): requires `sale.refund`; separation rule — approver must differ from requester unless approver role is `owner` [SPEC-DEFAULT: encodes "role and threshold policy" without inventing amount thresholds]; works from `COMPLETED` (records request+approval atomically, flagged `singleStep: true`) or `REFUND_REQUESTED`.
- **Bounds**: each item `qty` must satisfy `0 < qty ≤ (sold − alreadyRefunded)` per sale line, else `REFUND_EXCEEDS_LIMIT` (400). Amounts derive from the sale's price snapshot (later catalog edits cannot change refund math).
- **Atomic effects** (one service call, all-or-nothing):
  1. `Refund` + `RefundItem` rows (status APPROVED).
  2. Inventory `return` movements + balance increments for tracked products (`restocked: true`); untracked lines recorded with `restocked: false`.
  3. Compensating `Payment` rows per refunded amount: same method as the original payment slice, `status: "REFUNDED"` [SPEC-DEFAULT: status vocabulary extension], `providerRef: null` (no external settlement in Phase 6).
  4. Cash refunds (cash-method portion > 0): one `cash_refund` movement on the sale register's currently OPEN shift (`referenceType: "Refund"`); no open shift → `SHIFT_NO_OPEN_SHIFT` (409), nothing written — consistent with Phase 5 strictness.
  5. Sale status → `PARTIALLY_REFUNDED` (some lines/quantities remain refundable) or `REFUNDED` (all lines fully refunded).
  6. Audit `refund.approve` (and `refund.request` when single-step).
- **Reject** (`POST /api/v1/sales/:id/refund-reject { reason }`): requires `sale.refund`; returns sale to `COMPLETED`; audit `refund.reject`. Rejection is terminal for that request (a new request may be filed later).
- Replay of an approve key returns the original refund with `replayed: true`; key reuse with a different payload → `IDEMPOTENCY_MISMATCH`.

## Customers (FR-SALE-01 customer selection, Phase 6 profiles)

- CRUD: `POST/GET/PATCH /api/v1/customers`, `GET /api/v1/customers/:id` (detail + purchase history: the customer's COMPLETED sales newest-first, bounded page), archive via `isActive: false` (no hard delete; history must survive).
- Permissions: all session roles may read/create/select (cashiers need this at POS); edit/archive restricted to `owner`/`manager` roles [SPEC-DEFAULT: role-set gate, since the matrix has no customer key and FR-RBAC-02 does not list customer edits as sensitive].
- Search: `q` matches name/phone/email substring, bounded page (default 20, cap 100), same semantics as catalog search.
- Sale linkage: `customerId` on draft/complete is validated against the business's customers (unknown id → `VALIDATION`); `customerName` snapshot auto-fills from the record when omitted. Free-text `customerName` without `customerId` remains allowed (walk-in sales).
- PII: customer PII is hidden from roles without permission per FR-ANALYTICS-04 — detail redacts `phone`/`email`/`address` unless role is `owner`/`manager`/`inventory` [SPEC-DEFAULT: mirrors `cost.view` redaction pattern with a dedicated rule, no new permission key].

## Expenses (FR-EXPENSE-01)

- Fields per PLAN.md: category, amount, description, payment method, date, actor, optional attachment (URL string, validated as URL max 500, no upload), tenant scope.
- `POST /api/v1/expenses { category, amountMinor, description?, method, expenseDate?, attachmentUrl?, shiftId? }`: all session roles may record (cashiers log register outflows); `expenseDate` defaults to now, may be backdated up to 90 days [SPEC-DEFAULT].
- Shift linkage: when `method` is `cash` and `shiftId` is provided, the shift must be OPEN (else `SHIFT_NO_OPEN_SHIFT`) and a `paid_out` movement posts atomically with `referenceType: "Expense"` — this is how register cash expenses enter shift reconciliation. Without `shiftId`, cash expenses are business-level (no shift effect).
- Corrections: expenses are voided, never edited or deleted (`POST /api/v1/expenses/:id/void { reason }`, owner/manager only; sets `voidedAt`/`voidReason`; audit `expense.void`). Voiding a shift-linked expense does NOT auto-remove the cash movement (closed-shift immutability); instead it posts an offsetting `adjustment` movement on the currently open shift of the same register when one exists, else records the void without cash effect and flags `cashAdjusted: false` [SPEC-DEFAULT].
- List/get with filters (category, method, date from/to, voided), bounded pagination.

## Sales History, Detail, Filters, Exports

- `GET /api/v1/sales` gains `customerId`, `dateFrom`, `dateTo` filters (ISO 8601 UTC; bounded range max 366 days [SPEC-DEFAULT]) alongside existing cursor/status pagination.
- `GET /api/v1/sales/:id` detail now embeds `refunds` (with items), `customer` (permission-redacted), `registerId`, and cost redaction unchanged (`cost.view`).
- Export: `GET /api/v1/sales/export?format=csv` with the same filters, requires `export.run` (existing key), capped at 1000 rows [SPEC-DEFAULT], `Content-Type: text/csv`, UTF-8 with BOM for spreadsheet compatibility. Expense export: `GET /api/v1/expenses/export?format=csv`, same gate and cap. Exports are synchronous (bounded cap keeps p95 < 500ms for the cap size).

## Permissions (FR-RBAC-01/02)

Reuse Phase 1 keys plus existing `export.run`; role-set gates where the matrix has no key:

| Operation | Required | Owner | Manager | Cashier | Inventory |
|---|---|---|---|---|---|
| Customer read/create/select | session + membership | yes | yes | yes | yes |
| Customer edit/archive | owner/manager role | yes | yes | no (`FORBIDDEN`) | no |
| Customer PII detail | owner/manager/inventory | full | full | redacted | full |
| Refund request/approve/reject | `sale.refund` (+ separation rule on approve) | yes | yes | no | no |
| Expense record | session + membership | yes | yes | yes | yes |
| Expense void | owner/manager role | yes | yes | no | no |
| Sales/expenses export | `export.run` | yes | yes | no | yes |

## API Endpoints

All under `/api/v1`, `SessionGuard` everywhere, `CsrfGuard` on mutations, envelope `{ code, message, correlationId, fields? }`:

```text
GET    /api/v1/customers?q&active&page&pageSize
POST   /api/v1/customers
GET    /api/v1/customers/:id                       (detail + purchase history)
PATCH  /api/v1/customers/:id                       (owner/manager)
POST   /api/v1/sales/:id/refund-approve            (sale.refund, Idempotency-Key)
POST   /api/v1/sales/:id/refund-reject             (sale.refund)
GET    /api/v1/sales/:id                           (now embeds refunds + customer)
GET    /api/v1/sales?customerId&dateFrom&dateTo    (extended filters)
GET    /api/v1/sales/export?format=csv             (export.run)
POST   /api/v1/expenses
GET    /api/v1/expenses?category&method&dateFrom&dateTo&voided
GET    /api/v1/expenses/:id
POST   /api/v1/expenses/:id/void                   (owner/manager)
GET    /api/v1/expenses/export?format=csv          (export.run)
```

New stable codes: `REFUND_EXCEEDS_LIMIT` (400). Reuse `SHIFT_NO_OPEN_SHIFT`, `IDEMPOTENCY_MISMATCH`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`. New idempotency commandType: `refund.approve`.

## Web UI (PLAN.md 8.2, 9.1)

Same appliance language as Phases 4-5 (TanStack Query + `apiFetch`, CSRF from `/api/v1/auth/csrf`, tabular numerals, text+shape states, no gradients):

- `/sales`: filterable history (status, customer, date range) + cursor pagination + links to detail; export button (visible with `export.run`, server authoritative).
- `/sales/[id]`: full detail (lines, payments, refunds with items, customer, register) + refund request/approve/reject actions gated by permission; approve form with per-line qty inputs bounded by refundable quantities.
- `/customers`: search + create + list; `/customers/[id]`: profile (PII-redacted per role) + purchase history + link to each sale.
- `/expenses`: entry form (category, amount, method, date, attachment URL, optional shift picker for cash) + filtered list + void action (owner/manager) + export button.
- `/pos`: customer search/select dropdown (writes `customerId`, auto-fills name; walk-in free text retained).
- Dashboard: Sales/Customers/Expenses links (replacing remaining placeholders appropriately).

## Audit (PLAN.md 6.7)

Append-only rows for `customer.create`, `customer.update`, `customer.archive`, `refund.request` (exists), `refund.approve`, `refund.reject`, `expense.create`, `expense.void`, each with snapshots, actorId, requestId, idempotency key where applicable. No updates/deletes.

## Test Strategy

TDD throughout. Vitest unit (refundable-qty math, separation rule, expense void semantics, CSV shaping), memory-DB integration (atomic approve with all four compensating writes, over-refund rejection with nothing written, replay idempotency, void-with-adjustment), supertest contract (auth, validation codes, permission gates, cross-tenant `NOT_FOUND`, double-approve, closed-shift cash-refund rejection), exit test + verify script, CI extended. Abuse cases: refund more than sold, double approve, approve without permission, self-approve as non-owner, refund on VOIDED/DRAFT sale, expense backdate beyond window, export without `export.run`, cross-tenant customer/expense/refund access.

## Performance Budgets (PLAN.md 12)

Approve p95 < 500ms (single-sale scope, bounded lines); history reads paginated (cap 100); exports capped at 1000 rows synchronous. Customer search p95 < 200ms on bounded page (name/phone index).

## Exit Criteria

- Owner explains a sale (lines, payments, refunds, customer, register), a refund (requester, approver, items, four compensating records), an expense (fields, void state, shift linkage), and a customer history from source records.
- Over-quantity refund rejected with nothing written; replayed approve posts nothing twice; self-approval by non-owner rejected.
- Cash refund with no open shift rejected; voided shift-linked expense handled per the adjustment rule.
- Cross-tenant customer/sale/refund/expense access returns `NOT_FOUND`.
- Migrations 0001→0007 apply cleanly on live Postgres.

## Non-Goals (deferred)

Supplier/vendor management (later purchasing phase), loyalty/points/credit accounts, customer-facing receipts portal, accounting exports/period close (integrations phase), tax filing, multi-branch customer sharing (Phase 9), offline queued refunds/expenses (Phase 9), AI spend insights (deferred patch), file upload/storage (still URL strings).
