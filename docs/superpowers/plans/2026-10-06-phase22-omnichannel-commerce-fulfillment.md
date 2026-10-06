# Phase 22 Omnichannel Commerce & Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-party web ordering, inventory reservations, pickup/manual-delivery fulfillment, and guest order status while keeping the existing Sale/Payment/Refund stack as NexPOS's only financial authority.

**Architecture:** Introduce an `Order` family beside—not above—the existing `Sale` family. Orders freeze customer intent and fulfillment snapshots; reservations reduce available-to-sell without moving stock; linked Sale completion performs the one authoritative inventory movement and commits the owning reservation in the same transaction. Guest access uses scoped hashed tokens, staff operations stay under the existing session/CSRF/RBAC boundary, and all stock-decreasing paths share one reservation-aware availability service and the existing `sales:<businessId>` -> sorted inventory-lock order.

**Tech Stack:** TypeScript, NestJS, Next.js App Router, Zod, PostgreSQL/Prisma migrations with hand-written `DbPort` adapters, Vitest, Playwright, pnpm/Turbo, existing PayMongo/Brevo integrations.

**Spec:** `docs/superpowers/specs/2026-10-06-phase22-omnichannel-commerce-fulfillment-design.md`

## Global Constraints

- Baseline is `origin/main` commit `fd686025b80f31acb0400a5ade5acc11b400ef78` plus the approved Phase 22 design commits; preserve Phase 1–21 behavior.
- `Sale`, `Payment`, and `Refund` remain the only financial/refund/receipt authority; do not create an Order ledger or `order.refund`.
- Guest WEB checkout cannot issue/reload/redeem gift cards and cannot use loyalty or store credit.
- Historical Sales remain valid with no Order; do not backfill them.
- Every submitted Order has an explicit fulfillment branch; no silent branch fallback or cross-branch routing.
- Canonical mutation lock order is `sales:<businessId>` first, then sorted `(businessId, branchId, productId)` inventory advisory locks.
- Reservation rows never create inventory movements or mutate `qtyOnHand`; linked Sale completion commits reservations and performs the stock movement exactly once.
- Existing `IDEMPOTENCY_MISMATCH` and `STALE_VERSION` codes remain authoritative; add only `RESERVATION_CONFLICT` for reservation-breaking stock mutations.
- Public checkout credential: 256-bit random secret, SHA-256 at rest, Secure/HttpOnly/SameSite=Strict cookie, two-hour expiry, exact first-party Origin on cookie-authenticated mutations.
- Public status token: separate 256-bit random token, SHA-256 at rest, 30-day expiry, one-order read-only scope, staff-only rotate/resend/revoke, never persisted client-side.
- Pay-at-pickup remains a 20-minute timed hold until explicit staff acceptance; only accepted/paid Orders become non-expiring operational holds.
- Delivery is prepaid only; pickup may be prepaid or pay at pickup.
- Delivery fee uses a flat business setting and the existing business tax convention; no zone/distance pricing or generic fee framework.
- Fulfillment never mutates money or inventory; `COLLECTED` and `DELIVERED` are terminal physical-handoff facts.
- No new runtime dependency unless the standard library and current packages cannot satisfy a requirement.

## Review Focus

- **Last-unit race:** a POS Sale, web Order reservation, transfer dispatch, supplier return, or negative count hitting the same final unit must leave one valid winner and never consume another Order's HELD quantity. Task 4 owns the race tests.
- **Acceptance-vs-expiry race:** a pay-at-pickup Order accepted at the TTL boundary must become either one confirmed operational hold or one expired/released Order, never both. Task 8 owns the race tests.
- **Provider uncertainty:** a PayMongo callback/reconciliation arriving while a WEB reservation is pending/unknown must not lose the hold, duplicate stock movement, or complete without exact owning reservation coverage. Task 5 owns these tests.
- **Refund replay/capacity:** repeated delivery/merchandise refunds across split tenders must never exceed original tender capacity, double-reverse delivery fee/tax, or distort merchandise/COGS/loyalty reporting. Task 6 owns these tests.
- **Bearer/tenant leakage:** storefront keys may identify a tenant but checkout/status secrets must never cross Orders, tenants, logs, retained URL state, analytics, or crash telemetry. Tasks 2, 7, and 9 own these tests.

---

## File Structure Map

### New API order family

- `apps/api/src/orders/order-types.ts` — shared Order, fulfillment, reservation, page-query, and payment-projection types.
- `apps/api/src/orders/order-state.ts` — pure Order/Fulfillment transition guards.
- `apps/api/src/orders/order-contact.ts` — deterministic email/phone normalization shared by guest submit and CRM linking.
- `apps/api/src/orders/payment-status.ts` — pure derived `Order.paymentStatus` precedence.
- `apps/api/src/orders/order-service.ts` — tenant-scoped Order read/write orchestration and staff list/detail commands.
- `apps/api/src/orders/order-sale-service.ts` — create/link Sale from frozen Order snapshots and create POS Order companion rows.
- `apps/api/src/orders/reservation-service.ts` — hold/release/expire/commit reservations under canonical locks.
- `apps/api/src/orders/fulfillment-service.ts` — acceptance, allocation, assignment, and physical state transitions only.
- `apps/api/src/orders/order-access-service.ts` — checkout/status token mint/lookup/rotate/revoke.
- `apps/api/src/orders/order-expiry-service.ts` — native-timer sweep for due timed reservations with provider-state safety.
- `apps/api/src/orders/order-notification-service.ts` — post-commit customer email events using newly minted status tokens.
- `apps/api/src/orders/nest/order.controller.ts` — authenticated staff Order API.
- `apps/api/src/orders/nest/public-order.controller.ts` — public storefront/draft/submit/payment/status API.
- `apps/api/src/common/first-party-origin.guard.ts` — exact `WEB_URL` Origin check for checkout-cookie mutations.
- `apps/api/src/common/pg/pg-orders.ts` — PostgreSQL Order-family persistence and bounded list query.
- `packages/validation/src/orders.schema.ts` — public/staff Order validation and pagination contracts.

### Shared inventory boundary

- `apps/api/src/inventory/availability-service.ts` — reservation-aware `availableToSell` and discretionary stock-decrease checks.

### Web

- `apps/web/src/lib/orders.ts` — Order types/query builders/action helpers.
- `apps/web/src/lib/order-status-token.ts` — consume-and-scrub fragment token before POST.
- `apps/web/src/app/order/page.tsx` — public storefront/cart/checkout.
- `apps/web/src/app/order-status/page.tsx` — token-scoped public status and provider-return message.
- `apps/web/src/app/orders/page.tsx` — bounded staff Order queue.
- `apps/web/src/app/orders/[id]/page.tsx` — staff Order/fulfillment actions.
- `apps/web/src/app/admin/online-ordering/page.tsx` — owner online-ordering configuration/shareable storefront URL.

