# Phase 21 performance and resilience evidence

Date: 2026-10-06

## Harness

`scripts/load/phase21-mix.mjs` accepts `BASE_URL`, `DURATION_SECS`, `CONCURRENCY`, and `OUTPUT_PATH` (plus private `PHASE21_LOAD_EMAIL` / `PHASE21_LOAD_PASSWORD` inputs). It seeds one disposable product, high stock, and a session, then measures product search, barcode lookup, POS completion, receipt download-equivalent completion path, dashboard/report, inventory, procurement, customer, and stored-value lookup operations. Output contains p50/p95/p99, throughput, failure classes, and redacted samples; it never prints credentials or request bodies.

The harness is deliberately opt-in. The approved disposable Render staging stack was provisioned for this run; these numbers are staging measurements and are not a production SLO claim.

## Approved staging measurement

- Environment: disposable Render stack on `codex/phase21-production-hardening`, Oregon free tier, separate PostgreSQL 16 database.
- Run: 2026-10-05T18:30:23Z; 60 seconds; concurrency 10; 1,448 total requests; 0 failures (0.00% error rate); no redacted failure samples.
- Raw output: `2026-10-06-phase21-load-staging.json` in this audit directory.

| Operation | Count | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Product search | 160 | 201 ms | 337 ms | 548 ms |
| Barcode lookup | 160 | 206 ms | 506 ms | 672 ms |
| Reports/dashboard | 161 | 300 ms | 672 ms | 767 ms |
| Inventory movements | 161 | 212 ms | 553 ms | 592 ms |
| Procurement | 161 | 205 ms | 430 ms | 700 ms |
| Customer lookup | 161 | 211 ms | 475 ms | 657 ms |
| Stored value | 161 | 200 ms | 505 ms | 566 ms |
| POS completion | 162 | 765 ms | 1,473 ms | 1,907 ms |
| Receipt path | 161 | 1,039 ms | 1,779 ms | 2,258 ms |

## Deterministic evidence

- `pnpm exec vitest run scripts/load/phase21-mix.test.mjs` — 2/2 passed.
- Percentile behavior is deterministic for empty and populated samples.
- Abort, HTTP 5xx, HTTP 4xx, and transport failures are classified separately.
- Failure samples redact URLs, credentials, and email values.

## Query/index review

The Phase 21 schema changes add only sale-void metadata and an option-value archive flag; neither introduces a new hot-path query. Existing product, barcode, inventory, report, procurement, customer, and stored-value paths retain their current indexes. An `EXPLAIN ANALYZE` run should be performed against the approved staging-sized dataset before changing indexes.

## Resilience procedure

The staging run used a throwaway owner/session and disposable product data. Separately exercise a transient 503, database reconnect, stale-tab refresh, refresh-after-commit, and duplicate-click scenarios using the existing contract/E2E seams. The environment, release, p50/p95/p99, error rate, and collector/run timestamp are recorded above and in the JSON output.
