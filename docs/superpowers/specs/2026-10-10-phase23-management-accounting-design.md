# Phase 23 — Management Accounting, Supplier Payables, and P&L

**Date:** 2026-10-10
**Status:** User-approved design; implementation in progress. See `docs/superpowers/audits/2026-10-10-phase23-status.md`. Acceptance criteria are not met; do not release.
**Baseline:** `e504afa46d5db0275af6423b03a7372cc9241be6` (clean local checkout, including the onboarding follow-up).
**Branch:** `codex/phase23-accounting`
**Scope source:** Phase 21 explicitly deferred “accounting journals/AP/P&L”; Phase 22 delivered omnichannel ordering. Phase 10 already exports derived journal rows; Phases 16–17 added suppliers, receipts, and supplier returns without supplier AP.

## 1. Purpose

Give a business owner a traceable, tenant-scoped management ledger, supplier balances, and a profit-and-loss report. Keep operational records authoritative: Sales, Payments, Refunds, Expenses, Inventory Movements, Purchase Receipts, and Supplier Returns continue to own their current workflows. Accounting records explain those events; they do not replace or mutate them.

This is management accounting. It does not claim compliance with statutory accounting, tax filing, audit, or bookkeeping rules. The application gives no tax advice and does not calculate recoverable input tax. Businesses must consult their accountant for statutory treatment.

## 2. Existing behavior and constraints

- Phase 10 `GET /api/v1/exports/ledger.csv` derives balanced rows from current operational tables using fixed account codes. It does not persist journal entries or supplier liabilities.
- Phase 16 added Suppliers and Purchase Orders. Its contract forbids PO operations from changing stock or financial ledgers.
- Phase 17 added posted Purchase Receipts and Supplier Returns. Receipt lines preserve received unit cost; returns preserve returned unit-cost snapshots.
- Sale lines preserve `costMinor`, which supports historical sale COGS without reading a product's current cost.
- Phase 22 introduced delivery revenue/tax and delivery-fee refunds. The current export already separates those amounts from merchandise revenue.
- Businesses have one configured currency. Phase 23 does not convert currencies.
- Tenant isolation, branch scope, role permissions, audit records, idempotency, integer minor units, and PostgreSQL parity remain mandatory.

## 3. Recommended implementation shape

### 3.1 Double-entry journal

Add business-scoped accounts, journal entries, and journal lines. Each account has a business-unique code, name, one of the standard account types (asset, liability, equity, revenue, expense), normal side, and system/active flags. Each entry has an effective date, source type and source ID, currency, branch scope when known, description, creator, and request ID. Each line references an account and carries a nonnegative integer debit or credit; a line cannot have both. Every entry must contain at least two lines, use one currency, and balance exactly before posting.

Posted entries and lines are immutable. Corrections create an audited reversal entry and, where needed, a corrected source event. Database uniqueness on `(businessId, sourceType, sourceId, sourceEvent)` makes retries effect-once. The writer validates tenant ownership for every account and source.

Seed a small default chart from the current Phase 10 account map, adding explicit Accounts Payable, Goods Received Not Invoiced (GRNI), and Purchase Price Variance accounts. System accounts cannot be deleted or assigned another type. Owners may add or deactivate unused accounts; used accounts cannot be deleted. Expense categories map to expense accounts through an explicit audited mapping. No arbitrary unbalanced journal-entry editor is included.

The journal is written in the same database transaction as the source mutation. If journal posting fails, the financial source mutation fails too. No asynchronous posting gap is allowed for sales, refunds, expenses, inventory receipts/returns, supplier bills, or supplier payments.

### 3.2 Source-event posting

Reuse Phase 10 posting rules as the baseline and move them into the shared journal-posting service. Define and test balanced posting rules for:

