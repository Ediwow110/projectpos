# Phase 22 — Omnichannel Commerce, Fulfillment & Customer Ordering

**Date:** 2026-10-06
**Status:** Revised after Phase 21; pending user review; implementation not authorized
**Baseline:** `origin/main` at `fd686025b80f31acb0400a5ade5acc11b400ef78` (Phase 21 production hardening merged)
**Scope:** First-party web ordering plus the existing in-store POS, with click-and-collect and manually managed delivery.

## 1. Purpose and design boundary

Phase 22 adds first-party customer ordering without weakening NexPOS's existing financial, inventory, audit, payment, tenant-isolation, or Phase 21 production-hardening guarantees.

The core ownership rule is:

> **Order owns customer intent and fulfillment. Reservation owns temporary availability. Sale owns financial settlement and final stock mutation. Fulfillment owns physical handoff.**

There must never be two financial authorities. The existing `Sale`, `Payment`, refund, receipt, loyalty, stored-value, inventory-movement, and payment-reconciliation paths remain authoritative.

### In scope

- `POS` and first-party `WEB` order channels.
- Guest web checkout with immutable submitted contact snapshots.
- Optional audited staff linkage to an existing CRM customer after submission.
- Prepaid web checkout using currently configured external online payment methods.
- Pay-at-pickup checkout.
- Click-and-collect fulfillment.
- Manual staff-managed delivery.
- Inventory reservations and available-to-sell calculations.
- A fulfillment model that supports multiple fulfillment rows even though MVP creates one.
- Public order-status access through a scoped high-entropy token.
- RBAC, idempotency, optimistic concurrency, audit, observability, and tenant/branch isolation.

### Out of scope

- Third-party marketplaces or channel managers.
- Courier or delivery-provider integrations.
- Cash-on-delivery.
- A consumer account/authentication system.
- Automatic CRM matching or automatic customer creation.
- Online gift-card issue, reload, or redemption.
- Online loyalty or store-credit tender.
- A second payment/refund ledger or `order.refund` authority.
- Automatic cross-branch routing or stock rebalancing.
- Automatic fulfillment-staff assignment.
- Photo/signature delivery proof.

## 2. Phase 21 baseline constraints

Phase 22 starts from the merged Phase 21 baseline, not the older Phase 20 branch.

- Existing request/correlation IDs, security logging, recovery guidance, and production-hardening behavior remain intact.
- Existing Sale completion, PayMongo webhook settlement, and payment reconciliation take the business Sale lock before inventory locks.
- Existing inventory locks are transaction-level PostgreSQL advisory locks and are held until the transaction ends.
- Existing idempotency mismatch code is `IDEMPOTENCY_MISMATCH`.
- Existing optimistic-concurrency conflict code is `STALE_VERSION`.
- Existing refund authority remains `sale.refund`.

Phase 22 must reuse those conventions rather than introduce parallel codes or lock hierarchies.

## 3. Architectural decisions

### 3.1 Separate commerce intent from financial truth

Introduce a channel-neutral `Order` aggregate. Keep the current `Sale` aggregate as the financial, receipt, refund, loyalty, and final inventory authority.

- New POS transactions create an Order and Sale together.
- Historical Sales are not backfilled and may legitimately have no Order.
- Web checkout creates and submits an Order before financial settlement.
- A prepaid web Order gets a linked Sale when payment is initiated.
- A pay-at-pickup Order may remain without a Sale until the cashier starts the existing POS payment flow.
- `Order.saleId` is nullable and unique when present: one Order can link to at most one Sale, and one Sale can link to at most one Order.
- Sale creation from a submitted Order uses the frozen OrderLine snapshot; it never reprices from the current catalog.
- `Order.paymentStatus` is an API projection derived from the linked Sale, Payment, and Refund state. It is not a second ledger.

Payment projection values:

```text
UNPAID | PENDING | UNKNOWN | FAILED | PAID | PARTIALLY_REFUNDED | REFUNDED
```

Projection mapping:

Nominal Sale-state mapping:

| Sale state | Order payment projection |
| --- | --- |
| no linked Sale | `UNPAID` |
| `DRAFT` | `UNPAID` |
| `PENDING_PAYMENT` | `PENDING` |
| `PAYMENT_FAILED` | `FAILED` |
| `PAYMENT_UNKNOWN` | `UNKNOWN` |
| `RECONCILED` | derive from Payment rows as described below |
| `PAID` | `PAID` |
| `COMPLETED` | `PAID` unless approved refunds exist |
| `REFUND_REQUESTED` | `PAID` unless an earlier approved refund makes it `PARTIALLY_REFUNDED` |
| `PARTIALLY_REFUNDED` | `PARTIALLY_REFUNDED` |
| `REFUNDED` | `REFUNDED` |
| `VOIDED` | `UNPAID` unless Payment-row precedence below proves `UNKNOWN` or `PAID` |

