# Phase 8 Security and Stability Hardening Design - Online POS

**Date:** 2026-09-23
**Source spec:** `G:\Vscode\PLAN.md` sections 7 (Security and Privacy), 12 (Performance Budgets), 13 (Testing Strategy), 14 (Observability, Operations, Deployment), 17 (Phase 8)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-23-phase7-dashboard-reports-design.md` (all Phase 0-7 behavior under audit; fixes must preserve every green suite)

## Goal

Implement PLAN.md 17 Phase 8: authorization audit, tenant isolation audit, session/rate-limit review, dependency and upload review, query tuning, backup/restore drill, observability, and Playwright workflow coverage.

**Exit (PLAN.md 17 verbatim):** security abuse suite passes and performance budgets are measured in staging.

## Architecture

No new runtime subsystem. Phase 8 is an audit-and-harden pass over the existing modular monolith, producing four artifact kinds:

```text
1. Abuse/contract regression tests (supertest + vitest, run in CI)
2. Targeted hardening fixes (headers, rate limits, validation gaps found by the audit)
3. Operational docs + scripts (backup/restore, incident playbooks, load-test procedure)
4. Playwright E2E wiring (config + critical-path and role-workflow specs)
```

Baseline facts established during brainstorming (verified by reading the repo): rate limiting exists on login/reset/import only (in-memory); `CsrfGuard` is applied to all POST/PATCH routes; no security-headers middleware; no Playwright config or e2e tests; CI runs tests but not typecheck; no backup/restore scripts or docs; no load-test harness.

## 1. Authorization Audit (PLAN.md 7, FR-RBAC-01/02)

Deliverable: a route-by-route audit table (method × path × guards × role/permission gate × verdict) covering every controller, committed as `docs/superpowers/audits/2026-09-23-phase8-authorization.md`. Every GET requires `SessionGuard`; every POST/PATCH requires `SessionGuard` + `CsrfGuard`; every sensitive action re-checks role/permission server-side (never trusts client claims).

Known-sensitive actions to verify explicitly: price/cost edits, discounts above threshold, voids, refunds (request/approve/reject), inventory adjustments, user management, settings, exports, shift close overrides, cash adjustments, expense voids, register management, customer edits. Any gap found becomes a fix + regression test in the abuse suite. No new permission keys; gates reuse `SENSITIVE_ACTIONS` and the established role-set pattern.

## 2. Tenant Isolation Audit (FR-TENANT-01/02)

Deliverable: cross-tenant test per entity, added to a new `apps/api/test/abuse.contract.test.ts` where missing. Already covered: products, categories, inventory, sales, shifts, customers (contract tests assert `NOT_FOUND`). To verify/add: refunds (approve/reject another tenant's sale), expenses (read/void), registers (read/open), held sales (hold/resume), receipts, reports (overview with another tenant's session must show zeros, never foreign rows), idempotency keys (same key in two businesses must not collide).

Rule under test: every read/write is scoped from authenticated membership context; a manipulated `businessId`/ID from another tenant yields `NOT_FOUND` (never `FORBIDDEN`-with-data, never data).

## 3. Abuse Suite (PLAN.md 13.3)

New `apps/api/test/abuse.contract.test.ts` (supertest, memory DB) covering each threat case with a named test:

- IDOR via guessed IDs (sale, product, shift, customer, expense, refund target).
- Manipulated tenant IDs in bodies/params.
- Privilege escalation: cashier attempts refund approve, price edit, cost view (redaction, not denial — assert `costMinor` absent/zeroed), settings write, export, user management, shift override, expense void, register create.
- Duplicate payment / double submit (same `Idempotency-Key` twice; mismatched fingerprint with reused key → `IDEMPOTENCY_MISMATCH`).
- Negative quantity/price, zero amounts, huge discounts (override gate), invalid tax, split-total mismatch.
- Expired/revoked session submitting a mutation (401 `SESSION_EXPIRED`/`SESSION_REVOKED`/`TENANT_REQUIRED`).
- Concurrent last-stock sales (exactly one `INSUFFICIENT_STOCK`; ledger == balance) — already covered at service level; assert once over HTTP.
- Unknown-status payment resubmitted with the same key (returns original, no duplicate).
- Refund exceeding refundable quantity; refund on non-COMPLETED sale; self-approval by non-owner.
- Double shift close; close with unresolved state.
- Malicious uploads: attachment/image URL validation (`javascript:` scheme, overlong strings, non-URL strings → `VALIDATION`); oversized JSON bodies rejected (body limit — verify `main.ts` limit during implementation, document the value).
- Unauthorized export access (no `export.run` → `FORBIDDEN`; unauthenticated → 401).

Every test asserts a stable error `code` from the envelope, never just the status.

## 4. Session, Cookie, and Rate-Limit Review (PLAN.md 7)

- Verify `cookieOpts`: `httpOnly` on `pos_session`, `Secure` in production, `SameSite=Lax`, `Path=/`; `pos_csrf` readable by JS by design. Fix gaps; add contract assertions for flags present in test env (httpOnly, SameSite) and Secure-behind-production (assert via unit test on the helper with `NODE_ENV=production`).
- Verify session expiry (30 days), revocation on logout/password change, and re-authentication window behavior with focused tests.
- Rate limits: keep 5/min/IP on login/reset/import; add generous high-threshold limiters (60/min/business [SPEC-DEFAULT]) on `complete`, `reconcile`, `refund-approve`, and `products/import`... import already has 5/min — keep. New limiters must not trip existing contract suites (each suite uses fresh app instances; assert suite still green). Add unit tests for `createRateLimiter` window/reset semantics.
- CSRF: verify every POST/PATCH route carries the guard (audit table doubles as proof); negative test (mutation without token → 403) already exists for auth — extend one negative test per module area (catalog, sales, shifts).

## 5. Security Headers and Transport (PLAN.md 7)

Set headers in `main.ts` without new dependencies: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` minimal (`camera=(), microphone=(), geolocation=()`), HSTS (`max-age=31536000; includeSubDomains`, production only), and a restrictive `Content-Security-Policy` for the API (`default-src 'none'; frame-ancestors 'none'`) [SPEC-DEFAULT values]. Contract test asserts each header on a sample GET. Web (Next.js) gets matching headers via `next.config` `headers()` for app routes. TLS itself is environment-provided (documented, not implemented here).

