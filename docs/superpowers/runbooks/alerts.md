# Alerts and Metrics Inventory

**Date:** 2026-09-23
**Status:** Thresholds below are [SPEC-DEFAULT] starting points for whoever wires alerting infrastructure (no metrics backend is stood up in Phase 8 — names follow Prometheus conventions so they can be adopted verbatim).

## Metric inventory

| Metric | Source | Meaning |
|---|---|---|
| `pos_http_requests_total{route,code}` | API middleware | request volume by route/status |
| `pos_http_request_latency_seconds{route,quantile}` | API middleware | p50/p95/p99 latency per route |
| `pos_auth_failures_total{reason}` | auth controller | login/credential failures |
| `pos_rate_limit_trips_total{route}` | rate limiters | limiter activations per route |
| `pos_sales_total{status}` | sales service | terminal sale states |
| `pos_payments_unknown_total` | sales service | payments entering UNKNOWN |
| `pos_payments_failed_total` | sales service | payments failing |
| `pos_inventory_failures_total{reason}` | inventory service | INSUFFICIENT_STOCK etc. |
| `pos_refunds_total{status}` | refund service | approved/rejected counts |
| `pos_db_latency_seconds{quantile}` | Prisma middleware | DB latency (add with client extensions) |
| `pos_backup_last_success_timestamp` | backup job | freshness of last backup |
| `pos_forbidden_total` | error filter | 403 rate (abuse signal) |

## Alert rules (starting points)

- Sustained 5xx rate > 1% over 5 min (`pos_http_requests_total{code=~"5.."}`).
- `PAYMENT_UNKNOWN` share > 5% of payments over 15 min — reconcile immediately (see incidents runbook).
- `pos_rate_limit_trips_total` spike on login (> 20/min) — credential-stuffing signal (limiter already caps at 5/min/IP).
- `pos_forbidden_total` spike — possible privilege-probing (correlate with audit `FORBIDDEN` entries).
- `pos_backup_last_success_timestamp` older than 26 h — backup failure.
- Failed migration or restore-test failure — page immediately.
- DB saturation: pool wait > 1 s p95 or connection errors > 0.

## Log discipline

- Structured JSON logs; every critical command carries `correlationId` (echoed in error envelopes — locked by `logging.test.ts`).
- Never log: passwords, password hashes, session/CSRF tokens, full customer PII. Use `toSafeLogContext` (`apps/api/src/common/log-context.ts`) for any request-scoped log fields.
# Phase 21 starting alerts

- `Http5xxRateHigh`: 5xx responses >2% for 5 minutes.
- `HttpLatencyHigh`: `pos_http_request_duration_bucket_total{bucket="gte500"}` >5% of requests for 5 minutes.
- `PaymentUnknown`: any sustained `pos_payment_unknown_total` increase or payment outcome `unknown`.
- `DatabaseOrMigrationFailure`: readiness, migration, backup, or reconnect failure.
- `StoredValueOrInventoryError`: sustained rejected/error outcomes for stored value or inventory.
- `CrossTenantAnomaly`: any alert from the tenant-isolation contract/monitoring checks.

Thresholds are starting points and must be calibrated against staging traffic before paging production.
