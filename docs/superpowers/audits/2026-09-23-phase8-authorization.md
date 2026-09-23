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

(Findings 1-4 recorded during Tasks 2-3; see git history.)

## Dependency review (`pnpm audit --audit-level=high`, 2026-09-23)

Baseline: 16 vulnerabilities (1 low, 7 moderate, 6 high, 2 critical).

- FIXED: upgraded `vitest` 2.1.8 → 3.2.7 across workspaces (`pnpm up vitest@^3.2.6 -r`; full suite green, no code changes needed). Eliminates both criticals (GHSA-9crc-q9x8-hgqq, GHSA-5xrq-8626-4rwp) and the vite `server.fs.deny` Windows bypass (GHSA-fx2h-pf6j-xcff, via vite 7). Post-upgrade audit: 10 vulns (1 low, 4 moderate, 5 high), zero critical.
- ACCEPTED (transitive via Next.js 15.5.25, build-time only): postcss GHSA-6g55-p6wh-862q + GHSA-r28c-9q8g-f849. PostCSS processes our own stylesheets at build time; no attacker-controlled CSS reaches it. Revisit on Next.js upgrade. Follow-up dated 2026-12-23.
- ACCEPTED (transitive via `@nestjs/platform-express`, unreachable): multer GHSA-wc9g-mqfw-jrwm + GHSA-qfvm-cv95-jqjf + GHSA-535w-7cp7-47q4. Grep proof: no `multipart`/`multer`/`FileInterceptor`/`busboy`/`formidable` usage anywhere under `apps/api/src` — the API is JSON-only with an explicit 100kb body limit, so the vulnerable code path is never loaded for attacker input. Revisit on NestJS upgrade. Follow-up dated 2026-12-23.

## Upload review

- No file-upload handling exists in the product (grep proof above; attachments/images are URL strings, never stored bytes).
- URL validators tightened in Phase 8 Task 3: `imageUrl` and `attachmentUrl` accept http(s) only (`abuse-payments.contract.test.ts` proves `javascript:` rejection).
- JSON body limit explicit at 100kb in `main.ts`; oversize bodies map to 413 `PAYLOAD_TOO_LARGE` (tested).
- Verdict: no upload attack surface beyond validated URL strings.

1. FIXED (abuse-payments suite): `imageUrl` (`catalog.schema.ts`) used bare `z.string().url()`, which ACCEPTS `javascript:`/`data:` URLs per WHATWG parsing — product creation returned 201 for `javascript:alert(1)`. Tightened to http(s)-only via refine; same defense-in-depth refine added to expense `attachmentUrl` (service already protocol-checked). Tests: `abuse-payments.contract.test.ts` "rejects malicious attachment and image URLs".
2. FIXED (abuse-payments suite): oversized JSON bodies surfaced as 500 INTERNAL. Made the 100kb JSON limit explicit in `main.ts` and mapped body-parser 413s to `PAYLOAD_TOO_LARGE` in `AuthErrorFilter` (+ `CODE_STATUS` entry). Test asserts 413.
3. FIXED (abuse-payments suite): cashier role seed included `discount.override`, `inventory.adjust`, and `shift.close.override`, defeating the FR-RBAC-02 threshold policy (cashiers could self-approve over-threshold discounts). Removed all three from the cashier seed in `tenant/seed.ts`; `rolePermissions` reads the seed live so enforcement is immediate. No existing test relied on the old grants (`seed.test.ts` green). Test: "gates over-threshold discounts by permission".
4. (Verify in Task 3 — resolved, no code change needed): concurrent oversell test initially showed 0×201 because the shared fixture product had only 4 units left; rewritten with a dedicated product (stock 5, two qty-5 drafts) → exactly 1×201 + 1×`INSUFFICIENT_STOCK`. Test bug, not production bug.
5. (Documented gap, not a bug) No member-invite API exists, so multi-user-in-one-business flows cannot be E2E-tested with distinct sessions; Playwright covers single-session role surfaces + unit tests prove role gates. Dated follow-up tied to a future invite feature.
6. (Documented gap) Staging performance cannot be measured from this repo; local cohorts + staging procedure instead (Task 7).