---

### Task 1: Add Phase 22 persistence and domain contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0035_phase22_omnichannel_orders/migration.sql`
- Modify: `apps/api/src/common/db.port.ts`
- Modify: `apps/api/src/common/memory.db.ts`
- Create: `apps/api/src/common/pg/pg-orders.ts`
- Modify: `apps/api/src/common/pg/pg.db.ts`
- Modify: `apps/api/src/common/pg/pg-tenants.ts`
- Modify: `apps/api/src/common/pg/pg-sales.ts`
- Modify: `apps/api/src/common/pg/pg-people.ts`
- Create: `apps/api/src/orders/order-types.ts`
- Test: `apps/api/test/pg/pg-orders.test.ts`
- Test: `apps/api/test/pg/pg-sales.test.ts`
- Test: `apps/api/src/orders/order-persistence.test.ts`

**Interfaces:**
- `DbBusiness` gains `storefrontKey: string | null`; add `findBusinessByStorefrontKey(key: string): Promise<DbBusiness | null>` and `setBusinessStorefrontKey(id: string, key: string): Promise<DbBusiness | null>`.
- `DbSale` gains `deliveryFeeMinor: number`, `deliveryTaxMinor: number`; existing Sale creation paths default both to `0`.
- `DbRefund` gains `deliveryFeeRefundMinor: number`, `deliveryTaxRefundMinor: number`; existing refund paths default both to `0`.
- Create `DbOrder`, `DbOrderLine`, `DbInventoryReservation`, `DbFulfillment`, `DbFulfillmentLine`, `DbOrderAccessToken`.
- `DbOrder.paymentMode` is an immutable snapshot: `POS | PREPAID | PAY_AT_PICKUP`.
- `DbOrder.branchId` is required for every WEB Order. It may be null only for `channel=POS` with `fulfillmentMode=NONE`, preserving the existing branch-null POS compatibility surface; no WEB request may use that exception.
- `Order.saleId` is nullable and unique; historical Sales require no matching Order.
- `OrderLine.bundleComponentsSnapshot` is validated JSON containing `componentProductId`, `componentNameSnapshot`, `quantityPerBundleSnapshot`, `costMinorSnapshot`, `compositionVersion`.
- Add Order-family CRUD/lookup methods to `DbPort`, including `findOrderBySaleId`, active reservation lookup by branch/product, token lookup by hash, token revoke, `listDueReservationOrders(now: Date, limit: number)`, and a DB-level bounded Order page query.

- [ ] **Step 1: Write failing PostgreSQL parity tests**

Add named tests proving:

```text
stores Order + submitted OrderLine snapshots and version
enforces one Order per Sale and one Sale per Order
stores HELD reservation with nullable expiresAt
stores Fulfillment + FulfillmentLine allocation
stores/revokes OrderAccessToken by tokenHash
looks up Business by storefrontKey
round-trips Sale delivery fields and Refund delivery-refund fields
```

- [ ] **Step 2: Run the new PG tests and verify they fail before the migration**

Run: `pnpm --filter @pos/api test:pg -- pg-orders pg-sales`

Expected: FAIL because Phase 22 tables/columns/port methods do not exist.

- [ ] **Step 3: Add the additive migration and Prisma models**

Create the Order-family tables/indexes/relations and nullable `Business.storefrontKey`. Add Sale/Refund delivery columns with `DEFAULT 0 NOT NULL`. Index at minimum:

```text
Order(businessId, createdAt, id)
Order(businessId, status, createdAt)
Order(businessId, branchId, createdAt)
Order(businessId, channel, createdAt)
InventoryReservation(businessId, branchId, productId, status, expiresAt)
InventoryReservation(businessId, orderId, status)
Fulfillment(businessId, orderId, status)
OrderAccessToken(tokenHash UNIQUE)
OrderAccessToken(businessId, orderId, kind, revokedAt, expiresAt)
Business(storefrontKey UNIQUE)
```

- [ ] **Step 4: Implement memory and PostgreSQL parity**

Keep the new PostgreSQL methods in `pg-orders.ts`; wire that family through `PgDbPort`. Update tenant/sales/people families only for their owned Business/Sale/Refund fields.

- [ ] **Step 5: Run persistence tests**

Run: `pnpm --filter @pos/api test:pg -- pg-orders pg-sales`

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS with every `createSale`, `createRefund`, and `createBusiness` caller supplying/defaulting the new fields.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma apps/api/src/common apps/api/src/orders/order-types.ts apps/api/test/pg
git commit -m "feat(orders): add omnichannel persistence"
```

### Task 2: Add online-ordering configuration, storefront locator, and RBAC

**Files:**
- Modify: `packages/auth/src/permissions.ts`
- Modify: `packages/auth/test/permissions.test.ts`
- Modify: `apps/api/src/tenant/seed.ts`
- Modify: `apps/api/test/seed.test.ts`
- Modify: `packages/validation/src/auth.schema.ts`
- Create: `packages/validation/src/orders.schema.ts`
- Modify: `packages/validation/src/index.ts`
- Modify: `apps/api/src/business/nest/business.service.ts`
- Modify: `apps/api/src/business/nest/business.service.test.ts`
- Modify: `apps/api/src/common/http-helpers.ts`

**Interfaces:**
- Add permissions: `order.view`, `order.create`, `order.submit`, `order.accept`, `order.cancel`, `order.fulfill`, `order.collect`, `order.view_delivery_details`, `order.link_customer`, `order.manage_access`.
- Owner/manager receive all Order permissions.
- Cashier receives `order.view`, `order.create`, `order.submit`, `order.accept`, `order.collect`.
- Inventory receives `order.view`, `order.fulfill`, `order.view_delivery_details`; it does not receive cancel/refund/access/CRM-link authority by default.
- Business settings accept `onlineOrderingEnabled: boolean`, `onlinePickupBranchIds: string[]`, `onlineFulfillmentBranchId: string | null`, `deliveryFlatFeeMinor: integer >= 0`.
- All active branches are candidates, but only IDs in `onlinePickupBranchIds` are public pickup branches.
- Enabling online ordering calls `ensureStorefrontKey(businessId): Promise<string>`, minting `randomBytes(16).toString("hex")` once; disabling ordering does not rotate/delete the key.
- Add `RESERVATION_CONFLICT -> 409` to the existing HTTP code map.
- `orders.schema.ts` validates public `storefrontKey` as exactly 32 lowercase/uppercase hex characters and checkout/status bearer tokens as exactly 64 hex characters.
- WEB contact validation requires trimmed `contactName`, valid email, normalized phone, and for DELIVERY an address snapshot `{ line1, line2?, city, region, postalCode, countryCode }`; `line1/city/region/postalCode` are non-empty and `countryCode` is two uppercase letters (default `PH` in the web UI).

- [ ] **Step 1: Write failing permission/seed/settings tests**

Assert exact default role grants, owner-only `settings.write`, rejection of non-tenant/inactive pickup branch IDs, rejection of invalid delivery branch IDs, non-negative delivery fee, and stable storefront key across repeated enable/disable.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @pos/api exec vitest run src/business/nest/business.service.test.ts test/seed.test.ts && pnpm --filter @pos/auth test`

