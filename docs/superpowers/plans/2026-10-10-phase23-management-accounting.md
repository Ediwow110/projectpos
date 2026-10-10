# Phase 23 Management Accounting Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` after the user approves this plan. Complete one task at a time and keep each task reviewable.

**Goal:** Add a tenant-scoped immutable management journal, supplier payables, reconciled P&L and account reports, with resumable legacy activation and no statutory accounting claims.

**Architecture:** Keep operational rows authoritative and post balanced journal entries in their existing `DbPort.withTransaction` boundary. Add an accounting persistence family for memory and PostgreSQL, a shared source-event posting service, and an AP service that consumes receipt/return snapshots. Reports read bounded server-side journal queries. The existing ledger CSV keeps its columns and becomes a journal projection after reconciliation. Legacy activation is an explicit owner-confirmed process; unknown inventory values remain unresolved.

**Tech Stack:** TypeScript, NestJS, Next.js App Router, Zod, Prisma schema plus additive hand-written PostgreSQL migration, `DbPort` memory/PostgreSQL adapters, Vitest, Playwright, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-10-10-phase23-management-accounting-design.md`

## Global Constraints

- Preserve the operational source as authority: Sale, Payment, Refund, Expense, Inventory Movement, Purchase Receipt, Supplier Return and existing stored-value records.
- Every journal entry is tenant scoped, uses integer minor units and one business currency, has at least two lines, balances exactly, and is immutable once posted. Corrections use linked reversals.
- Post journal and source mutations in the same transaction. Preserve current lock ordering and idempotency behavior; add no asynchronous posting window.
- Preserve Phase 10 CSV headers and spreadsheet formula-injection protection. Do not enable the journal-backed report until parity checks pass.
- Never derive historical costs from current Product cost. Flag unvalued inventory and require a balanced, owner-confirmed opening worksheet.
- AP quantities must be constrained by same-tenant, same-supplier, compatible-branch posted receipts less returns and prior bills. AP never creates customer Sale/Refund rows.
- Keep statutory filing, tax advice, multi-currency, banking, payroll, fixed assets, period close and production release out of scope.
- Use disposable PostgreSQL and deterministic memory fixtures for state-changing tests. Never use production accounts/data or payment providers.
- No new runtime dependency unless existing packages cannot meet a documented requirement.

## Review Focus

- **Atomicity and replay:** injected journal failure rolls back the source row and inventory/cash effects; duplicate source keys and idempotency keys create one effect. Tasks 4–6 own tests.
- **Receipt/bill/return allocation:** concurrent bills, returns, credits and payments cannot overconsume receipt quantities or exceed open AP. Task 6 owns PostgreSQL race tests.
- **Accounting math:** all posting rules balance and reconcile to source minor units, including split tenders, refunds/restocks, stored value, delivery, GRNI, price variance and credits. Tasks 1 and 5 own rule matrices.
- **Legacy valuation:** reruns are safe, pages are bounded, unresolved costs stay out of value reports, and no quantity or cost is fabricated. Task 8 owns tests.
- **Tenant and role boundary:** direct API calls, branch filters, drilldowns and CSV fail closed for unauthorized or cross-tenant access. Tasks 7 and 9 own contract tests.
- **Report consistency:** P&L, account activity, trial balance, and CSV use the same posted journal and inclusive date boundaries. Task 7 owns reconciliation tests.

## File Structure Map

- `apps/api/src/accounting/accounting-types.ts` — account, journal, posting, query and activation types.
- `apps/api/src/accounting/chart-of-accounts.ts` — pure default account definitions based on Phase 10 map plus AP, GRNI and variance.
- `apps/api/src/accounting/journal-rules.ts` — pure balanced-entry constructors and validation.
- `apps/api/src/accounting/journal-posting.service.ts` — idempotent tenant/source validation and immutable posting orchestration.
- `apps/api/src/accounting/accounting.service.ts` — account management, reversal, P&L, trial balance, activity and activation commands.
- `apps/api/src/accounting/nest/accounting.controller.ts` — protected account, journal, report and activation endpoints.
- `apps/api/src/payables/payables.service.ts` — bill drafts, receipt matching, posting, credits and payments.
- `apps/api/src/payables/nest/payables.controller.ts` — protected AP endpoints.
- `apps/api/src/common/pg/pg-accounting.ts` — PostgreSQL accounting-family queries and writes.
- `apps/api/src/common/pg/pg-payables.ts` — PostgreSQL bill/credit/payment persistence.
- `packages/validation/src/accounting.schema.ts` and `packages/validation/src/payables.schema.ts` — request/query contracts.
- `packages/database/prisma/schema.prisma` and next numbered migration — tenant-scoped tables, constraints, indexes and RLS policies.
- `apps/web/src/lib/accounting.ts`, `apps/web/src/lib/payables.ts` — typed API helpers.
- `apps/web/src/app/accounting/page.tsx`, `apps/web/src/app/accounting/journal/page.tsx`, `apps/web/src/app/accounting/accounts/page.tsx` — P&L and journal/account reports.
- `apps/web/src/app/payables/page.tsx`, `apps/web/src/app/payables/[id]/page.tsx` — bill queue and bill detail/actions.
- Tests follow existing `*.test.ts`, `apps/api/test/*.contract.test.ts`, `apps/api/test/pg`, `e2e` and `scripts/verify-phase*.test.mjs` conventions.

## Task 1: Define and verify accounting math

**Files:** Create `apps/api/src/accounting/accounting-types.ts`, `chart-of-accounts.ts`, `journal-rules.ts`, and `journal-rules.test.ts`.

- [ ] Add failing pure tests for account codes/types/normal sides, positive integer line amounts, debit XOR credit, two-line minimum, one currency, exact balance, and duplicate source-event key shape.
- [ ] Add posting matrices for sale split tenders, merchandise/delivery/tax, COGS snapshots, refund tender reversal and restock-only COGS reversal, expense, receipt/GRNI, billed receipt/variance, billed/unbilled supplier return and payment.
- [ ] Implement pure builders returning typed journal drafts; reject zero, negative, unsafe integer, malformed currency/date and unbalanced inputs with stable domain codes.
- [ ] Assert every default account code from `export.service.ts` maps to one defined type/normal side; add AP, GRNI and purchase-price variance without changing current meanings.
- [ ] Run `pnpm --filter @pos/api test -- src/accounting/journal-rules.test.ts` and `pnpm --filter @pos/api typecheck`.
- [ ] Review rule outputs against spec §3.2–3.3 before proceeding.

## Task 2: Add additive accounting persistence schema

**Files:** Modify `packages/database/prisma/schema.prisma`; create the next migration under `packages/database/prisma/migrations`; update the Phase 23 migration verifier and database package scripts only if needed.

- [ ] Write migration contract checks first for `AccountingAccount`, `JournalEntry`, `JournalLine`, source-event uniqueness, account-use protection, tenant/branch indexes, RLS, AP entities and return allocations.
- [ ] Define business-owned accounts; entries with source identity, event, effective date, currency, branch, description, actor/request IDs, posted/reversal links and created time; lines with account, debit/credit minor units and source memo.
- [ ] Define SupplierBill, bill allocations, SupplierCredit, supplier payment and receipt-line return allocations. Use integer `BIGINT`/Prisma `BigInt` consistently with existing minor units; validate JS safe-integer boundaries at the API edge.
- [ ] Add SQL constraints for debit/credit XOR and nonnegative values, unique `(businessId, sourceType, sourceId, sourceEvent)`, safe foreign keys and tenant ownership. Add trigger or write-path enforcement for posted immutability; ordinary updates/deletes cannot alter posted entries/lines.
- [ ] Add RLS policies consistent with current business-scoped tables and required indexes for date/branch/account/source and AP status/due date.
- [ ] Run Prisma format/validate and `node scripts/verify-phase23-migration.mjs` after implementing that verifier in Task 10.

## Task 3: Extend DbPort with memory/PostgreSQL parity

**Files:** Modify `apps/api/src/common/db.port.ts`, `memory.db.ts`, `pg.db.ts`; create `pg-accounting.ts` and `pg-payables.ts`; add `apps/api/test/pg/pg-accounting.test.ts`, `pg-payables.test.ts`, and memory contract tests.

- [ ] Add failing adapter contract tests for account seed idempotency, tenant-scoped lookup, immutable posted entries, source-event uniqueness, bounded date/branch/account journal queries, bill allocation totals, payment totals and receipt return allocations.
- [ ] Add `DbMovement.createdAt` to match `InventoryMovement.createdAt`; update memory and PostgreSQL read/write projections and test historical date preservation.
- [ ] Add typed DbPort methods for account CRUD/use checks, entry+lines create/find/reverse/list aggregates, activation cursors/unresolved values, bills/allocations/credits/payments and receipt allocation totals. Keep methods tenant-scoped in their parameters.
- [ ] Implement memory behavior with transaction snapshot/rollback semantics matching existing store behavior. Implement PostgreSQL family queries through `PgContext`, and wire family methods through `PgDbPort`.
- [ ] Add unique-violation mapping to stable domain errors; avoid catching unrelated SQL failures as duplicate requests.
- [ ] Run `pnpm --filter @pos/api test -- src/common` and `pnpm --filter @pos/api test:pg -- pg-accounting pg-payables` against the disposable database.

## Task 4: Implement journal poster and account lifecycle

**Files:** Create `journal-posting.service.ts`, accounting service unit/contract tests; modify `apps/api/src/app.module.ts`, accounting API module registration and `packages/auth/src/permissions.ts` plus permission seed/default grant tests.

- [ ] Add failing tests for idempotent `postSourceEvent`, same-business source/account checks, multi-branch scope, transaction rollback, immutable reversal links and owner-only account configuration.
- [ ] Implement system chart seeding with transaction-safe upsert; never overwrite user labels/mappings or mutate a used account's type/code. Deactivation/delete rules follow spec §3.1.
- [ ] Implement `postSourceEvent` to validate draft balance/currency/account tenant and persist header+lines atomically; same key with same payload returns existing entry; mismatched replay returns stable idempotency conflict.
- [ ] Implement audited reversal as one opposite balanced entry linked to the original; prevent duplicate reversal and direct mutation/deletion of posted records.
- [ ] Add `accounting.read`, `accounting.manage`, `payables.read`, `payables.write`, and `payables.pay` with documented owner/manager defaults; enforce at controllers/services (not only UI).
- [ ] Run targeted accounting unit/contract tests and permission package tests.

## Task 5: Post existing source events transactionally

**Files:** Modify sales/refund/expense/inventory/procurement/value/order services and relevant module factories; extract/replace Phase 10 mapping in `apps/api/src/exports/nest/export.service.ts`; add source posting unit and API contract tests.

- [ ] Build a source-to-journal table from existing service write boundaries before editing; each row records source create/update, transaction wrapper, idempotency key, lock order and reversal path.
- [ ] Add failing atomicity tests per event family with a poster that throws. Assert no Sale/Refund/Expense/receipt/return/movement/cash/stored-value write commits alone.
- [ ] Wire completed sales, captured tenders, approved refunds, restocked quantities, expenses/voids, receipts, returns, adjustments, gift cards, store credit, loyalty, delivery and order-linked sales through the shared posting service.
- [ ] Ensure expense categories resolve through an explicit audited account mapping; use a documented default only where the current contract has no category.
- [ ] Add receipt posting to inventory/GRNI at line cost snapshots; supplier return allocation determines GRNI clearing vs AP credit without changing stock source snapshots.
- [ ] Keep current `DbPort.withTransaction` and domain lock order; do not introduce nested lock inversion. Account posting failure rejects the whole source command.
- [ ] Keep the derived Phase 10 CSV as the active implementation until parity tests pass; add golden tests comparing current rows to journal drafts for representative fixtures.
- [ ] Run targeted source service tests, Phase 20/22 contracts, and relevant PG contracts.

## Task 6: Build supplier AP workflows

**Files:** Create `apps/api/src/payables/payables.service.test.ts`, `apps/api/test/payables.contract.test.ts`, `apps/api/test/pg/pg-payables-concurrency.test.ts`; add payables module/controller and validation schemas.

- [ ] Add failing tests for draft version conflicts, same-tenant/supplier/branch receipt validation, received-minus-returned-minus-billed limits, invoice/receipt price variance, non-stock charges, partial/full payment, overpayment, idempotent retries, supplier credits and cash shift movement atomicity.
- [ ] Implement draft create/update with optimistic version; posting consumes only eligible posted receipt allocations and posts GRNI, variance, expense and AP lines atomically.
- [ ] Implement payment with amount/date/method/reference/cash account validation, open-balance lock, AP debit/cash/clearing credit and request idempotency. When linked to an open shift, create the matching cash movement in the same transaction.
- [ ] Implement credit note allocation to posted returns; unbilled returned quantities clear GRNI, billed quantities reduce AP or create a supplier credit balance. Never create customer Refund or Sale rows.
- [ ] Add API validation and stable errors for overbilling, overpayment, invalid branch, supplier mismatch and concurrent stale draft.
- [ ] Run memory tests and PG race/constraint tests with isolated disposable fixtures.

## Task 7: Add journal-backed reports and exports

**Files:** Create accounting report service/controller/schema tests; modify `apps/api/src/exports/nest/export.service.ts`, `export.controller.ts`, export contracts and authorization defaults.

- [ ] Add failing contracts for inclusive UTC date bounds, branch filter, bounded pagination, no future dates beyond policy, zero-data result, unauthorized role, cross-tenant IDs and spreadsheet formula injection.
- [ ] Implement P&L, trial balance, account activity and paginated general journal as SQL-backed aggregates over posted rows; drilldowns return only source IDs readable under existing service policy.
- [ ] Add posting freshness and unresolved legacy inventory metadata; do not silently fold unresolved value into COGS or net income.
- [ ] Preserve `date,type,ref,account,debitMinor,creditMinor,memo` CSV columns, audit event, response streaming and formula-injection handling. Switch CSV to journal rows only behind a verified activation/readiness flag.
- [ ] Reconcile totals between P&L, trial balance and CSV in API tests over the same fixture and date range.
- [ ] Run accounting/export contracts and targeted PG report tests.

## Task 8: Implement safe historical activation and opening worksheet

**Files:** Create backfill service/command and tests under `apps/api/src/accounting` and `scripts`; modify export movement adapter tests; add activation API contract tests.

- [ ] Add failing tests for bounded cursor pages, interruption/resume, duplicate reruns, per-tenant reports, correct source snapshots, dated movement handling, missing-cost unresolved rows, and no quantity mutation.
- [ ] Implement deterministic event enumeration in bounded pages and invoke the same `postSourceEvent` rules as live writes. Persist cursor/checkpoints and summarized counts/totals; make every batch safely repeatable.
- [ ] Use SaleItem and PurchaseReceiptLine cost snapshots only. Record unresolved legacy inventory references and exclude their value from value-based P&L until owner adjustment.
- [ ] Implement opening worksheet preview with accounting date, entered account balances and retained-earnings offset. Validate exact balance; require owner confirmation and idempotency before posting a single immutable opening entry.
- [ ] Gate accounting reports and journal CSV cutover until activation completes and reconciliation checks are green; keep legacy CSV available during transition.
- [ ] Run restart/resume and opening-balance tests on memory and disposable PG.

## Task 9: Build accessible web workflows and Playwright coverage

**Files:** Create accounting/payables API helpers and pages listed in File Structure Map; add POMs under `e2e/pages` if that convention exists (otherwise `e2e/page-objects`); add `e2e/accounting.spec.ts` and isolated fixture helpers.

- [ ] Inspect existing auth/tenant fixtures and use isolated test tenants/database only. Never run setup or AP writes against production.
- [ ] Implement accessible P&L filters/summary, journal list and account activity/trial balance with loading, empty and recoverable error states; use roles/labels and server query parameters.
- [ ] Implement AP bill queue/detail, receipt matching, invoice-cost variance preview, draft/post, partial payment and credit display with permission-aware actions and API-authoritative state.
- [ ] Add POMs using `getByRole`, `getByLabel`, `getByText` and expect auto-waits; no fixed sleeps or CSS-based action locators.
- [ ] Cover owner and manager permission flows, draft/post/pay/reverse, report reconciliation, unauthorized actions, empty/loading/error states and desktop/tablet/mobile layouts.
- [ ] Run `pnpm exec playwright test e2e/accounting.spec.ts --project=chromium --reporter=line` with the repository’s isolated E2E environment.

## Task 10: Migration verification, security review and phase exit gates

**Files:** Create `scripts/verify-phase23-migration.mjs`, `scripts/verify-phase23.test.mjs`, `tests/phase23-exit.test.ts`; update CI workflow only after confirming the existing job contract and expected database services.

- [ ] Add failing static exit checks for schema/migration, RLS, `DbPort` parity, transaction posting call sites, API permission registration, web routes, tests, and CI references.
- [ ] Add explicit security contracts for tenant-scoped accounts/entries/bills/payments, branch scope, CSRF, idempotency, amount bounds, immutable posted rows and no payment credentials in logs/audit.
- [ ] Audit route bypass, direct service/API authorization and source updates/voids; correct gaps before enabling journal cutover.
- [ ] Run targeted suites first: accounting math/services, API contracts, PG accounting/payables, migration verifier, and one Playwright spec.
- [ ] Run required repository gates from current `.github/workflows/ci.yml`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, migration/security/phase verifiers, `pnpm build`, PostgreSQL contracts and E2E. Use the CI workflow as source of truth and record exact outcomes.
- [ ] Inspect final diff/status for user changes, secrets, migration order and generated artifacts. Record staging/production as not run until separately authorized; do not push/deploy in this plan.

## Self-review against spec

- Criteria 1–4 are covered by Tasks 1, 3–5 and 10 (balance, immutability, idempotency, source parity, rollback).
- Criteria 5–6 are covered by Tasks 6–7 (AP constraints and reconciled reports).
- Criteria 7 is covered by Task 8 (resumable safe backfill and owner-confirmed opening entry).
- Criteria 8–9 are covered by Tasks 3–7 and 10 (tenant/role/branch, memory/PG contracts).
- Criteria 10–11 are covered by Tasks 9–10 (accessible Playwright and repository gates).
- Explicit review focus is assigned to test-owning tasks above. No source event is allowed to become journal-only or post asynchronously.

## Review focus execution notes

- Run concurrency cases against the disposable PostgreSQL database with separate service instances where practical; memory serialization alone does not prove cross-process behavior.
- Verify failed journal writes by re-reading every source and side-effect table in the same contract test.
- Compare legacy export and journal projection on the same fixture before switching activation behavior.
- Verify an unresolved inventory value changes report metadata and does not change totals.
- Inspect emitted audit/log objects in tests to confirm no provider credentials, invoice attachment secrets, or raw payment credentials are stored.
