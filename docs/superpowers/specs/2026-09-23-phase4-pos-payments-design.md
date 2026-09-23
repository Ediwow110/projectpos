# Phase 4 POS and Payments Design - Online POS

**Date:** 2026-09-23
**Source spec:** `G:\Vscode\PLAN.md` sections 4.3 (FR-SALE-01..04, FR-RECEIPT-01, FR-REFUND-01/02), 4.4 (FR-PAY-01..04), 5.3, 5.4, 6.2, 6.3, 6.5, 6.6, 6.7, 7, 12, 17 (Phase 4)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-22-phase3-inventory-design.md` (all Phase 0-3 primitives reused unchanged)

## Goal

Implement PLAN.md 17 Phase 4: POS layout, cart, hold/resume, discounts, customer selection, transaction state machine, split payments, idempotency, receipts, and failure/unknown recovery.

**Exit (PLAN.md 17 verbatim):** a real business can complete a sale without duplicate charge, silent failure, or ambiguous inventory effect.

## Architecture

One new NestJS module following Phase 1/2/3 conventions exactly:

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  SalesModule      drafts + hold/resume + complete + payments + receipts (new in Phase 4)
  InventoryModule  unchanged (sale/return movements produced by SalesService via DbPort)
  CatalogModule    unchanged (product snapshot source; price/cost/tax read at sale time)
```

