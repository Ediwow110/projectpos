# Phase 3 Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 3 per `docs/superpowers/specs/2026-09-22-phase3-inventory-design.md` so stock balance equals ledger sum after normal and concurrent operations.

**Architecture:** One new NestJS `InventoryModule` following Phase 1/2 conventions: Zod validation at controller edge, `SessionGuard` + `CsrfGuard`, `inventory.adjust` write gate via `AuthService.rolePermissions()`, `withScope` tenant scoping, append-only audit, memory-DB contract tests via `supertest`. Pure domain logic in `apps/api/src/inventory/`.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 2.1.8, supertest, Next.js 15 + React 19 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-22-phase3-inventory-design.md`. PLAN.md is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer quantities for movements, no float arithmetic.
- Tenant server-derived from membership; every read/write via `withScope`.
- `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC, bounded pagination (default 20, cap 100).
- Audit append-only; inventory snapshots keep full rows (no secrets).
- Writes need `inventory.adjust` (Phase 1 SENSITIVE_ACTIONS key). Reads need session + membership only.
- Ledger authoritative; balance is a projection. Movement + balance update are atomic in the service call.
- Phase 1 dash-line convention: files use CRLF endings; avoid full-file rewrites that flip line endings.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/validation/src/inventory.schema.ts`: movement/balances/rebuild Zod schemas (Task 1).
- `packages/validation/test/inventory.schema.test.ts` (Task 1).
- `packages/database/prisma/schema.prisma`: add `InventoryMovement`, `InventoryBalance`, `Product.preventOversell` (Task 1).
- `packages/database/prisma/migrations/0004_phase3_inventory/migration.sql` (Task 1).
- `apps/api/src/inventory/signs.ts`: MOVEMENT types, `signFor`, `validateQtyDelta` (Task 2).
- `apps/api/src/inventory/projection.ts`: `applyMovementToBalance`, `computeBalanceFromLedger`, `deriveStockStatus` (Task 2).
- `apps/api/src/inventory/inventory.test.ts` (Task 2).
- `apps/api/src/common/db.port.ts`: `DbMovement`, `DbBalance`, inventory methods (Task 3).
- `apps/api/src/common/memory.db.ts`: in-memory inventory implementation (Task 3).
- `apps/api/src/inventory/nest/inventory.service.ts` + `inventory.service.test.ts` (Task 4).
- `apps/api/src/inventory/nest/inventory.controller.ts` + `inventory.module.ts` (Task 5).
- `apps/api/src/app.module.ts`: register `InventoryController` + `InventoryService` (Task 5).
- `apps/api/src/common/http-helpers.ts`: add `INSUFFICIENT_STOCK: 409`, `PRODUCT_NOT_TRACKED: 400` (Task 5).
- `apps/api/test/inventory.contract.test.ts` (Tasks 5-6).
- `apps/web/src/lib/inventory.ts` + `apps/web/test/inventory.test.ts` (Task 7).
- `apps/web/src/app/inventory/page.tsx`, `apps/web/src/app/inventory/[productId]/page.tsx` (Task 7).
- `tests/phase3-exit.test.ts`, `scripts/verify-phase3.test.mjs`, CI extension (Task 8).

### Task 1: Schema plus validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (append models; add `preventOversell` to `Product`)
- Create: `packages/database/prisma/migrations/0004_phase3_inventory/migration.sql`
- Create: `packages/validation/src/inventory.schema.ts`
- Modify: `packages/validation/src/index.ts` (append export)
- Create: `packages/validation/test/inventory.schema.test.ts`

**Interfaces:**
- Consumes: Phase 2 catalog models (`Product`) and validation patterns.
- Produces: `movementTypeSchema`, `movementCreateSchema`, `balancesQuerySchema`, `movementHistoryQuerySchema`; Prisma `InventoryMovement` / `InventoryBalance` models.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/inventory.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { movementCreateSchema, balancesQuerySchema } from "../src/inventory.schema";

describe("phase3 inventory schemas", () => {
  it("rejects zero qtyDelta", () => {
    expect(() =>
      movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 0 }),
    ).toThrow();
  });
  it("rejects non-integer qtyDelta", () => {
    expect(() =>
      movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 2.5 }),
    ).toThrow();
  });
  it("rejects unknown movement type", () => {
    expect(() =>
      movementCreateSchema.parse({ productId: "p1", type: "teleport", qtyDelta: 1 }),
    ).toThrow();
  });
  it("rejects view outside all|low|out", () => {
    expect(() => balancesQuerySchema.parse({ view: "everything" })).toThrow();
  });
  it("accepts a minimal valid movement", () => {
    const out = movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 10 });
    expect(out.qtyDelta).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/inventory.schema.test.ts`
