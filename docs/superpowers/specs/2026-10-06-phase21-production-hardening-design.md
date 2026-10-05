# Phase 21 Production Hardening Design

**Date:** 2026-10-06  
**Baseline:** `origin/main` at `78f0a9cdba7e496f06df22ebd262113854db81a8`  
**Predecessor:** Phase 20 loyalty, gift-card, and store-credit closure  
**Branch:** `codex/phase21-production-hardening`

## Goal

Make NexPOS measurable, failure-resistant, security-reviewed, and maintainable without changing the product domains planned for Phases 22–25. Phase 21 is an additive hardening phase: it closes known correctness debt, proves the existing tenant/branch/idempotency invariants, adds operational evidence, and records dated follow-ups for anything that cannot be proven from this repository.

## Scope boundary

In scope:

- full codebase, schema, migration, API, browser, CI, Render, Supabase/RLS, offline, and dependency audit;
- persistent sale void metadata (`voidedAt`, `voidReason`) and consistent UI copy;
- family-level variant option/dimension editing with safe compatibility rules;
- correlation/request observability, structured redacted logs, critical metrics, and latency baselines;
- security/tenant/branch/idempotency/concurrency regression coverage;
- justified indexes and query/performance evidence;
- backup/restore, rollback, incident, and alert runbooks;
- accessibility and responsive workflow verification.

Out of scope:

- omnichannel orders or public customer ordering;
- accounting journals/AP/P&L;
- workforce scheduling/timekeeping;
- new hardware integrations or a second offline queue;
- managed APM, WAF, third-party penetration testing, or production secret changes;
- silently adding offline support to any operation currently marked online-only.

## Current audit findings

1. `Sale` has no `voidedAt` or `voidReason` columns. `SalesLifecycleService.voidSale()` changes status and appends audit metadata but does not persist the reason on the sale record. This is a correctness and traceability defect.
2. The product-family UI/API can create variants and update family metadata, but does not edit option names or option values after creation. Existing variant combinations must be protected from destructive dimension edits.
3. Correlation IDs, request IDs, metrics, security headers, and audit primitives already exist. Phase 21 must verify their end-to-end behavior and close only measured gaps; it must not replace working infrastructure speculatively.
4. The repository already contains prior Phase 8 security/performance/runbook artifacts. Phase 21 supersedes stale claims with fresh evidence and links dated follow-ups instead of duplicating them.
5. The current checkout contains unrelated user changes. The Phase 21 worktree is based on `origin/main` so those files remain untouched.

## Architecture decisions

### Append-only corrections

Sale void metadata is a nullable additive migration. A void operation sets status, timestamp, and trimmed reason in one authoritative write; it never edits a completed sale, deletes rows, or rewrites financial history. The existing audit event remains, with the same request/correlation ID and approval metadata.

### Safe variant dimensions

Family option names and values are editable only through an explicit management endpoint. Existing option values referenced by variants cannot be deleted or renamed in a way that changes historical meaning. New values may be added; unused values may be archived. A dimension edit is rejected when it would produce duplicate combinations or orphan a stock-bearing variant. The API remains the authority and the UI explains the compatibility rule.

### Observability without sensitive payloads

Request IDs are generated or accepted only within a bounded format, echoed in error envelopes, and carried into audit records. Structured logs contain route, method, status, duration, release SHA, correlation ID, business ID, and classification—not passwords, sessions, bearer codes, secret keys, payment credentials, or raw customer contact data. Metrics remain dependency-free and process-local unless the existing deployment already supplies a collector.

### Evidence-first acceptance

Every workstream has focused tests, a full regression gate, and a production-safe smoke check. A limitation that cannot be proven from this repository is documented with an owner, evidence gap, and date; it is not reported as PASS by assumption.

## Exit contract

Phase 21 is complete only when:

- the two known correctness issues are closed and covered by memory + PostgreSQL + browser tests;
- no unresolved critical/high security finding or cross-tenant/branch leak remains;
- critical mutation paths have idempotency/concurrency evidence;
- latency baselines and budgets are recorded for the defined critical routes;
- structured redacted logs, request/correlation IDs, and critical metrics are observable;
- backup/restore and rollback procedures have a repeatable drill transcript;
- accessibility/responsive smoke covers desktop, tablet, mobile, and keyboard/dialog behavior;
- `verify`, `typecheck`, `lint`, `build`, full unit/API tests, PostgreSQL tests, and Playwright tests are green;
- authenticated production smoke passes without raw secrets or bearer codes;
- a closure report explicitly marks `PHASE 21 COMPLETE: YES` and `READY FOR PHASE 22: YES`.

