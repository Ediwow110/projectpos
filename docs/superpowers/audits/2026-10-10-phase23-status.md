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
- Owners can resolve paused historical inventory movement/count cost issues using invoice/count evidence. Each resolution posts a balanced immutable journal and leaves inventory quantities/count snapshots unchanged; resolved issues no longer block activation after recheck.
- Owners can resolve legacy standalone gift-card, store-credit, and loyalty adjustments in bounded batches using source evidence and an explicit counter account. Missing loyalty value snapshots require a supplied evidenced amount; each posting is balanced and immutable, and the issue remains open until every source row is resolved.
- Manual gift-card, store-credit, and loyalty adjustments require an explicit counter-account selection and post their balanced journal in the same transaction. Audit and manager-approval fingerprints include the account choice.
- Accessible Playwright coverage includes accounting/payables, direct stored-value counter-account selection, and legacy stored-value resolution across desktop, tablet, and mobile.
- Management accounting only was approved. The spec excludes statutory filings and tax advice. The repository roadmap ends at Phase 10; no Phase 24 scope was invented.

## Verification evidence

- `pnpm exec turbo run test --force --concurrency=1`: all 7 packages passed; API 144 files/712 tests; web 72 files/267 tests; validation 18 files/116 tests.
- `pnpm --filter @pos/api exec vitest run --config vitest.pg.config.ts`: 19 files/167 tests passed against the local disposable PostgreSQL test setup, including migration 0039 and stored-value backfill resolution.
- `pnpm test:exit`: 16 files/68 tests passed.
- `pnpm typecheck`: all 7 workspace packages passed.
- `pnpm lint`: completed without reported errors.
- Combined stored-value/accounting/payables browser run passed 21/21 desktop/tablet/mobile tests. After the final backfill guard, `pnpm e2e -- e2e/accounting.spec.ts` passed 9/9; production build succeeded again.
- `pnpm verify`, all `verify-phase*.test.mjs` scripts, `verify-phase23-migration.mjs`: passed (`SCAFFOLD_OK`, phase verifiers OK).
- `pnpm audit --prod --audit-level critical`: no known vulnerabilities.
- Final review: `git diff --check` passed. Git reports only LF-to-CRLF conversion warnings on edited TypeScript files.

## Remaining release blockers and limits

1. Phase 23 staging validation has not occurred. The earlier “My Workspace staging” approval is scoped to onboarding. Request separate Phase 23 staging approval after reviewing this local implementation.
2. CI has not run for this commit because the branch has not been pushed. Local checks mirror the relevant repository gates.
3. Each tenant still requires owner verification of historical source evidence and account mapping before activation. No source values are inferred.
4. No production release is authorized by this work.

## Closeout

- The local implementation, including evidence-based resolution paths for historical inventory and standalone stored-value gaps, is complete and verified.
- Phase 23 is not release-complete until owner evidence review for the intended tenant and authorized staging validation pass.
- Keep this implementation on `codex/phase23-accounting`; do not push, deploy, merge, or change production without explicit authorization.