- completed Sale: actual payment tenders to cash/clearing/liability accounts; merchandise, delivery, and tax components to their separate accounts; COGS from the SaleItem cost snapshots;
- approved Refund: reverse the appropriate revenue/tax/liability components, credit the actual refund tenders, and restore inventory/COGS only for restocked quantities;
- non-voided Expense and its void/reversal;
- posted stock receipts, supplier returns, and inventory adjustments using source snapshots and explicit variance handling;
- gift-card loads, store-credit activity, loyalty liability, and delivery fees/refunds under existing Phase 20/22 contracts;
- supplier bills, supplier credit notes, and supplier payments.

Keep the Phase 10 CSV endpoint and column contract. Produce it from the persisted journal after cutover so it cannot drift from P&L. Preserve the existing spreadsheet formula-injection protection and audit entry.

### 3.3 Supplier bills and credits

Add a supplier bill workflow that references an existing same-business Supplier and one or more posted receipts from that supplier. Capture supplier invoice number, invoice date, due date, currency, notes, receipt-line allocations, invoice unit cost/amount, and any explicitly coded non-stock charge. Use draft, posted, partially paid, paid, and voided states. Posting and payments are audited and idempotent.

Bill quantities cannot exceed posted receipt quantities less supplier returns and quantities already billed. Bills cannot reference draft, cancelled, cross-tenant, different-supplier, or incompatible-branch receipts. Multiple bills may consume a receipt only up to its unbilled quantity. Invoice/receipt cost differences post to Purchase Price Variance; they never rewrite the receipt, stock balance, Product cost, or historical Sale cost snapshot. Extend SupplierReturnLine with allocations to the exact PurchaseReceiptLine quantities so a later return can distinguish unbilled stock (clear GRNI) from billed stock (apply a supplier credit).

Posting a receipt debits Inventory and credits GRNI at the receipt-line cost snapshot. Posting a matched bill debits GRNI at that snapshot, records a debit or credit to Purchase Price Variance for any invoiced price difference, and credits Accounts Payable for the invoice obligation. A non-stock charge is debited to the selected expense account. Gross invoice amounts are recorded as entered; the application does not decide tax recoverability or tax classification. The bill UI must show when a line contains an invoice/receipt cost difference before posting.

Support partial and full supplier payments with payment date, amount, method, reference, and account. A payment cannot exceed the open bill balance. Payments debit Accounts Payable and credit the selected business cash/clearing account. Cash paid from an open register shift also creates its linked cash movement in the same transaction; cash paid outside a shift uses the business cash-on-hand account and remains visible in account activity. A posted Supplier Return can be linked to a supplier credit note, reducing Accounts Payable or creating a supplier credit balance; it never creates a customer Refund or Sale-side payment. The return/credit flow must identify returned receipt quantities so it clears GRNI for unbilled units and applies a supplier credit for billed units.

### 3.4 P&L and account reports

Add a tenant/branch-scoped P&L for an inclusive effective-date range. Calculate revenue, contra-revenue/refunds, COGS, operating expenses, purchase-price variance, and net income from posted journal lines. Show the date range, currency, posting freshness, and any unreconciled legacy inventory values. Drill-down opens source records the current user can read.

Also expose a paginated general journal and account activity/trial-balance view for reconciliation. Every report is derived from posted entries, not cached totals or browser state. Add role permissions for accounting read/manage and AP read/write/pay; default grants follow the existing owner/manager policy, and the server remains authoritative.

## 4. Historical data and activation

Backfill existing source history with a resumable, tenant-scoped job using bounded pages and the same posting service. Re-running a batch must not duplicate entries. Use immutable SaleItem and PurchaseReceiptLine cost snapshots; never value historical events from a product's current cost. Extend the movement data port to expose the persisted `createdAt` timestamp so dated inventory adjustments are not emitted with an empty date.

Inventory events without a reliable historical cost must be listed as unreconciled and excluded from value-based P&L until an authorized owner supplies an opening adjustment. The job must not invent a value or change quantities. Existing CSV output remains available until its journal-backed replacement passes reconciliation. Activation reports per-tenant counts, debit/credit totals, skipped records, and unresolved values before the accounting report is enabled.

