# Phase 20 execution ledger

- [x] Foundation: Prisma schema, migration 0032, DbPort, memory/PG parity.
- [x] Gift-card HMAC bearer codes, masked lookup, append-only balance ledger, idempotency, rate-limited lookup endpoint.
- [x] Customer-bound store credit and loyalty ledgers with integer math and non-negative debit guards.
- [x] Sale completion atomic transaction boundary with internal tenders, gift-card loads, loyalty earning, payment metadata, and rollback coverage inherited from stock transactions.
- [x] Refund transaction boundary with original internal-tender restoration and optional store-credit destination.
- [x] Gift-card load refunds with remaining-load/current-balance guards, append-only `LOAD_REFUND` entries, original-tender restoration, and liability-only export reversal.
- [x] Manager approval fingerprints and audit application for stored-value and loyalty adjustments.
- [x] Customer value ledger screens and dedicated gift-card register/history screens.
- [x] RBAC permissions, protected value endpoints, liability summary endpoint, and online-only UI tender visibility.
- [x] Typecheck and focused API/web regression tests.
- [ ] Production deployment/browser smoke and final evidence report (requires the deployed QA session).

Known boundary: the final production smoke is intentionally not claimed until the authenticated QA browser run is executed against the deployed build.