- [ ] **Step 3: Implement permissions, settings validation, and storefront-key minting**

Do not make `storefrontKey` a secret; it is a public tenant locator. Do not accept a client-supplied business ID on guest routes.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth packages/validation apps/api/src/tenant apps/api/src/business apps/api/src/common/http-helpers.ts apps/api/test/seed.test.ts
git commit -m "feat(orders): add online ordering settings"
```

### Task 3: Implement Order state, payment projection, and bounded staff reads

**Files:**
- Create: `apps/api/src/orders/order-state.ts`
- Create: `apps/api/src/orders/payment-status.ts`
- Create: `apps/api/src/orders/order-service.ts`
- Create: `apps/api/src/orders/nest/order.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/orders/order-state.test.ts`
- Test: `apps/api/src/orders/payment-status.test.ts`
- Test: `apps/api/src/orders/order-service.test.ts`
- Test: `apps/api/test/order.contract.test.ts`
- Test: `apps/api/test/pg/pg-orders.test.ts`

**Interfaces:**
- `transitionOrder(from, to): OrderStatus` implements the approved lifecycle; `REJECTED` is pre-confirmation only.
- `transitionFulfillment(type, from, to): FulfillmentStatus` implements the approved pickup/delivery cancellation rules.
- `deriveOrderPaymentStatus(input: { sale, payments, refunds, refundItems }): OrderPaymentStatus` implements the complete precedence table and is never persisted.
- `OrderService.listOrders(businessId, query): Promise<{items: OrderListItem[]; nextCursor: string | null}>` uses an opaque base64url JSON cursor `{createdAt, id}`, validates max 366-day range, and delegates filtering/pagination to `DbPort.listOrdersPage`.
- Staff list query contract is exactly:

```text
cursor?: opaque cursor
limit: integer 1..100, default 50
status?: Order lifecycle status
channel?: POS | WEB
fulfillmentMode?: NONE | PICKUP | DELIVERY
branchId?: tenant-owned branch id
paymentStatus?: UNPAID | PENDING | UNKNOWN | FAILED | PAID | PARTIALLY_REFUNDED | REFUNDED
dateFrom?: ISO timestamp
dateTo?: ISO timestamp
```

- `OrderService.getOrder(businessId, id, granted)` redacts delivery address/contact fields unless `order.view_delivery_details` is granted.

- [ ] **Step 1: Write pure state/projection tests**

Cover every existing Sale state plus transient precedence: full/partial approved refund rows outrank stale Sale status; UNKNOWN outranks incomplete success; fully covered SUCCEEDED payments yield PAID; RECONCILED failed/insufficient yields FAILED.

- [ ] **Step 2: Write bounded-list contract/PG tests**

Assert stable `createdAt DESC, id DESC` cursor ties, 50 default/100 max, 366-day maximum, tenant/branch scope, and persistence-level filtering. Add a PG test that fails if the service falls back to tenant-wide `listOrdersByBusiness`.

- [ ] **Step 3: Implement state/projection helpers and OrderService**

Keep cursor encode/decode in `order-service.ts` or a tiny private helper; do not add a cursor dependency.

- [ ] **Step 4: Add authenticated staff GET routes**

```text
GET /api/v1/orders
GET /api/v1/orders/:id
```

Require `order.view` and preserve current error envelope/correlation ID conventions.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @pos/api exec vitest run src/orders/order-state.test.ts src/orders/payment-status.test.ts src/orders/order-service.test.ts test/order.contract.test.ts`

Run: `pnpm --filter @pos/api test:pg -- pg-orders`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orders apps/api/src/app.module.ts apps/api/test/order.contract.test.ts apps/api/test/pg/pg-orders.test.ts
git commit -m "feat(orders): add staff order reads"
```

### Task 4: Add reservations and reservation-aware stock protection

**Files:**
- Create: `apps/api/src/inventory/availability-service.ts`
- Create: `apps/api/src/orders/reservation-service.ts`
- Modify: `apps/api/src/sales/sale-stock-service.ts`
- Modify: `apps/api/src/sales/payment-provider-service.ts`
- Modify: `apps/api/src/transfers/nest/transfer.service.ts`
- Modify: `apps/api/src/procurement/nest/procurement.service.ts`
- Modify: `apps/api/src/inventory/nest/inventory-count.service.ts`
- Test: `apps/api/src/orders/reservation-service.test.ts`
- Test: `apps/api/src/sales/sale-stock-service.test.ts`
- Test: `apps/api/src/transfers/nest/transfer.service.test.ts`
- Test: `apps/api/src/procurement/nest/procurement.service.test.ts`
- Test: `apps/api/src/inventory/nest/inventory-count.service.test.ts`
- Test: `apps/api/test/phase22-reservation-concurrency.contract.test.ts`
- Test: `apps/api/test/pg/pg-two-instance.test.ts`

**Interfaces:**
- `InventoryAvailabilityService.availableToSell(businessId, branchId, productId, ownerOrderId?): Promise<number>`.
- `InventoryAvailabilityService.assertDecreaseAllowed(businessId, branchId, requirements, ownerOrderId?): Promise<void>` throws `RESERVATION_CONFLICT` when on-hand minus other active HELD reservations cannot cover the decrease.
- `ReservationService.holdSubmittedOrder(businessId, orderId, idempotencyKey, now): Promise<DbInventoryReservation[]>` atomically creates all bundle/component holds or none.
- `ReservationService.releaseOrder(..., target: "RELEASED" | "EXPIRED")`.
- `ReservationService.commitForSale(businessId, orderId, saleId): Promise<void>` verifies exact active coverage then marks HELD -> COMMITTED.
- All reservation/decrease mutations acquire `sales:<businessId>` before sorted inventory locks.

- [ ] **Step 1: Write last-unit and own-hold failing tests**

Assert:

```text
two Orders racing for one unit -> one HELD, one RESERVATION_CONFLICT
POS Sale cannot consume another Order's HELD unit
linked Sale ignores its own HELD quantity but not other Orders' HELD quantity
bundle reservation expands submitted component snapshot exactly once
release/expire restores ATS without inventory movement
```

- [ ] **Step 2: Write stock-decrease regression tests**

Transfer dispatch, supplier-return posting, and a negative count/correction must fail with `RESERVATION_CONFLICT` before writing movement/balance changes when they would invade a hold.

- [ ] **Step 3: Implement shared availability service and ReservationService**

Use current `withInventoryLocks`; do not create another lock primitive. Query only `HELD` reservations; COMMITTED/RELEASED/EXPIRED do not reduce ATS.

- [ ] **Step 4: Route every discretionary stock decrease through the shared guard**

Wrap transfer dispatch, supplier-return posting, and count posting with the business Sale lock before inventory locks to preserve the canonical order.

- [ ] **Step 5: Run focused and two-instance tests**

Run: `pnpm --filter @pos/api exec vitest run src/orders/reservation-service.test.ts src/sales/sale-stock-service.test.ts src/transfers/nest/transfer.service.test.ts src/procurement/nest/procurement.service.test.ts src/inventory/nest/inventory-count.service.test.ts test/phase22-reservation-concurrency.contract.test.ts`

Run: `pnpm --filter @pos/api test:pg -- pg-two-instance pg-orders`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/inventory apps/api/src/orders apps/api/src/sales apps/api/src/transfers apps/api/src/procurement apps/api/test
git commit -m "feat(inventory): protect order reservations"
```

