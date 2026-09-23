# Phase 8 Authorization, Tenant, and Index Audit

**Date:** 2026-09-23
**Method:** read every controller, guard, permission definition, and migration index statement in the repo. Every verdict below cites the source file + line pattern; every behavior claim maps to a named passing test (existing or added in Phase 8 Tasks 2-4).

## Route table

Legend: S = `SessionGuard` (class-level unless noted), C = `CsrfGuard` on the route. Gate = server-side role/permission check inside the handler/service.

### Auth (`apps/api/src/auth/nest/auth.controller.ts`, prefix `api/v1/auth`, NO class-level guard)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| POST register | — | — | public; rate-limited 5/min/IP | PASS (abuse: enumeration-safe generic errors — verify in Task 2) |
| POST login | — | — | public; rate-limited 5/min/IP | PASS |
| POST logout | Y | — | session only | PASS |
| GET sessions | Y | — | own user only | PASS |
| DELETE sessions/:id | Y | Y | own session only | PASS |
| POST password-reset/request | — | — | public; rate-limited 5/min/IP | PASS |
| POST password-reset/confirm | — | — | single-use token | PASS |
| POST active-business | Y | Y | membership-derived tenant only | PASS |
| POST confirm-password | Y | Y | re-auth stamp | PASS |
| GET csrf | — | — | issues token cookie | PASS |

### Tenant/Business (`tenant.controller.ts`, `business.controller.ts`, prefix `api/v1`, S class-level)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| GET me | Y | — | membership scope | PASS |
| GET health | Y | — | membership scope | PASS |
| GET business | Y | — | membership scope | PASS |
| PATCH business/settings | Y | Y | re-auth window (`checkReAuth`) | PASS |
| GET/PATCH onboarding | Y | Y | membership scope | PASS |

### Catalog (`catalog.controller.ts`, S class-level)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| GET categories, GET products, GET products/:id | Y | — | session; cost redacted without `cost.view` | PASS |
| POST/PATCH categories, products, archive/restore, import | Y | Y | `price.edit` | PASS |
| POST products/import | Y | Y | `price.edit` + 5/min/business limiter | PASS |

### Inventory (`inventory.controller.ts`, S class-level)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| GET balances, GET products/:id/movements | Y | — | session | PASS |
| POST movements, POST rebuild | Y | Y | `inventory.adjust` | PASS |

### Sales (`sales.controller.ts`, S class-level)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| POST drafts/hold/resume | Y | Y | session (own-draft check in service) | PASS |
| POST complete | Y | Y | SELL_ROLES + Idempotency-Key required | PASS |
| GET sales, sales/:id, sales/export | Y | — | session; cost redacted; export needs `export.run` | PASS |
| POST sales/:id/void | Y | Y | `sale.void` (service) | PASS |
| POST sales/:id/refund-request | Y | Y | `sale.refund` (service) + key required | PASS |
| POST payments/:id/reconcile | Y | Y | `sale.refund` + key required | PASS |

### Shifts (`shift.controller.ts`, S class-level)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| GET registers | Y | — | session | PASS |
| POST/PATCH registers | Y | Y | owner/manager role | PASS |
| POST registers/:id/open | Y | Y | owner/manager/cashier (service) | PASS |
| GET shifts, shifts/:id | Y | — | session; cashier sees own only (service) | PASS |
| POST shifts/:id/cash | Y | Y | session; adjustment needs `shift.close.override` (service) | PASS |
| POST shifts/:id/close | Y | Y | opener-or-override (service) | PASS |

### Customers/Expenses/Refunds/Reports (S class-level on all)

