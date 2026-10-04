# Phase 18 — Physical Stock Counts, Variance Approval, and Replenishment

## Goals

- Add branch-scoped, first-class physical count sessions without creating a second inventory ledger.
- Freeze expected quantities while counting, calculate variance on the server, reject stale snapshots, and post non-zero `stock_count` movements atomically and exactly once.
- Add a deterministic, advisory replenishment queue based on `onHand + outstanding ordered quantities` and let authorized users create reviewed draft purchase orders.
- Preserve tenant isolation, existing manager approvals, memory/Postgres parity, and the incumbent NexPOS management UI.

## Domain decisions

### Inventory counts

`InventoryCount` is a business/branch-scoped aggregate with statuses `DRAFT`, `COUNTING`, `SUBMITTED`, `APPROVED`, `POSTED`, and `CANCELLED`. `InventoryCountLine` stores immutable product snapshots, the expected quantity and balance freshness marker captured when counting starts, and an absolute counted quantity. The server derives `varianceQty`.

Full counts include every active tracked product in the selected branch. Partial counts accept an explicit product set. Submitting requires every line to be counted and revalidates each balance's `updatedAt`; any mismatch returns `COUNT_STALE` and performs no write.

Zero variance completes without ledger rows. Non-zero variance requires the existing `inventory.adjust` manager-approval path, with one fingerprint covering the count id/version/branch/lines. Posting locks all product/branch keys, revalidates freshness and approval, creates only non-zero `stock_count` movements and balance updates in one transaction, and records idempotency before returning the logical result. Posted counts are immutable.

### Replenishment

Recommendations are computed on read for active tracked products. `onOrderQty` is the remaining quantity on `ORDERED` and `PARTIALLY_RECEIVED` purchase orders for the same branch. Candidates satisfy `onHand + onOrderQty <= reorderLevel`; suggested quantity is `max(0, reorderLevel * 2 - effectiveQty)`. Preferred `ProductSupplier` is used when present; otherwise the UI reports `Supplier needed`. Creating a draft PO revalidates all inputs and delegates to the existing procurement creation path. It never mutates inventory.

## API surface

- `GET /api/v1/inventory/counts`
- `POST /api/v1/inventory/counts`
- `GET /api/v1/inventory/counts/:id`
- `POST /api/v1/inventory/counts/:id/start`
- `PATCH /api/v1/inventory/counts/:id/lines`
- `POST /api/v1/inventory/counts/:id/submit`
- `POST /api/v1/inventory/counts/:id/approve`
- `POST /api/v1/inventory/counts/:id/post`
- `POST /api/v1/inventory/counts/:id/cancel`
- `GET /api/v1/inventory/replenishment`
- `POST /api/v1/inventory/replenishment/draft-po`

All mutating calls require CSRF and idempotency keys where a command can be retried. Authorization uses existing role permissions: owner/manager/inventory may count and replenish; cashier cannot post counts.

## Persistence

Additive Prisma migration and RLS tables for `InventoryCount`, `InventoryCountLine`, and an idempotency table keyed by business/count/command. Extend `DbPort`, the memory adapter, and PostgreSQL adapter together. No existing ledger or destructive migration changes.

## UI

Add discoverable Inventory → Stock Counts and Inventory → Replenishment screens. Count entry is keyboard/mobile friendly, exposes expected/counted/variance and stale errors, and uses semantic status text. Replenishment supports branch/supplier filters, selection for one supplier/branch, quantity review, and handoff to the existing draft purchase-order detail page.

## Verification

Unit, API, Postgres, web, and E2E coverage must include stale counts, atomic multi-line rollback, replay/concurrency, approval invalidation, zero variance, open-PO suppression, partial receipts, missing suppliers, and draft-PO inventory immutability. Run typecheck, lint, build, and the relevant regression suites before completion.