### Task 5: Link Orders to Sales and make payment settlement reservation-aware

**Files:**
- Create: `apps/api/src/orders/order-sale-service.ts`
- Modify: `apps/api/src/sales/nest/sales.service.ts`
- Modify: `apps/api/src/sales/sale-draft-service.ts`
- Modify: `apps/api/src/sales/sale-completion-service.ts`
- Modify: `apps/api/src/sales/sale-lifecycle-service.ts`
- Modify: `apps/api/src/sales/payment-provider-service.ts`
- Modify: `apps/api/src/sales/paymongo-webhook-service.ts`
- Modify: `apps/api/src/sales/payment-reconciliation-service.ts`
- Modify: `apps/api/src/sales/sales-types.ts`
- Test: `apps/api/src/orders/order-sale-service.test.ts`
- Test: `apps/api/src/sales/nest/sales.service.test.ts`
- Test: `apps/api/src/sales/sale-completion-service.test.ts`
- Test: `apps/api/src/sales/payment-provider-service.test.ts`
- Test: `apps/api/src/sales/paymongo-webhook-service.test.ts`
- Test: `apps/api/src/sales/payment-reconciliation-service.test.ts`
- Test: `apps/api/test/paymongo.contract.test.ts`
- Test: `apps/api/test/webhook.contract.test.ts`

**Interfaces:**
- `OrderSaleService.createSaleFromSubmittedOrder(businessId, actorId, requestId, orderId): Promise<DbSale>` copies frozen OrderLine/bundle snapshots, branch, totals, `deliveryFeeMinor`, and `deliveryTaxMinor`; it never reads live price/composition for repricing.
- WEB Sales always keep `Sale.customerId = null` even if staff later links `Order.customerId`; CRM linkage is operational context only and cannot unlock customer-only tender/refund destinations for that submitted Order.
- `OrderSaleService.createPosOrderForSale(...): Promise<DbOrder>` creates channel `POS`, fulfillmentMode `NONE`, and links the new Sale; historical rows remain untouched.
- New POS draft creation wraps Sale + POS Order companion creation in one transaction.
- The POS companion starts `CONFIRMED`, `paymentMode=POS`, `fulfillmentMode=NONE`, and creates no reservation/Fulfillment. Successful Sale completion moves it to `COMPLETED`; voiding the linked pre-completion Sale moves it to `CANCELLED`. A completed POS Order remains COMPLETED if money is later refunded because physical handoff is historical fact.
- `SalesStockService.applySale(..., ownerOrderId?: string)` uses reservation-aware availability.
- Sale completion/webhook/reconciliation find the linked Order by `saleId`; in the same transaction they apply stock once, COMMIT owning reservations, and move a prepaid WEB Order to `CONFIRMED`.
- `SalesPaymentProviderService.startPayMongoCheckout` accepts optional safe return paths; staff Sale flow keeps current defaults, WEB flow supplies token-free `/order-status?payment=success|cancelled`.

- [ ] **Step 1: Write failing snapshot/link tests**

Prove a WEB Sale uses frozen Order prices/taxes/bundle components even if the live Product changes after submission. Prove a new POS draft gets one Order and historical Sale reads still tolerate no Order.

- [ ] **Step 2: Write settlement concurrency tests**

Cover normal complete, PayMongo signed webhook, and UNKNOWN reconciliation:

```text
own HELD reservation -> COMMITTED exactly once
stock movement exactly once
duplicate webhook/reconciliation -> no duplicate movement/commit
missing/expired reservation coverage -> no Sale completion
PAYMENT_UNKNOWN retains reservation
definitive failed payment leaves timed Order submitted/retryable
```

- [ ] **Step 3: Implement OrderSaleService and POS companion creation**

Keep Sales as financial owner; Order service does not create Payment/Refund rows.

- [ ] **Step 4: Integrate settlement hooks into all three financial completion paths**

Preserve `sales:<businessId>` outer lock and existing idempotency keys.

- [ ] **Step 5: Run focused API/payment tests**

Run: `pnpm --filter @pos/api exec vitest run src/orders/order-sale-service.test.ts src/sales/sale-completion-service.test.ts src/sales/payment-provider-service.test.ts src/sales/paymongo-webhook-service.test.ts src/sales/payment-reconciliation-service.test.ts test/paymongo.contract.test.ts test/webhook.contract.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orders apps/api/src/sales apps/api/test
git commit -m "feat(orders): settle linked web sales"
```

### Task 6: Extend the existing refund/reporting/receipt path for delivery charges

**Files:**
- Modify: `packages/validation/src/refunds.schema.ts`
- Modify: `packages/validation/src/approvals.schema.ts`
- Modify: `apps/api/src/auth/nest/manager-approval-policy.service.ts`
- Modify: `apps/api/src/refunds/nest/refund.service.ts`
- Modify: `apps/api/src/refunds/nest/refund.controller.ts`
- Modify: `apps/api/src/reports/reporting-core.ts`
- Modify: `apps/api/src/reports/reporting-breakdown-service.ts`
- Modify: `apps/api/src/reports/nest/reporting.service.ts`
- Modify: `apps/api/src/exports/nest/export.service.ts`
- Modify: `apps/api/src/sales/receipt-service.ts`
- Modify: `apps/api/src/sales/receipt-text.ts`
- Modify: `apps/web/src/app/sales/[id]/page.tsx`
- Modify: `apps/web/src/lib/sales.ts`
- Test: `apps/api/src/refunds/nest/refund.service.test.ts`
- Test: `apps/api/src/auth/nest/manager-approval-policy.service.test.ts`
- Test: `apps/api/test/refund.contract.test.ts`
- Test: `apps/api/test/export.contract.test.ts`
- Test: `apps/api/src/reports/nest/reporting.service.test.ts`
- Test: `apps/api/src/sales/receipt-service.test.ts`
- Test: `apps/api/src/sales/receipt-text.test.ts`
- Test: `apps/web/src/lib/sales.test.ts`