Payment/refund rows are the financial evidence when a Sale status is transiently behind them. Projection precedence is:

1. If the Sale is `REFUNDED`, or approved Refund/RefundItem rows transiently satisfy the same full-refund predicate defined in §3.7 before the Sale row is patched -> `REFUNDED`.
2. If the Sale is `PARTIALLY_REFUNDED`, or any approved Refund exists without satisfying that full-refund predicate -> `PARTIALLY_REFUNDED`.
3. Any unresolved `UNKNOWN` Payment exists -> `UNKNOWN`.
4. `SUCCEEDED` Payments cover the Sale total -> `PAID`.
5. For `RECONCILED`, any definitive failed leg with insufficient succeeded value -> `FAILED`; otherwise -> `PENDING`.
6. Fall back to the nominal Sale-state mapping above.

The projection is computed on read and is never independently writable or persisted as a financial state machine.

### 3.2 Canonical lock order

Any transaction that can mutate a Sale, Payment settlement state, InventoryReservation, or stock availability follows one lock order:

```text
1. sales:<businessId>
2. sorted inventory locks for every (businessId, branchId, productId)
3. row/version checks and mutations
```

No Phase 22 path may acquire inventory locks and then acquire `sales:<businessId>`.

Reservation-only expiry/release operations also take `sales:<businessId>` before inventory locks. This intentionally preserves the current conservative tenant-level serialization for the MVP instead of introducing a second lock hierarchy.

### 3.3 Payment policy

- Pickup supports prepaid online payment or payment at pickup.
- Delivery requires prepaid online payment.
- Guest web checkout may use configured external provider methods such as PayMongo card/e-wallet/QR methods.
- Guest web checkout cannot use loyalty, store credit, or gift cards in Phase 22.
- Pay-at-pickup uses the existing POS tender flow when the customer arrives.
- Provider redirects are never authoritative; signed provider webhook/reconciliation remains authoritative.

### 3.4 Guest identity and CRM linkage

Submitted web Orders always snapshot:

- `contactName`
- `email`
- `phone`
- delivery address when applicable
- fulfillment instructions when supplied

`contactName`, `email`, and `phone` are required for WEB submission. Delivery additionally requires a complete delivery-address snapshot.

Guest web Orders are submitted with `customerId = null`.

Staff may later link an existing CRM customer through an audited action:

- The system never auto-matches by phone or email.
- Staff explicitly chooses the CRM customer.
- At least one normalized field (email or phone) must exactly match the immutable Order contact snapshot.
- A mismatch requires owner/manager override plus a reason.
- Linking never retroactively enables loyalty, store credit, or customer-only tender for that Order.
- Guest public access never exposes CRM history, loyalty, store credit, or unrelated orders.

### 3.5 Gift-card boundary

Phase 22 web checkout does not issue, reload, or redeem gift cards.

The existing Phase 20 POS gift-card workflow, bearer-code policy, receipt masking, and refund semantics remain unchanged. Online gift-card support requires a separate future design.

### 3.6 Delivery fee and tax

Delivery uses a business-level flat setting:

```text
deliveryFlatFeeMinor: integer >= 0
```

Default is `0`.

The delivery fee is a separate non-stock charge, not a fake catalog product. Its amount and tax snapshot freeze at Order submission and are copied into the linked Sale financial snapshot.

For Phase 22, the delivery charge uses the same tax-rate, rounding, and inclusive/exclusive convention already used by the business for merchandise. If the business has no configured tax rate, delivery tax is zero. No zone pricing, distance pricing, or separate delivery-tax engine is added.

To keep the financial model narrow, Sale gains explicit `deliveryFeeMinor` and `deliveryTaxMinor` snapshots, both defaulting to zero. Phase 22 does not introduce a generic charge/fee framework.

Reporting must distinguish merchandise revenue from delivery-charge revenue.

### 3.7 Delivery-fee refund semantics

Delivery refunds extend the existing RefundService and existing `POST /api/v1/sales/:id/refund-approve` command. Phase 22 does not introduce an Order refund engine or a second financial workflow.

The existing refund-approval payload gains:

```text
deliveryRefundMinor?: integer >= 0
```

MVP delivery refunds are all-or-nothing:

