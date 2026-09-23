# Phase 7 Dashboard and Reports Design - Online POS

**Date:** 2026-09-23
**Source spec:** `G:\Vscode\PLAN.md` sections 3.1 (MVP reports), 4.6 (FR-ANALYTICS-01..04), 8.4, 8.5, 9.1, 9.2, 12, 17 (Phase 7)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-23-phase6-sales-customers-refunds-expenses-design.md` (all Phase 0-6 read paths reused unchanged; no new tables in Phase 7)

## Goal

Implement PLAN.md 17 Phase 7: overview, sales, product, inventory, payments, cash, customer, and cashier analytics; meaningful comparisons; drill-down; needs-attention panel.

**Exit (PLAN.md 17 verbatim):** owner answers the seven dashboard questions within roughly 10 seconds for a normal dataset.

## Architecture

One new read-only NestJS module following Phase 1-6 conventions exactly:

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma, read-only)
  ReportingModule  live aggregation over existing DbPort list methods (new)
  SalesModule      unchanged (history queries reused by reports)
  InventoryModule  unchanged (balances + movements reused)
  ShiftModule      unchanged (shift close snapshots reused)
```

No new tables, no migrations, no background jobs in Phase 7. Aggregation is computed live per request from bounded ranges (small-business datasets; §12 budget is dashboard initial data p95 < 1.0 s). If a future dataset breaches the budget, the follow-up is prepared aggregates — explicitly not this phase. All endpoints are GET (no CSRF surface beyond session), `SessionGuard` everywhere.

## Settled-Sale Semantics (shared by every view)

Only settled states count toward revenue/profit/order metrics: `COMPLETED`, `PARTIALLY_REFUNDED`, `REFUNDED`. `DRAFT`, `PENDING_PAYMENT`, `PAID` (unfinalized), `PAYMENT_FAILED`, `PAYMENT_UNKNOWN`, `RECONCILED`, and `VOIDED` are excluded. Definitions:

```text
grossSales   = Σ totalMinor over settled sales in range
refundTotal  = Σ APPROVED refund totalMinor in range
netRevenue   = grossSales − refundTotal
orders       = count of settled sales in range
avgOrder     = netRevenue / orders (0 when orders = 0)
lineProfit   = Σ (lineTotalMinor − costMinor × qty) over settled sale lines,
               minus refunded-line cost relief at snapshot cost
discounts    = Σ discountMinor over settled sales in range
```

Timestamps use `Sale.createdAt` (backfilled in Phase 6); ranges are inclusive UTC day boundaries. Every response carries `generatedAt` (ISO 8601 UTC) plus explicit `range` and `compare` echo (FR-ANALYTICS-03).

## Date Ranges and Comparisons (PLAN.md 8.5)

- Presets: today, yesterday, last 7/30/90 days, this/last week, this/last month, custom [SPEC-DEFAULT: default last 30 days; max range 366 days, else `VALIDATION`].
- `compare`: `previous_period` (default), `previous_year`, `none`. Previous period = the immediately preceding equal-length span; previous year = same dates minus one year. Deltas reported as `{ current, previous, deltaMinor, deltaPct }` with `deltaPct: null` when previous is 0. Comparison semantics explained in plain language in each response (`compareLabel`, e.g. "vs previous 30 days").

## Permissions (FR-ANALYTICS-04)

Reuse Phase 1 keys; no new permission keys. The service takes the caller's `role` + `granted` and filters sections:

| Section | Required | Cashier sees |
|---|---|---|
| Revenue/orders/avg | session | yes |
| Gross profit/margin | `cost.view` | omitted (keys absent, never zero-filled) |
| Refunds/discounts totals | session | yes |
| Customer counts/top | session (PII already redacted at source for cashiers) | yes, redacted |
| Cashier/employee view | owner/manager role | `FORBIDDEN` as non-owner/manager |
| Expenses total | session | yes |

KPI cards link to filtered lists (`/sales?status=...`, `/inventory` low-stock view, refunds filter) — widgets are navigation surfaces (FR-ANALYTICS-02).

## API Endpoints

All under `/api/v1`, `SessionGuard`, GET only, query-validated with Zod (`reportsQuerySchema`: `dateFrom`/`dateTo`/`compare`/`registerId?`, same 366-day cap):

```text
GET /api/v1/dashboard/overview?dateFrom&dateTo&compare&registerId
GET /api/v1/reports/sales?dateFrom&dateTo&compare&registerId&granularity=day|hour
GET /api/v1/reports/products?dateFrom&dateTo&tab=top|slow|dead&limit
GET /api/v1/reports/inventory
GET /api/v1/reports/payments?dateFrom&dateTo
GET /api/v1/reports/cash?dateFrom&dateTo
GET /api/v1/reports/customers?dateFrom&dateTo
GET /api/v1/reports/cashiers?dateFrom&dateTo        (owner/manager only)
```

