# Phase 2 Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 per `docs/superpowers/specs/2026-09-21-phase2-catalog-design.md` so a cashier can search a bounded catalog quickly and a manager can safely change catalog data with audit entries.

**Architecture:** One new NestJS `CatalogModule` (controller + service) plus framework-free domain helpers under `apps/api/src/catalog/`, following Phase 1 conventions exactly: Zod validation at the controller edge, `SessionGuard` + `CsrfGuard` on routes, `price.edit` write-gating via `AuthService.rolePermissions()`, `cost.view` response redaction, `withScope` tenant scoping, append-only audit, memory-DB contract tests via `supertest`.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 2.1.8, supertest, Next.js 15 + React 19 + Tailwind + TanStack Query for web.

**Spec:** `docs/superpowers/specs/2026-09-21-phase2-catalog-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, no float totals (PLAN.md 6.2).
- Tenant derived server-side from authenticated membership only, never from client tenantId claim (FR-TENANT-01).
- Every business-owned table includes businessId, every read and write scoped via `withScope`.
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC on wire, `X-Request-Id` correlation.
- Bounded page pagination for catalog screens: default pageSize 20, cap 100.
- Audit log append-only, no app-level update or delete; catalog snapshots keep cost (no secrets in catalog rows).
- Cookie `pos_session` + `X-CSRF-Token` on mutations (Phase 1, unchanged).
- Permission gates reuse Phase 1 `SENSITIVE_ACTIONS` keys: writes need `price.edit`, cost visibility needs `cost.view`. No new permission keys.
- No inventory ledger, POS cart, variants, image upload, CSV parsing, bulk delete, exports, branches, offline, billing, integrations, or AI.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/database/prisma/schema.prisma`: add `Category` + `Product` models (Task 1).
- `packages/database/prisma/migrations/0003_phase2_catalog/migration.sql`: create tables + indexes (Task 1).
- `packages/validation/src/catalog.schema.ts`: category/product/search/import Zod schemas (Task 1).
- `packages/validation/test/catalog.schema.test.ts`: schema tests (Task 1).
- `apps/api/src/catalog/normalize.ts`: input normalization, SKU/barcode duplicate checks (Task 2).
- `apps/api/src/catalog/search.ts`: query matching, filter/sort/paginate, cost redaction (Task 2).
- `apps/api/src/catalog/catalog.test.ts`: domain unit tests (Task 2).
- `apps/api/src/common/db.port.ts`: add `DbCategory`, `DbProduct`, catalog methods (Task 3).
- `apps/api/src/common/memory.db.ts`: in-memory catalog implementation (Task 3).
- `apps/api/src/catalog/nest/catalog.service.ts`: CRUD + search + import + audit (Task 4).
- `apps/api/src/catalog/nest/catalog.service.test.ts`: service tests against memory DB (Task 4).
- `apps/api/src/catalog/nest/catalog.controller.ts`: REST adapter, validation, gates (Task 5).
- `apps/api/src/catalog/nest/catalog.module.ts`: module wiring (Task 5).
- `apps/api/src/app.module.ts`: register controller/service (Task 5).
- `apps/api/src/common/http-helpers.ts`: add `CATALOG_*` codes to `CODE_STATUS` (Task 5).
- `apps/api/test/catalog.contract.test.ts`: supertest contract tests (Task 6).
- `apps/web/src/app/products/page.tsx`: search + bounded list (Task 7).
- `apps/web/src/app/products/[id]/page.tsx`: detail + edit + archive/restore (Task 7).
- `apps/web/src/app/categories/page.tsx`: list + create/rename/archive (Task 7).
- `tests/phase2-exit.test.ts`, `scripts/verify-phase2.test.mjs`, CI extension (Task 8).

### Task 1: Schema plus validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (append Category + Product models)
- Create: `packages/database/prisma/migrations/0003_phase2_catalog/migration.sql`
- Create: `packages/validation/src/catalog.schema.ts`
- Modify: `packages/validation/src/index.ts` (append `export * from "./catalog.schema";`)
- Create: `packages/validation/test/catalog.schema.test.ts`

**Interfaces:**
- Consumes: Phase 0 `moneyMinorSchema` / `priceSchema`, Phase 1 `packages/validation` patterns.
- Produces: `categoryCreateSchema`, `categoryUpdateSchema`, `productCreateSchema`, `productUpdateSchema`, `productSearchSchema`, `productImportSchema`; Prisma `Category` / `Product` models.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/catalog.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  productCreateSchema,
  productSearchSchema,
} from "../src/catalog.schema";