- `deliveryRefundMinor` must be omitted/zero, or equal the full remaining refundable delivery charge;
- remaining refundable delivery charge is the unrefunded `deliveryFeeMinor + deliveryTaxMinor`;
- partial delivery-fee refunds are not supported in Phase 22;
- cumulative `Refund.deliveryFeeRefundMinor` cannot exceed `Sale.deliveryFeeMinor`;
- cumulative `Refund.deliveryTaxRefundMinor` cannot exceed `Sale.deliveryTaxMinor`;
- a non-zero request after the delivery charge is already fully refunded returns `REFUND_EXCEEDS_LIMIT`.

Each approved Refund persists explicit `deliveryFeeRefundMinor` and `deliveryTaxRefundMinor` snapshots, defaulting to zero. `Refund.totalMinor` includes merchandise refund, gift-card load refund, delivery-fee refund, and delivery-tax refund amounts.

The server derives the fee/tax split from the Sale snapshots and prior approved Refund rows. The client never chooses that split.

Delivery-charge refunds:

- may be approved under the existing refund policy before or after physical delivery; refunding the charge does not rewrite fulfillment history;
- use the same `destination` field as the existing refund command;
- are `ORIGINAL_TENDER` for guest web Orders because they have no verified customer store-credit account;
- may use `STORE_CREDIT` only when the linked Sale already has an eligible `customerId` under the existing RefundService rules; a later Order CRM-link action does not mutate Sale customer/tender eligibility for the submitted Order;
- do not create inventory movements;
- do not restore quantities;
- do not earn, reverse earned, redeem, or restore loyalty points.

For `ORIGINAL_TENDER`, the existing original-payment waterfall remains authoritative. The allocation algorithm treats cumulative prior approved `Refund.totalMinor` as already consumed value, walks original `SUCCEEDED` Payment legs in deterministic creation/id order, skips previously consumed capacity, and allocates the new refund only against the remaining original-tender capacity. This rule applies to the combined refund total; delivery refunds do not get a separate tender allocator.

The existing manager-approval fingerprint and threshold calculation include `deliveryRefundMinor`, so delivery refunds cannot bypass `sale.refund` or `refund.override` policy.

The existing refund ManagerApprovalAction gains the same `deliveryRefundMinor` field. Its validation treats a request as non-empty when any of `items`, `loadRefunds`, or a positive `deliveryRefundMinor` is present. Approval normalization recomputes the allowed delivery amount server-side before fingerprinting.

Sale refund status extends the existing merchandise rule:

- if the Sale has no delivery charge, existing full/partial refund behavior is unchanged;
- if the Sale has a delivery charge, `REFUNDED` requires the existing full-merchandise refund condition **and** full reversal of `deliveryFeeMinor + deliveryTaxMinor`;
- otherwise an approved refund leaves the Sale `PARTIALLY_REFUNDED`.

A `DELIVERED` or `COLLECTED` Fulfillment remains terminal even if money is later refunded. The linked Order therefore cannot be cancelled as though handoff never occurred.

Existing gift-card-load refund semantics remain unchanged.

Reporting rules:

- refund KPIs and net financial totals include the delivery component from approved `Refund.totalMinor`, while preserving the existing gift-card-load liability exclusions;
- merchandise quantity/cost analysis continues to use RefundItem rows only;
- delivery-fee revenue is reported separately as Sale delivery fees less `Refund.deliveryFeeRefundMinor`;
- delivery tax is reported separately as Sale delivery tax less `Refund.deliveryTaxRefundMinor` and is not treated as merchandise revenue;
- accounting export/journal logic that currently derives merchandise refund as Refund total minus gift-card-load refund must also subtract delivery-fee and delivery-tax refund components, so they are never misclassified as merchandise revenue;
- delivery refunds never affect inventory COGS or loyalty reporting.

### 3.8 Branch routing and assignment

Every submitted Order has an explicit fulfillment branch.

- Pickup: the customer selects an enabled pickup branch offered by the storefront.
- Delivery: the merchant configures one `onlineFulfillmentBranchId`; delivery is unavailable if it is not configured.
- No request silently falls back to another branch.
- No automatic cross-branch split or routing occurs in Phase 22.
- `assignedUserId` on fulfillment is nullable and manually assigned/claimed by staff.

## 4. Domain model

### 4.1 Order

Required concepts:

