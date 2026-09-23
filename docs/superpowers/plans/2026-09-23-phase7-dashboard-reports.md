# Phase 7 Dashboard and Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 7 per `docs/superpowers/specs/2026-09-23-phase7-dashboard-reports-design.md` so an owner answers the seven dashboard questions within roughly 10 seconds for a normal dataset.

**Architecture:** One new read-only NestJS `ReportingModule` following Phase 1-6 conventions: Zod validation at controller edge, `SessionGuard` on all GETs (no mutations, no CSRF surface), `withScope` tenant scoping, no audit rows (reads), memory-DB contract tests via `supertest`. Pure aggregation logic in framework-free functions under `apps/api/src/reports/`. No `DbPort` changes (every needed list method already exists), no migration. Web dashboard replaces `/` with KPI cards + SVG trend + tables; seven report pages share one chart/query helper lib.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma (read-only this phase), Zod 3.23.8, Vitest 2.1.8, supertest, Next.js 15 + React 19 + TanStack Query (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-23-phase7-dashboard-reports-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, no float totals (PLAN.md 6.2).
- Tenant derived server-side from authenticated membership only, never from client tenantId claim (FR-TENANT-01).
- Every read scoped via `withScope`; cross-tenant access returns `NOT_FOUND`/empty-safe scoping (no data leaks).
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC on wire, `X-Request-Id` correlation.
- Settled states only for revenue metrics: `COMPLETED`, `PARTIALLY_REFUNDED`, `REFUNDED`; all other sale states excluded.
- Permission filtering: profit keys omitted (never zero-filled) without `cost.view`; cashiers view is owner/manager-only (`FORBIDDEN` otherwise); customer PII follows existing redaction.
- Date ranges capped at 366 days (`VALIDATION` beyond); default range last 30 days; compare modes `previous_period` (default), `previous_year`, `none`.
- Every response carries `generatedAt` plus explicit `range`/`compare` echo (FR-ANALYTICS-03).
- KPI cards link to filtered source lists (FR-ANALYTICS-02); max 5 KPIs on the overview.
- No new tables, no migrations, no background jobs, no chart library, no dashboard customization.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/validation/src/reports.schema.ts`: `reportsQuerySchema`, `salesReportQuerySchema`, `productsReportQuerySchema` (Task 1).
- `packages/validation/test/reports.schema.test.ts` (Task 1).
- `packages/validation/src/index.ts`: append export (Task 1).
- `apps/api/src/reports/aggregate.ts`: `SETTLED_STATUSES`, `isSettled`, `resolveRange`, `previousRange`, `bucketKey`, `bucketRange`, `delta`, `compareLabel` (Task 2).
- `apps/api/src/reports/reports.test.ts`: domain unit tests (Task 2).
- `apps/api/src/reports/nest/reporting.service.ts` + `reporting.service.test.ts` (Tasks 3-4).
- `apps/api/src/reports/nest/reporting.controller.ts` + `reporting.module.ts` (Task 5).
- `apps/api/src/app.module.ts`: register controller + service (Task 5).
- `apps/api/test/dashboard.contract.test.ts` (Tasks 5-6).
- `apps/web/src/lib/reports.ts` (query builder + formatters) + `apps/web/src/lib/charts.tsx` (TrendChart, BarChart SVG) + `apps/web/test/reports.test.ts` (Task 7).
- `apps/web/src/app/page.tsx`: real dashboard (Task 7).
- `apps/web/src/app/reports/sales/page.tsx`, `products/page.tsx`, `inventory/page.tsx`, `payments/page.tsx`, `cash/page.tsx`, `customers/page.tsx`, `cashiers/page.tsx` (Task 7).
- `tests/phase7-exit.test.ts`, `scripts/verify-phase7.test.mjs`, CI extension (Task 7; exit gate folded into the final task).

### Task 1: Reports query validation contracts

**Files:**
- Create: `packages/validation/src/reports.schema.ts`
- Modify: `packages/validation/src/index.ts` (append `export * from "./reports.schema";`)
- Create: `packages/validation/test/reports.schema.test.ts`

**Interfaces:**
- Consumes: Zod patterns from `sales.schema.ts`/`expenseListSchema`.
- Produces: `COMPARE_MODES`, `reportsQuerySchema`, `salesReportQuerySchema`, `productsReportQuerySchema`. Task 5 controller parses queries with these.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/reports.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { reportsQuerySchema, salesReportQuerySchema, productsReportQuerySchema } from "../src/reports.schema";

describe("phase7 reports schemas", () => {
  it("defaults compare to previous_period", () => {
    expect(reportsQuerySchema.parse({}).compare).toBe("previous_period");
  });
  it("rejects unknown compare mode", () => {
    expect(() => reportsQuerySchema.parse({ compare: "next_year" })).toThrow();
  });
  it("rejects unknown granularity", () => {
    expect(() => salesReportQuerySchema.parse({ granularity: "decade" })).toThrow();
  });
  it("rejects unknown products tab", () => {
    expect(() => productsReportQuerySchema.parse({ tab: "viral" })).toThrow();
  });
  it("caps products limit at 100", () => {
    expect(() => productsReportQuerySchema.parse({ limit: 101 })).toThrow();
    expect(productsReportQuerySchema.parse({}).limit).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/reports.schema.test.ts`
Expected: FAIL with cannot find module `../src/reports.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/reports.schema.ts`:

```ts
import { z } from "zod";

export const COMPARE_MODES = ["previous_period", "previous_year", "none"] as const;

export const reportsQuerySchema = z.object({
  dateFrom: z.string().max(64, "VALIDATION").optional(),
  dateTo: z.string().max(64, "VALIDATION").optional(),
  compare: z.enum(COMPARE_MODES).default("previous_period"),
  registerId: z.string().min(1, "VALIDATION").optional(),
});

export const salesReportQuerySchema = reportsQuerySchema.extend({
  granularity: z.enum(["day", "hour"]).default("day"),
});

export const productsReportQuerySchema = reportsQuerySchema.extend({
  tab: z.enum(["top", "slow", "dead"]).default("top"),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});
```

Append the export to `packages/validation/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (5 new tests plus existing 43).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/reports.schema.ts packages/validation/src/index.ts packages/validation/test/reports.schema.test.ts
git commit -m "feat: add phase7 reports query validation contracts"
```

### Task 2: Reporting domain helpers (ranges, buckets, deltas, settled filter)

**Files:**
- Create: `apps/api/src/reports/aggregate.ts`
- Create: `apps/api/src/reports/reports.test.ts`

**Interfaces:**
- Consumes: Task 1 `COMPARE_MODES` (type-level only).
- Produces: `SETTLED_STATUSES`, `isSettled`, `resolveRange`, `previousRange`, `bucketKey`, `bucketRange`, `delta`, `compareLabel`. Task 3 uses these exact names and signatures.

- [ ] **Step 1: Write the failing domain test**

Create `apps/api/src/reports/reports.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  bucketKey, bucketRange, compareLabel, delta, isSettled, previousRange, resolveRange,
} from "./aggregate";

describe("phase7 reporting domain", () => {
  it("filters to settled states only", () => {
    expect(isSettled("COMPLETED")).toBe(true);
    expect(isSettled("PARTIALLY_REFUNDED")).toBe(true);
    expect(isSettled("REFUNDED")).toBe(true);
    expect(isSettled("VOIDED")).toBe(false);
    expect(isSettled("PAYMENT_UNKNOWN")).toBe(false);
    expect(isSettled("DRAFT")).toBe(false);
  });
  it("defaults to the last 30 days and rejects bad ranges", () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const r = resolveRange(undefined, undefined, now);
    expect(r.to.getTime() - r.from.getTime()).toBe(30 * 24 * 3600 * 1000);
    expect(() => resolveRange("not-a-date", undefined, now)).toThrow("VALIDATION");
    expect(() => resolveRange("2026-09-23T00:00:00.000Z", "2026-09-01T00:00:00.000Z", now)).toThrow("VALIDATION");
    expect(() => resolveRange("2020-01-01T00:00:00.000Z", "2026-09-23T00:00:00.000Z", now)).toThrow("VALIDATION");
  });
  it("computes previous ranges and labels", () => {
    const r = resolveRange("2026-09-01T00:00:00.000Z", "2026-09-11T00:00:00.000Z");
    const prev = previousRange(r, "previous_period")!;
    expect(prev.to.getTime()).toBe(r.from.getTime());
    expect(previousRange(r, "none")).toBeNull();
    expect(compareLabel(r, "previous_period")).toBe("vs previous 10 days");
    expect(compareLabel(r, "none")).toBe("no comparison");
  });
  it("buckets days and hours in UTC", () => {
    expect(bucketKey(new Date("2026-09-05T15:30:00.000Z"), "day")).toBe("2026-09-05");
    expect(bucketKey(new Date("2026-09-05T15:30:00.000Z"), "hour")).toBe("2026-09-05T15");
    expect(bucketRange(new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-03T00:00:00.000Z"), "day"))
      .toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });
  it("computes deltas with null pct on zero base", () => {
    expect(delta(120, 100)).toEqual({ deltaMinor: 20, deltaPct: 20 });
    expect(delta(50, 0)).toEqual({ deltaMinor: 50, deltaPct: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/reports/reports.test.ts`
Expected: FAIL with cannot find module `./aggregate`.

- [ ] **Step 3: Write minimal domain implementation**

Create `apps/api/src/reports/aggregate.ts`:

```ts
export const SETTLED_STATUSES = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export function isSettled(status: string): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 3600 * 1000;
const MAX_RANGE_MS = 366 * DAY_MS;

function parseBound(raw: string | undefined, name: string): Date | null {
  if (raw === undefined) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("VALIDATION");
  void name;
  return d;
}

export function resolveRange(dateFrom?: string, dateTo?: string, now: Date = new Date()): DateRange {
  const to = parseBound(dateTo, "dateTo") ?? now;
  const from = parseBound(dateFrom, "dateFrom") ?? new Date(to.getTime() - 30 * DAY_MS);
  if (from.getTime() > to.getTime()) throw new Error("VALIDATION");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new Error("VALIDATION");
  return { from, to };
}

export function previousRange(range: DateRange, compare: string): DateRange | null {
  if (compare === "none") return null;
  if (compare === "previous_year") {
    const from = new Date(range.from);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    const to = new Date(range.to);
    to.setUTCFullYear(to.getUTCFullYear() - 1);
    return { from, to };
  }
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function bucketKey(d: Date, granularity: "day" | "hour"): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (granularity === "hour") return `${day}T${pad(d.getUTCHours())}`;
  return day;
}

export function bucketRange(from: Date, to: Date, granularity: "day" | "hour"): string[] {
  const step = granularity === "hour" ? 3600 * 1000 : DAY_MS;
  const keys: string[] = [];
  // Align the cursor to the bucket start so partial edge days still emit their bucket.
  const cursor = new Date(from);
  if (granularity === "day") cursor.setUTCHours(0, 0, 0, 0);
  else cursor.setUTCMinutes(0, 0, 0);
  while (cursor.getTime() <= to.getTime()) {
    keys.push(bucketKey(cursor, granularity));
    cursor.setTime(cursor.getTime() + step);
  }
  return keys;
}

export function delta(current: number, previous: number): { deltaMinor: number; deltaPct: number | null } {
  return {
    deltaMinor: current - previous,
    deltaPct: previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 100),
  };
}

export function compareLabel(range: DateRange, compare: string): string {
  if (compare === "none") return "no comparison";
  if (compare === "previous_year") return "vs same dates last year";
  const days = Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS);
  return `vs previous ${days} days`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/reports/reports.test.ts`
Expected: PASS (5 tests; default span exactly 30 days; previous span 10 days for Sep 1→11).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/aggregate.ts apps/api/src/reports/reports.test.ts
git commit -m "feat: add phase7 reporting domain helpers"
```

### Task 3: ReportingService — overview, sales, products

**Files:**
- Create: `apps/api/src/reports/nest/reporting.service.ts`
- Create: `apps/api/src/reports/nest/reporting.service.test.ts` (Task 4 extends it with view tests; Task 3 writes overview/sales/products tests)

**Interfaces:**
- Consumes: Task 2 helpers, `DbPort` list methods (`listSalesByBusiness`, `listSaleItems`, `listPaymentsBySale`, `listRefundsBySale`, `listRefundItemsBySale`, `listProducts`, `listBalances`, `listCustomersByBusiness`, `listExpensesByBusiness`, `findCustomerById`, `findUserById`), `withScope`.
- Produces: `ReportingService` with `getOverview`, `getSalesReport`, `getProductsReport`, `getInventoryReport`, `getPaymentsReport`, `getCashReport`, `getCustomersReport`, `getCashiersReport`. Tasks 4-5 use these exact names.

Service conventions (follow `ShiftService` style: `@Injectable()`, constructor takes `DbPort`, `withScope(businessId, {})` first line):
- All methods take `(businessId, query: { dateFrom?, dateTo?, compare?, registerId?, granularity?, tab?, limit? }, role, granted)` — `getInventoryReport` takes `(businessId)` only (point-in-time; movement summary covers the trailing 30 days from `now`). Permission rule: `granted.includes("cost.view")` gates every profit key (omitted when absent); `getCashiersReport` throws `FORBIDDEN` unless role is `owner`/`manager`.
- Settled-sales loader (private): sales filtered by `isSettled`, optional `registerId`, and `createdAt` within range; previous-range loader reuses it with the previous range. Each collection read at most once per call.
- `getOverview`: KPIs `{ netRevenue, orders, avgOrder, grossProfit|null, refundTotal, discountTotal, expenseTotal }` each with `{ value, previous, deltaMinor, deltaPct }` (profit block omitted entirely without `cost.view`); `series` day buckets `{ bucket, netRevenue, orders }` refilled with zeros for empty buckets; `topProducts` top 5 by revenue `{ productId, name, qty, revenue }` (names from sale-item snapshots — no product-table join needed); `attention` array built from live state: low/out-of-stock counts (balances vs reorderLevel via product rows), open shifts count, UNKNOWN payments count (scan settled+unsettled sales' payments for `UNKNOWN`), pending refunds (sales with status `REFUND_REQUESTED`); each `{ kind, label, href, count }` with hrefs `/inventory`, `/inventory`, `/shifts`, `/sales?status=PAYMENT_UNKNOWN`... note the sales list supports `status` filter already — use `/sales?status=PAYMENT_UNKNOWN` and `/sales?status=REFUND_REQUESTED`. Response adds `generatedAt`, `range: { from, to }`, `compare`, `compareLabel`.
- `getSalesReport`: `{ totals: { netRevenue, orders, avgOrder, grossProfit|null, refundTotal, discountTotal }, series }` with granularity buckets (hour only meaningful for ≤2-day ranges — still computed regardless, no error).
- `getProductsReport`: per-product `{ productId, name, qty, revenue, profit|null, marginPct|null }` (`marginPct = round(profit/revenue*100)`, null when revenue 0 or no cost.view); tabs: `top` sort revenue desc; `slow` = `isActive` products with zero qty in range (revenue 0, sorted by name); `dead` = products with no sale in trailing 90 days (computed from all-time settled items, not just range) [SPEC-DEFAULT per spec]; `limit` slices after sorting.
- Profit math: per settled sale line `lineTotalMinor − costMinor × qty`, minus refund relief: for each approved refund item on the sale, `costMinor (line snapshot) × refunded qty`. Untracked lines still carry cost snapshots — included identically (cost data exists on the snapshot regardless of tracking).

- [ ] **Step 1: Write the failing service tests**

Create `apps/api/src/reports/nest/reporting.service.test.ts` with a seeding helper (explicit `createdAt` via `db.updateSale` backdate pattern — memory `updateSale` accepts any `DbSale` patch field including `createdAt`):

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ReportingService } from "./reporting.service";
import { SalesService } from "../../sales/nest/sales.service";
import { RefundService } from "../../refunds/nest/refund.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setupReports() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 100 });
  const sales = new SalesService(db);
  const mk = async (day: string, qty: number, key: string) => {
    const draft = await sales.createDraft("b1", "u1", "r1", {
      lines: [{ productId: prod.id, qty, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await sales.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key, granted: ALL,
    });
    await db.updateSale(draft.id, "b1", { createdAt: new Date(day) });
    return draft.id;
  };
  await mk("2026-09-10T10:00:00.000Z", 2, "rep-k1");
  await mk("2026-09-20T10:00:00.000Z", 1, "rep-k2");
  return { db, svc: new ReportingService(db), productId: prod.id };
}

describe("phase7 reporting overview", () => {
  it("computes KPIs and deltas for a fixed range", async () => {
    const { svc } = await setupReports();
    const out = await svc.getOverview("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none",
    }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(7500);
    expect(out.kpis.orders.value).toBe(2);
    expect(out.kpis.grossProfit!.value).toBe(4500);
    expect(out.topProducts[0].qty).toBe(3);
    expect(out.generatedAt).toBeTruthy();
  });
  it("omits profit without cost.view and compares against previous period", async () => {
    const { svc } = await setupReports();
    const out = await svc.getOverview("b1", {
      dateFrom: "2026-09-15T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "previous_period",
    }, "cashier", []);
    expect(out.kpis.grossProfit).toBeUndefined();
    expect(out.kpis.netRevenue.value).toBe(2500);
    expect(out.kpis.netRevenue.previous).toBe(5000);
    expect(out.compareLabel).toBe("vs previous 15 days");
  });
  it("blocks cross-tenant reads", async () => {
    const { svc } = await setupReports();
    await expect(svc.getOverview("b2", {}, "owner", ALL)).rejects.toThrow();
  });
});

describe("phase7 sales and products reports", () => {
  it("buckets revenue by day", async () => {
    const { svc } = await setupReports();
    const out = await svc.getSalesReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none", granularity: "day",
    }, "owner", ALL);
    const buckets = Object.fromEntries(out.series.map((s) => [s.bucket, s.netRevenue]));
    expect(buckets["2026-09-10"]).toBe(5000);
    expect(buckets["2026-09-20"]).toBe(2500);
    expect(buckets["2026-09-15"]).toBe(0);
  });
  it("ranks top products with margin", async () => {
    const { svc } = await setupReports();
    const out = await svc.getProductsReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none", tab: "top", limit: 20,
    }, "owner", ALL);
    expect(out.rows[0]).toMatchObject({ qty: 3, revenue: 7500, profit: 4500, marginPct: 60 });
  });
});
```

(Math checks: sale1 2×2500 = 5000, profit (2500−1000)×2 = 3000; sale2 1×2500 = 2500, profit 1500. Totals: revenue 7500, profit 4500, margin 4500/7500 = 60%. Sep 15→30 window holds only sale2 (2500); previous 15-day span holds sale1 (5000).)

The Step 1 file also includes this isolation test (`withScope` returns zeros for unknown tenants — assert no leakage, not a throw):

```ts
  it("isolates tenants (no cross-tenant leakage)", async () => {
    const { svc } = await setupReports();
    const out = await svc.getOverview("b2", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none",
    }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(0);
    expect(out.topProducts).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/reports/nest/reporting.service.test.ts`
Expected: FAIL with cannot find module `./reporting.service`.

- [ ] **Step 3: Write minimal service implementation (overview/sales/products only; Task 4 adds the rest)**

Create `apps/api/src/reports/nest/reporting.service.ts` with the `ReportingService` class implementing `getOverview`, `getSalesReport`, `getProductsReport` per the conventions above. Private helpers: `settledSales(businessId, range, registerId?)`, `saleLines(saleIds)` (single pass: `listSaleItems` per settled sale in range), `refundsFor(saleIds)` (via `listRefundItemsBySale` per sale... prefer one `listRefundsBySale` per sale then items per refund — bounded by settled count), `profitFor(...)`, `attentionFor(businessId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/reports/nest/reporting.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/nest/reporting.service.ts apps/api/src/reports/nest/reporting.service.test.ts
git commit -m "feat: add phase7 reporting service overview sales products"
```

### Task 4: ReportingService — inventory, payments, cash, customers, cashiers views

**Files:**
- Modify: `apps/api/src/reports/nest/reporting.service.ts` (append view methods)
- Modify: `apps/api/src/reports/nest/reporting.service.test.ts` (append view tests)

**Interfaces:**
- Consumes: Task 3 service skeleton + Task 2 helpers + `sumCashComponents` from `../../shifts/cash` (already exists — reuse, do not duplicate).
- Produces: `getInventoryReport`, `getPaymentsReport`, `getCashReport`, `getCustomersReport`, `getCashiersReport`. Task 5 controller calls these exact methods.

View rules (every view response also carries `generatedAt`, `range: { from, to }`, `compare`, `compareLabel`):
- `getInventoryReport(businessId)`: `{ healthy, low, out, untracked, lowStock: [{ productId, name, onHand, reorderLevel }], movements: { received, sold, damaged, adjusted } }` — health from `deriveStockStatus` (missing balance row counts as 0 on hand); movement sums are all-time ledger sums per type group (`DbMovement` carries no timestamp, so no date filtering is possible — documented here, not a bug); `lowStock` sorted by name, capped at 50.
- `getPaymentsReport(businessId, { from, to, registerId? })`: scan settled sales in range → `listPaymentsBySale` per sale → `{ byMethod: [{ method, total, count }], unknown: <count of UNKNOWN payments on any sale in range>, refunded: <sum of REFUNDED rows> }`. Methods sorted by total desc.
- `getCashReport(businessId, { from, to, registerId? })`: shifts from `listShiftsByBusiness` — `DbShift` carries no timestamp fields (verified in `db.port.ts`), so no date filtering is applied; `registerId` filters; newest-first capped at 100 with a code comment stating date scoping arrives with a future `openedAt` column (no migration in this read-only phase). Each: `{ shiftId, registerId, status, expectedCash, countedCash, variance }` — OPEN shifts compute live expected via `sumCashComponents` over `listCashMovementsByShift` + opening float; CLOSED use persisted snapshots. **Verify `DbShift` fields before writing** (grep for `openedAt|closedAt` in `db.port.ts`); adjust to whatever exists.
- `getCustomersReport(businessId, query: { dateFrom?, dateTo?, compare? }, role)`: `{ total, active, top }` (range resolved inside via `resolveRange`) — counts from `listCustomersByBusiness`; top 10 spenders from settled sales with `customerId` in range (name via `findCustomerById`, fallback to sale `customerName` snapshot, fallback `"Walk-in"`); cashier role gets names only (no phone/email — the service never includes PII fields in this view at all: return `{ customerId, name, spend, orders }` for every role).
- `getCashiersReport(businessId, { from, to }, role)`: non-owner/manager → `FORBIDDEN`. Per `actorId` (from settled sales): `{ actorId, name (via findUserById, fallback actorId), sales (net revenue), orders, refunds (approved count), refundTotal, discounts }`; `varianceContext` from shifts the actor closed (`closedBy === actorId`): `{ shiftsClosed, totalVariance }`. No ranking keys, no leaderboard copy.

- [ ] **Step 1: Write the failing view tests**

Append to `apps/api/src/reports/nest/reporting.service.test.ts`:

```ts
describe("phase7 inventory payments cash customers cashiers", () => {
  it("reports inventory health and low stock", async () => {
    const { svc, productId } = await setupReports();
    const out = await svc.getInventoryReport("b1");
    expect(out.low).toBe(0);
    expect(out.out).toBe(0);
    expect(out.healthy).toBe(1);
    expect(out.movements.sold).toBe(3);
  });
  it("breaks payments down by method", async () => {
    const { svc } = await setupReports();
    const out = await svc.getPaymentsReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner", ALL);
    expect(out.byMethod).toEqual([{ method: "cash", total: 7500, count: 2 }]);
    expect(out.unknown).toBe(0);
  });
  it("tops customers by spend without PII", async () => {
    const { db, svc } = await setupReports();
    const cust = await db.createCustomer({
      businessId: "b1", name: "Ana", phone: "0917", email: null,
      address: null, notes: null, isActive: true,
    });
    const draft = await new SalesService(db).createDraft("b1", "u1", "rx", {
      lines: [{ productId: (await db.listProducts("b1"))[0].id, qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0, customerId: cust.id,
    }, ALL);
    await new SalesService(db).completeSale("b1", "u1", "ry", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "top-cust-1", granted: ALL,
    });
    await db.updateSale(draft.id, "b1", { createdAt: new Date("2026-09-21T10:00:00.000Z") });
    const out = await svc.getCustomersReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "cashier");
    expect(out.total).toBe(1);
    expect(out.top[0]).toMatchObject({ name: "Ana", spend: 2500, orders: 1 });
    expect(out.top[0]).not.toHaveProperty("phone");
  });
  it("forbids the cashiers view for non-managers", async () => {
    const { svc } = await setupReports();
    await expect(svc.getCashiersReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "cashier")).rejects.toThrow("FORBIDDEN");
    const out = await svc.getCashiersReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner");
    expect(out.actors[0]).toMatchObject({ sales: 7500, orders: 2 });
  });
});
```

(Health check: balance after setup sells 3 from 100 → 97, reorderLevel 5 → healthy ✓. `movements.sold` counts sale qtyDelta abs in trailing 30d — memory has no clock control; movements created "now" (real now, 2026-09-23+) within trailing 30d of real now ✓. Careful: this couples the test to the real clock — movements with real-now timestamps always fall in trailing-30d. Acceptable and stable.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/reports/nest/reporting.service.test.ts`
Expected: FAIL — `svc.getInventoryReport is not a function`.

- [ ] **Step 3: Write minimal view implementations**

Append the five methods per the View rules above. Reuse `deriveStockStatus` and `sumCashComponents` via imports (no duplication).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/reports/nest/reporting.service.test.ts`
Expected: PASS (5 + 4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/nest/reporting.service.ts apps/api/src/reports/nest/reporting.service.test.ts
git commit -m "feat: add phase7 reporting inventory payments cash customers cashiers"
```

### Task 5: Reporting HTTP layer

**Files:**
- Create: `apps/api/src/reports/nest/reporting.controller.ts`
- Create: `apps/api/src/reports/nest/reporting.module.ts`
- Modify: `apps/api/src/app.module.ts` (register controller + service in `@Module` and `createTestApp`)
- Create: `apps/api/test/dashboard.contract.test.ts`

**Interfaces:**
- Consumes: Tasks 3-4 service, Task 1 Zod schemas, guard/`fail`/`statusFor`/`rid` patterns.
- Produces: routes `GET /api/v1/dashboard/overview`, `GET /api/v1/reports/sales|products|inventory|payments|cash|customers|cashiers`. Task 6 tests edges over these routes.

Controller rules: `SessionGuard` class-level (no `CsrfGuard` — GET only); each handler parses its Zod schema (`reportsQuerySchema` default; sales/products variants), passes `businessId`, parsed query, `auth.role`, and `rolePermissions`; service throws map via `statusFor`; explicit `res.status(200).json(...)`. Cashiers handler needs no extra gate (service throws `FORBIDDEN`).

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/test/dashboard.contract.test.ts` (file-scoped `jar()` fixtures; register owner, create product, stock 50, two cash sales on distinct fixed dates via... contract tests cannot backdate (no API for it) — sales land on real-now, so the test uses a wide range covering now):

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

// Rolling 30-day window: contract sales land on real-now, which must fall
// inside the queried range while staying under the 366-day cap.
const SINCE = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

async function makeSale(key: string, qty: number): Promise<void> {
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty }] });
  await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key)
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-dash@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
  await makeSale("dash-k1", 2);
  await makeSale("dash-k2", 1);
});