Provide an audited opening-balance worksheet for an owner to enter a dated, balanced trial balance supplied by their existing records or accountant. The worksheet previews all lines and the retained-earnings offset; owner confirmation posts one immutable opening entry. It does not guess balances or use current product costs. Activation shows the resulting trial balance, unresolved legacy inventory values, and the accounting start date. An unbalanced worksheet cannot be posted.

## 5. Security, audit, and data integrity

- Apply tenant-scoped RLS to every new table and enforce business scope in API services.
- Enforce branch access on reports and AP mutations using the existing branch/role model.
- Require CSRF protection for browser writes, idempotency keys for posting/payment commands, and optimistic versions for draft bill changes.
- Audit account changes, bill post/void, payment, credit note, journal reversal, and backfill activation. Exclude secrets and raw payment credentials from audit/log payloads.
- Reject zero-value or unbalanced entries, invalid account types, duplicate source postings, overpayment, overbilling, and cross-tenant references with stable error codes.
- Preserve existing sales, refund, supplier-return, cash, inventory, and stored-value invariants. Accounting failures roll back the complete source transaction.

## 6. Non-goals

- Statutory books, tax returns, tax advice, or a claim of compliance with Philippine or other jurisdictional standards.
- Bank feeds, bank reconciliation, payroll, fixed assets, budgets, forecasting, multi-currency, and accounting-platform integrations.
- PO creation or editing that changes stock, cash, payment, Sale, or Expense records.
- Rewriting old source records, automatic cost changes, unbalanced manual journal entry, or hidden client-side account balances.
- Period close/lock workflows, supplier statement reconciliation, and accountant approval workflows.
- Production data edits or deployment without separate authorization.

## 7. Acceptance criteria

1. Every posted entry balances in integer minor units and cannot be changed or deleted; reversal preserves the original.
2. A repeated source posting, bill posting, payment, credit, or backfill batch cannot create a duplicate effect.
3. Sale, tender, refund, restock, gift-card/store-credit, delivery, expense, receipt, supplier-return, AP, and payment journals match their source records and the documented posting rules.
4. Every new write posts the journal in the same transaction; injected posting failure leaves no partial business mutation.
5. Supplier bills enforce tenant, supplier, branch, receipt, received-quantity, returned-quantity, billed-quantity, amount, and open-balance constraints.
6. P&L, trial balance, account activity, and CSV totals reconcile; all report filters are server-side and bounded.
7. Backfill can resume, rerun, and report unresolved inventory values without fabricating amounts or changing inventory quantities; opening balance activation requires a balanced owner-confirmed worksheet.
8. Cross-tenant and unauthorized role tests fail closed for journals, accounts, bills, payments, and reports.
9. Memory and PostgreSQL contract tests cover posting, rollback, uniqueness, branch scope, backfill, and source parity.
10. Accessible Playwright coverage verifies owner/manager flows, AP draft/post/pay/reverse, report empty/loading/error states, and desktop/tablet/mobile layouts.
11. Repository lint, typecheck, unit/API, PostgreSQL, build, E2E, migration, security, and Phase 23 exit checks pass.

## 8. Review questions resolved by this draft

- Purpose: internal management accounting only, as approved by the user; statutory accounting and tax advice are excluded.
- Accounting authority: existing operational source records remain authoritative; posted journal is the immutable management-reporting projection.
- Inventory receipt/invoice difference: preserve receipt and sale snapshots; post invoiced difference to a visible purchase-price-variance account.
- Legacy cost gaps: report and block value inference; never derive historical value from current Product cost.
- Opening balances: accept only through a balanced, owner-confirmed worksheet with an explicit accounting start date and retained-earnings offset.
- External release: no production changes; staging requires explicit authorization for this Phase 23 release.