**Interfaces:**
- Existing refund-approve input gains `deliveryRefundMinor?: number`; allowed values are `0/undefined` or the full remaining `deliveryFeeMinor + deliveryTaxMinor`.
- Server persists `Refund.deliveryFeeRefundMinor` and `deliveryTaxRefundMinor`; client never provides the split.
- Existing manager-approval action/fingerprint/threshold includes normalized delivery refund.
- Original-tender allocator skips capacity consumed by **all prior approved Refund.totalMinor** before allocating the current refund across original SUCCEEDED Payment legs in deterministic creation/id order.
- Full Sale refund requires existing full-merchandise predicate and full delivery fee+tax reversal when delivery charge exists.
- Delivery refund has no inventory/COGS/loyalty effect.
- Receipt/detail/report/export projections show delivery charge/tax distinctly and never classify delivery refunds as merchandise refunds.

- [ ] **Step 1: Write failing delivery-refund and split-tender tests**

Assert full remaining delivery refund, second attempt `REFUND_EXCEEDS_LIMIT`, partial amount rejection, threshold/fingerprint inclusion, prior-refund tender-capacity skipping, and zero inventory/loyalty movements.

- [ ] **Step 2: Write failing reporting/receipt tests**

Assert merchandise revenue, delivery revenue, delivery tax, gift-card liability, refund totals, and COGS remain separated.

- [ ] **Step 3: Implement the minimal RefundService extension**

Do not add a second refund service. Keep existing `sale.refund`/`refund.override`, destination handling, and audit/idempotency structure.

- [ ] **Step 4: Update report/export/receipt projections**

Any current calculation of “merchandise refund = Refund total - gift-card load refund” must also subtract delivery-fee/tax refund components.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @pos/api exec vitest run src/refunds/nest/refund.service.test.ts src/auth/nest/manager-approval-policy.service.test.ts test/refund.contract.test.ts test/export.contract.test.ts src/reports/nest/reporting.service.test.ts src/sales/receipt-service.test.ts src/sales/receipt-text.test.ts`

Run: `pnpm --filter @pos/web exec vitest run src/lib/sales.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/validation apps/api/src/auth apps/api/src/refunds apps/api/src/reports apps/api/src/exports apps/api/src/sales apps/web/src/app/sales apps/web/src/lib/sales*
git commit -m "feat(refunds): refund delivery charges"
```

### Task 7: Add secure guest checkout/status API and transactional Order email

**Files:**
- Create: `apps/api/src/common/first-party-origin.guard.ts`
- Create: `apps/api/src/orders/order-access-service.ts`
- Create: `apps/api/src/orders/order-expiry-service.ts`
- Create: `apps/api/src/orders/order-notification-service.ts`
- Create: `apps/api/src/orders/order-contact.ts`
- Create: `apps/api/src/orders/nest/public-order.controller.ts`
- Modify: `apps/api/src/orders/order-service.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/sales/nest/sales.service.ts`
- Modify: `apps/api/src/sales/paymongo-webhook-service.ts`
- Modify: `apps/api/src/sales/payment-reconciliation-service.ts`
- Modify: `apps/api/src/sales/totals.ts`
- Modify: `apps/api/src/email/email.service.ts`
- Modify: `apps/api/src/email/email.service.test.ts`
- Create: `apps/api/src/sales/totals.test.ts`
- Test: `apps/api/src/common/first-party-origin.guard.test.ts`
- Test: `apps/api/src/orders/order-access-service.test.ts`
- Test: `apps/api/src/orders/order-expiry-service.test.ts`
- Test: `apps/api/src/orders/order-notification-service.test.ts`
- Test: `apps/api/src/orders/order-contact.test.ts`
- Test: `apps/api/test/public-orders.contract.test.ts`
- Test: `apps/api/test/email-delivery.test.ts`

**Interfaces:**
- Public tenant locator is `storefrontKey`, never client-supplied `businessId`.
- `GET /api/v1/public/storefront?key=<storefrontKey>` returns redacted business identity, configured active pickup branches, delivery availability/fee, currency/tax display metadata.
- `GET /api/v1/public/storefront/catalog?key=...&branchId=...&q=...&categoryId=...&page=1&pageSize=20` is bounded at 100 and returns only active products plus reservation-aware ATS; no cost fields.
- `POST /api/v1/public/orders` requires `Idempotency-Key` and `storefrontKey`, creates a WEB DRAFT and one CHECKOUT token, sets cookie `nexpos_checkout` with Secure/HttpOnly/SameSite=Strict/Path=`/api/v1/public/orders`/Max-Age=7200.
- `PATCH /api/v1/public/orders/:id/draft` and `POST .../:id/submit` authenticate by checkout-cookie token hash bound to the same Order.
- Export `computeTaxMinor(netMinor: number, rateBps: number | null): number` from `apps/api/src/sales/totals.ts`; `computeSaleTotals` reuses it, and WEB submit uses it for `deliveryTaxMinor` so delivery follows the exact existing `Math.round(net * rate / 10000)` convention.
- Submit server-reprices, validates contact/branch/mode, freezes lines/totals, creates timed reservations, mints one STATUS token, and sends it through `TransactionalEmailPort`.
- Submit performs the approved lifecycle as `DRAFT -> CHECKOUT -> SUBMITTED` inside the same locked transaction after validation; CHECKOUT is not a separately writable public endpoint.
- Submit body freezes `paymentMode: PREPAID | PAY_AT_PICKUP`; PREPAID also requires a configured external PayMongo method. PAY_AT_PICKUP is valid only with PICKUP.
- For PREPAID submit, after the Order/reservation transaction commits, create/link the frozen Sale and start the existing PayMongo checkout idempotently. Response includes `checkoutUrl`. If provider initiation fails, keep the Order SUBMITTED with its safe timed/provider-aware hold; `POST /api/v1/public/orders/:id/payment/retry` retries only checkout initiation for that same linked Sale.
- PAY_AT_PICKUP submit creates no Sale and no provider Payment.
- Submit returns the raw STATUS token once in the successful response so the current page may use it in memory; the frontend must not persist it. The same raw token is sent in the submission email.
- After submit, checkout credential scope narrows to same-Order payment retry only and is revoked on CONFIRMED/CANCELLED/EXPIRED/REJECTED.
- `POST /api/v1/public/orders/status` accepts `{token}` body only and returns one redacted Order projection.
- Multiple hash-only STATUS tokens may be active for the same Order when later lifecycle emails need a fresh usable link: each automatic customer-update email mints a new 30-day STATUS token without revoking older unexpired links. Staff `resend` and explicit `revoke` are different: resend revokes all active STATUS tokens before minting one replacement; revoke invalidates all active STATUS tokens and sends no new link.
- `FirstPartyOriginGuard` compares request Origin exactly with normalized `WEB_URL`; missing/mismatched Origin fails cookie-authenticated mutation.
- Public mutation rate-limit keys use storefront/order plus IP where available; never token text.
- Extend `TransactionalEmailPort` with `sendOrderUpdate({to, contactName, orderId, event, token})`; link is `/order-status#token=...`.
- `OrderNotificationService.sendEvent(businessId, orderId, event): Promise<boolean>` runs only after the owning state transaction commits. It mints a fresh STATUS token, sends through `TransactionalEmailPort`, and catches delivery failure into audit/metric evidence instead of rolling back payment, reservation, or fulfillment state.
- Prepaid WEB confirmation hooks in PayMongo webhook and reconciliation call `sendEvent(..., "CONFIRMED")` only when that invocation actually transitions the Order to CONFIRMED; idempotent financial replay does not send duplicate confirmation mail.
- `OrderExpiryService.sweep(now): Promise<number>` runs at startup and every 60 seconds using native `setInterval(...).unref()`; each due Order is rechecked under the canonical business/inventory locks. The current PayMongo port has no provider expiry timestamp, so when a linked checkout snapshot is `active`, `unknown`, or `paid`, move the reservation deadline to `now + 5 minutes` and recheck later. Only a definitive PayMongo `expired` result, or a no-provider timed Order such as unaccepted pay-at-pickup, may transition Order -> EXPIRED and HELD -> EXPIRED. Multiple API instances may run the sweep because the lock/version/idempotency boundary makes it safe.

