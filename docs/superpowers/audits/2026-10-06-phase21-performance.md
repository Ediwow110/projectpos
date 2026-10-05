# Phase 21 performance and resilience evidence

Date: 2026-10-06

## Harness

`scripts/load/phase21-mix.mjs` accepts `BASE_URL`, `DURATION_SECS`, `CONCURRENCY`, and `OUTPUT_PATH` (plus private `PHASE21_LOAD_EMAIL` / `PHASE21_LOAD_PASSWORD` inputs). It seeds one disposable product, high stock, and a session, then measures product search, barcode lookup, POS completion, receipt download-equivalent completion path, dashboard/report, inventory, procurement, customer, and stored-value lookup operations. Output contains p50/p95/p99, throughput, failure classes, and redacted samples; it never prints credentials or request bodies.

The harness is deliberately opt-in. No staging URL or approved credentials were provided in this worktree, so no production-latency claim is made.

## Deterministic evidence

- `pnpm exec vitest run scripts/load/phase21-mix.test.mjs` — 2/2 passed.
- Percentile behavior is deterministic for empty and populated samples.
- Abort, HTTP 5xx, HTTP 4xx, and transport failures are classified separately.
- Failure samples redact URLs, credentials, and email values.

## Query/index review

The Phase 21 schema changes add only sale-void metadata and an option-value archive flag; neither introduces a new hot-path query. Existing product, barcode, inventory, report, procurement, customer, and stored-value paths retain their current indexes. An `EXPLAIN ANALYZE` run should be performed against the approved staging-sized dataset before changing indexes.

## Resilience procedure

Run the harness against staging with a throwaway owner/session, then separately exercise a transient 503, database reconnect, stale-tab refresh, refresh-after-commit, and duplicate-click scenarios using the existing contract/E2E seams. Record environment, dataset size, release, p50/p95/p99, error rate, and the collector/run timestamp alongside the JSON output.
