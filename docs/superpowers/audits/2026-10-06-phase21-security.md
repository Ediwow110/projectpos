# Phase 21 security and concurrency evidence

Date: 2026-10-06

## Scope and coverage

The existing contract suite already exercises the sensitive route families with session, CSRF, permission, tenant, and branch boundaries. The review inventory is:

| Surface | Evidence |
| --- | --- |
| Sales, payment callbacks, refunds, voids | `test/sales.contract.test.ts`, `test/abuse-payments.contract.test.ts`, `test/refund.contract.test.ts`, `src/sales/nest/sales.service.test.ts` |
| Inventory, counts, transfers, shifts | `test/inventory.contract.test.ts`, `test/transfer.contract.test.ts`, `test/shift.contract.test.ts`, `src/inventory/nest/inventory-count.service.test.ts` |
| Procurement and suppliers | `test/procurement.contract.test.ts`, `src/procurement/nest/procurement.service.test.ts` |
| Gift cards, store credit, loyalty, receipts | `test/loyalty-settings.contract.test.ts`, `test/receipt-delivery.contract.test.ts`, `src/value/stored-value.service.test.ts`, `src/value/value.sale.integration.test.ts` |
| Customers, reports, expenses, devices, settings | `test/customer.contract.test.ts`, `test/dashboard.contract.test.ts`, `test/expense.contract.test.ts`, `test/device.contract.test.ts`, `test/plan-limits.contract.test.ts` |
| Catalog/product-family dimensions | `test/phase21-security.contract.test.ts`, `test/catalog.contract.test.ts`, `test/pg/pg-product-model.test.ts` |

The new Phase 21 contract proves a family projection and option mutation cannot cross business boundaries, and that the mutation remains protected by the existing authenticated write path. It also proves an unsafe oversized request ID is not reflected into the error envelope.

## Concurrency and replay evidence

- Sale completion vs void is serialized by the sale lock; a completed sale cannot be voided (`src/sales/nest/sales.service.test.ts`).
- Two concurrent void attempts produce one success, one `SALE_INVALID_TRANSITION`, one audit row, and one persisted reason/timestamp.
- Payment completion duplicate keys, mismatched fingerprints, and concurrent oversell are covered by `test/abuse-payments.contract.test.ts`.
- Refund/exchange replay, webhook duplicate delivery, receiving replay, stored-value adjustment replay, and manager-approval one-use claims are covered by the existing service/contract tests listed above.

## Findings

No new cross-tenant, branch-scope, permission, idempotency, or concurrency defect was found in this pass. The variant-dimension contract intentionally supports additive values and archival only; referenced values and option names cannot be rewritten.

## Verification

- `pnpm --filter @pos/api exec vitest run test/phase21-security.contract.test.ts src/sales/nest/sales.service.test.ts` — 19/19 passed.
- Full API suite after this audit — 109 files / 527 tests passed before the additional 1 concurrency test; rerun the full suite at closure.
- No production credentials, cookies, bearer codes, or customer data are included in this audit.