afterAll(async () => { await app.close(); });

describe("phase7 dashboard HTTP contract", () => {
  it("returns overview KPIs with comparison and attention", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/overview?dateFrom=${SINCE}&compare=none`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.kpis.netRevenue.value).toBe(7500);
    expect(res.body.kpis.grossProfit.value).toBe(4500);
    expect(res.body.topProducts[0].qty).toBe(3);
    expect(res.body.generatedAt).toBeTruthy();
    expect(Array.isArray(res.body.attention)).toBe(true);
  });

  it("omits profit for cashier-role reads (unit: permission filter)", async () => {
    const { ReportingService } = await import("../src/reports/nest/reporting.service");
    const { createMemoryDb } = await import("../src/common/memory.db");
    const svc = new ReportingService(createMemoryDb());
    const out = await svc.getOverview("b1", { compare: "none" }, "cashier", []);
    expect(out.kpis.grossProfit).toBeUndefined();
  });

  it("serves sales series and product rankings", async () => {
    const sales = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales?dateFrom=${SINCE}&compare=none&granularity=day`)
      .set("Cookie", cookie);
    expect(sales.status).toBe(200);
    expect(sales.body.totals.netRevenue).toBe(7500);
    const products = await request(app.getHttpServer())
      .get(`/api/v1/reports/products?dateFrom=${SINCE}&compare=none&tab=top`)
      .set("Cookie", cookie);
    expect(products.body.rows[0]).toMatchObject({ qty: 3, revenue: 7500 });
  });

  it("rejects unauthenticated overview with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/dashboard/overview");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/dashboard.contract.test.ts`
Expected: FAIL — 500 on `/api/v1/dashboard/overview` (no route yet; this stack's `@Catch()` filter maps unknown routes to 500).

- [ ] **Step 3: Write minimal controller + module + wiring**

Implement per the Controller rules above, mirroring `shift.controller.ts` structure. Wire into `app.module.ts` `@Module` and `createTestApp` factory (service factory pattern). No new error codes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- test/dashboard.contract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/nest/reporting.controller.ts apps/api/src/reports/nest/reporting.module.ts apps/api/src/app.module.ts apps/api/test/dashboard.contract.test.ts
git commit -m "feat: add phase7 reporting http layer"
```

