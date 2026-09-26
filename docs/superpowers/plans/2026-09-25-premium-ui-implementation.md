# NexPOS Premium UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved premium Figma UI across the existing NexPOS web application while preserving all current business logic, security, offline, payment, reporting, and permission behavior.

**Architecture:** Keep the existing Next.js routes and API hooks, replace the presentation layer through shared theme tokens, a rewritten `AppShell`, upgraded primitives, and shared SVG chart components. Migrate pages in functional groups so each task produces a usable slice without duplicating API logic or introducing fake data.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.6, Tailwind CSS 4, TanStack Query 5, Vitest 3, `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-09-25-premium-ui-implementation-design.md`

## Global Constraints

- Figma file `xr66O7yTaG0bhMhDI2UI7R` is the visual source of truth.
- Preserve existing route structure and API-backed workflows.
- Do not fabricate production metrics to fill a Figma graph.
- Do not expose financial, inventory, customer, employee, or operational metrics before authentication.
- Preserve role-based permissions, payment idempotency, PAYMENT_UNKNOWN, offline queueing, provisional receipts, and reconciliation behavior.
- Use Sora for display, IBM Plex Sans for operational UI, and IBM Plex Mono for data/IDs through `next/font/google`.
- Canonical management colors: `#FCF8F3`, `#F35D3F`, `#FFF0EA`, `#17130F`, `#FFFFFF`, `#EEE4DB`.
- Required final checks: web tests, typecheck, build, and visual inspection of key screens.

## Review Focus

- Unauthenticated access: login renders no business-sensitive figures and authenticated routes still redirect/guide correctly.
- Missing/partial reporting data: graphs render empty/unavailable states rather than fabricated values or crashing.
- Offline POS: queue/provisional receipt behavior remains visibly non-final and payment retry safety is unchanged.
- Permission-restricted cost/profit data: premium cards/tables do not accidentally reveal values hidden by the existing API/role behavior.
- Small screens/reduced motion: shell and POS remain usable without horizontal UI loss, and motion can be reduced.

---

### Task 1: Premium design system, fonts, shell, and primitives

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/ui.tsx`
- Create: `apps/web/src/components/premium.tsx`
- Create: `apps/web/src/components/premium.test.tsx`

**Interfaces:**
- Consumes: existing `AppShell` props `{ children, businessName?, role?, offline?, topbar? }`.
- Produces: premium shell with the same public props; shared `PageHeader`, `MetricCard`, `Panel`, `DataTableFrame`, `DecorativeBackdrop`, and button/status primitives.

- [ ] **Step 1: Write the failing component test**

Create `premium.test.tsx` using `react-dom/server` and Vitest. Render `MetricCard` and `Panel`; assert output contains the premium semantic classes/attributes (`data-ui="metric-card"`, `data-ui="panel"`) and that `StatusPill` renders visible status text in addition to tone classes.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm --filter @pos/web test -- premium.test.tsx`
Expected: FAIL because `premium.tsx` and the premium markers do not exist.

- [ ] **Step 3: Implement fonts and tokens**

Replace Inter-only setup in `layout.tsx` with Sora, IBM Plex Sans, and IBM Plex Mono variables. Rewrite global theme utilities around cream/coral/graphite tokens, focus states, card shadow, money/data typography, reduced motion, and dark POS fields.

- [ ] **Step 4: Implement shared primitives and rewrite `AppShell`**

Keep existing routes and props. Implement floating white sidebar/topbar, peach/coral backdrop shapes, premium mobile navigation, business card, and accessible active navigation. Upgrade `ui.tsx` buttons/cards/pills to the new tokens and add `premium.tsx` composition primitives.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @pos/web test -- premium.test.tsx && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 2: Shared premium chart layer

**Files:**
- Modify: `apps/web/src/lib/charts.tsx`
- Create: `apps/web/src/lib/charts.test.tsx`

**Interfaces:**
- Consumes: numeric API series/rows.
- Produces: `TrendChart`, `VerticalBarChart`, `GroupedBarChart`, `HorizontalBarChart`, `DonutChart`, and `HeatmapChart` with accessible SVG labels.

- [ ] **Step 1: Write failing chart tests**

