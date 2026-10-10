# Phase 23 implementation status — updated 2026-10-11

## Workspace and release state

- Worktree: `G:\Vscode\POS-phase23-accounting-20261010`
- Branch: `codex/phase23-accounting`
- Implementation base: `3f823826b648ae6bbffdab10bf0dc842ac0f6154`
- The original `G:\Vscode\POS` checkout remains untouched. Changes are isolated in the worktree.
- This update is committed locally on this branch. No push, merge, deployment, production write, or payment occurred.
- Earlier staging approval covered onboarding only. Phase 23 staging still needs separate approval.

## Implemented

- Tenant-scoped immutable double-entry journals and source posting for sales, refunds, expenses, inventory adjustments, receipts, supplier returns, bills, and payments.
- Supplier bill draft/post/payment and return-credit application workflows, receipt allocation, invoice/receipt price variance, bill detail, and open-balance reporting.
- Trial balance, P&L activation gating, paginated journal, account activity, audited journal CSV, owner opening-balance worksheet, and bounded resumable backfill.
- Backfill now uses the confirmed accounting start date, skips pre-cutover source records already covered by opening balances, and blocks value inference when source evidence is unavailable.
- Backfill requires an owner-confirmed opening entry and cutoff date. Owners can revise opening balances before backfill; afterward the cutoff date is locked, revisions reverse and retain the prior immutable entry, and revisions are blocked during a running batch.
- Manual gift-card, store-credit, and loyalty adjustments require an explicit counter-account selection and post their balanced journal in the same transaction. Audit and manager-approval fingerprints include the account choice.
- Accessible Playwright coverage includes accounting/payables and explicit stored-value counter-account flows across desktop, tablet, and mobile.
- Management accounting only was approved. The spec excludes statutory filings and tax advice. The repository roadmap ends at Phase 10; no Phase 24 scope was invented.

## Verification evidence

- `pnpm exec turbo run test --force --concurrency=1`: all 7 packages passed; API 144 files/709 tests; web 72 files/267 tests; validation 17 files/114 tests.
- `pnpm --filter @pos/api exec vitest run --config vitest.pg.config.ts`: 19 files/166 tests passed against the local disposable PostgreSQL test setup.
- `pnpm test:exit`: 16 files/68 tests passed.
- `pnpm typecheck`: all 7 workspace packages passed.
- `pnpm lint`: completed without reported errors.
- Combined stored-value/accounting/payables browser run passed 21/21 desktop/tablet/mobile tests. After the final backfill guard, `pnpm e2e -- e2e/accounting.spec.ts` passed 9/9; production build succeeded again.
- `pnpm verify`, all `verify-phase*.test.mjs` scripts, `verify-phase23-migration.mjs`: passed (`SCAFFOLD_OK`, phase verifiers OK).
- `pnpm audit --prod --audit-level critical`: no known vulnerabilities.
- `git diff --check`: passed. Git reports only LF-to-CRLF conversion warnings on edited TypeScript files.

## Remaining release blockers and limits

1. Historical inventory count/movement cost gaps and legacy standalone stored-value adjustments still fail closed when they fall on or after the chosen cutoff. The owner must have reliable source records and choose an appropriate cutoff/opening worksheet before backfill; the code does not invent values. No separate adjustment workflow was added for unsupported historical source events.
2. Phase 23 staging validation has not occurred. The earlier “My Workspace staging” approval is scoped to onboarding. Request separate Phase 23 staging approval after reviewing this local commit.
3. CI has not run for this commit because the branch has not been pushed. Local checks mirror the relevant repository gates.
4. No production release is authorized by this work.

## Closeout

- The local implementation and required code-level checks are complete.
- Phase 23 is not release-complete until source-data issues are resolved for the intended tenant and authorized staging validation passes.
- Keep this implementation on `codex/phase23-accounting`; do not push, deploy, merge, or change production without explicit authorization.