## 6. Dependency and Upload Review (PLAN.md 7, 14.1)

- Run `pnpm audit` (and `pnpm outdated` for awareness); record output in the audit doc; fix or document every high/critical finding (upgrade, or documented accept-with-reason + follow-up).
- Upload review: the product has no file uploads (attachments/images are URL strings). Verify: no `multipart` handling exists (grep proof), URL validators reject `javascript:`/`data:` schemes and >500 chars (unit tests), JSON body limit documented from `main.ts`. Record verdicts in the audit doc.

## 7. Query Tuning and Index Audit (PLAN.md 12)

- Review every migration's indexes against actual access patterns (tenant + created time/status, barcode, SKU, category, receipt number, idempotency keys). Deliverable: index audit section in the audit doc.
- Add a migration `0008_phase8_indexes` ONLY for indexes justified by the audit with a stated query each (candidates: `Sale(businessId, customerId)`, `Sale(businessId, createdAt)` for history/report scans; verify existing coverage first — do not duplicate). Prove it on live Postgres like prior phases.
- N+1 review: reporting views read per-sale collections in loops — acceptable at v1 scale per the Phase 7 spec, but measure: the load harness (§9) must include the dashboard overview endpoint, and any p95 breach becomes a follow-up (prepared aggregates), not silent acceptance.

## 8. Backup, Restore, and Playbooks (PLAN.md 14.3)

- `scripts/backup.sh` (`pg_dump` custom format, timestamped, against `$DATABASE_URL`) and `scripts/restore.sh` (drop-recreate + `pg_restore` + migration check), POSIX sh for CI/Linux and documented PowerShell equivalents for local Windows dev.
- `docs/superpowers/runbooks/backup-restore.md`: retention (daily 7, weekly 4, monthly 6 [SPEC-DEFAULT]), encryption at rest (provider-managed volume encryption + encrypted offsite copy procedure), access control (owner-only credentials, never in source), restore drill procedure with expected outputs.
- Perform one real drill against a throwaway container (same pattern as migration proofs) and record the transcript in the doc.
- `docs/superpowers/runbooks/incidents.md`: playbooks for payment reconciliation (`PAYMENT_UNKNOWN` triage), inventory drift (rebuild + investigate), failed deploy (migrate-forward + rollback guidance), database restore, credential compromise (revoke-all-sessions + rotate secrets), support-access misuse. Each playbook: symptoms, first 3 commands, escalation, post-incident audit entries to check.
- `docs/superpowers/runbooks/alerts.md`: what to alert on (sustained error-budget breach, payment unknown/failure spikes, DB saturation, failed migrations/backups/restore tests, cross-tenant anomalies) with example thresholds [SPEC-DEFAULT values, marked as starting points].

