# Phase 20 Design — Loyalty, Gift Cards, and Store Credit

## Scope

Phase 20 adds customer-bound loyalty and store credit plus bearer-code gift
cards. Stored value is represented only by append-only transaction ledgers;
inventory tables remain untouched. The existing sale, payment, refund, audit,
RBAC, report, export, memory, and PostgreSQL boundaries remain authoritative.

## Stored-value architecture

The database adds `GiftCard`, `GiftCardTransaction`, `StoreCreditAccount`,
`StoreCreditTransaction`, `LoyaltyProgram`, `LoyaltyAccount`,
`LoyaltyTransaction`, `SaleGiftCardLoad`, `SaleLoyalty`, and
`SaleItemLoyaltyAllocation`. Every row carries `businessId`; account keys are
unique per tenant and customer. Balances are derived from ledger sums inside a
deterministic advisory/in-memory lock. No balance is stored in inventory.

Payment receives additive nullable `internalInstrumentType` and
`internalInstrumentId` fields. `providerRef` remains reserved for external
providers. Internal tender keys are `gift_card`, `store_credit`, and `loyalty`.

## Gift-card security

The server generates 128-bit random bearer codes with `crypto.randomBytes` and
stores only an HMAC-SHA-256 lookup hash plus masked prefix/last four digits.
The plaintext code is returned only on successful issuance completion and is
never persisted, audited, logged, or returned by normal list/detail APIs.
Lookup and redemption are business-scoped and rate-limited.

## Atomic sale/refund design

Sale completion executes under the existing business lock and transaction. It
validates all tenders, locks internal instruments in sorted identifier order,
applies inventory, debits gift card/store credit/loyalty, creates payment rows,
records gift-card loads and loyalty snapshots, updates the sale, claims
idempotency, appends audit, and posts cash only for the cash tender net of
change. Any failure rolls back the complete mutation.

Refund approval uses the same sale lock and transaction. Original internal
tender rows restore their source ledger exactly once. An explicit
`STORE_CREDIT` destination creates a customer-bound credit transaction and no
cash/external refund leg. Historical loyalty snapshots, not current settings,
drive earn reversal and redeemed-point restoration.

## Loyalty math

Earned points are integer math:

```
floor(eligibleSpendMinor * earnPoints / earnAmountMinor)
```

Eligible spend is merchandise/services after discounts, excluding tax, cash
change, and gift-card load value. Gift-card-paid merchandise remains eligible.
Sale-time program settings and line-level allocation are persisted for stable
partial/full refunds. Normal redemption cannot make points negative; legitimate
earn reversals may create a documented negative balance when already-spent
points must be reversed.

## Offline policy and accounting

All internal-value operations are online-only and are disabled while offline.
Gift-card loads are liability, never merchandise revenue. Reports and ledger
exports separate gift-card loads, internal tender payments, and outstanding
liability summaries. Receipts show masked instruments only.

## RLS and tenant isolation

Every new PostgreSQL table enables RLS and receives business isolation policies
matching existing tenant tables. Cross-tenant ids resolve as not found. Memory
and PostgreSQL adapters implement the same validation, locking, idempotency,
and append-only behavior.

## UI surfaces

- `/gift-cards`: masked card search, status, balance, history, suspend/reactivate,
  and authorized adjustment.
- Customer detail: store-credit and loyalty balances/history.
- POS: customer-bound store-credit/loyalty actions and gift-card tender/load;
  internal tenders are disabled offline.
- Loyalty settings: owner/manager configuration with conversion preview.
- Receipts/reports/ledger exports expose masked internal tender and liability
  semantics.