- business/tenant scope;
- channel: `POS | WEB`;
- fulfillment mode: `NONE | PICKUP | DELIVERY`;
- explicit fulfillment branch;
- nullable verified `customerId`;
- immutable submitted contact snapshot;
- currency and commercial totals snapshot;
- merchandise subtotal, discount, tax, delivery charge, delivery tax, and grand total;
- nullable unique linked `saleId`;
- lifecycle status;
- optimistic-lock `version`;
- checkout/submission/confirmation/completion/cancellation timestamps;
- actor, request, and audit metadata.

Order lifecycle:

```text
DRAFT -> CHECKOUT -> SUBMITTED -> CONFIRMED -> COMPLETED
                                  |             \
                                  |              -> CANCELLED after full financial reversal when applicable
                                  -> CANCELLED
                                  -> EXPIRED
                                  -> REJECTED
```

Rules:

- Web pricing and availability are recalculated by the server before `SUBMITTED`.
- `SUBMITTED` freezes OrderLine and totals snapshots.
- Pay-at-pickup moves `SUBMITTED -> CONFIRMED` once the reservation succeeds.
- Prepaid Orders remain `SUBMITTED` while payment is pending, failed-but-retryable, or unknown.
- Successful prepaid Sale completion moves the Order to `CONFIRMED`.
- Payment failure leaves the Order `SUBMITTED` while its timed reservation remains valid; the customer may retry.
- `PAYMENT_UNKNOWN` leaves the Order `SUBMITTED` and keeps its reservation held until reconciliation resolves the financial uncertainty.
- `EXPIRED` applies only before confirmation when a timed reservation is safely released.
- `REJECTED` is a merchant refusal before confirmation; it is valid from `SUBMITTED`, releases the timed reservation, and is terminal.
- After financial settlement, cancellation uses the existing refund/reversal authority. A fully reversed, unfulfilled Order may then become `CANCELLED`; partial refunds do not cancel the Order.
- `FULFILLING` is never an independently mutable Order state. It is derived from fulfillment rows.

### 4.2 OrderLine

Draft lines remain editable. At `SUBMITTED`, the commercial snapshot freezes:

- product/variant identity;
- name, SKU, barcode, and unit snapshot;
- quantity;
- unit price and cost snapshot where financially required;
- line/order discounts allocated to the line;
- tax rate and tax amount;
- line total;
- bundle component snapshot and composition version.

Submitted lines cannot be edited. Corrections use cancellation/refund semantics.

### 4.3 InventoryReservation

Reservation rows represent temporary availability only. They never create inventory movements and never directly mutate `InventoryBalance.qtyOnHand`.

States:

```text
HELD -> COMMITTED
HELD -> RELEASED
HELD -> EXPIRED
```

Each reservation snapshots:

- business;
- branch;
- Order and OrderLine;
- stock-bearing product/component;
- quantity;
- expiration;
- idempotency identity;
- created/updated audit metadata.

Bundles reserve stock-bearing components from the submitted bundle snapshot, never fictitious bundle inventory.

### 4.4 Reservation timing

- A normal web checkout hold starts with a 20-minute TTL.
- Starting an external provider checkout must not allow the reservation to expire while the provider attempt can still validly settle.
- If the provider exposes a definitive checkout expiry, `expiresAt` is extended through that expiry plus a five-minute processing grace period.
- If the provider does not expose a definitive expiry, the expiry worker queries provider state before release. `PENDING` or `UNKNOWN` keeps the hold; only a definitively failed/expired attempt can release it.
- Pay-at-pickup Orders remain `SUBMITTED` on a timed 20-minute reservation until an authorized staff member explicitly accepts them.
- Staff acceptance must occur before the timed reservation expires. Acceptance is idempotent, version-checked, audited, and requires `order.accept`.
- Accepted pay-at-pickup Orders move `SUBMITTED -> CONFIRMED` and only then clear reservation `expiresAt`, making the reservation an operational hold.
- An unaccepted pay-at-pickup Order that reaches its TTL becomes `EXPIRED` and releases its reservation. An expired Order cannot be accepted or resurrected; the customer must submit a new Order.
- Successfully prepaid Orders also clear reservation `expiresAt` at confirmation.
- Operational holds are not auto-expired in Phase 22. Because they are already confirmed, staff must cancel the Order through the audited cancellation flow to release them; `REJECTED` is pre-confirmation only.
- There is no inventory-override action for an operational hold in Phase 22. Managers cancel the Order instead of bypassing its reservation.
- Aged operational holds are surfaced through metrics/staff queues so they do not become invisible dead stock.

### 4.5 Available-to-sell and own-hold semantics

For each stock-bearing product and branch:

```text
availableToSell = qtyOnHand - active HELD reservations
```

For a Sale linked to an Order that owns HELD reservations:

```text
availableForThisOrder =
  qtyOnHand - HELD reservations belonging to other orders
```

The linked Sale completion path must:

1. verify that the Order's active reservations exactly cover its frozen stock requirements;
2. ignore those own reservations when checking competing availability;
3. apply the normal Sale inventory movement exactly once;
4. transition those reservations `HELD -> COMMITTED` in the same transaction.

A normal POS Sale with no owning reservation subtracts all active HELD reservations from availability.

### 4.6 Other stock-decreasing operations

Any discretionary operation that decreases `qtyOnHand` must not consume stock held for another Order.

At minimum this applies to:

- normal POS Sale completion;
- linked web Sale completion;
- PayMongo webhook settlement;
- payment reconciliation;
- transfer dispatch;
- supplier-return posting.

Inventory counts and explicitly approved negative physical-stock corrections may record the observed quantity, but posting must fail with `RESERVATION_CONFLICT` if the resulting `qtyOnHand` would be lower than active HELD reservations. The system does not fabricate stock, create negative stock, or silently move reservations to another branch.

Authorized staff resolve the conflict by replenishing stock or using the affected Order's state-appropriate audited transition: reject an unconfirmed submitted Order, or cancel a confirmed Order. Phase 22 has no force-post override that breaks an active reservation.

### 4.7 Fulfillment

An Order may have multiple fulfillment rows, although the MVP normally creates exactly one.

Each Fulfillment contains:

- type: `PICKUP | DELIVERY`;
- status;
- branch;
- nullable manually assigned staff user;
- optimistic-lock `version`;
- delivery/contact snapshot where applicable;
- timestamps and audit metadata.

Each FulfillmentLine allocates:

- `fulfillmentId`;
- `orderLineId`;
- quantity.

Allocation invariants:

- allocated quantity is positive;
- total allocated quantity for an OrderLine never exceeds its submitted quantity;
- before the Order can become `COMPLETED`, every submitted unit is covered by a successfully completed fulfillment.

Pickup:

```text
PENDING -> READY -> COLLECTED
PENDING -> CANCELLED
READY   -> CANCELLED
```

Delivery:

```text
PENDING -> PACKED -> DISPATCHED -> DELIVERED
PENDING         -> CANCELLED
PACKED          -> CANCELLED
DISPATCHED      -> DELIVERY_FAILED
DELIVERY_FAILED -> DISPATCHED
DELIVERY_FAILED -> CANCELLED
```

Fulfillment cancellation rules:

- pickup `PENDING` and `READY` may transition to `CANCELLED` before handoff;
- delivery `PENDING` and `PACKED` may transition to `CANCELLED` before dispatch;
- delivery `DISPATCHED` cannot cancel directly; it must transition to `DELIVERY_FAILED`, and `DELIVERY_FAILED -> CANCELLED` is allowed only after staff confirms the goods are back in merchant custody;
- `DELIVERY_FAILED -> DISPATCHED` remains the retry path;
- `COLLECTED` and `DELIVERED` are terminal and cannot transition to `CANCELLED`.

In the Phase 22 MVP, there is no independent “cancel fulfillment but keep the same Order active” command. Confirmed-Order `cancel` atomically transitions each eligible non-terminal Fulfillment to `CANCELLED`. `REJECTED` occurs before fulfillment begins. A dispatched delivery must first use the delivery-failure/return-to-custody path before Order cancellation is allowed.

Fulfillment transitions, including `CANCELLED`, never mutate money or inventory. Order cancellation/refund rules remain separate and authoritative.

## 5. Lifecycle flows

### 5.1 POS

New POS checkout creates an Order and the existing Sale together.

The existing Sale completion path:

1. validates payment;
2. checks reservation-aware available-to-sell;
3. applies the authoritative stock movement once;
4. completes the Sale;
5. marks the immediate in-store Order `COMPLETED`.

Historical Sales remain valid without an Order.

### 5.2 Prepaid web order

```text
WEB checkout
-> Order DRAFT / CHECKOUT
-> server reprices and validates
-> SUBMITTED
-> inventory HELD
-> create linked Sale from frozen Order snapshot
-> create provider checkout
-> signed provider webhook / reconciliation
-> Sale completion + reservation COMMITTED in one transaction
-> Order CONFIRMED
-> fulfillment
-> COMPLETED after physical handoff
```

Provider redirect/success-page return never marks payment paid.

### 5.3 Pay-at-pickup web order