Render each new chart with `renderToStaticMarkup`. Assert a chart with empty data renders an explicit empty description and does not emit `NaN`; assert donut and grouped bar charts include an accessible `<title>`/`aria-label`.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- charts.test.tsx`
Expected: FAIL because the new chart exports are absent.

- [ ] **Step 3: Implement chart primitives**

Use dependency-free SVG/HTML chart primitives styled by currentColor/CSS variables. Do not add temporary Figma asset references or fake values.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @pos/web test -- charts.test.tsx && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 3: Dashboard premium migration

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/dashboard-view.ts`
- Create: `apps/web/src/lib/dashboard-view.test.ts`

**Interfaces:**
- Consumes: existing `/api/v1/reports/dashboard/overview`, branches, billing, and sync data.
- Produces: deterministic Dashboard view-model helpers for KPI cards, chart points, top products, and attention items.

- [ ] **Step 1: Write failing view-model tests**

Test that missing `grossProfit` stays unavailable rather than becoming a fake zero KPI; test empty series returns an empty chart model; test attention counts preserve API labels/hrefs.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- dashboard-view.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement helpers and page composition**

Recompose the current Dashboard using premium `PageHeader`, four KPI cards, real sales chart, operational health/attention, quick actions, top products, and sync/billing notices. Preserve date/compare/branch filters and current loading/error/empty states.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- dashboard-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 4: POS sell and payment migration

**Files:**
- Modify: `apps/web/src/app/pos/page.tsx`
- Create: `apps/web/src/lib/pos-view.ts`
- Create: `apps/web/src/lib/pos-view.test.ts`

**Interfaces:**
- Consumes: current cart/product/register/customer/payment/offline logic already inside the POS route.
- Produces: presentation helpers for cart totals, payment status copy/tone, and responsive product/card state. No payment API contract changes.

- [ ] **Step 1: Write failing safety/view tests**

Test that `PAYMENT_UNKNOWN` maps to non-success tone/copy, queued offline sales map to provisional/pending copy, and completed sales map to success. Test zero-item cart disables the pay presentation state.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- pos-view.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement premium POS composition**

Keep all existing callbacks, queries, idempotency, queueing, reconciliation, customer/register controls, and receipt links. Replace only layout/classes with the Figma-inspired dark cashier workspace, richer product cards, high-contrast cart rail, focused payment modal, and responsive tablet behavior.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- pos-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 5: Products and Inventory migration

**Files:**
- Modify: `apps/web/src/app/products/page.tsx`
- Modify: `apps/web/src/app/inventory/page.tsx`
- Create: `apps/web/src/lib/inventory-view.ts`
- Create: `apps/web/src/lib/inventory-view.test.ts`

**Interfaces:**
- Consumes: existing catalog/inventory endpoints and permission-shaped responses.
- Produces: inventory health classifications (`healthy`, `low`, `out`) from real stock and reorder values.

- [ ] **Step 1: Write failing inventory classification tests**

Test zero stock → `out`; positive stock at/below reorder → `low`; above reorder → `healthy`; missing cost stays unavailable rather than rendered as `₱0` when not provided.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- inventory-view.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Recompose both pages**

Use premium KPI cards, health/attention panels, filters, and tables. Preserve all CRUD/receive/adjust/transfer actions and current permission checks.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- inventory-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 6: Graph-rich Sales and Reports migration

**Files:**
- Modify: `apps/web/src/app/sales/page.tsx`
- Modify: `apps/web/src/app/reports/sales/page.tsx`
- Modify as needed: `apps/web/src/app/reports/payments/page.tsx`
- Modify as needed: `apps/web/src/app/reports/products/page.tsx`
- Modify as needed: `apps/web/src/app/reports/branches/page.tsx`
- Create: `apps/web/src/lib/report-view.ts`
- Create: `apps/web/src/lib/report-view.test.ts`

**Interfaces:**
- Consumes: current sales/payment/product/branch report endpoints and query-range helpers.
- Produces: graph models derived only from supported report data.

- [ ] **Step 1: Write failing report transformation tests**

Test payment mix percentages from real totals, branch comparison normalization with zero totals, and time-series empty handling. Test unsupported category data returns `null`/unavailable rather than generated sample values.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- report-view.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement graph-rich layout**