- [ ] **Step 1: Write access-token/origin failing tests**

Cover 32-byte entropy, SHA-256-only storage, expiry, revocation, cross-Order token rejection, cross-tenant storefront isolation, exact Origin, and cookie attributes.

- [ ] **Step 2: Write contact-normalization and public submit/status contract tests**

Define `normalizeOrderEmail(value) = value.trim().toLowerCase()`. Define `normalizeOrderPhone(value)` by trimming, removing spaces/parentheses/hyphens/dots, preserving an optional leading `+`, and requiring `/^\+?\d{7,15}$/`. Use the same functions against CRM customer values before exact comparison.

Cover server repricing, delivery-tax rounding through `computeTaxMinor`, contact/address validation, DRAFT->CHECKOUT->SUBMITTED transition, inactive/wrong-tenant branches, DELIVERY requiring PREPAID, PICKUP pay-at-pickup, guest `customerId=null`, immutable submitted snapshots, PREPAID Sale/checkout creation, PAY_AT_PICKUP no-Sale behavior, checkout retry after provider-init failure, duplicate Idempotency-Key replay/mismatch, redacted status response, and no guest gift-card/loyalty/store-credit tender.

- [ ] **Step 3: Implement access service, public controller, and guarded guest mutations**

Reuse `randomBytes`, `createHash`, existing rate limiter, existing human-verification port, and current error envelopes.

- [ ] **Step 4: Implement and test the expiry sweep**

Use native timers only; expose `sweep(now)` for deterministic unit tests. Add tests for ordinary TTL expiry, provider active/unknown/paid preservation with a five-minute extension, definitive provider expired release, and two concurrent sweeps producing one transition.

- [ ] **Step 5: Add Order transactional email**

Test generated HTML/text contains the fragment link and never logs/echoes the token outside the message payload. Test automatic lifecycle email token minting keeps previous links valid, staff resend revokes prior active links, failed email delivery does not roll back the committed Order state, and settlement replay does not send duplicate confirmation mail.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @pos/api exec vitest run src/common/first-party-origin.guard.test.ts src/orders/order-contact.test.ts src/orders/order-access-service.test.ts src/orders/order-expiry-service.test.ts src/orders/order-notification-service.test.ts src/sales/totals.test.ts test/public-orders.contract.test.ts src/email/email.service.test.ts test/email-delivery.test.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common apps/api/src/orders apps/api/src/email apps/api/src/app.module.ts apps/api/test/public-orders.contract.test.ts apps/api/test/email-delivery.test.ts
git commit -m "feat(orders): add secure guest checkout"
```

### Task 8: Implement staff acceptance, cancellation, and fulfillment

**Files:**
- Create: `apps/api/src/orders/fulfillment-service.ts`
- Modify: `apps/api/src/orders/order-service.ts`
- Modify: `apps/api/src/orders/nest/order.controller.ts`
- Test: `apps/api/src/orders/fulfillment-service.test.ts`
- Test: `apps/api/src/orders/order-service.test.ts`
- Test: `apps/api/test/order.contract.test.ts`
- Test: `apps/api/test/phase22-reservation-concurrency.contract.test.ts`

**Interfaces:**
- `acceptPayAtPickup(businessId, actorId, requestId, orderId, expectedVersion, key)` is valid only for WEB + PICKUP + pay-at-pickup + SUBMITTED + complete unexpired HELD coverage; it clears reservation `expiresAt`, transitions Order -> CONFIRMED, creates the initial pickup Fulfillment and allocations, and audits `order.accept`.
- Expiry worker/service path transitions unaccepted timed Order -> EXPIRED and HELD -> EXPIRED under the same locks.
- `rejectOrder` is SUBMITTED-only and pre-fulfillment; it releases holds.
- `cancelOrder` is for confirmed Orders; before settlement it releases holds, after settlement it requires the spec's full financial reversal and no completed handoff.
- Fulfillment actions: `ready`, `pack`, `dispatch`, `deliver`, `fail`, `collect`; every command is idempotent/version-checked/audited.
- Customer-facing fulfillment email events (`READY`, `DISPATCHED`, terminal `DELIVERY_FAILED`) call `OrderNotificationService.sendEvent`; it mints a fresh STATUS token and never tries to recover an older raw token from its hash.
- Successful staff acceptance sends the CONFIRMED event after commit through `OrderNotificationService`; email failure is non-transactional evidence and does not undo the accepted operational hold.
- Delivery FAILED -> CANCELLED requires an explicit `returnedToMerchant: true` input; DISPATCHED cannot cancel directly.
- Assignment is manual: `assignFulfillment(..., assignedUserId | null, expectedVersion)`; no auto-assignment.
- Assignment validates the target user has an active membership in the same business.
- Internal `createFulfillment(orderId, type, branchId, allocations)` enforces positive allocation and aggregate quantity <= submitted OrderLine quantity, so tests can create multiple Fulfillment rows/partial allocations even though MVP UI creates one.
- `completeOrderIfFullyHandedOff(orderId)` moves Order -> COMPLETED only when every submitted unit is covered by COLLECTED/DELIVERED fulfillment allocations; cancelled/failed allocations do not count.

- [ ] **Step 1: Write acceptance-vs-expiry race test**

Run acceptance and expiry concurrently at the TTL boundary. Assert exactly one terminal outcome:

```text
CONFIRMED + HELD operational hold
OR
EXPIRED + EXPIRED reservation
```

Never CONFIRMED with released stock and never EXPIRED with an operational hold.

- [ ] **Step 2: Write fulfillment transition/cancellation tests**

Cover pickup PENDING/READY cancellation, delivery PENDING/PACKED cancellation, DISPATCHED -> DELIVERY_FAILED only, returned-custody cancellation, retry dispatch, and terminal COLLECTED/DELIVERED rejection.

Also cover two partial Fulfillments whose completed allocations sum to the OrderLine quantity, over-allocation rejection, cross-tenant assignment rejection, and Order completion only after all units are physically handed off.

- [ ] **Step 3: Implement FulfillmentService and staff commands**

Add routes:

```text
POST /api/v1/orders/:id/accept
POST /api/v1/orders/:id/cancel
POST /api/v1/orders/:id/reject
POST /api/v1/orders/:id/link-customer
POST /api/v1/orders/:id/access/resend
POST /api/v1/orders/:id/access/revoke
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/assign
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/ready
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/pack
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/dispatch
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/deliver
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/fail
POST /api/v1/orders/:orderId/fulfillments/:fulfillmentId/collect
```

- [ ] **Step 4: Implement CRM linking rules**

Explicitly selected existing customer; compare both sides with `normalizeOrderEmail`/`normalizeOrderPhone` and require an exact match on at least one field. Owner/manager override + trimmed 3–500 character reason on mismatch; never mutate frozen contact snapshot or Sale tender eligibility.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @pos/api exec vitest run src/orders/fulfillment-service.test.ts src/orders/order-service.test.ts test/order.contract.test.ts test/phase22-reservation-concurrency.contract.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orders apps/api/test/order.contract.test.ts apps/api/test/phase22-reservation-concurrency.contract.test.ts
git commit -m "feat(orders): add fulfillment workflow"
```

