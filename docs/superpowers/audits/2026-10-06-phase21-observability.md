# Phase 21 observability evidence

Date: 2026-10-06

## Contract

- `x-request-id` is accepted only when it is 1–128 characters and matches the bounded `[A-Za-z0-9._:-]` alphabet. Invalid, oversized, or injection-shaped values are replaced with a generated request ID.
- The API stores the ID on the request and returns it as `X-Request-Id`; error envelopes continue to expose the same `correlationId` field.
- JSON log lines include the correlation ID and optional route/status/duration/outcome fields. Passwords, bearer material, token/cookie/authorization fields, email addresses, and phone-shaped values are redacted before serialization.

## Metrics

The process-local Prometheus-text counters are intentionally dependency-free:

- `pos_http_requests_total{method,route,status}` — completed responses.
- `pos_http_request_errors_total{method,route,status}` — 4xx/5xx responses.
- `pos_http_request_duration_bucket_total{method,route,bucket}` — latency buckets `<100ms`, `<500ms`, and `>=500ms`.
- `pos_{sales,payment,refund,inventory,stored_value}_outcomes_total{outcome}` — success/rejected/error route outcomes for critical domains.
- Existing business counters such as `pos_sales_completed_total`, `pos_payment_unknown_total`, and `pos_inventory_failures_total` remain unchanged.

Labels are sorted, length-bounded, and escaped for text exposition. No request bodies, credentials, bearer codes, or unredacted contact values are labels.

## Alert starting points

Use a 5-minute window in the external collector (if configured): alert on HTTP 5xx rate >2%, request duration bucket `gte500` above 5% of traffic, payment `unknown` outcomes >0, and any sustained inventory/stored-value error outcomes. These are starting thresholds; calibrate against a staging cohort before production paging.

## Evidence

- `pnpm --filter @pos/api exec vitest run src/common/request-id.middleware.test.ts src/common/logger.test.ts src/common/metrics.test.ts` — 5/5 tests passed.
- `pnpm --filter @pos/api typecheck` — passed.
- `pnpm lint` — passed after the observability changes.