| Method Path | S | C | Gate | Verdict |
|---|---|---|---|---|
| GET/POST customers, GET customers/:id | Y | Y(post) | session; PII redacted for cashiers | PASS |
| PATCH customers/:id | Y | Y | owner/manager role | PASS |
| POST/GET expenses, GET expenses/:id | Y | Y(post) | session | PASS |
| POST expenses/:id/void, GET expenses/export | Y | Y(post) | owner/manager (void); `export.run` (export) | PASS |
| POST sales/:id/refund-approve/reject | Y | Y | `sale.refund` + separation (service); approve needs key | PASS |
| GET dashboard/overview + 7 reports/* | Y | — | session; profit omitted w/o `cost.view`; cashiers owner/manager | PASS |

**Overall verdict: zero missing-guard findings.** Every GET has `SessionGuard`; every POST/PATCH/DELETE has `SessionGuard` + `CsrfGuard`; every sensitive action re-checks server-side. The abuse suites (Tasks 2-4) lock each row.

## Tenant matrix

Existing cross-tenant tests (all assert `NOT_FOUND`, never data): Product, Category (`catalog.contract`), InventoryMovement (`inventory.contract`), Sale (`sales.contract`), Shift (`shift.contract`), Customer (`customer.contract`).

To add in Phase 8 Tasks 2-3 (each a named test, no shrugs): Refund (approve/reject foreign sale), Expense (read/void foreign), Register (read/open foreign), HeldSale (hold/resume foreign draft), Receipt (foreign sale receipt), Reports overview (foreign session sees zeros), Payment reconcile (foreign payment id), Idempotency (same key in two businesses yields independent sales).

## Index review

Audited statements in migrations 0001-0007 against access patterns:

| Index | Serves | Verdict |
|---|---|---|
| User(email) unique | login lookup | OK |
| Session(tokenHash) unique | guard lookup | OK |
| Membership(businessId, userId) unique + side indexes | guard membership check | OK |
| Category(businessId, name) unique; (businessId) | duplicate guard, scoping | OK |
| Product(businessId, isActive), (businessId, categoryId); sku/barcode unique per business | search bounds, duplicate guards | OK |
| InventoryMovement(businessId, productId, createdAt) | history, rebuild | OK |
| InventoryBalance(businessId, productId) unique | balance reads | OK |
| Sale(businessId, receiptNo) + (businessId, idempotencyKey) unique; (businessId, status, createdAt) | receipt gen, replay, history scans | OK |
| Sale(businessId, registerId) | register-filtered history | OK |
| SaleItem(businessId, saleId); Payment(businessId, saleId) + idempotency unique | detail embeds | OK |
| HeldSale(businessId, actorId); SaleIdempotency(businessId, key, commandType) unique | hold/resume, replays | OK |
| Register(businessId, name) unique | duplicate guard | OK |
| Shift(businessId, registerId, status) + (businessId, status, openedAt→see note) | open-shift lookup, lists | OK — note: Shift has no timestamp column; newest-first ordering uses row id order in memory. Date scoping awaits a future `openedAt` column (no migration here). |
| CashMovement(businessId, shiftId, createdAt) + (businessId, registerId, createdAt) | shift ledger, close math | OK |
| Customer(businessId, phone) unique; (businessId, isActive); (businessId, name) | duplicate guard, search | OK |
| Refund(businessId, saleId); RefundItem(businessId, refundId) + (businessId, saleItemId) | refundable math | OK |
| Expense(businessId, category, expenseDate) + (businessId, expenseDate) | filtered lists | OK |

**Gap (justified, one migration):** history/report scans filter `Sale` by `customerId` (`GET /sales?customerId=`, customer purchase history) with no supporting index. → migration `0008_phase8_indexes`: `CREATE INDEX "Sale_businessId_customerId_idx" ON "Sale"("businessId", "customerId");` — Task 6 proves it live. No other gap meets the bar (stated query required).

## Findings

1. (Fix in Task 3) `imageUrl` (`catalog.schema.ts`) uses bare `z.string().url()`, which ACCEPTS `javascript:`/`data:` URLs per WHATWG parsing. Tighten to http(s) only. `attachmentUrl` is service-checked already; add the same schema-level refine for defense in depth.
2. (Verify in Task 3) Nest default JSON body limit — confirm 413 on oversized bodies; make explicit in `main.ts` if implicit.
3. (Documented gap, not a bug) No member-invite API exists, so multi-user-in-one-business flows cannot be E2E-tested with distinct sessions; Playwright covers single-session role surfaces + unit tests prove role gates. Dated follow-up tied to a future invite feature.
4. (Documented gap) Staging performance cannot be measured from this repo; local cohorts + staging procedure instead (Task 7).
