# Phase 8 Performance Measurements

**Date:** 2026-09-23
**Harness:** `scripts/load/dashboard-mix.mjs` (HTTP mode, zero-dep — for staging/live-server runs) and `apps/api/test/load-cohort.test.ts` (in-process cohorts via `createTestApp`, run on demand with `LOAD=1` / `LOAD_GROWTH=1`; no-ops otherwise so `pnpm test` stays fast).

## Method notes (read before comparing numbers)

- In-process cohorts exclude TCP + Postgres: they measure app-stack latency (guards, services, memory DB). Staging numbers will be higher; the staging procedure below reuses `dashboard-mix.mjs` over HTTP.
- Cash completions are paced to ~8/s shared (~480/min, under the 1000/min abuse brake) so the mix measures latency instead of tripping the limiter. Pacing waits are never counted as latency. The brake itself was load-verified: unpaced floods return 429, nothing corrupts.
- Error budget for cohorts: ≤1% (a lone transport `ECONNRESET` under socket churn must not fail an otherwise green cohort).
- A pacing check-then-act race was found and fixed during harness development (mutex-serialized decisions); without it all workers fire together.

## Budgets (PLAN.md §12)

| Operation | Budget (p95) |
|---|---|
| Product search | < 200 ms |
| Sale completion (excl. provider settlement) | < 500 ms |
| Dashboard initial data | < 1000 ms |
| Sales list | < 500 ms (plan-internal guardrail) |

## Baseline cohort (measured 2026-09-23, local Docker host)

1 business, 50 products, 5 concurrent workers, 15 s. 2676 ops, 0 errors.

| Operation | n | p50 | p95 | p99 | Budget | Verdict |
|---|---|---|---|---|---|---|
| search | 1335 | 4.6 ms | 8.1 ms | 13.1 ms | 200 ms | PASS |
| complete | 538 | 9.9 ms | 14.6 ms | 20.4 ms | 500 ms | PASS |
| overview | 531 | 8.7 ms | 25.9 ms | 33.3 ms | 1000 ms | PASS |
| list | 262 | 9.0 ms | 24.4 ms | 28.1 ms | 500 ms | PASS |

## Growth cohort (measured 2026-09-23, local Docker host)

1 business, 500 products, 50 concurrent workers, 60 s. 2492 ops, 1 error (0.04%, transport `ECONNRESET` — harness socket churn, not an app failure; no 5xx observed).

| Operation | n | p50 | p95 | p99 | Budget | Verdict |
|---|---|---|---|---|---|---|
| search | 1219 | 1.6 ms | 8.1 ms | 39.3 ms | 200 ms | PASS |
| complete | 514 | 3.9 ms | 5.9 ms | 7.3 ms | 500 ms | PASS |
| overview | 506 | 4.3 ms | 24.9 ms | 36.6 ms | 1000 ms | PASS |
| list | 252 | 1.4 ms | 23.7 ms | 41.7 ms | 500 ms | PASS |

## Harness limits (honest)

- The 100-concurrent growth shape from PLAN.md §14.4 exceeds what the in-process harness can drive: at 50+ concurrent supertest agents the ephemeral server's socket queue saturates (`ECONNRESET` on writes) independent of app latency. True 100-session growth measurement belongs to staging via `dashboard-mix.mjs`.
- Concurrent-deduction and duplicate-payment commands are covered by the abuse suites (`abuse-payments.contract.test.ts`: concurrent oversell, idempotency replay) rather than the timing mix.

## Staging procedure (for whoever holds staging credentials)

1. `node scripts/load/dashboard-mix.mjs --base https://staging.example.com --email <owner> --password <pw> --concurrency 5 --duration 60 --catalog 50` (baseline).
2. Same with `--concurrency 100 --duration 120 --catalog 500` (growth).
3. Paste both tables here. The script exits non-zero on any budget breach or error rate above 1%.
