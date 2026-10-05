# Phase 21 Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden NexPOS for production by closing sale-void and variant-dimension correctness debt, proving security/concurrency boundaries, and producing measurable operational evidence.

**Architecture:** Preserve the modular NestJS API, Next.js web app, shared validation, memory/PG `DbPort` parity, append-only ledgers, and existing CI. Work vertically: each task adds its test evidence and leaves the branch buildable. Database changes are additive and are proven against PostgreSQL before merge.

**Tech Stack:** TypeScript, NestJS, Next.js, Zod, Vitest, PostgreSQL migrations, Playwright, pnpm/Turbo, Render deployment.

**Spec:** `docs/superpowers/specs/2026-10-06-phase21-production-hardening-design.md`

## Global Constraints

- Do not start Phase 22 or add omnichannel/accounting/workforce/hardware features.
- Preserve append-only inventory, financial, stored-value, loyalty, and audit semantics.
- Server authorization, tenant scope, branch scope, idempotency, and concurrency remain authoritative.
- Additive schema evolution only; every migration is tested against PostgreSQL.
- Never log passwords, sessions, reset tokens, gift-card bearer codes, secret keys, raw payment credentials, or unredacted personal data.
- Do not invent offline support; stored-value, provider payment, manager approval, and other online-only operations remain blocked offline.
- Preserve unrelated working-tree changes by working from the dedicated worktree.

## Review Focus

- A void request must persist the exact trimmed reason and timestamp in both memory and PostgreSQL, while a replay cannot mutate a completed sale.
- Editing a family dimension must not orphan stock-bearing variants, duplicate combinations, or silently rewrite historical option meaning.
- A caller-supplied request ID must be bounded, echoed safely, and never become a log-injection or sensitive-payload channel.
- Two concurrent mutation requests must produce one authoritative result and one ledger effect, not two successful responses.
- Production receipts/reports must remain masked and must not expose gift-card bearer material while new observability fields are emitted.

## Task List

### Task 1: Freeze the audit baseline and evidence ledger

**Files:**
- Create: `docs/superpowers/audits/2026-10-06-phase21-baseline.md`
- Create: `.superpowers/sdd/phase21-production-hardening/progress.md`
- Inspect: `package.json`, `.github/workflows/ci.yml`, `render.yaml`, `packages/database/prisma/schema.prisma`, `apps/api/src/main.ts`

**Interfaces:** Consumes current `origin/main`; produces the inventory of routes, migrations, tests, deployment assumptions, and dated findings consumed by Tasks 2–9.

- [ ] Record the current commit, dirty-file boundary, package scripts, CI jobs, Render service assumptions, and existing Phase 8/20 audit links.
- [ ] Build an endpoint matrix from every controller: method, path, session guard, CSRF guard, permission, tenant scope, branch scope, idempotency requirement, and error envelope.
- [ ] Record current dependency audit, typecheck/lint/build/test/PG/E2E baseline commands and their exact outputs; failures become dated findings, not hidden.
- [ ] Record the two known correctness findings and mark all Phase 22–25 items explicitly out of scope.
- [ ] Verify the audit document contains no raw secrets, bearer codes, cookies, or production credentials.

**Verification:** `pnpm verify`; `pnpm lint`; `pnpm typecheck`; `pnpm build`; `pnpm audit --prod --audit-level critical`; full test commands as available. Review the generated audit for redaction and reproducibility.