Use grouped bars, donut, horizontal bars, heatmap/time buckets, and transaction/report tables only where backed by existing responses. Keep report tabs/routes functional and preserve query parameters/branch scoping.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- report-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 7: Customers and Shifts migration

**Files:**
- Modify: `apps/web/src/app/customers/page.tsx`
- Modify: `apps/web/src/app/shifts/page.tsx`
- Create: `apps/web/src/lib/shift-view.ts`
- Create: `apps/web/src/lib/shift-view.test.ts`

**Interfaces:**
- Consumes: existing customer and shift APIs.
- Produces: shift variance display model that preserves sign and audit meaning.

- [ ] **Step 1: Write failing shift display tests**

Test positive variance → `over`, negative → `short`, zero → `balanced`, and unresolved/open shifts never display as closed.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- shift-view.test.ts`
Expected: FAIL because helper does not exist.

- [ ] **Step 3: Recompose Customers and Shifts**

Apply premium metrics, activity/segment visuals where supported, searchable tables, live-shift panels, close/reconciliation cards, and explicit variance states without changing mutation semantics.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- shift-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 8: Branches, Billing, and Sync & Devices migration

**Files:**
- Modify: `apps/web/src/app/branches/page.tsx`
- Modify: `apps/web/src/app/billing/page.tsx`
- Modify: `apps/web/src/app/sync/page.tsx`
- Modify as needed: `apps/web/src/lib/sync-ui.tsx`
- Create: `apps/web/src/lib/system-view.ts`
- Create: `apps/web/src/lib/system-view.test.ts`

**Interfaces:**
- Consumes: current branch/billing/device/sync APIs and sync-store state.
- Produces: presentational health/status models that do not overstate queued/recovered states.

- [ ] **Step 1: Write failing status-model tests**

Test queued sync → info/pending, retrying → warning, conflict → danger, success → success; billing trial/plan-limit notices preserve existing links/actions.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- system-view.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Recompose pages**

Use premium branch cards/transfers, plan/usage/invoice surfaces, and device/sync status panels. Preserve permission and retry/reconciliation behavior.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- system-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 9: Privacy-first Login and premium Onboarding

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/onboarding/page.tsx`
- Create: `apps/web/src/lib/auth-view.test.ts`

**Interfaces:**
- Consumes: current authentication and onboarding actions only.
- Produces: premium pre-auth composition with no business metrics.

- [ ] **Step 1: Write failing privacy regression test**

Read/render the login module and assert the pre-auth presentation does not contain sample peso totals, sales/order/cash-variance metrics, or the prior example business email. Assert the approved privacy copy is present.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @pos/web test -- auth-view.test.ts`
Expected: FAIL against the current old login presentation.

- [ ] **Step 3: Implement Login and Onboarding**

Rebuild login with the approved privacy-first dark brand panel and premium auth card. Recompose onboarding around the premium stepper and real existing setup actions; do not claim persistence for unsupported fields.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pos/web test -- auth-view.test.ts && pnpm --filter @pos/web typecheck`
Expected: PASS.

### Task 10: Whole-app responsive, accessibility, and build verification

**Files:**
- Modify only files found necessary by verification.

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: verified premium frontend ready for review.

- [ ] **Step 1: Run full web tests**

Run: `pnpm --filter @pos/web test`
Expected: PASS with zero failures.

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm --filter @pos/web typecheck`
Expected: exit 0.

- [ ] **Step 3: Run production build**

Run: `pnpm --filter @pos/web build`
Expected: exit 0.

- [ ] **Step 4: Inspect implementation hygiene**

Run searches confirming no temporary Figma asset URLs are present, no old navy/blue shell classes remain in the migrated shell, and login contains no pre-auth sample business financial metrics.

- [ ] **Step 5: Visual review**

Run the app and inspect Dashboard, POS desktop, POS tablet width, Products, Inventory, Sales, Reports, Customers, Shifts, Login, and Onboarding against the corresponding Figma screenshots. Fix in-scope visual mismatches without altering existing business behavior.

- [ ] **Step 6: Final verification rerun**

Run: `pnpm --filter @pos/web test && pnpm --filter @pos/web typecheck && pnpm --filter @pos/web build`
Expected: all commands succeed.
