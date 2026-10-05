# Phase 22 — Omnichannel Commerce, Fulfillment & Customer Ordering

**Date:** 2026-10-06  
**Status:** Design approved; implementation not authorized  
**Scope:** First-party web ordering plus the existing in-store POS, with click-and-collect and manually managed delivery.

## 1. Purpose and design boundary

Phase 22 adds omnichannel customer ordering without weakening NexPOS's existing financial, inventory, audit, payment, and tenant-isolation guarantees.

The core ownership rule is:

> **Order owns customer intent and fulfillment. Reservation owns temporary availability. Sale owns financial settlement and final stock mutation. Fulfillment owns physical handoff.**

There must never be two financial authorities. The existing `Sale`, `Payment`, refund, receipt, loyalty, stored-value, and inventory-completion paths remain authoritative.

### In scope

- `POS` and first-party `WEB` order channels.
- Guest checkout with immutable submitted contact snapshots.
- Optional explicit linkage to a verified existing CRM customer.
- Prepaid web checkout.
- Pay-at-pickup checkout.
- Click-and-collect fulfillment.
- Manual staff-managed delivery.
- Inventory reservations and available-to-sell calculations.
- Multiple fulfillment rows per order, even if MVP creates one.
- RBAC, public order-status access, idempotency, audit, and concurrency protection.

### Out of scope

- Third-party marketplaces or channel managers.
- Courier or delivery-provider integrations.
- Cash-on-delivery.
- A new consumer account/authentication system.
- A second payment/refund ledger.
- Automatic CRM customer creation or matching by phone/email.
- Gift-card bearer-code policy changes; this receives a separate design decision.
- Photo/signature delivery proof.

## 2. Architectural decisions

### 2.1 Separate commerce intent from financial truth

Introduce a channel-neutral `Order` aggregate. Keep the current `Sale` aggregate as the financial and receipt authority.

- POS can create an `Order` and `Sale` in one transaction.
- Web checkout creates and submits an `Order` first.
- A web order links to a `Sale` at the existing payment boundary.
- `Order.paymentStatus` is a commerce-facing projection of the linked Sale/payment state, not an independent ledger.

### 2.2 Payment policy

- Pickup supports prepaid online payment or payment at pickup.
- Delivery requires prepaid online payment.
- Guest checkout may use an external online payment provider.
- Store credit and loyalty require verified customer identity.
- Cash-on-delivery is not supported in Phase 22.

### 2.3 Identity and CRM linkage

Guest orders snapshot `contactName`, `email`, `phone`, delivery address, and fulfillment instructions at submission.

- `customerId` is nullable for guests.
- Phone/email matches never auto-link an order to an existing CRM customer.
- An authenticated, verified customer may be linked explicitly through an audited action.
- Guest access uses an opaque, high-entropy status token; internal order IDs are not public lookup credentials.

## 3. Domain model

### 3.1 Order

The order owns channel, customer intent, submitted totals, payment projection, and lifecycle state.

Required concepts:

- business/tenant scope;
- channel: `POS | WEB`;
- fulfillment mode: `NONE | PICKUP | DELIVERY`;
- nullable verified `customerId`;
- immutable submitted contact snapshot;
- currency and totals snapshot;
- nullable linked `saleId`;
- payment-status projection;
- lifecycle status and optimistic-lock version;
- expiration, cancellation, actor, request, and audit metadata.

Order lifecycle:

```text
DRAFT -> CHECKOUT -> SUBMITTED -> CONFIRMED -> COMPLETED
                                  \-> CANCELLED
                                  \-> EXPIRED
                                  \-> REJECTED
```

`FULFILLING` is not an independently mutable order state. If a roll-up is useful for reporting, it is derived from fulfillment rows.

### 3.2 OrderLine

Draft lines remain editable. At `SUBMITTED`, the commercial snapshot freezes:

- product/variant identity;
- name, SKU, and barcode snapshot;
- quantity;
- unit price;
- discounts;
- tax rate and amount;
- line total;
- bundle component snapshot.

Submitted lines cannot be edited. Corrections use cancellation/refund semantics.

### 3.3 InventoryReservation

Reservation rows represent temporary availability only. They do not create inventory movements or alter `InventoryBalance.qtyOnHand`.

States:

```text
HELD -> COMMITTED
HELD -> RELEASED
HELD -> EXPIRED
```

Each row snapshots business, branch/location, order, order line, stock-bearing product/component, quantity, expiration, and idempotency identity.

Normal checkout holds have an `expiresAt`. Once an order is confirmed and preparation begins, the hold becomes operational by clearing `expiresAt`; it remains `HELD` until Sale completion or cancellation. Automatic expiry processes only timed holds.

Bundles reserve stock-bearing components from the submitted bundle snapshot, never fictitious bundle inventory.

### 3.4 Fulfillment

An order may have multiple fulfillment rows, even though MVP normally creates one.

Each fulfillment contains type, status, branch/location, assigned staff, line quantities, delivery/contact snapshot where applicable, version, and audit metadata.

Pickup:

```text
PENDING -> READY -> COLLECTED
```

Delivery:

```text
PENDING -> PACKED -> DISPATCHED -> DELIVERED
                         \-> DELIVERY_FAILED -> DISPATCHED
```

Fulfillment transitions never mutate inventory. They represent physical handoff only.

## 4. Lifecycle flows

### 4.1 POS

POS creates an order and existing Sale together. The existing Sale completion path validates payment, applies the authoritative stock movement once, and the order becomes `COMPLETED` for immediate in-store fulfillment.

### 4.2 Prepaid web order