### Task 2: Persist sale void metadata

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0033_phase21_sale_void_metadata/migration.sql`
- Modify: `apps/api/src/common/db.port.ts`, `apps/api/src/common/memory.db.ts`, `apps/api/src/common/pg/pg-sales.ts`
- Modify: `apps/api/src/sales/sale-lifecycle-service.ts`, `apps/api/src/sales/sales-types.ts`
- Test: `apps/api/src/sales/sales.test.ts`, `apps/api/src/sales/sale-lifecycle-service.test.ts`, `apps/api/test/pg/pg-sales.test.ts`

**Interfaces:** `DbSale` gains `voidedAt: Date | null` and `voidReason: string | null`; `updateSale` persists both fields; `voidSale()` writes `{ status: "VOIDED", voidedAt: new Date(), voidReason: reason.trim() }` under the existing sale lock.

- [ ] Write failing memory and PostgreSQL tests proving a void stores timestamp/reason and a non-void sale keeps both fields null.
- [ ] Write a failing test proving a completed sale cannot be voided and that a repeated request cannot create a second financial/audit effect.
- [ ] Add nullable columns and indexes only if a stated void-history query needs them; keep the migration additive and tenant-scoped.
- [ ] Update memory and PG selects/inserts/patches so parity includes the new fields.
- [ ] Update the lifecycle service and sale detail/read projections to expose status, reason, and timestamp without changing receipt totals.
- [ ] Run focused memory and PG tests, then the full API suite.

**Verification:** `pnpm --filter @pos/api exec vitest run src/sales/sale-lifecycle-service.test.ts src/sales/sales.test.ts`; `pnpm --filter @pos/api test:pg -- src/sales`; inspect a PostgreSQL row through the existing test projection, never raw production writes.

### Task 3: Align void UI copy and audit presentation

**Files:**
- Modify: `apps/web/src/app/sales/[id]/page.tsx`
- Modify: `apps/web/src/lib/sales.ts` or the existing sale-detail mapper
- Test: `apps/web/src/app/sales/[id]/page.test.tsx` or the nearest existing sales UI test; add `e2e/sales-void-audit.spec.ts` only if the current suite has no suitable coverage.

**Interfaces:** Consumes the Task 2 sale projection; produces accessible sale-detail copy showing the retained void reason/timestamp and a clear distinction between `VOIDED`, `REFUND_REQUESTED`, and `REFUNDED`.

- [ ] Add a failing component test for a voided sale showing the persisted reason and timestamp, and for a non-voided sale hiding the void metadata.
- [ ] Replace ambiguous “voiding prevents…” text where it conflicts with the persisted audit semantics; keep confirmation and manager approval requirements explicit.
- [ ] Verify keyboard focus, alert announcements, disabled/busy state, and no duplicate submit behavior.
- [ ] Run the focused web test and a browser smoke against a disposable seeded sale.

**Verification:** `pnpm --filter @pos/web exec vitest run src/app/sales/[id]/page.test.tsx`; targeted Playwright spec at desktop/tablet/mobile.

### Task 4: Add safe family-level variant-dimension editing

**Files:**
- Modify: `packages/validation/src/product-model.schema.ts`
- Modify: `apps/api/src/catalog/nest/product-model.service.ts`, `product-model.controller.ts`
- Modify: `apps/api/src/common/db.port.ts`, `apps/api/src/common/memory.db.ts`, `apps/api/src/common/pg/pg-product-model.ts`
- Modify: `apps/web/src/app/products/families/page.tsx`
- Test: `apps/api/src/catalog/nest/product-model.service.test.ts`, `apps/api/test/product-model.contract.test.ts`, `apps/api/test/pg/pg-product-model.test.ts`, `apps/web/src/app/products/families/page.test.tsx`

**Interfaces:** Add an authenticated, permission-gated family option update contract. It accepts option names plus add/archive value operations, returns a refreshed family projection, and rejects duplicate combinations, deletion of referenced values, or changes that would orphan stock-bearing variants.

- [ ] Write failing validation/service tests for adding a value, archiving an unused value, duplicate option names, duplicate combinations, and attempted deletion of a referenced value.
- [ ] Define exact endpoint payload and error codes before UI work; do not infer option IDs from client labels.
- [ ] Implement memory/PG parity with business and family scope checks, audit rows, and idempotency where the operation can be retried.
- [ ] Add an accessible editor with explicit “archive value” copy, current-usage counts, unsaved-change protection, and responsive layout.
- [ ] Verify existing variants keep their option-value IDs and historical display names after safe edits.

**Verification:** focused API memory/PG/web tests; targeted Playwright family editor test; full catalog regression.

### Checkpoint: Correctness debt closed

- [ ] Tasks 1–4 have focused tests and audit entries.
- [ ] Memory and PostgreSQL projections agree for void metadata and variant dimensions.
- [ ] No new Phase 22–25 feature has entered the branch.

### Task 5: Harden correlation, structured logs, and critical metrics

**Files:**
- Modify: `apps/api/src/correlation.ts`, `apps/api/src/common/request-id.middleware.ts`, `apps/api/src/logger.ts`, `apps/api/src/common/metrics.ts`, `apps/api/src/common/metrics.middleware.ts`
- Modify: `apps/api/src/common/auth-error.filter.ts`, `apps/api/src/errors.ts`, `apps/api/src/main.ts`
- Test: `apps/api/src/common/metrics.test.ts`, `apps/api/src/common/request-id.middleware.test.ts`, `apps/api/src/common/logger.test.ts`, `apps/api/test/observability.contract.test.ts`
- Create: `docs/superpowers/audits/2026-10-06-phase21-observability.md`

**Interfaces:** Request IDs are bounded and safe; response errors echo `correlationId`; structured logs include release/route/status/duration/classification; metrics cover request latency/errors plus sale/payment/refund/inventory/stored-value outcomes.

- [ ] Write failing tests for missing, valid, oversized, and injection-shaped request IDs.
- [ ] Write a redaction test asserting passwords, cookies, bearer codes, tokens, provider credentials, and raw customer contact values never occur in serialized logs.
- [ ] Add duration and outcome metrics without adding a runtime dependency or changing business behavior.
- [ ] Document metric names, labels, retention assumptions, and useful alert thresholds.
- [ ] Verify error envelopes remain backwards-compatible for existing callers.

**Verification:** focused observability tests; API contract tests; inspect representative JSON log lines for redaction.

### Task 6: Security, tenant/branch isolation, idempotency, and concurrency audit

**Files:**
- Create/extend: `apps/api/test/phase21-security.contract.test.ts`, `apps/api/test/phase21-concurrency.contract.test.ts`
- Modify only where a test proves a defect: relevant controller/service/schema files
- Create: `docs/superpowers/audits/2026-10-06-phase21-security.md`

**Interfaces:** Tests cover every sensitive route and critical mutation using the existing auth, permission, CSRF, tenant, branch, lock, and idempotency primitives.

- [ ] Add named tests for IDOR and cross-business access across sales, refunds, expenses, inventory, procurement, gift cards, store credit, loyalty, receipts, reports, devices, and settings.
- [ ] Add branch-mismatch tests for POS, inventory, receiving, counts, shifts, and transfers.
- [ ] Add duplicate/replay/mismatched-fingerprint tests for sale completion, payment callbacks, refunds, voids, receiving, gift-card load/redeem, store credit, loyalty, and manager approvals.
- [ ] Add concurrent last-unit, duplicate callback, and double-submit tests asserting exactly one ledger effect.
- [ ] Record every finding with severity, evidence, fix or dated follow-up; do not downgrade a real leak to “accepted.”

**Verification:** focused security/concurrency suites; full API and PostgreSQL regression; dependency audit with a written disposition for every high/critical finding.

### Task 7: Performance, query/index, and resilience evidence

**Files:**
- Create: `scripts/load/phase21-mix.mjs`
- Create: `docs/superpowers/audits/2026-10-06-phase21-performance.md`
- Modify only when justified: migration under `packages/database/prisma/migrations/`
- Test: `scripts/load/phase21-mix.test.mjs` or a deterministic parser/unit test for the harness

**Interfaces:** The harness accepts `BASE_URL`, `DATABASE_URL`/seed assumptions, duration, concurrency, and output path; it reports p50/p95/p99, throughput, error rate, and per-operation budgets without logging credentials or payloads.

- [ ] Write a deterministic test for percentile calculation, timeout classification, and redacted output.
- [ ] Measure product/search, barcode-equivalent lookup, POS completion, receipts, reports, inventory, procurement, customer lookup, and stored-value lookup.
- [ ] Review SQL access patterns and `EXPLAIN ANALYZE` only against a disposable PostgreSQL dataset; add an index only with a named query and before/after evidence.
- [ ] Exercise transient 503, DB reconnect, stale tab, refresh-after-commit, and duplicate-click behavior using existing test seams.
- [ ] Record local baseline, growth cohort, limitations, and staging procedure; do not claim production latency from local-only data.

**Verification:** harness unit tests; local load cohorts; PostgreSQL query plan evidence; resilience contract tests.

### Task 8: Backup, recovery, incident, and alert runbooks

**Files:**
- Inspect/modify: `scripts/backup.sh`, `scripts/restore.sh`, `docs/superpowers/runbooks/backup-restore.md`
- Modify: `docs/superpowers/runbooks/incidents.md`, `docs/superpowers/runbooks/alerts.md`, `docs/superpowers/runbooks/production-deployment.md`
- Create: `docs/superpowers/audits/2026-10-06-phase21-recovery-drill.md`

**Interfaces:** Backup/restore scripts accept explicit connection parameters from environment, never source secrets; the drill uses a throwaway PostgreSQL container and records migration/schema checks.

- [ ] Verify shell scripts fail closed when `DATABASE_URL` is absent and do not echo credentials.
- [ ] Run a throwaway backup → destroy → restore → migration/checksum/readiness drill.
- [ ] Document retention, encryption responsibility, owner-only access, rollback/migrate-forward rules, and the first three incident commands for payment, inventory, deploy, credential, and support-access incidents.
- [ ] Define alert names and starting thresholds for error rate, payment unknowns, DB saturation, failed migrations/backups, and cross-tenant anomalies.

**Verification:** shell syntax checks, throwaway container drill transcript, runbook review for secret redaction.

### Task 9: UX/accessibility and full regression closure

**Files:**
- Create: `docs/superpowers/audits/2026-10-06-phase21-ux-accessibility.md`
- Add/modify only proven defects: relevant web pages/components and E2E specs
- Modify: `.github/workflows/ci.yml` only if a required verification command is missing

**Interfaces:** Existing navigation and flows remain behaviorally compatible; accessibility fixes use current design tokens/components and do not add a new UI framework.

- [ ] Walk authenticated owner/cashier/inventory workflows from login through POS, customers, catalog, inventory, procurement, gift cards, loyalty, reports, settings, and logout.
- [ ] Verify keyboard order, focus restoration, dialog announcements, labels, reduced motion, contrast, zoom, 320/768/1024/1440 widths, loading/error/empty states, and scanner input.
- [ ] Add regression tests for each real defect; record non-defects and dated follow-ups.
- [ ] Run `pnpm verify`, `pnpm test`, `pnpm test:exit`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm audit --prod --audit-level critical`, PostgreSQL tests, and desktop/tablet/mobile Playwright.
- [ ] Open the Phase 21 PR only after all required checks are green and the closure report is evidence-backed.

**Verification:** complete CI matrix plus authenticated production smoke and browser console check after deployment.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Sale metadata migration drifts between memory and PostgreSQL | High | Contract tests against both ports and migration proof before merge |
| Variant editing breaks historical combinations | High | Archive-only semantics for referenced values; duplicate/orphan rejection tests |
| Full audit expands into Phase 22–25 feature work | High | Scope boundary and checkpoint; feature-shaped discoveries become dated follow-ups |
| Local performance is mistaken for production performance | Medium | Record environment and cohort; require staging procedure and honest limitations |
| Existing unrelated files are committed | High | Dedicated worktree from `origin/main`; inspect staged diff before every commit |
| Observability leaks sensitive data | High | Redaction tests with bearer/token/password fixtures and log review |

## Open Questions

- Which staging environment and credentials are approved for authenticated latency measurement and backup-drill validation?
- Should variant option values be archived permanently or be restorable by managers? The plan defaults to reversible archive, not deletion.
- Which external collector, if any, consumes process-local metrics in Render? Phase 21 documents the interface without adding infrastructure.