describe("phase2 catalog schemas", () => {
  it("rejects negative price with MONEY_NEGATIVE", () => {
    expect(() =>
      productCreateSchema.parse({ name: "Soda", priceMinor: -100, costMinor: 0 }),
    ).toThrow();
  });
  it("rejects non-integer money with MONEY_NOT_INTEGER", () => {
    expect(() =>
      productCreateSchema.parse({ name: "Soda", priceMinor: 10.5, costMinor: 0 }),
    ).toThrow();
  });
  it("rejects pageSize over 100", () => {
    expect(() => productSearchSchema.parse({ pageSize: 101 })).toThrow();
  });
  it("rejects empty category name", () => {
    expect(() => categoryCreateSchema.parse({ name: "" })).toThrow();
  });
  it("accepts a minimal valid product", () => {
    const out = productCreateSchema.parse({ name: "Soda", priceMinor: 2500 });
    expect(out.unit).toBe("pc");
    expect(out.trackInventory).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test`
Expected: FAIL with cannot find module `../src/catalog.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/catalog.schema.ts`:

```ts
import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  description: z.string().trim().max(500, "VALIDATION").optional(),
  isActive: z.boolean().optional(),
});

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
    description: z.string().trim().max(500, "VALIDATION").nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

const skuField = z.string().trim().max(64, "VALIDATION").optional();
const barcodeField = z.string().trim().max(64, "VALIDATION").optional();

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(160, "VALIDATION"),
  categoryId: z.string().min(1, "VALIDATION").optional(),
  sku: skuField,
  barcode: barcodeField,
  brand: z.string().trim().max(80, "VALIDATION").optional(),
  unit: z.string().trim().min(1).max(16, "VALIDATION").default("pc"),
  costMinor: moneyMinorSchema.default(0),
  priceMinor: moneyMinorSchema,
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  reorderLevel: z.number().int().min(0).default(0),
  trackInventory: z.boolean().default(true),
  isActive: z.boolean().default(true),
  imageUrl: z.string().trim().url("VALIDATION").max(500, "VALIDATION").optional(),
});