### Task 9: Build the public storefront and token-safe order-status experience

**Files:**
- Create: `apps/web/src/lib/orders.ts`
- Create: `apps/web/src/lib/orders.test.ts`
- Create: `apps/web/src/lib/order-status-token.ts`
- Create: `apps/web/src/lib/order-status-token.test.ts`
- Create: `apps/web/src/app/order/page.tsx`
- Create: `apps/web/src/app/order-status/page.tsx`
- Test: `e2e/public-ordering.spec.ts`
- Test: `e2e/order-status-security.spec.ts`

**Interfaces:**
- Public storefront URL is `/order?storefront=<storefrontKey>`.
- Storefront loads public config/catalog, requires explicit branch before cart submit, shows reservation-aware availability, and supports PICKUP prepaid/pay-at-pickup plus DELIVERY prepaid only.
- Do not persist checkout/status bearer tokens in browser storage.
- `consumeStatusTokenFromLocation(location, history): string | null` reads `#token=...` once, stores only in a local variable, synchronously calls `history.replaceState(null, "", "/order-status")`, then caller POSTs the token.
- Provider success/cancel return may arrive without a status token; show a neutral “payment return received; check your email for secure order status” state and never infer payment success from the redirect.
- Loading/error/empty/expired states are keyboard/screen-reader accessible and respect reduced motion.

- [ ] **Step 1: Write token-scrub unit test first**

Assert raw token exists only in the returned local value, browser URL is immediately token-free, and no storage API is called.

- [ ] **Step 2: Write storefront helper/component tests**

Cover pickup/delivery validation, branch switching invalidating unavailable cart quantities, server-total replacement, payment failed/unknown copy, and disabled online ordering.

- [ ] **Step 3: Implement public pages with existing `apiFetch`**

Do not add a client state library; React state + current TanStack Query usage is sufficient.

- [ ] **Step 4: Add Playwright security/checkout paths**

Verify fragment disappears before API completion, no token appears in console/local/session storage, guest cannot fetch another Order, pay-at-pickup shows “awaiting staff confirmation,” and provider-return page does not claim PAID.

- [ ] **Step 5: Run web/E2E tests**

Run: `pnpm --filter @pos/web exec vitest run src/lib/orders.test.ts src/lib/order-status-token.test.ts`

Run: `pnpm e2e -- e2e/public-ordering.spec.ts e2e/order-status-security.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/orders* apps/web/src/lib/order-status-token* apps/web/src/app/order apps/web/src/app/order-status e2e/public-ordering.spec.ts e2e/order-status-security.spec.ts
git commit -m "feat(web): add customer ordering"
```

### Task 10: Build online-ordering settings and staff fulfillment UI

**Files:**
- Create: `apps/web/src/app/admin/online-ordering/page.tsx`
- Create: `apps/web/src/app/orders/page.tsx`
- Create: `apps/web/src/app/orders/[id]/page.tsx`
- Modify: `apps/web/src/lib/workspace-navigation.ts`
- Modify: `apps/web/src/lib/workspace-navigation.test.ts`
- Test: `apps/web/src/lib/orders.test.ts`
- Test: `e2e/order-operations.spec.ts`
- Test: `e2e/order-responsive.spec.ts`

**Interfaces:**
- Online-ordering settings page is owner/settings-write only; configures enablement, pickup branches, delivery branch, flat delivery fee; shows copyable `/order?storefront=<key>` URL only when enabled.
- Staff list uses the bounded API filters and cursor; never fetches all Orders.
- Detail page renders payment projection, reservation state/age, immutable customer snapshot, CRM link state, fulfillment allocation/assignment, and allowed transitions.
- Delivery PII is hidden unless API projection includes it; UI must not infer permission from role name alone.
- Aged operational holds are visibly flagged; authorized staff can cancel through the normal Order flow, never force-break reservations.
- Status-link resend/revoke controls require `order.manage_access`.

- [ ] **Step 1: Write navigation/settings/list/detail tests**

Assert permission gating, bounded query-string construction, no raw tenant ID in storefront link, no client-side display of redacted delivery fields, and correct action buttons per state/version.

- [ ] **Step 2: Implement settings page**

Reuse `GET /api/v1/business`, `PATCH /api/v1/business/settings`, current CSRF helper flow, and existing Branch list.

- [ ] **Step 3: Implement staff Order queue/detail**

Use current Panels/buttons/query patterns; do not create a new UI framework. Include loading, empty, retry, conflict reload, and idempotent busy states.