```text
Order SUBMITTED
-> inventory HELD
-> staff ACCEPTS before 20-minute TTL
-> Order CONFIRMED
-> reservation becomes operational hold
-> Pickup PENDING
-> READY
-> customer arrives
-> create/link Sale from frozen Order snapshot if none exists
-> existing POS payment/Sale flow
-> Sale completion + reservation COMMITTED
-> Pickup COLLECTED
-> Order COMPLETED
```

The Order is not a completed Sale before collection.

Staff acceptance, not anonymous submission, is the trust boundary that permits a guest pay-at-pickup reservation to become non-expiring. Until acceptance, rate limits and optional human verification are abuse controls only; they do not upgrade the hold.

### 5.4 Cancellation, rejection, expiry, and refund

- Before financial settlement: cancellation/rejection atomically releases HELD reservations.
- Staff `reject` is valid only for an unconfirmed `SUBMITTED` Order; confirmed Orders use `cancel`.
- Timed pre-confirmation expiry releases reservations only when no financially uncertain provider attempt remains.
- After Sale completion/payment settlement: existing refund/return mechanisms remain authoritative.
- Full financial reversal plus no completed fulfillment permits Order cancellation.
- For an Order whose Sale includes a delivery charge, post-settlement Order cancellation requires full merchandise reversal under the existing refund rules **and** full reversal of the Sale's delivery fee and delivery tax.
- Fulfillment cannot directly reverse money or inventory.
- Cancellation, refund, reservation release, expiry, and delivery failure are idempotent and audited.

## 6. Public storefront and access-token boundary

### 6.1 Public checkout access

The first-party web storefront uses a short-lived HttpOnly checkout credential:

- Creating a web Order generates a 256-bit random draft secret.
- Only its SHA-256 hash is stored server-side.
- The raw secret is placed in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie scoped to the public Order API.
- The secret is never placed in localStorage/sessionStorage, analytics, logs, or audit payloads.
- The credential expires after two hours.
- Before submission it may mutate only that Order's draft fields.
- After submission its scope narrows to payment retry for that same Order; submitted commercial/contact snapshots remain immutable.
- It is revoked when the Order becomes `CONFIRMED`, `CANCELLED`, `EXPIRED`, or `REJECTED`.

The cookie uses `SameSite=Strict` in production, and every cookie-authenticated public mutation enforces the configured first-party Origin. Phase 22 does not rely on SameSite alone as its CSRF boundary.

### 6.2 Submitted-order status access

Submission generates a separate 256-bit random status token:

- only the SHA-256 hash is stored;
- the raw token is returned once and sent through the existing transactional-email abstraction;
- customer links use a URL fragment, for example `/order-status#token=...`, so the bearer token is not sent in the initial HTTP request URL;
- the frontend reads the fragment once into an in-memory variable, synchronously calls `history.replaceState` to replace the address with token-free `/order-status`, and only then submits the token through the POST body;
- the token grants read-only access to one redacted Order projection;
- default lifetime is 30 days;
- staff resend rotates the token and revokes the prior token;
- staff may explicitly revoke access;
- public self-service resend is out of scope for Phase 22.

The raw status token is never written to localStorage/sessionStorage/IndexedDB, application logs, analytics, referrer-bearing navigation, browser-readable persisted state, or crash/error telemetry. Error reporting for the status page must scrub both URL fragments and request-body token fields.

### 6.3 Public API shape

```text
GET    /api/v1/public/storefront
GET    /api/v1/public/storefront/catalog
POST   /api/v1/public/orders
PATCH  /api/v1/public/orders/:id/draft
POST   /api/v1/public/orders/:id/submit
POST   /api/v1/public/orders/:id/payment/retry
POST   /api/v1/public/orders/status
```

Public Order mutations are authenticated by the checkout cookie. After submission, the only customer mutation it authorizes is payment retry for the same Order while the timed reservation is still valid. Public status lookup accepts the status token only in the request body and remains read-only.

Public endpoints are separately rate-limited and may use the existing human-verification abstraction when abuse thresholds require it.

### 6.4 Staff API shape

```text
GET    /api/v1/orders
GET    /api/v1/orders/:id
POST   /api/v1/orders/:id/accept
POST   /api/v1/orders/:id/cancel
POST   /api/v1/orders/:id/reject
POST   /api/v1/orders/:id/link-customer
POST   /api/v1/orders/:id/access/resend
POST   /api/v1/orders/:id/access/revoke
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/pack
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/ready
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/dispatch
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/deliver
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/fail
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/collect
```

Staff endpoints remain session-, CSRF-, tenant-, branch-, and RBAC-protected as applicable.