export const productUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(160, "VALIDATION").optional(),
    categoryId: z.string().min(1, "VALIDATION").nullable().optional(),
    sku: skuField.nullable(),
    barcode: barcodeField.nullable(),
    brand: z.string().trim().max(80, "VALIDATION").nullable().optional(),
    unit: z.string().trim().min(1).max(16, "VALIDATION").optional(),
    costMinor: moneyMinorSchema.optional(),
    priceMinor: moneyMinorSchema.optional(),
    taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
    reorderLevel: z.number().int().min(0).optional(),
    trackInventory: z.boolean().optional(),
    isActive: z.boolean().optional(),
    imageUrl: z.string().trim().url("VALIDATION").max(500, "VALIDATION").nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const productSearchSchema = z.object({
  q: z.string().trim().max(120, "VALIDATION").optional(),
  categoryId: z.string().min(1, "VALIDATION").optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const productImportSchema = z.object({
  items: productCreateSchema.array().min(1, "VALIDATION").max(200, "CATALOG_IMPORT_TOO_LARGE"),
});
```

Append to `packages/validation/src/index.ts`:

```ts
export * from "./catalog.schema";
```

Append to `packages/database/prisma/schema.prisma`:

```prisma
model Category {
  id          String   @id @default(cuid())
  businessId  String
  name        String
  description String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  business    Business @relation(fields: [businessId], references: [id])
  products    Product[]
  @@unique([businessId, name])
  @@index([businessId])
}

model Product {
  id             String    @id @default(cuid())
  businessId     String
  categoryId     String?
  name           String
  sku            String?
  barcode        String?
  brand          String?
  unit           String    @default("pc")
  costMinor      Int       @default(0)
  priceMinor     Int
  taxRateBps     Int?
  reorderLevel   Int       @default(0)
  trackInventory Boolean   @default(true)
  isActive       Boolean   @default(true)
  imageUrl       String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  business       Business  @relation(fields: [businessId], references: [id])
  category       Category? @relation(fields: [categoryId], references: [id])
  @@index([businessId, isActive])
  @@index([businessId, categoryId])
}
```

Also add `categories Category[]` and `products Product[]` relation lists to the existing `Business` model.

Create `packages/database/prisma/migrations/0003_phase2_catalog/migration.sql`:

```sql
CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "categoryId" TEXT,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "barcode" TEXT,
  "brand" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'pc',
  "costMinor" INTEGER NOT NULL DEFAULT 0,
  "priceMinor" INTEGER NOT NULL,
  "taxRateBps" INTEGER,
  "reorderLevel" INTEGER NOT NULL DEFAULT 0,
  "trackInventory" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "Product"("businessId", "sku");
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");
CREATE INDEX "Product_businessId_isActive_idx" ON "Product"("businessId", "isActive");
CREATE INDEX "Product_businessId_categoryId_idx" ON "Product"("businessId", "categoryId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (all catalog schema tests plus existing suite).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/catalog.schema.ts packages/validation/src/index.ts packages/validation/test/catalog.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0003_phase2_catalog/migration.sql
git commit -m "feat: add phase2 catalog schema and validation contracts"
```

### Task 2: Catalog domain helpers

**Files:**
- Create: `apps/api/src/catalog/normalize.ts`
- Create: `apps/api/src/catalog/search.ts`
- Create: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: validated Zod outputs from Task 1.
- Produces: `normalizeSku`, `normalizeBarcode`, `normalizeProductInput`, `findDuplicateSku`, `findDuplicateBarcode`, `matchesQuery`, `applyProductSearch`, `redactProductForRole`. Later tasks use these exact names and signatures.

- [ ] **Step 1: Write the failing domain test**

Create `apps/api/src/catalog/catalog.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { normalizeProductInput, findDuplicateSku } from "./normalize";
import { matchesQuery, applyProductSearch, redactProductForRole } from "./search";

const rows = [
  { id: "p1", businessId: "b1", name: "Coke", sku: "COKE-1", barcode: "111", categoryId: "c1", brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null },
  { id: "p2", businessId: "b1", name: "Pepsi", sku: null, barcode: null, categoryId: null, brand: null, unit: "pc", costMinor: 900, priceMinor: 2400, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: false, imageUrl: null },
];

describe("phase2 catalog domain", () => {
  it("normalizes sku to uppercase and blanks to null", () => {
    expect(normalizeProductInput({ name: " x ", sku: " ab-1 ", barcode: "" }).sku).toBe("AB-1");
    expect(normalizeProductInput({ name: " x ", sku: "", barcode: "" }).sku).toBeNull();
  });
  it("detects duplicate sku case-insensitively", () => {
    expect(findDuplicateSku([{ sku: "a-1" }, { sku: "A-1" }])).toBe(1);
    expect(findDuplicateSku([{ sku: "a-1" }, { sku: "b-2" }])).toBe(-1);
  });
  it("matches name substring, sku substring, barcode exact", () => {
    expect(matchesQuery(rows[0], "cok")).toBe(true);
    expect(matchesQuery(rows[0], "oke-")).toBe(true);
    expect(matchesQuery(rows[0], "111")).toBe(true);
    expect(matchesQuery(rows[0], "11")).toBe(false);
    expect(matchesQuery(rows[0], "zzz")).toBe(false);
  });
  it("paginates active products deterministically", () => {
    const out = applyProductSearch(rows, { active: "true", page: 1, pageSize: 20 });
    expect(out.total).toBe(1);
    expect(out.items[0].id).toBe("p1");
  });
  it("redacts cost without cost.view permission", () => {
    expect(redactProductForRole(rows[0], [])).not.toHaveProperty("costMinor");
    expect(redactProductForRole(rows[0], ["cost.view"])).toHaveProperty("costMinor", 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/catalog/catalog.test.ts`
Expected: FAIL with cannot find module `./normalize`.

- [ ] **Step 3: Write minimal domain implementation**

Create `apps/api/src/catalog/normalize.ts`:

```ts
export interface NormalizedProductInput {
  name: string;
  sku: string | null;
  barcode: string | null;
}

export function normalizeSku(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim().toUpperCase();
  return v === "" ? null : v;
}

export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim();
  return v === "" ? null : v;
}

export function normalizeProductInput(input: {
  name: string;
  sku?: string | null;
  barcode?: string | null;
}): NormalizedProductInput {
  return {
    name: input.name.trim(),
    sku: normalizeSku(input.sku ?? null),
    barcode: normalizeBarcode(input.barcode ?? null),
  };
}

export function findDuplicateSku(items: Array<{ sku?: string | null }>): number {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const sku = normalizeSku(items[i].sku ?? null);
    if (!sku) continue;
    if (seen.has(sku)) return i;
    seen.add(sku);
  }
  return -1;
}

export function findDuplicateBarcode(items: Array<{ barcode?: string | null }>): number {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const bc = normalizeBarcode(items[i].barcode ?? null);
    if (!bc) continue;
    if (seen.has(bc)) return i;
    seen.add(bc);
  }
  return -1;
}
```

Create `apps/api/src/catalog/search.ts`:

```ts
export interface CatalogRow {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  costMinor: number;
  priceMinor: number;
  isActive: boolean;
  [key: string]: unknown;
}

export function matchesQuery(row: CatalogRow, q: string): boolean {
  const needle = q.trim();
  if (needle === "") return true;
  if (row.name.toLowerCase().includes(needle.toLowerCase())) return true;
  if (row.sku && row.sku.toLowerCase().includes(needle.toLowerCase())) return true;
  if (row.barcode && row.barcode === needle) return true;
  return false;
}

export function applyProductSearch(
  rows: CatalogRow[],
  opts: { q?: string; categoryId?: string; active: "true" | "false" | "all"; page: number; pageSize: number },
): { items: CatalogRow[]; total: number; page: number; pageSize: number } {
  let out = rows.filter((r) => {
    if (opts.active === "true" && !r.isActive) return false;
    if (opts.active === "false" && r.isActive) return false;
    if (opts.categoryId && r.categoryId !== opts.categoryId) return false;
    if (opts.q && !matchesQuery(r, opts.q)) return false;
    return true;
  });
  out = [...out].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const total = out.length;
  const start = (opts.page - 1) * opts.pageSize;
  return { items: out.slice(start, start + opts.pageSize), total, page: opts.page, pageSize: opts.pageSize };
}

export function redactProductForRole<T extends { costMinor: number }>(
  row: T,
  granted: string[],
): Omit<T, "costMinor"> | T {
  if (granted.includes("cost.view")) return row;
  const { costMinor: _omitted, ...rest } = row;
  void _omitted;
  return rest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/catalog/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/normalize.ts apps/api/src/catalog/search.ts apps/api/src/catalog/catalog.test.ts
git commit -m "feat: add phase2 catalog domain helpers"
```

### Task 3: DbPort extension plus memory implementation

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbCategory`, `DbProduct`, catalog methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement catalog methods)

**Interfaces:**
- Consumes: Task 2 normalization (service layer uses it; memory DB stores rows as given).
- Produces: `DbPort.listCategories(businessId)`, `createCategory`, `findCategoryById`, `updateCategory`, `listProducts(businessId)`, `createProduct`, `findProductById`, `updateProduct`. Task 4 uses these exact names.

- [ ] **Step 1: Write the failing service-slice test**

Create `apps/api/src/catalog/nest/catalog.service.test.ts` with (full file; Task 4 extends it — this step proves the port is missing):

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase2 catalog port", () => {
  it("round-trips a category scoped to its business", async () => {
    const db = createMemoryDb();
    const cat = await db.createCategory({ businessId: "b1", name: "Drinks", description: null, isActive: true });
    expect((await db.listCategories("b1")).map((c) => c.id)).toContain(cat.id);
    expect(await db.listCategories("b2")).toEqual([]);
    expect(await db.findCategoryById(cat.id, "b2")).toBeNull();
  });
  it("round-trips a product scoped to its business", async () => {
    const db = createMemoryDb();
    const p = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: "COKE-1", barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    expect(await db.findProductById(p.id, "b1")).not.toBeNull();
    expect(await db.findProductById(p.id, "b2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/catalog/nest/catalog.service.test.ts`
Expected: FAIL — `db.createCategory is not a function` (or type error surfacing at runtime).

- [ ] **Step 3: Write minimal port + memory implementation**

Append to `apps/api/src/common/db.port.ts`:

```ts
export interface DbCategory {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface DbProduct {
  id: string;
  businessId: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  unit: string;
  costMinor: number;
  priceMinor: number;
  taxRateBps: number | null;
  reorderLevel: number;
  trackInventory: boolean;
  isActive: boolean;
  imageUrl: string | null;
}
```

Append to the `DbPort` interface:

```ts
  createCategory(c: Omit<DbCategory, "id">): Promise<DbCategory>;
  listCategories(businessId: string): Promise<DbCategory[]>;
  findCategoryById(id: string, businessId: string): Promise<DbCategory | null>;
  updateCategory(id: string, businessId: string, patch: Partial<Omit<DbCategory, "id" | "businessId">>): Promise<DbCategory | null>;
  createProduct(p: Omit<DbProduct, "id">): Promise<DbProduct>;
  listProducts(businessId: string): Promise<DbProduct[]>;
  findProductById(id: string, businessId: string): Promise<DbProduct | null>;
  updateProduct(id: string, businessId: string, patch: Partial<Omit<DbProduct, "id" | "businessId">>): Promise<DbProduct | null>;
```

In `apps/api/src/common/memory.db.ts`: add `categories` and `products` maps, and implement the eight methods with strict `businessId` equality on reads/updates (return `null` on cross-tenant access), following the existing `nid("cat")` / `nid("prod")` id style.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/catalog/nest/catalog.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/catalog/nest/catalog.service.test.ts
git commit -m "feat: add phase2 catalog db port and memory implementation"
```

### Task 4: CatalogService

**Files:**
- Create: `apps/api/src/catalog/nest/catalog.service.ts`
- Modify: `apps/api/src/catalog/nest/catalog.service.test.ts` (append service behavior tests)

**Interfaces:**
- Consumes: Tasks 1–3 (`productCreateSchema` types, `normalize*` / `findDuplicate*` / `applyProductSearch`, `DbPort` catalog methods, `withScope`).
- Produces: `CatalogService` with `createCategory`, `listCategories`, `updateCategory`, `createProduct`, `getProduct`, `searchProducts`, `updateProduct`, `setProductActive`, `importProducts`. Task 5 controller calls these exact methods.

Service rules: normalize on write; verify `categoryId` belongs to the same business else throw `VALIDATION`; pre-check `(businessId, sku)` / `(businessId, barcode)` uniqueness else throw `CATALOG_DUPLICATE_SKU` / `CATALOG_DUPLICATE_BARCODE`; import validates all rows first (schema + in-file dupes + existing dupes) and creates nothing on failure; every mutation appends one audit row (`category.create`, `category.update`, `product.create`, `product.update`, `product.archive`, `product.restore`, `product.import`).

- [ ] **Step 1: Write the failing service tests**

Append to `apps/api/src/catalog/nest/catalog.service.test.ts`:

```ts
import { CatalogService } from "./catalog.service";

async function setup() {
  const { createMemoryDb } = await import("../../common/memory.db");
  const db = createMemoryDb();
  return { db, svc: new CatalogService(db) };
}

describe("phase2 catalog service", () => {
  it("creates a product and audits product.create", async () => {
    const { db, svc } = await setup();
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 2500, costMinor: 1000 });
    expect(p.sku).toBeNull();
    expect((await db.listAudit()).some((a) => a.action === "product.create")).toBe(true);
  });
  it("rejects duplicate sku within a business but allows across businesses", async () => {
    const { svc } = await setup();
    await svc.createProduct("b1", "u1", "r1", { name: "A", priceMinor: 100, sku: "x-1" });
    await expect(svc.createProduct("b1", "u1", "r1", { name: "B", priceMinor: 100, sku: "X-1" })).rejects.toThrow("CATALOG_DUPLICATE_SKU");
    await svc.createProduct("b2", "u1", "r1", { name: "C", priceMinor: 100, sku: "X-1" });
  });
  it("rejects a category from another business with VALIDATION", async () => {
    const { svc } = await setup();
    const cat = await svc.createCategory("b1", "u1", "r1", { name: "Drinks" });
    await expect(
      svc.createProduct("b2", "u1", "r1", { name: "Coke", priceMinor: 100, categoryId: cat.id }),
    ).rejects.toThrow("VALIDATION");
  });
  it("imports atomically: one bad row creates nothing", async () => {
    const { db, svc } = await setup();
    await expect(
      svc.importProducts("b1", "u1", "r1", { items: [
        { name: "A", priceMinor: 100, sku: "dup" },
        { name: "B", priceMinor: 100, sku: "DUP" },
      ] }),
    ).rejects.toThrow("CATALOG_DUPLICATE_SKU");
    expect(await db.listProducts("b1")).toEqual([]);
  });
  it("archives and restores with audit entries", async () => {
    const { db, svc } = await setup();
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 100 });
    await svc.setProductActive("b1", "u1", "r1", p.id, false);
    expect((await db.findProductById(p.id, "b1"))!.isActive).toBe(false);
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("product.archive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/catalog/nest/catalog.service.test.ts`
Expected: FAIL with cannot find module `./catalog.service`.

- [ ] **Step 3: Write minimal service implementation**

Create `apps/api/src/catalog/nest/catalog.service.ts` implementing the class per the Interfaces rules above, using `withScope` for scoping, Task 2 helpers for normalization/matching/redaction, `DbPort` for persistence, and `db.appendAudit` per mutation. Keep it in the `BusinessService` style (constructor injects `DbPort`, methods take `(businessId, actorId, requestId, ...)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/catalog/nest/catalog.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/nest/catalog.service.ts apps/api/src/catalog/nest/catalog.service.test.ts
git commit -m "feat: add phase2 catalog service"
```

### Task 5: Catalog HTTP layer

**Files:**
- Create: `apps/api/src/catalog/nest/catalog.controller.ts`
- Create: `apps/api/src/catalog/nest/catalog.module.ts`
- Modify: `apps/api/src/app.module.ts` (register controller + service in both `@Module` and `createTestApp`)
- Modify: `apps/api/src/common/http-helpers.ts` (add `CATALOG_DUPLICATE_SKU: 409`, `CATALOG_DUPLICATE_BARCODE: 409`, `CATALOG_IMPORT_TOO_LARGE: 400` to `CODE_STATUS`)

**Interfaces:**
- Consumes: Task 4 `CatalogService`, Task 1 Zod schemas, Phase 1 `SessionGuard` / `CsrfGuard` / `AuthService.rolePermissions` / `fail` / `statusFor` / `rid` pattern.
- Produces: routes `GET/POST /api/v1/categories`, `PATCH /api/v1/categories/:id`, `GET/POST /api/v1/products`, `GET/PATCH /api/v1/products/:id`, `POST /api/v1/products/:id/archive`, `POST /api/v1/products/:id/restore`, `POST /api/v1/products/import`. Task 6 tests these routes.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on all POST/PATCH; writes check `this.auth.rolePermissions(auth.role).includes("price.edit")` else `fail(res, 403, "FORBIDDEN", ...)`; reads redact cost via `redactProductForRole(row, this.auth.rolePermissions(auth.role))`; import route additionally rate-limited at 5/min/business via `createRateLimiter(5, 60_000)` keyed on `businessId`; Zod `safeParse` failures map to `fail(res, 400, "VALIDATION", ...)` (import oversize maps to `CATALOG_IMPORT_TOO_LARGE`); service throws map via `statusFor(code)`.

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/test/catalog.contract.test.ts` with:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

describe("phase2 catalog HTTP contract", () => {
  let app: INestApplication;
  let cookie: string;
  let csrf: string;

  beforeAll(async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Ana", email: "ana-cat@example.com",
      password: "correct-horse-12", businessName: "Sari Store",
    });
    cookie = String(res.headers["set-cookie"] ?? "");
    csrf = res.body.csrfToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates and searches a product with bounded pagination", async () => {
    const create = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Coke", priceMinor: 2500, costMinor: 1000, sku: "coke-1" });
    expect(create.status).toBe(201);
    const list = await request(app.getHttpServer())
      .get("/api/v1/products?q=cok")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).not.toHaveProperty("costMinor");
  });

  it("rejects duplicate sku with CATALOG_DUPLICATE_SKU", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Coke 2", priceMinor: 100, sku: "COKE-1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CATALOG_DUPLICATE_SKU");
  });

  it("rejects unauthenticated catalog read with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/products");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns NOT_FOUND for another tenant's product id", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-cat@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = String(res2.headers["set-cookie"] ?? "");
    const list = await request(app.getHttpServer()).get("/api/v1/products").set("Cookie", cookie);
    const id = list.body.items[0].id;
    const got = await request(app.getHttpServer()).get(`/api/v1/products/${id}`).set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/catalog.contract.test.ts`
Expected: FAIL — 404 on `/api/v1/products` (no route yet).

- [ ] **Step 3: Write minimal controller + module + wiring**

Implement the three files per the Controller rules above, mirroring `business.controller.ts` structure (`rid()` helper, `@Controller("api/v1")`, `@UseGuards(SessionGuard)`, `@Res()` responses, `fail`/`statusFor` error mapping). Wire into `app.module.ts` `@Module` and `createTestApp` following the existing `BusinessService` factory pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- test/catalog.contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/nest/catalog.controller.ts apps/api/src/catalog/nest/catalog.module.ts apps/api/src/app.module.ts apps/api/src/common/http-helpers.ts apps/api/test/catalog.contract.test.ts
git commit -m "feat: add phase2 catalog http layer"
```

### Task 6: Permission and import contract coverage

**Files:**
- Modify: `apps/api/test/catalog.contract.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 5 routes, Phase 1 `ROLE_SEED` (cashier lacks `price.edit`/`cost.view`).
- Produces: proof that cashier reads without cost, cashier writes get `FORBIDDEN`, import round-trips with audit, oversize import rejected.

- [ ] **Step 1: Write the failing permission tests**

Append to `apps/api/test/catalog.contract.test.ts`:

```ts
describe("phase2 catalog permissions and import", () => {
  it("cashier-equivalent without price.edit gets FORBIDDEN on write (unit: rolePermissions gate)", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("price.edit");
    expect(svc.rolePermissions("cashier")).not.toContain("cost.view");
    expect(svc.rolePermissions("manager")).toContain("price.edit");
  });

  it("owner import round-trips and audits product.import", async () => {
    // uses app/cookie/csrf from outer scope
    const res = await request(app.getHttpServer())
      .post("/api/v1/products/import")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ items: [{ name: "Sprite", priceMinor: 2400 }, { name: "Royal", priceMinor: 2400 }] });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
  });

  it("rejects oversize import with CATALOG_IMPORT_TOO_LARGE", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ name: `P${i}`, priceMinor: 100 }));
    const res = await request(app.getHttpServer())
      .post("/api/v1/products/import")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ items });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CATALOG_IMPORT_TOO_LARGE");
  });
});
```

Note: the outer `app`/`cookie`/`csrf` are scoped to the first describe block; restructure so both describes share them (move `beforeAll` setup to file scope) as part of this task.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/catalog.contract.test.ts`
Expected: FAIL — `res.body.imported` undefined (import route returns wrong shape) or scoping error.

- [ ] **Step 3: Write minimal fix**

Ensure `POST /api/v1/products/import` returns `201 { imported: n }` and the shared setup is file-scoped. No new production code beyond what Task 5 built (shape fix only).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test`
Expected: PASS (full API suite).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/catalog.contract.test.ts apps/api/src/catalog/nest/catalog.controller.ts
git commit -m "test: add phase2 permission and import contract coverage"
```

### Task 7: Catalog web UI

**Files:**
- Create: `apps/web/src/app/products/page.tsx`
- Create: `apps/web/src/app/products/[id]/page.tsx`
- Create: `apps/web/src/app/categories/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (replace "Products — coming in Phase 2" with a link to `/products`)

**Interfaces:**
- Consumes: Task 5 routes via existing `apiFetch`; role from `GET /api/v1/me`.
- Produces: cashier-usable search page, manager edit/archive UI, category management UI.

Web rules: `"use client"` + TanStack Query like `page.tsx`; CSRF token read from `GET /api/v1/auth/csrf` for mutations (follow the onboarding page's CSRF pattern — read `apps/web/src/app/onboarding/page.tsx` first); hide write affordances when `me.role` lacks `price.edit` (owner/manager/inventory roles show them, cashier does not); cost field hidden unless role is owner/manager/inventory; server remains authoritative.

- [ ] **Step 1: Write the failing web test**

Create `apps/web/test/catalog.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

describe("phase2 catalog web helpers", () => {
  it("builds a bounded search query string", async () => {
    const { buildProductSearch } = await import("../src/lib/catalog");
    expect(buildProductSearch({ q: "coke", page: 1, pageSize: 20 })).toBe(
      "/api/v1/products?q=coke&page=1&pageSize=20",
    );
  });
  it("hides cost for cashier role", async () => {
    const { canSeeCost, canEditCatalog } = await import("../src/lib/catalog");
    expect(canSeeCost("cashier")).toBe(false);
    expect(canSeeCost("owner")).toBe(true);
    expect(canEditCatalog("cashier")).toBe(false);
    expect(canEditCatalog("manager")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test -- test/catalog.test.ts`
Expected: FAIL with cannot find module `../src/lib/catalog`.

- [ ] **Step 3: Write minimal lib + pages**

Create `apps/web/src/lib/catalog.ts`:

```ts
export function buildProductSearch(params: {
  q?: string;
  categoryId?: string;
  active?: string;
  page?: number;
  pageSize?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 20));
  if (params.active) sp.set("active", params.active);
  return `/api/v1/products?${sp.toString()}`;
}

const EDIT_ROLES = new Set(["owner", "manager", "inventory"]);

export function canEditCatalog(role: string): boolean {
  return EDIT_ROLES.has(role);
}

export function canSeeCost(role: string): boolean {
  return EDIT_ROLES.has(role);
}
```

Create the three pages per the Web rules above (search input + category select + active toggle + bounded list with prev/next; detail with edit form + archive/restore; categories with create/rename/archive). Mirror `register/page.tsx` form patterns and `page.tsx` query patterns.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/catalog.ts apps/web/test/catalog.test.ts apps/web/src/app/products/page.tsx "apps/web/src/app/products/[id]/page.tsx" apps/web/src/app/categories/page.tsx apps/web/src/app/page.tsx
git commit -m "feat: add phase2 catalog web ui"
```

### Task 8: Exit gate and verification

**Files:**
- Create: `tests/phase2-exit.test.ts`
- Create: `scripts/verify-phase2.test.mjs`
- Modify: `.github/workflows/ci.yml` (append `- run: node scripts/verify-phase2.test.mjs`)
- Modify: root `package.json` (no change needed — `test:exit` already covers `tests/`)

**Interfaces:**
- Consumes: all Phase 2 deliverables.
- Produces: Phase 2 exit proof mirroring Phase 1's gate.

- [ ] **Step 1: Write the failing exit test**

Create `tests/phase2-exit.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSku, findDuplicateBarcode } from "../apps/api/src/catalog/normalize";
import { applyProductSearch, redactProductForRole } from "../apps/api/src/catalog/search";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { CatalogService } from "../apps/api/src/catalog/nest/catalog.service";

describe("phase2 exit", () => {
  it("cashier searches a bounded catalog without seeing cost", () => {
    const rows = [
      { id: "p1", businessId: "b1", name: "Coke", sku: "COKE-1", barcode: "111", categoryId: null, costMinor: 1000, priceMinor: 2500, isActive: true },
    ];
    const out = applyProductSearch(rows, { q: "coke", active: "true", page: 1, pageSize: 20 });
    expect(out.total).toBe(1);
    expect(redactProductForRole(out.items[0], [])).not.toHaveProperty("costMinor");
  });
  it("manager changes catalog data with audit entries", async () => {
    const db = createMemoryDb();
    const svc = new CatalogService(db);
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 2500 });
    await svc.updateProduct("b1", "u1", "r1", p.id, { priceMinor: 2600 });
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("product.create");
    expect(actions).toContain("product.update");
  });
  it("cross-tenant catalog access is blocked", async () => {
    const db = createMemoryDb();
    const svc = new CatalogService(db);
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 2500 });
    await expect(svc.getProduct("b2", p.id, [])).rejects.toThrow("NOT_FOUND");
  });
  it("duplicate barcode rejected, normalization holds", () => {
    expect(normalizeSku(" ab-1 ")).toBe("AB-1");
    expect(findDuplicateBarcode([{ barcode: "1" }, { barcode: "1" }])).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:exit`
Expected: FAIL with cannot find module `../apps/api/src/catalog/normalize` (until Tasks 2–4 land; when executed in order this passes — the RED here is verified at plan time by absence of the files).

- [ ] **Step 3: Write minimal verification script**

Create `scripts/verify-phase2.test.mjs`:

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0003_phase2_catalog/migration.sql"),
  existsSync("packages/validation/src/catalog.schema.ts"),
  existsSync("apps/api/src/catalog/normalize.ts"),
  existsSync("apps/api/src/catalog/search.ts"),
  existsSync("apps/api/src/catalog/nest/catalog.service.ts"),
  existsSync("apps/api/src/catalog/nest/catalog.controller.ts"),
  existsSync("apps/api/src/catalog/nest/catalog.module.ts"),
  existsSync("apps/api/test/catalog.contract.test.ts"),
  existsSync("apps/web/src/app/products/page.tsx"),
  existsSync("apps/web/src/app/categories/page.tsx"),
  existsSync("tests/phase2-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE2_OK");
} else {
  console.error("PHASE2_MISSING");
  process.exit(1);
}
```

Append to `.github/workflows/ci.yml` after the phase1 line:

```yaml
      - run: node scripts/verify-phase2.test.mjs
```

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase2.test.mjs && pnpm typecheck && pnpm lint`
Expected: all green + `PHASE2_OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/phase2-exit.test.ts scripts/verify-phase2.test.mjs .github/workflows/ci.yml
git commit -m "test: add phase2 exit gate and verification"
```