Response shapes:
- **overview**: `{ kpis: { netRevenue, orders, avgOrder, grossProfit|null, refundTotal, discountTotal, expenseTotal, deltas... }, series: [{ bucket, netRevenue, orders }], topProducts: [{ productId, name, qty, revenue }], attention: [{ kind, label, href, count }] }`. KPI count capped at 5 (PLAN.md 8.4).
- **sales**: `{ totals, series }` with `granularity=hour` producing 24 buckets for single-day ranges [SPEC-DEFAULT].
- **products**: rows `{ productId, name, qty, revenue, profit|null, marginPct|null }`; tabs: `top` (by revenue), `slow` (active but zero sales in range), `dead` (no sale in 90 days [SPEC-DEFAULT]); `limit` default 20, cap 100.
- **inventory**: `{ healthy, low, out, untracked, lowStock: [{ productId, name, onHand, reorderLevel }], movements: { received, sold, damaged, adjusted } }` derived from balances + ledger in range.
- **payments**: `{ byMethod: [{ method, total, count }], unknown: count, refunded: total }` over settled payments in range (methods from the Phase 4 config set; unknown-but-pending excluded from totals, counted separately).
- **cash**: `{ shifts: [{ shiftId, registerId, status, expectedCash, countedCash, variance }] }` in range (OPEN shifts show live-expected, counted null).
- **customers**: `{ total, active, top: [{ customerId, name, spend, orders }] }` (top 10 [SPEC-DEFAULT]; names already PII-redacted for cashiers at the customer source).
- **cashiers**: `{ actors: [{ actorId, sales, orders, refunds, refundTotal, discounts, varianceContext }] }` where `varianceContext` aggregates counted-vs-expected from shifts the actor closed. No rankings, no leaderboard copy (PLAN.md 9.2).
- **attention** kinds: `low_stock`, `out_of_stock`, `open_shifts`, `unknown_payments`, `pending_refunds` — each with a deep link (`href`) into the relevant operational list.

New stable codes: none required — reuse `VALIDATION` (bad ranges), `FORBIDDEN` (cashier view), `NOT_FOUND` (n/a). No idempotency (read-only).

## Web UI (PLAN.md 8.4, 8.5, 9.2)

Dashboard-first surfaces reusing Phase 1-6 web patterns (TanStack Query + `apiFetch`, no new dependencies):

- `/` becomes the operational dashboard: 4–5 KPI cards (each a link), one primary sales trend (metric switcher: sales/revenue/orders/profit/avg order — profit hidden without `cost.view`), top-products table, needs-attention panel. Getting-started empty states retained when the business has no sales yet. Date preset + compare pickers with plain-language compare label.
- Charts: hand-rolled accessible SVG (`apps/web/src/lib/charts.tsx`: `TrendChart` line/area, `BarChart` horizontal/vertical) with `role="img"`, `<title>`/`<desc>`, and an adjacent data table carrying the exact numbers (tables decide, charts pattern-match — PLAN.md 8.4). No chart library added: keeps the POS bundle split and §12 budgets intact.
- `/reports/sales|products|inventory|payments|cash|customers|cashiers`: one page per view, each with the same date/compare controls and a drill-down path summary → segment → filtered list → record detail → source transaction (lists link to existing `/sales`, `/sales/[id]`, `/inventory`, `/shifts/[id]`, `/customers/[id]` pages).
- Frontend-design direction: command-center calm — dense but quiet tables, one brand accent reserved for the primary trend, status never color-alone, tabular numerals everywhere, no gradients, motion limited to metric-switch transitions.
- Dashboard customization/drag-reorder is post-MVP (PLAN.md non-goal); ship the strong default layout.

## Audit (PLAN.md 6.7)

Read-only phase: no mutations, no audit rows. Export-gated views reuse the Phase 6 `export.run` permission where CSV download is offered (sales/expenses exports already exist; no new export endpoints in Phase 7).

## Test Strategy

TDD throughout. Vitest unit (settled-state filtering, net/profit math, comparison bucketing, permission section filtering, CSV-free shape tests), memory-DB integration (seeded sales/refunds/expenses/shifts produce exact expected aggregates; empty business returns zeros, never nulls/errors), supertest contract (auth, validation codes, cashier `FORBIDDEN` on cashiers view, profit omission without `cost.view`, cross-tenant isolation via separate businesses), exit test + verify script, CI extended. Fixture discipline: deterministic `createdAt` values (memory DB has no clock control — set explicit dates on created sales).

## Performance Budgets (PLAN.md 12)

Dashboard initial data p95 < 1.0 s for a normal dataset (bounded 366-day scan, single-digit list passes, no N+1: each view reads each collection at most once). Report endpoints same budget. Web: dashboard bundle separate from POS (existing split respected; new chart code ships only in dashboard/report routes).

## Exit Criteria

- Owner loads `/` and answers all seven §8.4 questions (sales total, trend vs comparison, drivers, stock health, register/staff context, risk spots, today's attention) within ~10 s on a normal dataset.
- Every KPI links to a filtered source list; every report drills to record detail.
- Cashier sees revenue/orders but no profit/employee sections; unauthorized roles get `FORBIDDEN` on the cashiers view, never partial data.
- Empty business renders getting-started states, not errors or NaNs.
- No migration (read-only over existing tables); contract tests prove cross-tenant isolation.

## Non-Goals (deferred)

Precomputed materialized aggregates/caching layer (only if measured budgets demand), dashboard customization/drag-reorder (explicit post-MVP non-goal), branches view (Phase 9), accounting exports/period close, AI forecasting/recommendations (deferred patch), new export endpoints, push alerts/notification rules (hardening phase).