`POST /api/v1/orders/:id/accept` is valid only for a `WEB`, pay-at-pickup Order in `SUBMITTED` state whose timed HELD reservations are still active. It cannot confirm prepaid Orders, expired Orders, or Orders with missing/expired reservation coverage.

`POST /api/v1/orders/:id/reject` is valid only before confirmation for a `SUBMITTED` Order. Confirmed Orders use `POST /api/v1/orders/:id/cancel`.

`GET /api/v1/orders` is bounded from its first implementation.

Query contract:

```text
cursor?: opaque cursor
limit: integer 1..100, default 50
status?: Order lifecycle status
channel?: POS | WEB
fulfillmentMode?: NONE | PICKUP | DELIVERY
branchId?: explicit tenant-owned branch
paymentStatus?: UNPAID | PENDING | UNKNOWN | FAILED | PAID | PARTIALLY_REFUNDED | REFUNDED
dateFrom?: ISO timestamp
dateTo?: ISO timestamp
```

The response is `{ items, nextCursor }`. Results sort by `createdAt DESC, id DESC`; the opaque cursor encodes both values so ties remain stable. `dateFrom/dateTo` filter Order `createdAt`, and a supplied range may not exceed 366 days. Filtering and pagination must occur in the persistence query; implementations must not load all tenant Orders and slice in memory.

## 7. Idempotency, concurrency, and error contracts

Every state-changing endpoint uses the existing `Idempotency-Key` convention.

- Same key and normalized command returns the stored result.
- Same key with a different normalized payload returns `IDEMPOTENCY_MISMATCH`.
- Stale Order or Fulfillment version returns `STALE_VERSION`.
- A stock mutation that would violate an active reservation returns `RESERVATION_CONFLICT`.
- Webhook replay returns the original provider/Sale result.
- All responses preserve stable error codes and correlation IDs.
- Order and Fulfillment writes use optimistic versions in addition to the transaction/advisory-lock boundary.

Acceptance invariants:

- Reservations are all-or-nothing.
- A POS Sale cannot consume another Order's HELD quantity.
- A transfer dispatch or supplier return cannot consume another Order's HELD quantity.
- A reservation cannot exceed available-to-sell.
- A linked Sale consumes its own reservation exactly once.
- No duplicate Sale, Payment, Refund, inventory movement, reservation commit, or fulfillment transition can result from retries.
- Branch scope is explicit and cannot silently fall back to another branch.

## 8. RBAC

Phase 22 adds operational Order permissions only:

- `order.view`
- `order.create`
- `order.submit`
- `order.accept`
- `order.cancel`
- `order.fulfill`
- `order.collect`
- `order.view_delivery_details`
- `order.link_customer`
- `order.manage_access`

There is no `order.refund` permission.

Refunds continue to use the existing `sale.refund` and manager-approval policy.

Role intent:

- owners/managers: all Order permissions plus existing financial authority;
- cashiers: view, create/submit POS Orders, accept submitted pay-at-pickup Orders, collect pickup Orders, and start pay-at-pickup Sale flow;
- staff granted `order.accept`: accept a submitted pay-at-pickup Order before its timed reservation expires;
- fulfillment-capable staff: view assigned work, see required delivery details, and perform fulfillment transitions;
- only owners/managers may override a CRM-link snapshot mismatch or manage public-access revocation/resend policy.

Default role seeding grants `order.accept` to owner, manager, and cashier roles. Other staff receive it only through the existing permission-management path.

No role edits submitted lines, prices, taxes, reservations, or completed Sale records directly.

## 9. UI and customer communication

### 9.1 Customer storefront

The first-party web experience must provide:

- branch-aware catalog availability;
- cart and server-validated checkout totals;
- pickup versus delivery choice;
- contact and fulfillment details;
- clear payment-state handling for pending, failed, unknown, and successful payment;
- order-status access without requiring a consumer account;
- accessible loading, empty, error, retry, and expired-session states.

### 9.2 Staff operations

Staff UI must provide:

- incoming Order queue;
- payment and reservation state;
- pickup-ready workflow;
- delivery pack/dispatch/deliver/fail workflow;
- aged operational-hold visibility;
- explicit customer-link action;
- status-link resend/revoke for authorized staff;
- branch and assignment visibility.

### 9.3 Email

Reuse the existing `TransactionalEmailPort` and configured Brevo transport.

Phase 22 email events include:

- submitted/confirmed Order;
- pickup ready;
- delivery dispatched;
- terminal delivery failure where customer action is required;
- rotated status-access link when authorized staff resends it.

Email payloads contain the scoped customer status link, never internal credentials or payment secrets.