### Task 6: Reporting edge coverage (cashiers gate, inventory/payments/cash/customers routes, bad ranges)

**Files:**
- Modify: `apps/api/test/dashboard.contract.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 5 routes.
- Produces: proof of cashier-view gating, remaining views over HTTP, `VALIDATION` on bad ranges.

- [ ] **Step 1: Write the failing coverage tests**

Append (file-scoped fixtures shared; `SINCE` rolling constant shared):

```ts
describe("phase7 reporting edges", () => {
  it("serves inventory, payments, cash, and customers views", async () => {
    for (const path of [
      "/api/v1/reports/inventory",
      `/api/v1/reports/payments?dateFrom=${SINCE}&compare=none`,
      `/api/v1/reports/cash?dateFrom=${SINCE}&compare=none`,
      `/api/v1/reports/customers?dateFrom=${SINCE}&compare=none`,
    ]) {
      const res = await request(app.getHttpServer()).get(path).set("Cookie", cookie);
      expect(res.status).toBe(200);
    }
    const inv = await request(app.getHttpServer()).get("/api/v1/reports/inventory").set("Cookie", cookie);
    expect(inv.body.healthy).toBe(1);
    const pay = await request(app.getHttpServer())
      .get(`/api/v1/reports/payments?dateFrom=${SINCE}&compare=none`).set("Cookie", cookie);
    expect(pay.body.byMethod).toEqual([{ method: "cash", total: 7500, count: 2 }]);
  });

  it("rejects over-wide ranges with VALIDATION", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/reports/sales?dateFrom=2020-01-01T00:00:00.000Z&dateTo=2026-09-23T00:00:00.000Z&compare=none")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("rejects unauthenticated cashiers view with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/reports/cashiers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("serves the cashiers view to the owner", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/cashiers?dateFrom=${SINCE}&compare=none`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.actors[0]).toMatchObject({ orders: 2, sales: 7500 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/dashboard.contract.test.ts`
Expected: FAIL — cashiers/inventory/payments routes or over-wide range handling mismatch (fix to match).

- [ ] **Step 3: Write minimal fix**

Shape/logic fix only: ensure all eight routes exist, over-366-day ranges map to 400 `VALIDATION`, cashiers gate enforced in service.

- [ ] **Step 4: Run full API suite to verify nothing regressed, then commit**

Run: `pnpm --filter @pos/api test`
Expected: PASS (full suite).

```bash
git add apps/api/test/dashboard.contract.test.ts apps/api/src/reports/nest/reporting.controller.ts apps/api/src/reports/nest/reporting.service.ts
git commit -m "test: add phase7 reporting edge coverage"
```

### Task 7: Dashboard + reports web UI and exit gate (uses frontend-design)

**Files:**
- Create: `apps/web/src/lib/reports.ts`, `apps/web/src/lib/charts.tsx`
- Create: `apps/web/test/reports.test.ts`
- Modify: `apps/web/src/app/page.tsx` (real dashboard; keep getting-started empty states)
- Create: `apps/web/src/app/reports/sales/page.tsx`, `products/page.tsx`, `inventory/page.tsx`, `payments/page.tsx`, `cash/page.tsx`, `customers/page.tsx`, `cashiers/page.tsx`
- Create: `tests/phase7-exit.test.ts`
- Create: `scripts/verify-phase7.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase7 line via `Add-Content`, never a full rewrite — file is CRLF)

**Interfaces:**
- Consumes: Task 5-6 routes via `apiFetch`; role from `GET /api/v1/me`.
- Produces: dashboard + seven report pages; Phase 7 exit proof.

Design (frontend-design skill): command-center calm — dense quiet tables, one brand accent on the primary trend, tabular numerals, text+shape states, no gradients, motion limited to metric-switch transitions. Signature element: KPI cards as navigation surfaces with delta arrows expressed in words+numbers ("▲ 20% vs previous 30 days" needs a non-color cue — use ▲/▼ glyphs plus text, never color alone).

Web rules: `"use client"` + TanStack Query; date preset + compare pickers with plain-language label; metric switcher sales/revenue/orders/profit/avg (profit hidden without `cost.view` — the overview payload omits the key, so the switcher derives availability from payload presence); every chart adjacent to its data table; drill-down links to existing list/detail pages.

- [ ] **Step 1: Write the failing web test**

Create `apps/web/test/reports.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("phase7 reports web helpers", () => {
  it("builds an overview query string with defaults", async () => {
    const { buildOverviewQuery } = await import("../src/lib/reports");
    expect(buildOverviewQuery({})).toBe("/api/v1/dashboard/overview?compare=previous_period");
    expect(buildOverviewQuery({ dateFrom: "2026-09-01", compare: "none" })).toBe(
      "/api/v1/dashboard/overview?dateFrom=2026-09-01&compare=none",
    );
  });
  it("formats deltas in words and numbers", async () => {
    const { formatDelta } = await import("../src/lib/reports");
    expect(formatDelta({ deltaMinor: 2000, deltaPct: 20 }, "vs previous 30 days")).toBe(
      "▲ 20.00 (▲ 20%) vs previous 30 days",
    );
    expect(formatDelta({ deltaMinor: -500, deltaPct: null }, "no comparison")).toBe(
      "▼ 5.00 (n/a) no comparison",
    );
  });
  it("hides profit metrics without the key", async () => {
    const { availableMetrics } = await import("../src/lib/reports");
    expect(availableMetrics({ netRevenue: {}, orders: {} })).toEqual(["revenue", "orders", "avg"]);
    expect(availableMetrics({ netRevenue: {}, orders: {}, grossProfit: {} })).toContain("profit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test -- test/reports.test.ts`
Expected: FAIL with cannot find module `../src/lib/reports`.

- [ ] **Step 3: Write minimal lib + charts + pages**

Create `apps/web/src/lib/reports.ts`:

```ts
export function buildOverviewQuery(params: {
  dateFrom?: string;
  dateTo?: string;
  compare?: string;
  registerId?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  sp.set("compare", params.compare ?? "previous_period");
  if (params.registerId) sp.set("registerId", params.registerId);
  return `/api/v1/dashboard/overview?${sp.toString()}`;
}

export function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function formatDelta(
  d: { deltaMinor: number; deltaPct: number | null },
  label: string,
): string {
  const arrow = d.deltaMinor >= 0 ? "▲" : "▼";
  const pct = d.deltaPct === null ? "n/a" : `${arrow} ${d.deltaPct}%`;
  return `${arrow} ${money(Math.abs(d.deltaMinor))} (${pct}) ${label}`;
}

export function availableMetrics(kpis: Record<string, unknown>): string[] {
  const out = ["revenue", "orders", "avg"];
  if ("grossProfit" in kpis) out.push("profit");
  return out;
}
```

Create `apps/web/src/lib/charts.tsx` with `TrendChart({ points, width?, height? })` (SVG polyline + area fill + `<title>`/`<desc>`, zero-line handling when all values are 0) and `BarChart({ bars })` (horizontal SVG bars with value labels). Purely presentational; tested indirectly through page typecheck (unit tests cover only `reports.ts`).

Dashboard `/page.tsx`: preserve the `meQuery` + sign-in gate; when sales exist show KPI cards (links), metric-switcher trend, top-products table, attention panel; when the overview reports zero orders AND zero products, show the existing getting-started section instead. Date preset select (today/yesterday/last 7/30/90 days/custom via date inputs) + compare select; pass ISO strings to `buildOverviewQuery`.

Seven report pages mirror the dashboard query controls and render their endpoint payloads with charts + tables + drill-down links. Cashiers page: render `FORBIDDEN` message when the API returns 403 (role-hint the link only for owner/manager, server authoritative).

- [ ] **Step 4: Write the failing exit test, then verify it passes**

Create `tests/phase7-exit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSettled } from "../apps/api/src/reports/aggregate";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { ReportingService } from "../apps/api/src/reports/nest/reporting.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setup() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 50 });
  await db.createProduct({
    businessId: "b1", categoryId: null, name: "Pepsi", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 900, priceMinor: 2400, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  const sales = new SalesService(db);
  const draft = await sales.createDraft("b1", "u1", "r1", {
    lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
  }, ALL);
  await sales.completeSale("b1", "u1", "r2", draft.id, {
    payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit7-1", granted: ALL,
  });
  await db.updateSale(draft.id, "b1", { createdAt: new Date("2026-09-10T10:00:00.000Z") });
  return { db, svc: new ReportingService(db) };
}

describe("phase7 exit", () => {
  it("owner dashboard answers from source records", async () => {
    const { svc } = await setup();
    const out = await svc.getOverview("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(5000);
    expect(out.kpis.grossProfit!.value).toBe(3000);
    expect(out.topProducts).toHaveLength(1);
    expect(out.attention.some((a) => a.kind === "out_of_stock")).toBe(true);
  });
  it("settled filter excludes drafts and voids", () => {
    expect(isSettled("COMPLETED")).toBe(true);
    expect(isSettled("DRAFT")).toBe(false);
    expect(isSettled("VOIDED")).toBe(false);
  });
  it("cashier gets no profit and no cashiers view", async () => {
    const { svc } = await setup();
    const out = await svc.getOverview("b1", { compare: "none" }, "cashier", []);
    expect(out.kpis.grossProfit).toBeUndefined();
    await expect(svc.getCashiersReport("b1", { compare: "none" }, "cashier")).rejects.toThrow("FORBIDDEN");
  });
  it("empty business returns zeros, never errors", async () => {
    const svc = new ReportingService(createMemoryDb());
    const out = await svc.getOverview("b9", { compare: "none" }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(0);
    expect(out.topProducts).toEqual([]);
  });
});
```

Run: `pnpm test:exit`
Expected: FAIL with cannot find module `../apps/api/src/reports/aggregate` (until Tasks 2-4 land; passes when executed in order).

- [ ] **Step 5: Write minimal verification script + wire CI + run full verification**

Create `scripts/verify-phase7.test.mjs`:

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/validation/src/reports.schema.ts"),
  existsSync("apps/api/src/reports/aggregate.ts"),
  existsSync("apps/api/src/reports/nest/reporting.service.ts"),
  existsSync("apps/api/src/reports/nest/reporting.controller.ts"),
  existsSync("apps/api/src/reports/nest/reporting.module.ts"),
  existsSync("apps/api/test/dashboard.contract.test.ts"),
  existsSync("apps/web/src/lib/reports.ts"),
  existsSync("apps/web/src/lib/charts.tsx"),
  existsSync("apps/web/src/app/reports/sales/page.tsx"),
  existsSync("apps/web/src/app/reports/cashiers/page.tsx"),
  existsSync("tests/phase7-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE7_OK");
} else {
  console.error("PHASE7_MISSING");
  process.exit(1);
}
```

Append to `.github/workflows/ci.yml` via `Add-Content` (byte-append, CRLF-safe):

```powershell
Add-Content -LiteralPath ".github/workflows/ci.yml" -Value "      - run: node scripts/verify-phase7.test.mjs"
```

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase7.test.mjs && pnpm typecheck`
Expected: all green + `PHASE7_OK`. (`pnpm lint` runs no tasks in this repo — turbo reports "No tasks were executed" — nothing to satisfy there.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/reports.ts apps/web/src/lib/charts.tsx apps/web/test/reports.test.ts apps/web/src/app/page.tsx apps/web/src/app/reports/sales/page.tsx apps/web/src/app/reports/products/page.tsx apps/web/src/app/reports/inventory/page.tsx apps/web/src/app/reports/payments/page.tsx apps/web/src/app/reports/cash/page.tsx apps/web/src/app/reports/customers/page.tsx apps/web/src/app/reports/cashiers/page.tsx tests/phase7-exit.test.ts scripts/verify-phase7.test.mjs .github/workflows/ci.yml
git commit -m "feat: add phase7 dashboard reports web ui and exit gate"
```

Note: this task bundles web UI + exit gate (unlike prior phases that split them) because the exit test needs no web artifacts beyond file existence, and the web pages are the last code change — keep the commit only after `pnpm test`, `test:exit`, verify script, and `tsc --noEmit` for `@pos/web` all pass. Run web typecheck explicitly: `pnpm --filter @pos/web exec tsc --noEmit`.
