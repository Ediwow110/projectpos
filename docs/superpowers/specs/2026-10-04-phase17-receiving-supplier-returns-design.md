# Phase 17 Receiving and Supplier Returns Design

Phase 17 extends the Phase 16 procurement foundation with atomic purchase-order
receiving and supplier returns. It does not change `Product.costMinor` and does
not start Phase 18.

## Invariants

- A receipt is scoped to one business and branch, references an ORDERED or
  PARTIALLY_RECEIVED purchase order, and never receives more than outstanding
  quantities.
- Posting a receipt creates one `receipt` inventory movement per line and adds
  the same quantity to the branch balance in one database transaction.
- Posting a supplier return creates one negative `supplier_return` movement per
  line and subtracts from the branch balance in the same transaction.
- Receipt and return idempotency keys are replay-safe and reject a different
  payload with `IDEMPOTENCY_MISMATCH`.
- All mutations require `inventory.receive` or `inventory.supplier_return` and
  are tenant/branch scoped. Cashiers have neither permission.
- Purchase-order status changes are monotonic: ORDERED -> PARTIALLY_RECEIVED ->
  RECEIVED; a posted receipt cannot be cancelled.

## Data model

`PurchaseReceipt`/`PurchaseReceiptLine` snapshot the received quantity and unit
cost at posting time. `SupplierReturn`/`SupplierReturnLine` keep a draft until
posted, then snapshot the returned quantity and reason. Receipt and return
numbers are business-scoped sequences. Every mutation is audited.

## Delivery slices

1. Validation, schema migration, Prisma parity, and DbPort/memory/Postgres
   implementations.
2. Receiving and return services/controllers with locking, transactions,
   idempotency, RBAC, audit, and exact-once inventory effects.
3. Web API helpers and responsive receiving/returns panels on the existing PO
   detail page.
4. Unit, API, Postgres-parity, and web checks plus a Phase 17 exit contract.