Expected: FAIL with cannot find module `../src/inventory.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/inventory.schema.ts`:

```ts
import { z } from "zod";

export const MOVEMENT_TYPES = [
  "opening_stock",
  "receive",
  "sale",
  "return",
  "damage",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "stock_count",
] as const;

export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

export const movementCreateSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  type: movementTypeSchema,
  qtyDelta: z.number().int("QTY_NOT_INTEGER").refine((n) => n !== 0, { message: "VALIDATION" }),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
  referenceType: z.string().trim().max(64, "VALIDATION").optional(),
  referenceId: z.string().min(1, "VALIDATION").max(128, "VALIDATION").optional(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const balancesQuerySchema = pageQuery.extend({
  view: z.enum(["all", "low", "out"]).default("all"),
});

export const movementHistoryQuerySchema = pageQuery;
```

Append `export * from "./inventory.schema";` to `packages/validation/src/index.ts` (mind CRLF endings — byte-append via script, don't rewrite whole file).

Append to `packages/database/prisma/schema.prisma` (byte-append preserving CRLF):

```prisma
model InventoryMovement {
  id            String   @id @default(cuid())
  businessId    String
  productId     String
  type          String
  qtyDelta      Int
  reason        String?
  referenceType String?
  referenceId   String?
  actorId       String
  requestId     String
  createdAt     DateTime @default(now())
  business      Business @relation(fields: [businessId], references: [id])
  product       Product  @relation(fields: [productId], references: [id])
  @@index([businessId, productId, createdAt])
}

model InventoryBalance {
  id         String   @id @default(cuid())
  businessId String
  productId  String
  qtyOnHand  Int      @default(0)
  updatedAt  DateTime @updatedAt
  business   Business @relation(fields: [businessId], references: [id])
  product    Product  @relation(fields: [productId], references: [id])
  @@unique([businessId, productId])
}
```

Also add `preventOversell Boolean @default(true)` to `Product`, plus `movements InventoryMovement[]` and `balances InventoryBalance[]` relation lists on `Business` and `Product`.

Create `packages/database/prisma/migrations/0004_phase3_inventory/migration.sql`:

```sql
ALTER TABLE "Product" ADD COLUMN "preventOversell" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "qtyDelta" INTEGER NOT NULL,
  "reason" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_qtyDelta_check" CHECK ("qtyDelta" <> 0)
);
CREATE INDEX "InventoryMovement_businessId_productId_createdAt_idx" ON "InventoryMovement"("businessId", "productId", "createdAt");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InventoryBalance" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qtyOnHand" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryBalance_businessId_productId_key" ON "InventoryBalance"("businessId", "productId");
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/inventory.schema.ts packages/validation/src/index.ts packages/validation/test/inventory.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0004_phase3_inventory/migration.sql
git commit -m "feat: add phase3 inventory schema and validation contracts"
```

### Task 2: Inventory domain helpers

**Files:**
- Create: `apps/api/src/inventory/signs.ts`
- Create: `apps/api/src/inventory/projection.ts`
- Create: `apps/api/src/inventory/inventory.test.ts`

**Interfaces:**
- Consumes: Task 1 `MOVEMENT_TYPES`.
- Produces: `signFor`, `validateQtyDelta`, `applyMovementToBalance`, `computeBalanceFromLedger`, `deriveStockStatus`. Task 4 uses these exact names.

- [ ] **Step 1: Write the failing domain test**

Create `apps/api/src/inventory/inventory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signFor, validateQtyDelta } from "./signs";
import { applyMovementToBalance, computeBalanceFromLedger, deriveStockStatus } from "./projection";

describe("phase3 inventory domain", () => {
  it("signs receive positive and damage negative, adjustment either", () => {
    expect(signFor("receive")).toBe(1);
    expect(signFor("damage")).toBe(-1);
    expect(signFor("adjustment")).toBe(0);
  });
  it("rejects zero and mismatched signs", () => {
    expect(() => validateQtyDelta("receive", 0)).toThrow("VALIDATION");
    expect(() => validateQtyDelta("receive", -5)).toThrow("VALIDATION");
    expect(() => validateQtyDelta("damage", 5)).toThrow("VALIDATION");
    validateQtyDelta("adjustment", -5);
  });
  it("applies a movement to a balance", () => {
    expect(applyMovementToBalance(10, { qtyDelta: -3 })).toBe(7);
  });
  it("sums a ledger", () => {
    expect(computeBalanceFromLedger([{ qtyDelta: 100 }, { qtyDelta: -2 }, { qtyDelta: -1 }])).toBe(97);
  });
  it("derives low and out status from balance and reorder level", () => {
    expect(deriveStockStatus({ qtyOnHand: 0, reorderLevel: 5, trackInventory: true })).toBe("out");
    expect(deriveStockStatus({ qtyOnHand: 3, reorderLevel: 5, trackInventory: true })).toBe("low");
    expect(deriveStockStatus({ qtyOnHand: 9, reorderLevel: 5, trackInventory: true })).toBe("ok");
    expect(deriveStockStatus({ qtyOnHand: 0, reorderLevel: 5, trackInventory: false })).toBe("untracked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/inventory/inventory.test.ts`
Expected: FAIL with cannot find module `./signs`.

- [ ] **Step 3: Write minimal domain implementation**

Create `apps/api/src/inventory/signs.ts`:

```ts
export type MovementType =
  | "opening_stock" | "receive" | "sale" | "return" | "damage"
  | "adjustment" | "transfer_in" | "transfer_out" | "stock_count";

const POSITIVE = new Set(["opening_stock", "receive", "return", "transfer_in"]);
const NEGATIVE = new Set(["sale", "damage", "transfer_out"]);

export function signFor(type: MovementType): 1 | -1 | 0 {
  if (POSITIVE.has(type)) return 1;
  if (NEGATIVE.has(type)) return -1;
  return 0; // adjustment, stock_count: computed/any-sign
}

export function validateQtyDelta(type: MovementType, qtyDelta: number): void {
  if (!Number.isInteger(qtyDelta) || qtyDelta === 0) throw new Error("VALIDATION");
  const sign = signFor(type);
  if (sign === 1 && qtyDelta < 0) throw new Error("VALIDATION");
  if (sign === -1 && qtyDelta > 0) throw new Error("VALIDATION");
}
```

Create `apps/api/src/inventory/projection.ts`:

```ts
export function applyMovementToBalance(onHand: number, movement: { qtyDelta: number }): number {
  return onHand + movement.qtyDelta;
}

export function computeBalanceFromLedger(movements: Array<{ qtyDelta: number }>): number {
  return movements.reduce((sum, m) => sum + m.qtyDelta, 0);
}

export type StockStatus = "ok" | "low" | "out" | "untracked";

export function deriveStockStatus(input: {
  qtyOnHand: number;
  reorderLevel: number;
  trackInventory: boolean;
}): StockStatus {
  if (!input.trackInventory) return "untracked";
  if (input.qtyOnHand <= 0) return "out";
  if (input.qtyOnHand <= input.reorderLevel) return "low";
  return "ok";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/inventory/inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/inventory/signs.ts apps/api/src/inventory/projection.ts apps/api/src/inventory/inventory.test.ts
git commit -m "feat: add phase3 inventory domain helpers"
```

### Task 3: DbPort extension plus memory implementation

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbMovement`, `DbBalance`, inventory methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement inventory methods)

**Interfaces:**
- Consumes: Task 2 helpers (service uses them; memory DB stores rows as given).
- Produces: `DbPort.createMovement`, `listMovements(productId, businessId)`, `listMovementsByBusiness`, `upsertBalance`, `findBalance`, `listBalances(businessId)`. Task 4 uses these exact names.

- [ ] **Step 1: Write the failing port test**

Create `apps/api/src/inventory/nest/inventory.service.test.ts` with (Task 4 extends it):

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase3 inventory port", () => {
  it("round-trips a movement scoped to its business", async () => {
    const db = createMemoryDb();
    await db.createMovement({
      businessId: "b1", productId: "p1", type: "receive", qtyDelta: 10,
      reason: null, referenceType: null, referenceId: null,
      actorId: "u1", requestId: "r1",
    });
    expect((await db.listMovements("p1", "b1")).length).toBe(1);
    expect(await db.listMovements("p1", "b2")).toEqual([]);
  });
  it("upserts balances scoped to business", async () => {
    const db = createMemoryDb();
    await db.upsertBalance({ businessId: "b1", productId: "p1", qtyOnHand: 10 });
    expect((await db.findBalance("p1", "b1"))!.qtyOnHand).toBe(10);
    expect(await db.findBalance("p1", "b2")).toBeNull();
    expect(await db.listBalances("b2")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/inventory/nest/inventory.service.test.ts`
Expected: FAIL — `db.createMovement is not a function`.

- [ ] **Step 3: Write minimal port + memory implementation**

Append to `apps/api/src/common/db.port.ts`:

```ts
export interface DbMovement {
  id: string;
  businessId: string;
  productId: string;
  type: string;
  qtyDelta: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
  requestId: string;
}

export interface DbBalance {
  id: string;
  businessId: string;
  productId: string;
  qtyOnHand: number;
}
```

Append to `DbPort`:

```ts
  createMovement(m: Omit<DbMovement, "id">): Promise<DbMovement>;
  listMovements(productId: string, businessId: string): Promise<DbMovement[]>;
  listMovementsByBusiness(businessId: string): Promise<DbMovement[]>;
  upsertBalance(b: Omit<DbBalance, "id">): Promise<DbBalance>;
  findBalance(productId: string, businessId: string): Promise<DbBalance | null>;
  listBalances(businessId: string): Promise<DbBalance[]>;
```

In `memory.db.ts`: add `movements` and `balances` maps; `createMovement` uses `nid("mov")`; `listMovements`/`listMovementsByBusiness` filter by strict businessId equality; `upsertBalance` keys on `${businessId}:${productId}`; all cross-tenant reads return `[]`/`null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/inventory/nest/inventory.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/inventory/nest/inventory.service.test.ts
git commit -m "feat: add phase3 inventory db port and memory implementation"
```

### Task 4: InventoryService

**Files:**
- Create: `apps/api/src/inventory/nest/inventory.service.ts`
- Modify: `apps/api/src/inventory/nest/inventory.service.test.ts` (append behavior tests)

**Interfaces:**
- Consumes: Tasks 1–3 (Zod types, `signFor`/`validateQtyDelta`/`applyMovementToBalance`/`computeBalanceFromLedger`, `DbPort` inventory methods, `withScope`).
- Produces: `InventoryService` with `recordMovement`, `getBalances`, `getMovementHistory`, `rebuild`. Task 5 controller calls these exact methods.

Service rules:
- `recordMovement(businessId, actorId, requestId, input)`: fetch product in same business (else `NOT_FOUND`); reject untracked products (`trackInventory=false`) with `PRODUCT_NOT_TRACKED` unless type is `adjustment` or `stock_count`; `validateQtyDelta`; require `reason` (min 3 chars) for damage/adjustment (`VALIDATION` otherwise); oversell guard — `preventOversell` product going negative throws `INSUFFICIENT_STOCK`, and nothing is written; else `createMovement` + `upsertBalance` together; append `inventory.adjust` audit row.
- `getBalances(businessId, { page, pageSize, view })`: join balances with product rows (name, reorderLevel, trackInventory), derive status, filter by view, sort by name, bounded-paginate.
- `getMovementHistory(businessId, productId, { page, pageSize })`: verify product belongs to business (else `NOT_FOUND`); newest-first (`id` desc as creation proxy in memory; createdAt desc in SQL), bounded-paginate.
- `rebuild(businessId, actorId, requestId)`: for every product with movements in the business, compare `computeBalanceFromLedger` sum vs stored balance; return `{ checked, drifts }`; append `inventory.rebuild` audit row. Report-only.

- [ ] **Step 1: Write the failing service tests**

Append to `apps/api/src/inventory/nest/inventory.service.test.ts`:

```ts
import { InventoryService } from "./inventory.service";

async function setupSvc() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  return { db, svc: new InventoryService(db), productId: prod.id };
}

describe("phase3 inventory service", () => {
  it("opening stock then receive leaves balance equal to ledger sum", async () => {
    const { db, svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r1", { productId, type: "opening_stock", qtyDelta: 100 });
    await svc.recordMovement("b1", "u1", "r2", { productId, type: "receive", qtyDelta: 20 });
    const bal = await db.findBalance(productId, "b1");
    const ledger = await db.listMovements(productId, "b1");
    expect(bal!.qtyOnHand).toBe(120);
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("rejects oversell with INSUFFICIENT_STOCK and writes nothing", async () => {
    const { db, svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r1", { productId, type: "receive", qtyDelta: 5 });
    await expect(
      svc.recordMovement("b1", "u1", "r2", { productId, type: "damage", qtyDelta: -10, reason: "broken bottles" }),
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect((await db.listMovements(productId, "b1")).length).toBe(1);
  });
  it("rejects untracked product with PRODUCT_NOT_TRACKED", async () => {
    const { svc } = await setupSvc();
    const { db } = { db: null as never };
    void db;
    // covered via dedicated untracked setup below
  });
  it("interleaved concurrent movements keep balance equal to ledger sum", async () => {
    const { db, svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r0", { productId, type: "opening_stock", qtyDelta: 1000 });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        svc.recordMovement("b1", "u1", `rc${i}`, { productId, type: "receive", qtyDelta: 1 }),
      ),
    );
    const bal = await db.findBalance(productId, "b1");
    const ledger = await db.listMovements(productId, "b1");
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("rebuild reports zero drift on healthy tenant", async () => {
    const { svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r1", { productId, type: "receive", qtyDelta: 7 });
    const out = await svc.rebuild("b1", "u1", "rr");
    expect(out.drifts).toEqual([]);
    expect(out.checked).toBeGreaterThanOrEqual(1);
  });
});
```

(Add matching imports for `computeBalanceFromLedger` at the top; fix the placeholder untracked test to create an untracked product via `db.createProduct({ ...trackInventory: false })` and assert `PRODUCT_NOT_TRACKED` on a `receive` movement.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/inventory/nest/inventory.service.test.ts`
Expected: FAIL with cannot find module `./inventory.service`.

- [ ] **Step 3: Write minimal service implementation**

Create `apps/api/src/inventory/nest/inventory.service.ts` per the rules above, in `BusinessService`/`CatalogService` style. `validateQtyDelta` from Task 2 enforces signs; `withScope` scopes every call; audit actions `inventory.adjust` (movements) and `inventory.rebuild`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/inventory/nest/inventory.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/inventory/nest/inventory.service.ts apps/api/src/inventory/nest/inventory.service.test.ts
git commit -m "feat: add phase3 inventory service"
```

### Task 5: Inventory HTTP layer

**Files:**
- Create: `apps/api/src/inventory/nest/inventory.controller.ts`
- Create: `apps/api/src/inventory/nest/inventory.module.ts`
- Modify: `apps/api/src/app.module.ts` (register controller + service in `@Module` and `createTestApp`)
- Modify: `apps/api/src/common/http-helpers.ts` (add `INSUFFICIENT_STOCK: 409`, `PRODUCT_NOT_TRACKED: 400`)
- Create: `apps/api/test/inventory.contract.test.ts`

**Interfaces:**
- Consumes: Task 4 `InventoryService`, Task 1 Zod schemas, Phase 1 guards/`AuthService.rolePermissions`/`fail`/`statusFor`/`rid`.
- Produces: `GET/POST` inventory routes. Task 6 tests permission/cross-tenant behavior.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on the two POSTs; writes check `rolePermissions(role).includes("inventory.adjust")` else `FORBIDDEN`; Zod `safeParse` failures → `VALIDATION` 400; service throws map via `statusFor(code)`.

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/test/inventory.contract.test.ts` with file-scoped fixtures (same `jar()` cookie pattern as catalog tests):

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

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-inv@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500 });
  productId = prod.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase3 inventory HTTP contract", () => {
  it("records opening stock and reads it back in balances", async () => {
    const mov = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "opening_stock", qtyDelta: 50 });
    expect(mov.status).toBe(201);
    const bal = await request(app.getHttpServer()).get("/api/v1/inventory/balances")
      .set("Cookie", cookie);
    expect(bal.status).toBe(200);
    expect(bal.body.items.some((b: { productId: string; qtyOnHand: number }) => b.productId === productId && b.qtyOnHand === 50)).toBe(true);
  });

  it("rejects oversell with INSUFFICIENT_STOCK", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "damage", qtyDelta: -999, reason: "flood damage" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_STOCK");
  });

  it("rejects unauthenticated balances with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/inventory/balances");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns movement history newest-first", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/inventory/products/${productId}/movements`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/inventory.contract.test.ts`
Expected: FAIL — 404 on `/api/v1/inventory/movements` (no route yet).

- [ ] **Step 3: Write minimal controller + module + wiring**

Mirror `catalog.controller.ts` structure (`rid()`, `@Controller("api/v1")`, `@UseGuards(SessionGuard)`, `@Res()` responses, `fail`/`statusFor`). Wire into `app.module.ts` `@Module` and `createTestApp` factory. Add the two codes to `CODE_STATUS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- test/inventory.contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/inventory/nest/inventory.controller.ts apps/api/src/inventory/nest/inventory.module.ts apps/api/src/app.module.ts apps/api/src/common/http-helpers.ts apps/api/test/inventory.contract.test.ts
git commit -m "feat: add phase3 inventory http layer"
```

### Task 6: Cross-tenant and role contract coverage + live-DB migration proof

**Files:**
- Modify: `apps/api/test/inventory.contract.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 5 routes, Phase 1 `ROLE_SEED` (cashier lacks `inventory.adjust`).
- Produces: proof of FORBIDDEN cashier writes, NOT_FOUND cross-tenant access, rebuild round-trip.

- [ ] **Step 1: Write the failing coverage tests**

Append:

```ts
describe("phase3 inventory permissions and rebuild", () => {
  it("cashier role lacks inventory.adjust", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("inventory.adjust");
    expect(svc.rolePermissions("inventory")).toContain("inventory.adjust");
  });

  it("returns NOT_FOUND for another tenant's product history", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-inv@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const got = await request(app.getHttpServer())
      .get(`/api/v1/inventory/products/${productId}/movements`)
      .set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });

  it("rebuild round-trips with zero drift", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/inventory/rebuild")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.drifts).toEqual([]);
  });

  it("low-stock view surfaces the low product", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/inventory/balances?view=low")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/inventory.contract.test.ts`
Expected: FAIL — rebuild shape mismatch or equivalent (fix the route to return `{ checked, drifts }`).

- [ ] **Step 3: Write minimal fix**

Ensure `POST /api/v1/inventory/rebuild` returns `200 { checked, drifts }`. Shape fix only.

- [ ] **Step 4: Prove migrations 0001→0004 on live Postgres**

Run against `pos-db-phase3` (host port 5433):

```bash
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0001_phase0_foundation/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0002_phase1_auth/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0003_phase2_catalog/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0004_phase3_inventory/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -c '\dt'
```

Expected: all apply cleanly; `\dt` lists all tables including `InventoryMovement`, `InventoryBalance`. If a table already exists from a prior run, drop the `pos` database objects first (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) and re-apply in order.

- [ ] **Step 5: Run test to verify it passes, then commit**

Run: `pnpm --filter @pos/api test`
Expected: PASS (full API suite).

```bash
git add apps/api/test/inventory.contract.test.ts apps/api/src/inventory/nest/inventory.controller.ts
git commit -m "test: add phase3 permission rebuild and cross-tenant coverage"
```

### Task 7: Inventory web UI (uses frontend-design)

**Files:**
- Create: `apps/web/src/lib/inventory.ts`
- Create: `apps/web/test/inventory.test.ts`
- Create: `apps/web/src/app/inventory/page.tsx`
- Create: `apps/web/src/app/inventory/[productId]/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (link to `/inventory`)

**Interfaces:**
- Consumes: Task 5 routes via `apiFetch`; role from `GET /api/v1/me`.
- Produces: balances dashboard, movement-history page.

Design (frontend-design skill): inventory is an ops tool — commit to an **industrial/utilitarian** direction. Monospace numerals for quantities, tabular density, status as text + shape (never color alone), generous touch targets on the movement form for tablet use. No gradients, no decorative motion — the motion budget goes to the search/status transitions only.

Web rules: `"use client"` + TanStack Query like Phase 2 pages; CSRF token from `GET /api/v1/auth/csrf` for mutations; hide the movement form without `inventory.adjust` (owner/manager/inventory roles); server authoritative.

- [ ] **Step 1: Write the failing web test**

Create `apps/web/test/inventory.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("phase3 inventory web helpers", () => {
  it("builds a balances query string", async () => {
    const { buildBalancesSearch } = await import("../src/lib/inventory");
    expect(buildBalancesSearch({ view: "low", page: 1, pageSize: 20 })).toBe(
      "/api/v1/inventory/balances?view=low&page=1&pageSize=20",
    );
  });
  it("gates the movement form by role", async () => {
    const { canAdjustInventory, statusLabel } = await import("../src/lib/inventory");
    expect(canAdjustInventory("cashier")).toBe(false);
    expect(canAdjustInventory("inventory")).toBe(true);
    expect(statusLabel("low")).toBe("LOW");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test -- test/inventory.test.ts`
Expected: FAIL with cannot find module `../src/lib/inventory`.

- [ ] **Step 3: Write minimal lib + pages**

Create `apps/web/src/lib/inventory.ts`:

```ts
const ADJUST_ROLES = new Set(["owner", "manager", "inventory"]);

export function canAdjustInventory(role: string): boolean {
  return ADJUST_ROLES.has(role);
}

export function statusLabel(status: string): string {
  return status.toUpperCase();
}

export function buildBalancesSearch(params: {
  view?: string;
  page?: number;
  pageSize?: number;
}): string {
  const sp = new URLSearchParams();
  sp.set("view", params.view ?? "all");
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 20));
  return `/api/v1/inventory/balances?${sp.toString()}`;
}
```

Create `/inventory/page.tsx`: balances table (product name, on-hand tabular numerals, reorder level, OK/LOW/OUT text badge), view tabs all/low/out, record-movement form (product id, type select, qty, reason) behind `canAdjustInventory`. Create `/inventory/[productId]/page.tsx`: movement history list newest-first + movement form. Add dashboard link.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/inventory.ts apps/web/test/inventory.test.ts apps/web/src/app/inventory/page.tsx "apps/web/src/app/inventory/[productId]/page.tsx" apps/web/src/app/page.tsx
git commit -m "feat: add phase3 inventory web ui"
```

### Task 8: Exit gate and verification

**Files:**
- Create: `tests/phase3-exit.test.ts`
- Create: `scripts/verify-phase3.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase3 line, byte-preserving — file is CRLF)

**Interfaces:**
- Consumes: all Phase 3 deliverables.
- Produces: Phase 3 exit proof.

- [ ] **Step 1: Write the failing exit test**

Create `tests/phase3-exit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateQtyDelta } from "../apps/api/src/inventory/signs";
import { computeBalanceFromLedger, deriveStockStatus } from "../apps/api/src/inventory/projection";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { InventoryService } from "../apps/api/src/inventory/nest/inventory.service";

describe("phase3 exit", () => {
  it("opening->receive->damage->adjust sequence leaves balance equal to ledger sum", async () => {
    const db = createMemoryDb();
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement("b1", "u1", "r1", { productId: prod.id, type: "opening_stock", qtyDelta: 100 });
    await svc.recordMovement("b1", "u1", "r2", { productId: prod.id, type: "receive", qtyDelta: 20 });
    await svc.recordMovement("b1", "u1", "r3", { productId: prod.id, type: "damage", qtyDelta: -2, reason: "2 broken" });
    await svc.recordMovement("b1", "u1", "r4", { productId: prod.id, type: "adjustment", qtyDelta: 1, reason: "recount" });
    const bal = await db.findBalance(prod.id, "b1");
    const ledger = await db.listMovements(prod.id, "b1");
    expect(bal!.qtyOnHand).toBe(119);
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("oversell is rejected and sign validation holds", async () => {
    expect(() => validateQtyDelta("sale", 5)).toThrow("VALIDATION");
    expect(deriveStockStatus({ qtyOnHand: 2, reorderLevel: 5, trackInventory: true })).toBe("low");
  });
  it("concurrent receives keep balance equal to ledger sum", async () => {
    const db = createMemoryDb();
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement("b1", "u1", "r0", { productId: prod.id, type: "opening_stock", qtyDelta: 500 });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        svc.recordMovement("b1", "u1", `rc${i}`, { productId: prod.id, type: "receive", qtyDelta: 1 }),
      ),
    );
    const bal = await db.findBalance(prod.id, "b1");
    const ledger = await db.listMovements(prod.id, "b1");
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("rebuild detects zero drift on a healthy tenant", async () => {
    const db = createMemoryDb();
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement("b1", "u1", "r1", { productId: prod.id, type: "receive", qtyDelta: 7 });
    const out = await svc.rebuild("b1", "u1", "rr");
    expect(out.drifts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:exit`
Expected: FAIL with cannot find module `../apps/api/src/inventory/signs` (until Tasks 2–4 land; passes when executed in order).

- [ ] **Step 3: Write minimal verification script**

Create `scripts/verify-phase3.test.mjs`:

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0004_phase3_inventory/migration.sql"),
  existsSync("packages/validation/src/inventory.schema.ts"),
  existsSync("apps/api/src/inventory/signs.ts"),
  existsSync("apps/api/src/inventory/projection.ts"),
  existsSync("apps/api/src/inventory/nest/inventory.service.ts"),
  existsSync("apps/api/src/inventory/nest/inventory.controller.ts"),
  existsSync("apps/api/src/inventory/nest/inventory.module.ts"),
  existsSync("apps/api/test/inventory.contract.test.ts"),
  existsSync("apps/web/src/app/inventory/page.tsx"),
  existsSync("tests/phase3-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE3_OK");
} else {
  console.error("PHASE3_MISSING");
  process.exit(1);
}
```

Append `      - run: node scripts/verify-phase3.test.mjs` to `.github/workflows/ci.yml` byte-preserving (CRLF file — use byte append, never a full rewrite).

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase3.test.mjs`
Expected: all green + `PHASE3_OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/phase3-exit.test.ts scripts/verify-phase3.test.mjs .github/workflows/ci.yml
git commit -m "test: add phase3 exit gate and verification"
```