## 10. Observability and verification

Verification must cover:

- reservation versus POS Sale races;
- reservation versus transfer-dispatch/supplier-return races;
- linked Sale completion excluding its own reservation from competing holds;
- duplicate submit, payment retry, webhook, collection, and fulfillment commands;
- duplicate/stale staff acceptance and expiry-versus-acceptance races for pay-at-pickup;
- payment failed, unknown, and reconciliation paths;
- provider-aware reservation expiry;
- operational holds and aged-hold visibility;
- guest-token scope, expiry, rotation, and revocation;
- draft-cookie scope and revocation;
- prevention of automatic/accidental CRM linkage;
- CRM-link mismatch override audit;
- multiple Fulfillment rows and partial line allocations at the domain level;
- fulfillment cancellation from PENDING/READY/PACKED, and rejection of cancellation after COLLECTED/DELIVERED;
- absence of duplicate Sale/Payment/Refund/inventory movement;
- delivery fee/tax snapshot stability;
- delivery refund cumulative limits, tender waterfall, manager threshold, Sale refund status, reporting, and zero inventory/loyalty side effects;
- PII and bearer-secret redaction in logs, request URLs, retained browser URL state, metrics, crash telemetry, and error envelopes;
- tenant and branch isolation;
- end-to-end pickup and manual-delivery smoke paths;
- regression coverage for Phase 1–21 POS, payments, inventory, refunds, stored value, procurement, audit, recovery, and observability behavior.

Metrics must distinguish:

- Order draft/submission/confirmation/completion/cancellation;
- reservation holds/releases/expiries/commits/shortages;
- aged operational holds;
- provider payment handoff/failure/unknown/reconciliation;
- Sale completion from WEB versus POS;
- fulfillment ready/pack/dispatch/delivery/failure/collection latency;
- duplicate/idempotency conflicts;
- guest access failures/revocations.

## 11. Implementation sequence

This document authorizes planning only after user review. It does not authorize application implementation by itself.

The implementation plan should sequence work as:

1. Order, OrderLine, Fulfillment, FulfillmentLine, reservation, access-token, and configuration contracts/persistence.
2. Shared reservation-aware available-to-sell logic and canonical lock-order integration across stock-decreasing paths.
3. Reservation-aware Sale creation/completion, PayMongo webhook settlement, and reconciliation.
4. Extend the existing RefundService/reporting contracts for delivery-fee/tax refunds without creating a second refund path.
5. Public web Order draft/submit/payment/status boundary and transactional email.
6. Pickup, staff acceptance, and pay-at-pickup flow.
7. Manual delivery, assignment, cancellation states, and multiple-fulfillment domain support.
8. Storefront/staff UI, bounded Order list, observability, load, security, accessibility, and full regression verification.

The plan must preserve the atomic financial/reservation boundary and must not introduce a second financial authority.

## 12. Resolved Phase 22 decisions

The prior open questions are resolved for the MVP as follows:

- **Gift cards:** no web issue/reload/redemption in Phase 22; POS behavior unchanged.
- **CRM verification:** guest Orders submit with no customer link; later staff linkage requires explicit customer selection plus an exact email/phone snapshot match, with manager override and reason for mismatch.
- **Delivery charge:** business-level flat fee, default zero, using existing business tax-rate treatment.
- **Order access token:** 256-bit random token, SHA-256 at rest, 30-day lifetime, staff-only rotate/resend/revoke.
- **Operational holds:** no direct override; confirmed holds are released only by audited Order cancellation or committed by Sale completion. Rejection is pre-confirmation only.
- **Pay-at-pickup trust boundary:** anonymous submission keeps the 20-minute timed reservation; explicit staff acceptance before expiry is required before the hold becomes non-expiring.
- **Branch routing:** explicit pickup branch; one configured delivery fulfillment branch; no automatic fallback or cross-branch routing.
- **Assignment:** manual only; no automatic staff assignment.
- **Refund authority:** existing `sale.refund` only; no `order.refund`.
- **Delivery refunds:** existing RefundService/refund-approve command only; all-or-nothing remaining delivery fee+tax, cumulative caps, existing tender destination/approval policy, no inventory or loyalty effects.
- **Error codes:** reuse `IDEMPOTENCY_MISMATCH` and `STALE_VERSION`.
- **Lock hierarchy:** `sales:<businessId>` first, then sorted inventory advisory locks.

These choices intentionally favor the smallest secure Phase 22 implementation. Consumer accounts, online stored value, courier integration, advanced delivery pricing, automated routing, and automated assignment remain future phases.