- [ ] **Step 4: Update navigation**

Expose Orders to roles with `order.view`; Online Ordering appears only where settings management is appropriate.

- [ ] **Step 5: Run web and responsive E2E tests**

Run: `pnpm --filter @pos/web exec vitest run src/lib/orders.test.ts src/lib/workspace-navigation.test.ts`

Run: `pnpm e2e -- e2e/order-operations.spec.ts e2e/order-responsive.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/online-ordering apps/web/src/app/orders apps/web/src/lib/workspace-navigation* apps/web/src/lib/orders* e2e/order-operations.spec.ts e2e/order-responsive.spec.ts
git commit -m "feat(web): add order operations"
```

### Task 11: Close observability, security, load, PostgreSQL parity, and full regression

**Files:**
- Modify: `apps/api/src/common/metrics.ts`
- Add/modify: `apps/api/test/phase22-security.contract.test.ts`
- Add/modify: `apps/api/test/phase22-reservation-concurrency.contract.test.ts`
- Create: `apps/api/test/phase22-orders.contract.test.ts`
- Modify: `apps/api/test/pg/pg-orders.test.ts`
- Modify: `apps/api/test/pg/pg-two-instance.test.ts`
- Create: `e2e/phase22-omnichannel.spec.ts`
- Create: `scripts/load/phase22-orders.mjs`
- Create: `scripts/load/phase22-orders.test.mjs`
- Create: `docs/superpowers/audits/2026-10-06-phase22-omnichannel.md`

**Interfaces:**
- Metrics include Order lifecycle, reservation hold/release/expire/commit/conflict, aged operational holds, WEB/POS Sale completion channel, payment handoff/failure/unknown/reconciliation, fulfillment transition latency/outcomes, idempotency conflicts, and guest access failures/revocations.
- Metric labels must never contain email, phone, address, storefront secret-like values, checkout/status tokens, Order notes/instructions, or provider payloads.
- Load harness reports p50/p95/p99/error rate for public catalog, submit/hold, bounded staff list, and status lookup using disposable data only.

- [ ] **Step 1: Add security/redaction contract tests**

Cover cross-business storefront key use, checkout token cross-Order use, status token cross-Order use, branch IDOR, staff permission matrix, exact Origin, URL fragment/body token redaction, and CRM mismatch override audit.

- [ ] **Step 2: Add concurrency/two-instance tests**

Cover:

```text
two web holds for last unit
web hold vs POS Sale
web hold vs transfer dispatch
web hold vs supplier return
web hold vs negative inventory count
accept vs expiry
webhook replay
reconciliation replay
cancel/release replay
fulfillment transition replay
```

- [ ] **Step 3: Add deterministic load-harness test and local cohort**

Do not report local latency as production latency. Redact credentials/body/token values from harness output.

- [ ] **Step 4: Run complete verification matrix**

Run:

```bash
pnpm verify
pnpm test
pnpm test:exit
pnpm typecheck
pnpm lint
pnpm build
pnpm audit --prod --audit-level critical
pnpm --filter @pos/api test:pg
pnpm e2e
```

Expected: all required checks green; document any environment-only limitation rather than hiding it.

- [ ] **Step 5: Run authenticated browser smoke**

Verify owner setup -> public storefront -> prepaid pickup -> signed settlement -> ready -> collect; pay-at-pickup submit -> staff accept -> ready -> POS tender -> collect; prepaid delivery -> pack -> dispatch -> deliver; cancellation/refund path; browser console has no errors or bearer leakage.

- [ ] **Step 6: Write the Phase 22 audit/closure evidence**

Record commit, migration, test counts, PostgreSQL concurrency evidence, token-redaction evidence, load cohort, unresolved non-blocking follow-ups, and explicit confirmation that consumer accounts/courier/online stored value remain out of scope.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/metrics.ts apps/api/test e2e scripts/load docs/superpowers/audits
git commit -m "test: close phase22 omnichannel verification"
```

## Checkpoints

### Checkpoint A — Persistence and read contracts

- [ ] Tasks 1–3 pass memory/PostgreSQL parity and bounded list tests.
- [ ] No public endpoint accepts raw `businessId`.
- [ ] Historical Sales without Orders remain readable.

### Checkpoint B — Inventory/financial authority

- [ ] Tasks 4–6 prove reservations protect all stock-decreasing paths.
- [ ] Sale completion/payment webhook/reconciliation commit owning reservations exactly once.
- [ ] Delivery refunds stay inside existing RefundService/Payment/manager-approval/reporting semantics.

### Checkpoint C — Guest and fulfillment boundary

- [ ] Tasks 7–10 prove scoped token handling, Origin checks, staff acceptance, fulfillment cancellation rules, and UI permission/redaction behavior.
- [ ] No redirect is treated as payment authority.
- [ ] No bearer token survives in browser storage or retained URL state.

### Checkpoint D — Production closure

- [ ] Task 11 full matrix is green.
- [ ] PostgreSQL two-instance races have one authoritative outcome.
- [ ] Phase 1–21 critical POS/payment/refund/inventory/stored-value/procurement flows remain green.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Reverse lock order between reservations and existing Sale/inventory flows | Critical | One documented order: business Sale lock first, sorted inventory locks second; two-instance race tests before UI work |
| Guest hold abuse | High | 20-minute timed hold plus explicit staff acceptance before non-expiring pickup hold |
| Provider callback after reservation drift | Critical | Provider-aware hold lifetime, exact reservation coverage at settlement, no completion on missing coverage |
| Refund allocation exceeds original tender after multiple refunds | Critical | Prior approved Refund totals consume tender capacity; focused split-tender replay tests |
| Public tenant lookup leaks internal IDs or cross-tenant data | High | Random public storefront key, indexed lookup, no guest businessId parameter, redacted projections |
| Status token leaks through browser/telemetry | High | URL fragment consumed once, synchronous `replaceState`, POST body only, redaction/security E2E |
| Staff Order list becomes tenant-wide scan | High | DB-level filters/cursor from first release; PG test forbids service-side full-table pagination |
| Delivery/fulfillment state accidentally mutates finance/stock | High | FulfillmentService has no Payment/Movement methods; financial and inventory assertions live in separate services/tests |
| Existing POS is destabilized by new Order companion rows | High | Additive POS Order creation only; historical Sale compatibility and full Phase 1–21 regression |

## Explicit Non-Goals for Execution

- No consumer account/login system.
- No online gift-card issue/reload/redemption.
- No online loyalty/store-credit tender.
- No courier integration, route optimization, distance pricing, or cash-on-delivery.
- No automatic cross-branch routing, auto-assignment, or force-post reservation override.
- No generic fee framework; only `deliveryFeeMinor` and `deliveryTaxMinor`.
- No historical Sale-to-Order backfill.