```text
Order DRAFT
-> CHECKOUT
-> SUBMITTED
-> inventory HELD
-> create/link Sale
-> existing payment flow
-> Sale completion + reservation COMMITTED in one transaction
-> Order CONFIRMED
-> fulfillment proceeds
```

Provider redirects are never authoritative. Existing provider webhooks and reconciliation drive payment confirmation.

### 4.3 Pay-at-pickup web order

```text
Order SUBMITTED
-> inventory HELD
-> Order CONFIRMED
-> Pickup PENDING
-> READY
-> customer arrives
-> existing POS payment/Sale flow
-> Sale completion + reservation COMMITTED
-> Pickup COLLECTED
-> Order COMPLETED
```

The order is not a completed Sale before collection.

### 4.4 Cancellation and refund

- Before financial settlement: cancel the order and release held reservations.
- After Sale completion/payment settlement: use existing refund/return mechanisms, then project the order state from those results.
- Fulfillment cannot directly reverse money or inventory.
- Cancellation, refund, reservation release, and delivery failure are idempotent and audited.

## 5. Available-to-sell and concurrency

For each stock-bearing product and branch:

```text
availableToSell = qtyOnHand - active HELD reservations
```

All reservation, POS sale, pay-at-pickup completion, release, expiry, and Sale-completion operations:

1. Resolve stock requirements, including bundle components.
2. Acquire the existing sorted inventory locks for every `(business, branch, product)` key.
3. Re-read balances and active reservations inside the transaction.
4. Validate available quantity.
5. Apply the reservation or Sale transition atomically.
6. Append audit and metrics data.

The linked web Sale completion path is reservation-aware. It commits the held reservation and applies the normal sale movement exactly once. Collection or delivery never decrements stock again.

Acceptance invariants:

- Reservations are all-or-nothing.
- A POS sale cannot consume another order's held quantity.
- A reservation cannot exceed available-to-sell.
- No duplicate Sale, payment, refund, inventory movement, or reservation commit can result from retries.
- Branch scope is explicit and cannot silently fall back to another branch.

## 6. Checkout, APIs, and security

### 6.1 Public storefront boundary

Guest-facing APIs are separate from staff order-management APIs. Guests receive only an opaque, high-entropy, scoped status/receipt token stored server-side as a hash. The token cannot access CRM history, loyalty, store credit, payment instruments, or unrelated orders.

Staff endpoints remain session- and RBAC-protected and tenant-scoped.

### 6.2 Internal API shape

```text
POST   /api/v1/orders
GET    /api/v1/orders
GET    /api/v1/orders/:id
PATCH  /api/v1/orders/:id/draft
POST   /api/v1/orders/:id/submit
POST   /api/v1/orders/:id/cancel
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/pack
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/ready
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/dispatch
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/deliver
POST   /api/v1/orders/:orderId/fulfillments/:fulfillmentId/collect
```

### 6.3 Idempotency and versioning

Every mutation uses the existing `Idempotency-Key` convention.

- Same key and normalized command: return the stored result.
- Same key with a different payload: `IDEMPOTENCY_CONFLICT`.
- Stale order/fulfillment version: `STALE_ORDER_VERSION`.
- Webhook replay: return the original payment/Sale result.
- All responses carry stable error codes and correlation IDs.

### 6.4 RBAC

Proposed permissions:

- `order.view`
- `order.create`
- `order.submit`
- `order.cancel`
- `order.fulfill`
- `order.collect`
- `order.view_delivery_details`
- `order.refund`

Customers can access only their own guest-token or verified-account order surface. Cashiers can view and collect orders and complete pay-at-pickup through POS. Fulfillment staff can pack, ready, dispatch, and deliver assigned orders. Managers/owners retain full order and existing refund authority.

No role edits submitted lines, prices, taxes, reservations, or Sale records directly.

## 7. Observability and verification

Phase 22 verification must cover:

- online reservation versus POS sale races;
- duplicate submit, webhook, collection, and fulfillment commands;
- payment failure, unknown, and reconciliation paths;
- reservation expiry and operational holds;
- guest-token scope, expiry, and revocation;
- prevention of accidental CRM linkage;
- multiple/partial fulfillment transitions;
- absence of duplicate Sale/payment/refund/inventory movement;
- PII and secret redaction in logs and error envelopes;
- tenant and branch isolation;
- end-to-end pickup and delivery smoke paths;
- regression coverage for Phase 1–21 POS, payments, inventory, refunds, stored value, and audit behavior.

Metrics should distinguish order submission, reservation holds/releases/expiries, payment handoff, Sale completion, fulfillment latency, collection, delivery failure, and duplicate/idempotency conflicts.

## 8. Implementation boundary

This document is a design artifact only. No application code, schema, migration, endpoint, UI, payment configuration, or production configuration is authorized by this document.

Implementation planning should be a separate reviewed step and should sequence the work as:

1. Contracts and persistence foundations.
2. Reservation-aware Sale completion.
3. Order submission and guest-token boundary.
4. Pickup and pay-at-pickup flow.
5. Manual delivery and multiple-fulfillment support.
6. UI, observability, load, security, and regression verification.

The detailed implementation plan must preserve the atomic financial/reservation boundary and must not introduce a second financial authority.

## 9. Remaining design decisions before implementation

- Exact gift-card bearer-code behavior in guest checkout.
- Customer verification mechanism for explicit CRM linkage.
- Delivery-charge configuration and tax treatment.
- Order-access token lifetime and resend/revocation policy.
- Whether staff may override an expired operational hold, and which approval is required.
- Final fulfillment assignment and branch-routing rules.
