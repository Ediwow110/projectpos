# Phase 16 Procurement Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppliers, product-supplier mappings, and draft→ordered→cancelled purchase orders with tenant/branch/RBAC, idempotency, optimistic concurrency, audit, and full UI — with zero inventory mutation.

**Architecture:** New `procurement` API domain following the transfers/expenses stack (zod in `@pos/validation`, raw-SQL pg family + memory store behind `DbPort`, inline `rolePermissions` checks, `SaleIdempotency` claims, `POCounter` numbering, `version` CAS). New web routes `/suppliers*`, `/purchase-orders*` under a "Procurement" nav group.

**Tech Stack:** NestJS 11 + Express, raw `pg`, zod, vitest + supertest, Next.js 15 App Router + react-query + Tailwind, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-phase16-procurement-design.md`

## Global Constraints

- Load-bearing rule: NO writes to InventoryBalance/InventoryMovement/CashMovement/Payment/Sale/Expense/Shift/Product stock from any procurement path.
- Migration `0028_procurement` only, additive, forward-only; RLS enabled on all new tables; no policies, no grants.
- Money: `*Minor` integers; qty int > 0; server-derived totals; never trust client totals.
- Statuses: exactly `DRAFT | ORDERED | CANCELLED`. No PARTIALLY_RECEIVED/RECEIVED.
- Tenant: every query `(id, businessId)`; cross-tenant → `NOT_FOUND`.
- Permissions: `supplier.write`, `purchase_order.write`, `purchase_order.order`, `purchase_order.cancel`; owner/manager/inventory only; cashier filtered out in `ROLE_SEED.cashier`.
- Idempotency commands: `supplier.create`, `purchase_order.create`, `purchase_order.order`, `purchase_order.cancel` (header `Idempotency-Key`).
- Concurrency: PO `version` + `expectedVersion` → `STALE_VERSION` 409.
- PO number: `PO-<UTC year>-<6-digit seq>`, unique per business, `POCounter` atomic upsert inside `db.withLock`.
- Cancel requires reason ≥3 chars. Order requires supplier active + ≥1 line + valid branch.
- Dual store: every new `DbPort` method implemented in memory.db.ts AND pg-procurement.ts; Prisma schema.prisma models + parity MAP entries added.
- No commits of `apps/web/tsconfig.json` stray change; no debug logs; no hardcoded QA ids.

---

### Task A1: Validation schemas (packages/validation)

**Files:**
- Create: `packages/validation/src/procurement.schema.ts`
- Modify: `packages/validation/src/index.ts`
- Test: `packages/validation/test/procurement.schema.test.ts`

**Produces:** `supplierCreateSchema`, `supplierUpdateSchema`, `supplierListSchema`, `productSupplierCreateSchema`, `productSupplierUpdateSchema`, `purchaseOrderCreateSchema`, `purchaseOrderUpdateSchema`, `purchaseOrderListSchema`, `purchaseOrderCancelSchema`, `SUPPLIER_MAX_LEN` consts.

- [ ] Step 1: Write failing schema tests (name required/≤120, code upper-normalized optional, email format, pageSize bounds, lines: qty positive int, unitCostMinor int ≥0 optional, duplicate productId rejected via `superRefine`, expectedVersion int ≥1, cancel reason ≥3 ≤500).
- [ ] Step 2: `pnpm --filter @pos/validation test` → FAIL.
- [ ] Step 3: Implement schemas reusing `quantitySchema`, `moneyMinorSchema` from money.schema; `.strict()` bodies.
- [ ] Step 4: Run tests → PASS. Export from index.ts. Commit `feat(validation): procurement schemas`.

### Task A2: Migration + Prisma models + parity map

**Files:**
- Create: `packages/database/prisma/migrations/0028_procurement/migration.sql`
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `scripts/check-runtime-schema-parity.mjs` (MAP += 4 entries)
- Test: pg harness applies it automatically (Task D4); locally `node scripts/apply-migrations.mjs` against dev db.

**Produces:** tables `Supplier`, `ProductSupplier`, `PurchaseOrder`, `PurchaseOrderLine`, `POCounter` per spec DDL: quoted camelCase, TEXT ids, `businessId TEXT NOT NULL` FK CASCADE, entity FKs RESTRICT (lines: order CASCADE), CHECKs (`quantity > 0`, `unitCostMinor >= 0`, `lineTotalMinor >= 0`, `version >= 1`), partial unique indexes (`Supplier_businessId_code_key` WHERE code NOT NULL, preferred WHERE isPreferred, `ProductSupplier_businessId_productId_supplierId_key`, `PurchaseOrder_businessId_poNumber_key`, lines unique (businessId, purchaseOrderId, productId)), list indexes, `ENABLE ROW LEVEL SECURITY` on each.

- [ ] Step 1: Write migration SQL mirroring 0003/0005/0015 conventions.
- [ ] Step 2: Apply on local docker db (`scripts/dev-local.mjs` db or `docker compose up -d db`), verify `\d` output; revert local by manual drop? NO — forward only: verify on the pg test harness instead (`vitest.pg.config.ts` replays all migrations).
- [ ] Step 3: Add 5 models to schema.prisma (Supplier, ProductSupplier, PurchaseOrder, PurchaseOrderLine, POCounter) matching DDL.
- [ ] Step 4: `node scripts/check-runtime-schema-parity.mjs` after Task B adds Db* interfaces.
- [ ] Step 5: Commit `feat(database): migration 0028 procurement foundation`.

### Task B1: DbPort types + methods

**Files:**
- Modify: `apps/api/src/common/db.port.ts`

**Produces interfaces:** `DbSupplier` (all DDL fields, createdAt/updatedAt Date), `DbProductSupplier`, `DbPurchaseOrder` (incl. `version: number`, actor/date nullable fields), `DbPurchaseOrderLine`.

**Produces methods:** supplier CRUD (`createSupplier`, `listSuppliersByBusiness`, `findSupplierById`, `updateSupplier` returns null-on-miss), productSupplier (`createProductSupplier`, `listProductSuppliersBySupplier`, `listProductSuppliersByBusiness`, `findProductSupplierById`, `updateProductSupplier`, `clearPreferredProductSuppliers(businessId, productId, exceptId)`, `deleteProductSupplier`), PO (`createPurchaseOrder`, `findPurchaseOrderById`, `listPurchaseOrdersByBusiness`, `updatePurchaseOrder(id, businessId, patch, expectedVersion)` → CAS bump, null on stale/missing, `nextPoNo`), lines (`createPurchaseOrderLine`, `listPurchaseOrderLines`, `deletePurchaseOrderLines(orderId, businessId)`), audit read (`listAuditFor(businessId, entityType, entityId)`).

- [ ] Step 1: Add interfaces + method signatures to DbPort (typecheck will fail until B2/B3 done — implement all three in one commit).
- [ ] Step 2: memory.db.ts implementations (Maps, id gen `nid`-equivalent per store, stamps, tenant filters, CAS via version compare, nextPoNo with per-business counter Map inside existing promise-chain lock semantics; listAuditFor filters existing audit array).
- [ ] Step 3: `pg-procurement.ts` family (PgContext queries exactly like pg-branches.ts: `ctx.client()`, `ctx.owns()` release, `buildSet` pattern, `CURRENT_TIMESTAMP` updatedAt, CAS `UPDATE ... WHERE "version" = $n RETURNING`, nextPoNo = INSERT..ON CONFLICT DO UPDATE..RETURNING seq, format `PO-${year}-${seq.padStart(6,"0")}`). Wire into `PgDbPort` constructor + delegating methods.
- [ ] Step 4: `pnpm --filter @pos/api typecheck` → clean. Commit `feat(api): procurement data layer (port, memory, pg)`.

### Task B2: Permission keys

**Files:**
- Modify: `packages/auth/src/permissions.ts` (add 4 keys to SENSITIVE_ACTIONS)
- Modify: `apps/api/src/tenant/seed.ts` (cashier filter excludes the 4 new keys)
- Test: `apps/api/src/tenant/seed.test.ts` (add cases: cashier lacks procurement grants; owner/manager/inventory have them)

- [ ] Step 1: failing seed test; Step 2: implement; Step 3: run; commit `feat(auth): procurement permission keys`.

### Task C1: Domain pure logic + service

**Files:**
- Create: `apps/api/src/procurement/purchase-order-math.ts` (`PO_TRANSITIONS`, `canTransitionPO`, `computePoTotals`)
- Create: `apps/api/src/procurement/normalize.ts` (`normalizeSupplierCode`, `normalizeSupplierPayload` bounds/trim/defaults country PH)
- Create: `apps/api/src/procurement/nest/procurement.service.ts`
- Create tests: `purchase-order-math.test.ts`, `normalize.test.ts`, `procurement.service.test.ts`

**Produces:** `ProcurementService` methods (all `(businessId, actorId, requestId, input, granted)` shaped):
listSuppliers/get/create/update/deactivate/reactivate, list/create/update/remove productSupplier, listPOs/getPO/createPO/updateDraft/orderPO/cancelPO/listPoEvents. Internal: `requireGrant`, locks `supplier:${businessId}:${id}`, `purchase-order:${businessId}:${id}`, `po-number:${businessId}`; idempotency via findIdempotency/claimIdempotency + fingerprintPayload (command types per spec); version CAS from port; totals recomputed server-side (qty×unitCost sum); unit cost default chain ProductSupplier→Product.costMinor→0; supplier-snapshot fields on lines; audit rows for every mutation incl. before/after; SUPPLIER_INACTIVE gate at create+order; NO inventory API calls anywhere.

- [ ] RED: service tests on `createMemoryDb()` covering every spec rule incl. **zero-movement assertions** (listMovementsByBusiness before/after deep-equal; listBalances unchanged) and audit action presence. Run → fail.
- [ ] GREEN: implement service. Run → pass. Commit `feat(api): procurement service (state machine, idempotency, CAS)`.

### Task C2: Controller + module + wiring

**Files:**
- Create: `apps/api/src/procurement/nest/procurement.controller.ts`, `procurement.module.ts`
- Modify: `apps/api/src/app.module.ts` (both registries), `apps/api/src/common/http-helpers.ts` (5 new CODE_STATUS)

**Produces:** routes per spec §API. Pattern: SessionGuard, CsrfGuard mutations, zod safeParse → fail VALIDATION, idemKey(req), failFromError.

- [ ] Step 1: implement following expense/transfer controllers exactly; register AppModule + createTestApp.
- [ ] Step 2: contract test `apps/api/test/procurement.contract.test.ts` (expense contract shape): auth, RBAC matrix (cashier 403 all writes incl. hidden-field bypass), tenant 404s, branch 400s, validation matrix, state transitions, STALE_VERSION, idempotency replays/mismatch, totals-forgery ignored (send bogus totals field → strict → VALIDATION; or totals recomputed), events endpoint.
- [ ] Step 3: run contract + full api suite. Commit `feat(api): procurement HTTP API`.

### Task C3: pg parity tests

**Files:** Create `apps/api/test/pg/pg-procurement.test.ts`

- [ ] Concurrent nextPoNo (Promise.all 5 creates → 5 distinct PO-YYYY-NNNNNN); duplicate supplier code / product-supplier pair / poNumber / line product rejected at DB; preferred partial unique; version CAS null-on-stale; idempotency claim conflict DO NOTHING → IDEMPOTENCY_REPLAY; audit persisted with snapshots; **inventory tables byte-identical around full create→order→cancel**; FK RESTRICT (delete referenced supplier via SQL → violation). Run `vitest run --config vitest.pg.config.ts` (needs docker db per scripts/dev-local). Commit `test(api): procurement pg parity`.

### Task D1: Web libs + nav + api glue

**Files:**
- Create: `apps/web/src/lib/suppliers.ts`, `apps/web/src/lib/purchase-orders.ts` (+ co-located node-env tests)
- Modify: `apps/web/src/lib/workspace-navigation.ts` (ITEMS + Procurement group for owner/manager/inventory; cashier excluded), `workspace-navigation.test.ts`, `e2e/navigation-discoverability.spec.ts` (destinations list)

**Produces:** role helpers (`canManageSuppliers`, `canWritePurchaseOrders`, `canOrderPurchaseOrder`, `canCancelPurchaseOrder` — grants are role sets per existing lib pattern), `poStatusTone/Label`, search builders (`buildSupplierSearch`, `buildPoSearch`), `toMinor/money` reuse per page precedent, offline copy const `PROCUREMENT_OFFLINE_MESSAGE = "Purchase orders require an internet connection."`.

- [ ] RED lib tests → GREEN → commit `feat(web): procurement lib helpers and navigation`.

### Task D2: Suppliers UI pages

**Files:** Create `apps/web/src/app/suppliers/page.tsx`, `apps/web/src/app/suppliers/[id]/page.tsx`; web component test `apps/web/src/app/suppliers/page.test.tsx` (renderToStaticMarkup + mocked useQuery per AppShell.test pattern: loading/empty/error/inactive pill/no-write-buttons-for-cashier).

- [ ] Implement list (search input `aria-label="Search suppliers"`, status select, DataTableFrame premium-table, pagination Prev/Next, create Modal form with labels, deactivate/reactivate ConfirmDialog, inline role=status success `"<Name> was created."` etc.) + detail (contact card dl, edit modal, product-relationship panel: attach form (product select populated from `/api/v1/products`), rows with inline edit fields (supplierSku text, unit cost peso, leadTime number, preferred radio), remove confirm, PO history table link rows). Offline: `navigator.onLine` effect disables mutation controls + banner text.
- [ ] Manual dev-browser pass; commit `feat(web): suppliers pages`.

### Task D3: Purchase orders UI pages

**Files:** Create `/purchase-orders/page.tsx`, `/purchase-orders/[id]/page.tsx` (+ static markup tests for states)

- [ ] List: filters (poNumber search, status, supplier, date range), pills, create modal with line editor (add line rows: product select, qty, unit cost prefilled from `GET /api/v1/suppliers/:id/products` mapping when supplier chosen — fall back to product cost; running client total display labeled "estimated until saved", server total authoritative after save), draft created via POST with `crypto.randomUUID()` Idempotency-Key.
- [ ] Detail: embeds lines; DRAFT edit mode replaces lines wholesale on save (PATCH with lines array + expectedVersion from loaded PO); add/remove line rows; Order flow: ConfirmDialog details supplier/branch/line count/total → POST order (idem key, expectedVersion) → state ORDERED, editor hidden, lock notice `aria` text; Cancel flow: reason textarea → confirm → POST cancel; STALE_VERSION → banner "This purchase order changed elsewhere. Reload to see the latest." + Reload button; events section (`/events` list: action, actor id hidden→shown name? (no user-name endpoint on list → show actorId + action + date; keep human: `req.auth` userId is opaque — render action labels + timestamps + status pill; acceptable per existing sales detail? check and follow)); offline banner/disables; responsive stacking.
- [ ] Commit `feat(web): purchase order pages`.

### Task D4: E2E suite

**Files:** Create `e2e/procurement.spec.ts`, `e2e/procurement-responsive.spec.ts`, `e2e/procurement-security.spec.ts` (or single feature files per naming convention)

- [ ] Primary flow (owner via registerOperationalBusiness + seedProduct A/B + opening stock; capture balances via API `/api/v1/inventory/balances` or listProducts stock endpoints — reuse what inventory e2e already reads): supplier create→map product A (sku/cost/preferred)→draft PO 2 lines→reopen persistence→edit qty→totals→order→locked text→events visible→stock unchanged + no new movements (compare `/inventory/products/:id/movements` count endpoint availability — else use balances).
- [ ] Cancellation flow; cashier denial flow (createStaffMember cashier, signIn, nav lacks Procurement, direct goto renders read-only, API POST via request → 403 FORBIDDEN); cross-business (second business, request foreign ids with context A → 404 NOT_FOUND envelope); concurrency (two browser contexts same draft, second save → stale banner); idempotency replay (same key double POST via apiAuthedContext request → second 200 replayed / 201 once); responsive: projects cover 1440/1024/390 + one explicit viewport loop 360/430/768/834/1280/1366/1920 asserting no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth` on PO list/detail) and line editor usable; keyboard: Escape closes create dialog, focus returns.
- [ ] Run full `pnpm e2e`. Commit `test(e2e): procurement foundation flows`.

### Task E: Exit test + full regression

**Files:** Create `tests/phase16-exit.test.ts` (mirror phase12 style: repo-contract assertions — migration exists, code has zero references to createMovement/upsertBalance inside procurement src, CODE_STATUS keys, nav entries).

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:exit && pnpm build && node scripts/verify-scaffold.test.mjs && node scripts/verify-phase16... (no new verify script needed unless phase precedent demands; keep exit test)`.
- [ ] `pnpm --filter @pos/api test` full + `vitest run --config vitest.pg.config.ts` + full playwright. Record evidence. Commit.

### Task F: PR → CI → merge → Render → production smoke

- [ ] Push branch, `gh pr create` (template per PR requirements in phase prompt), CI green (verify+pg+e2e).
- [ ] Merge (no force), record SHA, auto-deploy → verify web+API LIVE on SHA, `/readyz` 200 (Render MCP or curl).
- [ ] Production smoke per phase prompt §PRODUCTION SMOKE against an isolated new QA business (register via UI on prod web), stock baselines of `biz_muqti2lj_5` re-read before/after (must stay 8/6 and 7/4), cashier denial check, cleanup optional.
- [ ] Final report in phase prompt format. STOP. No Phase 17.