## 9. Observability Check (PLAN.md 14.2)

- Verify every critical command carries a correlation ID end-to-end (request → service → audit `requestId`); add a contract test asserting the response envelope's `correlationId` echoes a sent `X-Request-Id`.
- Verify structured JSON logs with redaction (no password hashes, tokens, or PII in logs — grep-based test on logger output shape).
- Document the metrics inventory (request latency/error rate, DB latency, auth failures, transaction failures, payment unknown rate, inventory failures, POS sale success) as Prometheus-style metric names in the alerts doc without standing up infrastructure (no new deps/services in Phase 8).

## 10. Performance Budgets and Load Harness (PLAN.md 12, 14.1, 14.4)

- Extend CI to run `pnpm typecheck` (currently missing — the Phase 4 typecheck repair only helps if CI enforces it) and keep all verify scripts green.
- Zero-dependency Node load script `scripts/load/dashboard-mix.mjs` (configurable base URL, concurrency, duration): mixes product search, barcode-equivalent lookup, sale completion (unique idempotency keys), and dashboard overview; reports p50/p95/p99, throughput, error rate, and per-operation budget verdicts against §12 budgets (search p95 < 200 ms, complete p95 < 500 ms excl. providers, dashboard p95 < 1.0 s).
- Run the baseline + growth cohorts locally (1 business, few registers, seeded catalog; then 100 concurrent sessions), record the table in `docs/superpowers/audits/2026-09-23-phase8-performance.md`. Staging measurement procedure documented for whoever holds staging credentials (this repo cannot measure staging itself — stated honestly, not faked).
- Concurrent-deduction + duplicate-payment commands included in the mix (not only reads).

## 11. Playwright E2E (PLAN.md 13.1, 13.2)

- Add `@playwright/test` devDependency, `playwright.config.ts` (chromium, desktop 1440×900 + tablet 820×1180 projects, `webServer` starting web + api against a test database), and `tests/e2e/` specs:
  - `critical-path.spec.ts`: the §13.2 scenario verbatim (business → employee → product → stock → open register → cashier sale → payment → receipt → history/cash/dashboard → close shift → shift report + audit).
  - `roles.spec.ts`: owner/manager/cashier/inventory workflow smoke (login as each, perform one characteristic action, assert permission boundaries in UI).
- Page-object-lite helpers only (no over-abstracted framework). E2E runs against ephemeral test DB with seed; documented `pnpm e2e` command; CI job added (with `if: false`... no — CI runs it with Playwright's official setup action and a Postgres service; if CI minutes are a concern, mark explicitly. Decision: CI runs E2E on pull requests only [SPEC-DEFAULT]).
- Visual verification of dashboard/POS at both breakpoints via the Playwright MCP tools during implementation (screenshots reviewed before sign-off).

## Exit Criteria

1. Abuse suite green in CI; every §13.3 threat case maps to a named test.
2. Authorization + tenant + index audit docs committed with zero open gaps (or dated follow-ups).
3. Headers, cookie flags, rate limits verified by tests; `pnpm audit` recorded with no unaddressed high/critical.
4. Backup/restore scripts + one real drill transcript committed.
5. Incident playbooks + alerts doc committed.
6. Load harness committed with local baseline/growth table; staging procedure documented.
7. Playwright critical-path + role specs green locally and in CI; UI visually verified at desktop/tablet.
8. Full `pnpm test` + `test:exit` + all verify scripts + `pnpm typecheck` green; no migration unless the index audit justifies 0008 (proven live if so).

## Non-Goals (deferred)

Production/staging credentials or infrastructure, managed backup services, APM/metrics infrastructure, WAF, penetration testing by third parties, native apps, multi-branch/offline/billing work (Phases 9-10), AI (deferred patch), new product features of any kind (hardening only — any feature-shaped discovery becomes a dated follow-up, not scope creep).