Cross-module calls use NestJS services via `DbPort` only, never direct table access (PLAN.md 5.3). Pure domain logic lives in framework-free functions under `apps/api/src/sales/` (totals, state machine, idempotency) and is unit-tested directly; the controller is a thin adapter tested via `supertest`. `DbPort` is extended with sales methods; `createMemoryDb` implements them in-memory (single-threaded serialization stands in for row locks, matching the repo's test convention). No Redis, workers, storage, offline, shifts UI, or provider integrations in Phase 4.

Critical synchronous path (PLAN.md 5.3): validate tenant/permissions -> lock/reconcile stock -> persist sale snapshot -> persist payments -> persist inventory `sale` movements -> commit. Email/PDF/aggregations leave the path after commit (non-critical, deferred).

## Data Model

All Phase 0-3 models reused as-is. Additions, all tenant-scoped per FR-TENANT-01:

```text
Sale
  id (cuid, global immutable), businessId, receiptNo (human-readable, per-business sequence [SPEC-DEFAULT: YYYY-######]),
  status (DRAFT | PENDING_PAYMENT | PAID | COMPLETED | VOIDED | PAYMENT_FAILED | PAYMENT_UNKNOWN | RECONCILED | REFUND_REQUESTED | PARTIALLY_REFUNDED | REFUNDED),
  subtotalMinor, discountMinor, taxMinor, totalMinor, paidMinor, changeMinor (all int >= 0),
  currency (default business currency, snapshot),
  customerId? (nullable FK-string, no Customer table in Phase 4), customerName? (snapshot string max 120),
  notes? (max 500), heldAt?, completedAt?, voidReason?,
  actorId, requestId, idempotencyKey (client-supplied, see below),
  createdAt, updatedAt
  @@unique([businessId, receiptNo])
  @@unique([businessId, idempotencyKey])
  @@index([businessId, status, createdAt])

SaleItem
  id, businessId, saleId, productId,
  name snapshot, unit snapshot, qty (int > 0),
  priceMinor snapshot, costMinor snapshot, taxRateBps snapshot (null = exempt),
  lineDiscountMinor (int >= 0, default 0), lineTotalMinor (validated),
  @@index([businessId, saleId])

Payment
  id, businessId, saleId, method (cash | card | gcash | maya | bank_transfer | other),
  amountMinor (int > 0), status (SUCCEEDED | FAILED | UNKNOWN),
  providerRef? (unique when present), idempotencyKey,
  createdAt
  @@unique([businessId, idempotencyKey])
  @@index([businessId, saleId])

HeldSale (draft cart persistence for hold/resume)
  id, businessId, actorId, payload (JSON cart snapshot), createdAt, resumedAt?
  @@index([businessId, actorId])
```

Payment methods are data/configuration, not hard-coded UI branches (FR-PAY-01): the `method` enum above is the seeded configuration set; the POS renders method tabs from a `GET /api/v1/payments/methods` config endpoint so new methods need no UI branch.

Customer handling (PLAN.md-faithful split): Phase 4 stores `customerId?` + `customerName?` snapshot on the sale and offers a selection affordance (search-by-name input backed by a stub list endpoint returning exact-match history names). Full Customer CRUD, profiles, and purchase history stay in Phase 6. No `Customer` table in Phase 4.

Refund handling (PLAN.md-faithful split): Phase 4 defines the `REFUND_REQUESTED -> PARTIALLY_REFUNDED -> REFUNDED` transitions and a `POST /api/v1/sales/:id/refund-request` endpoint that moves COMPLETED -> REFUND_REQUESTED with reason + audit. Compensating inventory/payment/cash records and approval workflow complete in Phase 6 (FR-REFUND-01/02 fully verified there). Original sale is never deleted (FR-REFUND-02).

## Money, Tax, Rounding (PLAN.md 6.2)

- Integer minor units everywhere; no float totals. `taxRateBps` basis points per line (null inherits business default from settings).
- Central rounding: half-up to the minor unit, computed once in `computeSaleTotals()` and reused by domain, API, receipts, and (later) reports.
- Line total = qty * priceMinor - lineDiscountMinor; subtotal = sum of line totals; order discount applied after lines [SPEC-DEFAULT: proportional cap at subtotal, never negative]; tax per line rounded then summed [SPEC-DEFAULT, matches catalog convention]; total = subtotal - orderDiscount + tax; paid = sum of SUCCEEDED payments; change = max(0, paid - total). Split payments must sum exactly to total unless cash overpayment with change (FR-PAY-02). Server recomputes and validates all amounts before commit (FR-SALE-02); client cart total is display-only.
- Completed sale stores price/cost/tax snapshot per line so later catalog edits cannot rewrite history (FR-SALE-03).

## Transaction State Machine (PLAN.md 6.3)

```text
DRAFT -> PENDING_PAYMENT -> PAID -> COMPLETED
DRAFT -> VOIDED
PENDING_PAYMENT -> PAYMENT_FAILED | PAYMENT_UNKNOWN -> RECONCILED -> PENDING_PAYMENT (retry with SAME key)
COMPLETED -> REFUND_REQUESTED (Phase 4 endpoint; further transitions in Phase 6)
```

- Only valid transitions accepted; every transition records actor, timestamp, reason, correlation/idempotency key.
- `COMPLETED` immutable except through refund/correction workflows.
- A sale is complete only when sale + validated payment + inventory effect commit atomically.
- Non-definitive payment outcome is `PAYMENT_UNKNOWN`, never a failure and never permission to create a second payment with a new key.

## Idempotency (PLAN.md 6.5)

- Client generates `Idempotency-Key` header before the first attempt and persists it for the command duration.
- Uniqueness on `(businessId, idempotencyKey, commandType)` where commandType in `sale.complete | payment.reconcile | refund.request`.
- Request fingerprint (hash of canonical payload) persisted; reused key with different payload rejected with `IDEMPOTENCY_MISMATCH` (409).
- Duplicate returns original result with `replayed: true` indicator; no second sale/payment/stock deduction.
- Provider references unique and mapped to internal payment. Reconciliation (`POST /api/v1/payments/:id/reconcile` with body `{ outcome: SUCCEEDED | FAILED }`) moves UNKNOWN to terminal state idempotently.

## Inventory Effect

`SalesService.completeSale()` produces Phase 3 `InventoryMovement` rows of type `sale` (qtyDelta negative, one per tracked line) plus `upsertBalance` updates inside the same atomic service call. Untracked products (`trackInventory=false`) skip movements. `preventOversell=true` going negative rejects with `INSUFFICIENT_STOCK` (409) and writes nothing (sale stays PENDING_PAYMENT/FAILED, never partial). Cash movements are recorded as a `cash.sale` audit-compatible entry stub consumed fully by Phase 5 shifts (no `CashMovement` table in Phase 4).

## Discounts and Voids (FR-SALE-01, FR-RBAC-02)

- Line + order discounts supported. Discount above threshold requires `discount.override` [SPEC-DEFAULT: order discount > 10% or any line discount > 20%]. Cashier without the permission gets `FORBIDDEN`; manager/owner pass.
- Voids: DRAFT lines voidable by cashier; whole-sale void (`sale.void`) requires permission. Void records reason + audit, never deletes rows.

## Receipts (FR-RECEIPT-01, FR-SALE-04)

- Every completed sale has `receiptNo` + global immutable `id`.
- `GET /api/v1/receipts/:saleId` returns receipt JSON (business header, lines, totals, payments, change, receiptNo, timestamps UTC). Web renders digital view + print CSS with thermal-friendly 58mm/80mm media queries [SPEC-DEFAULT: CSS-only, no printer SDK]. Download/share via browser print-to-PDF. No printer integrations in Phase 4 (Phase 10).

## Permissions (FR-RBAC-01/02)

Reuse Phase 1 `SENSITIVE_ACTIONS`; no new permission keys:

| Operation | Required | Owner | Manager | Cashier | Inventory |
|---|---|---|---|---|---|
| POS search/add to cart (reads) | session + membership | yes | yes | yes | yes |
| Hold/resume own draft | session + membership | yes | yes | yes | yes |
| Complete sale | session + membership | yes | yes | yes | no (`FORBIDDEN`) |
| Discount above threshold | `discount.override` | yes | yes | no | no |
| Void sale / price edit | `sale.void` / `price.edit` | yes | yes | no | no |
| Refund request | `sale.refund` | yes | yes | no | no |
| Reconcile UNKNOWN | `sale.refund` or owner/manager role [SPEC-DEFAULT: `sale.refund`] | yes | yes | no | no |
| See cost in sale lines | `cost.view` | yes | yes | no (redacted) | yes |

## API Endpoints

All under `/api/v1`, `SessionGuard` everywhere, `CsrfGuard` on mutations, envelope `{ code, message, correlationId, fields? }`:

```text
POST /api/v1/sales/drafts                 (create DRAFT from cart lines)
POST /api/v1/sales/:id/hold               (persist held snapshot)
POST /api/v1/sales/:id/resume             (restore held snapshot to DRAFT)
POST /api/v1/sales/:id/void               (sale.void, reason required)
POST /api/v1/sales/complete               (Idempotency-Key required; atomic commit)
GET  /api/v1/sales?page&pageSize&status    (cursor pagination [SPEC-DEFAULT: cursor, limit 50])
GET  /api/v1/sales/:id
POST /api/v1/payments/:id/reconcile       (sale.refund; { outcome })
GET  /api/v1/payments/methods             (config list, no authz beyond session)
GET  /api/v1/receipts/:saleId
POST /api/v1/sales/:id/refund-request     (sale.refund; reason required)
```

New stable codes: `SALE_INVALID_TRANSITION` (409), `PAYMENT_TOTAL_MISMATCH` (400), `IDEMPOTENCY_MISMATCH` (409), `PAYMENT_UNKNOWN` (202, recoverable), `INSUFFICIENT_STOCK` (reuse Phase 3, 409), `PRODUCT_NOT_TRACKED` n/a (skipped silently). Cross-tenant/missing rows `NOT_FOUND` (404). All timestamps ISO 8601 UTC.

## Web UI (PLAN.md 8.3)

POS route `/pos` (cashier-first, `"use client"` + TanStack Query + `apiFetch`, CSRF from `/api/v1/auth/csrf`):

- Desktop/tablet: left search/scan + categories/favorites + product grid; right persistent cart (lines, qty steppers, discount, notes, customer input, hold/resume, void) + subtotal/discount/total + PAY.
- Payment panel: amount due, method tabs (from config endpoint), amount received, change, split-payment line editor, processing/success/failed/unknown states (unknown shows reconcile guidance, never blind-retry copy).
- Receipt view: digital + print button, 58/80mm print CSS.
- Role gating hides discount-override/void/refund affordances without permission; server authoritative. Keyboard: scan-input focus, Enter = add, `+`/`-` qty, `F9` pay [SPEC-DEFAULT]. Unknown-payment and offline-indicator as designed states.
- Frontend-design direction: appliance-like ops tool — large touch targets, tabular numerals, text+shape status (never color alone), no gradients, motion limited to add-item/payment confirmations.

## Audit (PLAN.md 6.7)

Append-only rows for `sale.draft`, `sale.hold`, `sale.resume`, `sale.complete`, `sale.void`, `payment.reconcile`, `refund.request`, each with before/after snapshots (cost included), actorId, requestId, idempotency key in reason/meta. No updates/deletes.

## Test Strategy

TDD throughout. Vitest unit (totals/rounding, state machine, idempotency fingerprint, discount policy), memory-DB integration (atomic commit, oversell rollback, replay returns original, UNKNOWN->reconcile), supertest contract (auth, validation codes, permission gates, cross-tenant NOT_FOUND, double-submit same key creates one sale), exit test + verify script, CI extended. Abuse cases from PLAN.md 13.3: duplicate payment, double submit, negative qty/price, huge discount, total mismatch, concurrent last-stock sales, timeout resubmit, unknown provider status, refund exceeding bounds.

## Performance Budgets (PLAN.md 12)

Cart recalc local < 20ms; add-to-cart perceived < 50ms (local-first, no per-click API wait); sale creation p95 < 500ms after API reach; payment command p95 < 500ms excl. provider settlement. Catalog metadata preloaded; never cache inventory/payment/financial totals.

## Exit Criteria

- Cashier completes a cash + split-payment sale end-to-end (search -> cart -> discount -> hold/resume -> pay -> receipt) with stock decreased, sale snapshot immutable, audit entries present.
- Same `Idempotency-Key` replayed returns original with `replayed: true`; no second sale/payment/movement.
- UNKNOWN payment visible with reconcile path; no blind-retry affordance.
- Concurrent last-stock sales: one succeeds, other gets `INSUFFICIENT_STOCK`, ledger == balance.
- Cross-tenant sale/payment/receipt access returns `NOT_FOUND`.

## Non-Goals (deferred)

Full Customer CRUD/history (Phase 6), refund approval workflow + compensating records (Phase 6), registers/shifts/cash reconciliation (Phase 5), expenses (Phase 6), dashboard/reports (Phase 7), branches/offline/billing/integrations/AI (Phases 9-10), provider SDKs, printer hardware, hold listing across users (own drafts only in Phase 4 [SPEC-DEFAULT]).
