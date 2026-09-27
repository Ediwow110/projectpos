# Phase 9a Multi-Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 9a per `docs/superpowers/specs/2026-09-24-phase9a-multibranch-design.md`: branch-scoped operations and stock transfers with dual-location ledger entries, keeping every Phase 0-8 suite green via nullable scoping.

**Architecture:** One new NestJS `BranchModule` (branches + transfers) following Phase 1-8 conventions exactly: Zod at the edge, `SessionGuard` + `CsrfGuard`, `inventory.adjust` gates for transfer writes, `withScope` tenant scoping, append-only audit, memory-DB contract tests via `supertest`. Branch scope is a nullable `branchId` on operational rows (no backfill, no NOT NULL); `TransferService` instantiates no other service (writes movements/balances directly through `DbPort`, like `InventoryService` does). Reports gain a `branchId` filter plus a branches comparison view. No new infra, no offline behavior (Phase 9b).

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 3.2.7, supertest, Next.js 15 + React 19 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-24-phase9a-multibranch-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, integer quantities for stock, no float arithmetic.
- Tenant derived server-side from authenticated membership only; `branchId` never trusted from the client without a same-business existence check.
- Every business-owned table includes businessId; branch scoping is additive and nullable — existing null-branch behavior must not change (proved by all prior suites staying green).
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC, `X-Request-Id` correlation.
- `Idempotency-Key` required on transfer dispatch/receive/cancel (commandTypes `transfer.dispatch`, `transfer.receive`, `transfer.cancel`); uniqueness on `(businessId, key, commandType)`; fingerprint mismatch → `IDEMPOTENCY_MISMATCH`.
- Audit log append-only; no new permission keys (`inventory.adjust` for transfer writes; owner/manager role-set for branch CRUD).
- Cookie `pos_session` + `X-CSRF-Token` on mutations; explicit `res.status(...)` on every POST.
- No Expense/Customer/Product/Category schema changes; no franchise/branch-pricing/offline/AI work.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/database/prisma/schema.prisma`: add `Branch` + `StockTransfer` + `StockTransferLine` models; nullable `branchId` on Register/Shift/CashMovement/InventoryBalance/InventoryMovement/Sale/Expense; relation lists on `Business` (Task 1).
- `packages/database/prisma/migrations/0009_phase9a_branches/migration.sql` (Task 1).
- `packages/validation/src/branches.schema.ts` + `test/branches.schema.test.ts`: branch + transfer schemas (Task 1).
- `packages/validation/src/sales.schema.ts`: optional `branchId` on draft/complete (Task 1).
- `packages/validation/src/inventory.schema.ts`: optional `branchId` on movementCreate (Task 1).
- `packages/validation/src/shifts.schema.ts`: optional `branchId` on register create (Task 1).
- `packages/validation/src/expenses.schema.ts`: optional `branchId` on expense create (Task 1).
- `packages/validation/src/reports.schema.ts`: optional `branchId` on base query (Task 1).
- `apps/api/src/branches/nest/branch.service.ts` + `branch.service.test.ts` (Task 2).
- `apps/api/src/transfers/transfer-math.ts` (lifecycle helper) + `apps/api/src/transfers/nest/transfer.service.ts` + `transfer.service.test.ts` (Task 3).
- `apps/api/src/common/db.port.ts` + `memory.db.ts`: branch types/methods + `branchId` fields (Tasks 2-3).
- Inventory/sales/shift/expense service + fixture updates for branch keys (Task 4).
- `apps/api/src/branches/nest/branch.controller.ts` + `branch.module.ts` (registers + branches routes) (Task 5).
- `apps/api/src/transfers/nest/transfer.controller.ts` + `transfer.module.ts` (Task 5).
- `apps/api/src/app.module.ts` wiring (Task 5).
- `apps/api/src/common/http-helpers.ts`: `TRANSFER_INVALID_STATE: 409` (Task 5).
- `apps/api/test/branch.contract.test.ts`, `transfer.contract.test.ts` (Tasks 5-6).
- `apps/api/src/reports/nest/reporting.service.ts`: branch filter + `getBranchesReport` (Task 6).
- `apps/web/src/lib/branches.ts` + `test/branches.test.ts` (Task 7).
- `apps/web/src/app/branches/page.tsx`, `transfers/page.tsx`, `transfers/[id]/page.tsx`, `reports/branches/page.tsx` (Task 7).
- Dashboard + page.tsx links, POS/register/shift display touches (Task 7).
- `tests/phase9a-exit.test.ts`, `scripts/verify-phase9a.test.mjs`, CI extension (Task 8).

### Task 1: Schema plus validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0009_phase9a_branches/migration.sql`
- Create: `packages/validation/src/branches.schema.ts`
- Modify: `packages/validation/src/index.ts`, `sales.schema.ts`, `inventory.schema.ts` (`movementCreateSchema`), `shifts.schema.ts` (register create), `expenses.schema.ts` (expense create), `reports.schema.ts` (base query)
- Create: `packages/validation/test/branches.schema.test.ts`

**Interfaces:**
- Consumes: Phase 0-8 schema/validation patterns.
- Produces: `branchCreateSchema`, `branchUpdateSchema`, `transferCreateSchema`, `transferListSchema`, `BRANCH_TYPES`; Prisma `Branch`/`StockTransfer`/`StockTransferLine` + nullable `branchId` columns; optional `branchId` on six existing Zod schemas. Tasks 2-7 consume these names.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/branches.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { branchCreateSchema, transferCreateSchema } from "../src/branches.schema";

describe("phase9a branch schemas", () => {
  it("rejects empty branch name", () => {
    expect(() => branchCreateSchema.parse({ name: "" })).toThrow();
  });
  it("rejects unknown branch type", () => {
    expect(() => branchCreateSchema.parse({ name: "Main", type: "planet" })).toThrow();
  });
  it("defaults branch type to store", () => {
    expect(branchCreateSchema.parse({ name: "Main" }).type).toBe("store");
  });
  it("rejects same-branch transfers and empty lines", () => {
    expect(() =>
      transferCreateSchema.parse({ fromBranchId: "b", toBranchId: "b", lines: [{ productId: "p", qty: 1 }] }),
    ).toThrow();
    expect(() =>
      transferCreateSchema.parse({ fromBranchId: "a", toBranchId: "b", lines: [] }),
    ).toThrow();
  });
  it("rejects zero qty lines", () => {
    expect(() =>
      transferCreateSchema.parse({ fromBranchId: "a", toBranchId: "b", lines: [{ productId: "p", qty: 0 }] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/branches.schema.test.ts`
Expected: FAIL with cannot find module `../src/branches.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/branches.schema.ts`:

```ts
import { z } from "zod";

export const BRANCH_TYPES = ["store", "warehouse"] as const;

export const branchCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  type: z.enum(BRANCH_TYPES).default("store"),
  isActive: z.boolean().optional(),
});

export const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const transferLineSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
});

export const transferCreateSchema = z
  .object({
    fromBranchId: z.string().min(1, "VALIDATION"),
    toBranchId: z.string().min(1, "VALIDATION"),
    lines: transferLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, { message: "VALIDATION" });

export const transferListSchema = z.object({
  status: z.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});
```

Append `export * from "./branches.schema";` to the validation index. Add `branchId: z.string().min(1, "VALIDATION").optional()` to: `draftCreateSchema` + `completeSchema` (sales.schema.ts), `movementCreateSchema` (inventory.schema.ts), register create schema (shifts.schema.ts — check exact export name: `registerCreateSchema`), `expenseCreateSchema` (expenses.schema.ts), and the base `reportsQuerySchema` (reports.schema.ts).

Append to `packages/database/prisma/schema.prisma`:

```prisma
model Branch {
  id         String   @id @default(cuid())
  businessId String
  name       String
  type       String   @default("store")
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  business   Business @relation(fields: [businessId], references: [id])
  registers  Register[]
  @@unique([businessId, name])
  @@index([businessId])
}

model StockTransfer {
  id            String              @id @default(cuid())
  businessId    String
  fromBranchId  String
  toBranchId    String
  status        String              @default("DRAFT")
  requestedBy   String
  dispatchedBy  String?
  receivedBy    String?
  requestId     String
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  business      Business            @relation(fields: [businessId], references: [id])
  lines         StockTransferLine[]
  @@index([businessId, status, createdAt])
}

model StockTransferLine {
  id         String        @id @default(cuid())
  businessId String
  transferId String
  productId  String
  qty        Int
  business   Business      @relation(fields: [businessId], references: [id])
  transfer   StockTransfer @relation(fields: [transferId], references: [id])
  @@index([businessId, transferId])
}
```

Add nullable `branchId String?` to models `Register`, `Shift`, `CashMovement`, `InventoryBalance`, `InventoryMovement`, `Sale`, `Expense`; add `branches Branch[]`, `transfers StockTransfer[]`, `transferLines StockTransferLine[]` to `Business`; add `branches`... registers need `branches` back-relation? `Register` gains `branch Branch? @relation(fields: [branchId], references: [id])` and `Branch.registers Register[]`. Keep other branch FKs relation-free (plain string columns, no Prisma relation) to minimize relation churn — document this choice in a schema comment.

Create `packages/database/prisma/migrations/0009_phase9a_branches/migration.sql`:

```sql
CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'store',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_businessId_name_key" ON "Branch"("businessId", "name");
CREATE INDEX "Branch_businessId_idx" ON "Branch"("businessId");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StockTransfer" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "fromBranchId" TEXT NOT NULL,
  "toBranchId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "requestedBy" TEXT NOT NULL,
  "dispatchedBy" TEXT,
  "receivedBy" TEXT,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockTransfer_businessId_status_createdAt_idx" ON "StockTransfer"("businessId", "status", "createdAt");
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StockTransferLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockTransferLine_businessId_transferId_idx" ON "StockTransferLine"("businessId", "transferId");
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Register" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Shift" ADD COLUMN "branchId" TEXT;
ALTER TABLE "CashMovement" ADD COLUMN "branchId" TEXT;
ALTER TABLE "InventoryBalance" ADD COLUMN "branchId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Register" ADD CONSTRAINT "Register_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (5 new tests plus existing 48).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/branches.schema.ts packages/validation/src/index.ts packages/validation/src/sales.schema.ts packages/validation/src/inventory.schema.ts packages/validation/src/shifts.schema.ts packages/validation/src/expenses.schema.ts packages/validation/src/reports.schema.ts packages/validation/test/branches.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0009_phase9a_branches/migration.sql
git commit -m "feat: add phase9a branch transfer schemas and validation contracts"
```

### Task 2: Branch port, memory implementation, and BranchService

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbBranch` + branch methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement; extend port import list)
- Create: `apps/api/src/branches/nest/branch.service.ts`
- Create: `apps/api/src/branches/nest/branch.service.test.ts`

**Interfaces:**
- Consumes: Task 1 Zod shapes (shape-level), `withScope`.
- Produces: `BranchService` with `createBranch(businessId, actorId, requestId, input, role)`, `listBranches(businessId)`, `updateBranch(businessId, actorId, requestId, id, patch, role)`; `DbPort.createBranch`, `listBranchesByBusiness`, `findBranchById`, `updateBranch`. Task 5 controller calls these exact methods.

Service rules (follow `ShiftService.createRegister` precedent):
- `createBranch(businessId, actorId, requestId, { name, type? }, role)`: role must be `owner`/`manager` else `FORBIDDEN`; name trimmed non-empty; duplicate name per business → `VALIDATION`; type defaults `store`; audit `branch.create`.
- `listBranches(businessId)`: all rows newest... order by name ASC (deterministic for pickers).
- `updateBranch(..., role)`: same gate; rename duplicate → `VALIDATION`; `isActive: false` archives; audit `branch.update`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/branches/nest/branch.service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BranchService } from "./branch.service";

describe("phase9a branch port", () => {
  it("round-trips a branch scoped to its business", async () => {
    const db = createMemoryDb();
    const b = await db.createBranch({ businessId: "b1", name: "Main", type: "store", isActive: true });
    expect((await db.listBranchesByBusiness("b1")).map((x) => x.id)).toContain(b.id);
    expect(await db.listBranchesByBusiness("b2")).toEqual([]);
    expect(await db.findBranchById(b.id, "b2")).toBeNull();
  });
});

describe("phase9a branch service", () => {
  it("creates branches with audit and duplicate protection", async () => {
    const db = createMemoryDb();
    const svc = new BranchService(db);
    const b = await svc.createBranch("b1", "u1", "r1", { name: "Main" }, "owner");
    expect(b.type).toBe("store");
    await expect(svc.createBranch("b1", "u1", "r2", { name: "Main" }, "owner")).rejects.toThrow("VALIDATION");
    await svc.createBranch("b1", "u1", "r3", { name: "Warehouse", type: "warehouse" }, "manager");
    expect((await db.listAudit()).some((a) => a.action === "branch.create")).toBe(true);
  });
  it("blocks cashier branch management and cross-tenant reads", async () => {
    const db = createMemoryDb();
    const svc = new BranchService(db);
    await expect(svc.createBranch("b1", "u9", "r9", { name: "Back" }, "cashier")).rejects.toThrow("FORBIDDEN");
    const b = await svc.createBranch("b1", "u1", "r1", { name: "Main" }, "owner");
    await expect(svc.updateBranch("b1", "u1", "r2", b.id, { name: "HQ" }, "cashier")).rejects.toThrow("FORBIDDEN");
    expect(await db.findBranchById(b.id, "b2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/branches/nest/branch.service.test.ts`
Expected: FAIL — `db.createBranch is not a function`.

- [ ] **Step 3: Write minimal port + memory + service implementation**

Port additions:

```ts
export interface DbBranch {
  id: string;
  businessId: string;
  name: string;
  type: string;
  isActive: boolean;
}
```

```ts
  createBranch(b: Omit<DbBranch, "id">): Promise<DbBranch>;
  listBranchesByBusiness(businessId: string): Promise<DbBranch[]>;
  findBranchById(id: string, businessId: string): Promise<DbBranch | null>;
  updateBranch(id: string, businessId: string, patch: Partial<Omit<DbBranch, "id" | "businessId">>): Promise<DbBranch | null>;
```

Memory: `branches` map, `nid("br")` ids, strict businessId scoping. Service per the rules above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/branches/nest/branch.service.test.ts`
Expected: PASS (1 port + 2 service tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/branches/nest/branch.service.ts apps/api/src/branches/nest/branch.service.test.ts
git commit -m "feat: add phase9a branch service"
```

### Task 3: Transfer lifecycle domain, port, memory, and TransferService

**Files:**
- Create: `apps/api/src/transfers/transfer-math.ts` (lifecycle guard helper)
- Modify: `apps/api/src/common/db.port.ts` (append `DbStockTransfer`, `DbStockTransferLine`, transfer methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement)
- Create: `apps/api/src/transfers/nest/transfer.service.ts`
- Create: `apps/api/src/transfers/nest/transfer.service.test.ts`

**Interfaces:**
- Consumes: Task 2 port patterns, `validateQtyDelta`-style sign discipline from inventory signs (transfer_out negative / transfer_in positive already defined — reuse, do not redefine signs).
- Produces: `canTransitionTransfer`, `TransferService` with `createTransfer`, `dispatchTransfer`, `receiveTransfer`, `cancelTransfer`, `getTransfer`, `listTransfers`. Task 5 controller calls these exact methods.

Domain (`transfer-math.ts`):

```ts
const TRANSFER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionTransfer(from: string, to: string): string {
  const allowed = TRANSFER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new Error("TRANSFER_INVALID_STATE");
  return to;
}
```

Service rules (`TransferService`, constructor takes `DbPort`, `withLock` per transfer id + per source branch for dispatch atomicity — use key `transfer:${businessId}:${transferId}` for all three mutating calls):
- `createTransfer(businessId, actorId, requestId, { fromBranchId, toBranchId, lines }, granted)`: requires `inventory.adjust`; branches must differ, exist in business, and be active (else `VALIDATION`); each line product exists in business (else `NOT_FOUND`) with positive int qty; creates `StockTransfer` (status DRAFT, requestedBy actorId) + lines; audit `transfer.create`. Returns the transfer with embedded `lines`.
- `dispatchTransfer(businessId, actorId, requestId, transferId, key)`: requires `inventory.adjust`; transfer must be DRAFT (else `TRANSFER_INVALID_STATE`); idempotency (`transfer.dispatch`, fingerprint over `{ transferId }`): replay returns `{ transfer, replayed: true }`, mismatch → `IDEMPOTENCY_MISMATCH`; pre-check every line: source balance `(business, fromBranch, product)` covers qty else `INSUFFICIENT_STOCK` with nothing written; then per line: `transfer_out` movement (negative, `referenceType: "StockTransfer"`, `referenceId: transferId`, `branchId: fromBranchId`) + decrement source balance; status → IN_TRANSIT + dispatchedBy; claim idempotency; audit `transfer.dispatch`. Returns `{ transfer, replayed }`.
- `receiveTransfer(...)`: same shape with key type `transfer.receive`; `IN_TRANSIT` only; writes `transfer_in` movements (positive, same reference) + increments destination balances; status → RECEIVED + receivedBy; audit `transfer.receive`.
- `cancelTransfer(..., key)`: `transfer.cancel` key; DRAFT → CANCELLED (no movements); IN_TRANSIT → posts compensating `transfer_in` movements to the SOURCE branch per line (reason `cancel:<transferId>`... movements carry `reason` field — set reason string, reference stays `StockTransfer`/transferId), restores source balances, then CANCELLED; RECEIVED/CANCELLED → `TRANSFER_INVALID_STATE`; audit `transfer.cancel`.
- `getTransfer(businessId, transferId)`: `NOT_FOUND` cross-tenant; embeds lines.
- `listTransfers(businessId, { status?, page, pageSize })`: status filter, newest-first by id desc... memory ids embed Date.now base36 — sortable desc as creation proxy (matches existing memory convention); bounded page `{ items, total, page, pageSize }`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/transfers/nest/transfer.service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { TransferService } from "./transfer.service";

const GRANT = ["inventory.adjust"];

async function setupTransfer() {
  const db = createMemoryDb();
  const svc = new TransferService(db);
  const a = await db.createBranch({ businessId: "b1", name: "A", type: "store", isActive: true });
  const b = await db.createBranch({ businessId: "b1", name: "B", type: "store", isActive: true });
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", branchId: a.id, productId: prod.id, qtyOnHand: 10 });
  return { db, svc, a: a.id, b: b.id, productId: prod.id };
}
```

```ts
describe("phase9a transfer service", () => {
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", branchId: a.id, productId: prod.id, qtyOnHand: 10 });
  return { db, svc, a: a.id, b: b.id, productId: prod.id };
}
```

Tests:

```ts
describe("phase9a transfer service", () => {
  it("dispatches and receives with dual-location ledger entries", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 4 }],
    }, GRANT);
    expect(t.status).toBe("DRAFT");
    await svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-d1");
    expect((await db.findBalance(productId, "b1", a))!.qtyOnHand).toBe(6);
    await svc.receiveTransfer("b1", "u1", "r3", t.id, "key-r1");
    expect((await db.findBalance(productId, "b1", b))!.qtyOnHand).toBe(4);
    const moves = await db.listMovementsByBusiness("b1");
    expect(moves.filter((m) => m.type === "transfer_out").length).toBe(1);
    expect(moves.filter((m) => m.type === "transfer_in").length).toBe(1);
    const actions = (await db.listAudit()).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["transfer.create", "transfer.dispatch", "transfer.receive"]));
  });
  it("rejects oversell dispatch with nothing written", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 99 }],
    }, GRANT);
    await expect(svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-d2")).rejects.toThrow("INSUFFICIENT_STOCK");
    expect(await db.listMovementsByBusiness("b1")).toEqual([]);
    expect((await db.findTransferById(t.id, "b1"))!.status).toBe("DRAFT");
  });
```

The trailing `findShiftById` line is filler nonsense (asserts nothing about transfers). Self-review fix: drop it; the meaningful assertions are the empty-movements check plus status still DRAFT:

```ts
    expect((await db.findTransferById(t.id, "b1"))!.status).toBe("DRAFT");
```

```ts
  it("rejects double dispatch and receive-before-dispatch", async () => {
    const { svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 1 }],
    }, GRANT);
    await expect(svc.receiveTransfer("b1", "u1", "r2", t.id, "key-rx")).rejects.toThrow("TRANSFER_INVALID_STATE");
    await svc.dispatchTransfer("b1", "u1", "r3", t.id, "key-d3");
    await expect(svc.dispatchTransfer("b1", "u1", "r4", t.id, "key-d4")).rejects.toThrow("TRANSFER_INVALID_STATE");
  });
  it("cancels in-transit by restoring source stock", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 4 }],
    }, GRANT);
    await svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-d5");
    await svc.cancelTransfer("b1", "u1", "r3", t.id, "key-c5");
    expect((await db.findBalance(productId, "b1", a))!.qtyOnHand).toBe(10);
    expect((await db.findBalance(productId, "b1", b))!.qtyOnHand).toBe(0);
  });
  it("requires inventory.adjust and blocks cross-tenant access", async () => {
    const { svc, a, b, productId } = await setupTransfer();
    await expect(svc.createTransfer("b1", "u9", "r9", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 1 }],
    }, [])).rejects.toThrow("FORBIDDEN");
    await expect(svc.getTransfer("b2", "nope")).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/transfers/nest/transfer.service.test.ts`
Expected: FAIL with cannot find module `./transfer.service`.

- [ ] **Step 3: Write minimal math + port + memory + service implementation**

`transfer-math.ts`, port additions (DbStockTransfer, DbStockTransferLine, six methods; optional `branchId` on DbBalance + DbMovement), memory maps + key scoping (`balances` key `${businessId}:${branchId ?? ""}:${productId}`; `findBalance(productId, businessId, branchId: string | null = null)`; `listMovements(productId, businessId, branchId?: string | null)` with undefined = all branches), service per rules. Service `listTransfers` sorts id desc (memory creation proxy, existing convention).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/transfers/nest/transfer.service.test.ts`
Expected: PASS (5 tests). Also run prior inventory/sales suites to prove null-branch behavior unchanged: `pnpm --filter @pos/api test -- src/inventory src/sales`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/transfers/transfer-math.ts apps/api/src/transfers/nest/transfer.service.ts apps/api/src/transfers/nest/transfer.service.test.ts apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts
git commit -m "feat: add phase9a transfer service"
```

### Task 4: Branch keys across inventory, sales, shifts, expenses, registers

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (optional `branchId` on DbSale, DbShift, DbCashMovement, DbExpense, DbRegister)
- Modify: `apps/api/src/inventory/nest/inventory.service.ts` (accept/store `branchId` on movements; balance key; rebuild groups by branch)
- Modify: `apps/api/src/sales/nest/sales.service.ts` (validate/store `branchId`; pass into `applyStockEffect`; refund branch inheritance)
- Modify: `apps/api/src/refunds/nest/refund.service.ts` (return/cash movements use sale's branch)
- Modify: `apps/api/src/shifts/nest/shift.service.ts` (register branch inheritance on open; cash movement branch; close/report includes branch)
- Modify: `apps/api/src/expenses/nest/expense.service.ts` (optional branchId; shift inheritance)
- Modify: existing fixtures in `apps/api/src/**/ *.test.ts` ONLY if typecheck demands (branchId optional → most fixtures untouched)
- Modify: `apps/api/src/customers/nest/customer.service.ts` — nothing (customers unscoped; verify no change needed)

**Interfaces:**
- Consumes: Task 3 port/memory branch keys.
- Produces: branch-aware writes with null fallback everywhere. Tasks 5-6 test over HTTP.

Rules per service (all backward compatible — new input fields optional, null fallback):
- Inventory `recordMovement(..., { ..., branchId? })`: stores on movement; balance read/write keyed with it; oversell per key; `getBalances`/`getMovementHistory` accept optional `branchId` filter; `rebuild` reports per `(branch, product)`... rebuild returns `{ checked, drifts }` — drifts gain `branchId` field (additive).
- Sales `createDraft`/`completeSale`: accept optional `branchId` input; validate same-business branch when present (`findBranchById`, else `VALIDATION`); effective = input ?? register's branch ?? null (register lookup already exists for registerId — read its `branchId`); store on sale; pass into `applyStockEffect` (signature gains trailing `branchId: string | null`); reconcile path uses `sale.branchId`.
- Refunds: `return` movements + balance increments use the original sale's `branchId`; `cash_refund` posting unchanged (shift row already carries branch via Task 3's postCashSale... postCashSale looks up the OPEN shift by register — shift has branchId after Task 4 shift changes; pass it through).
- Shifts: `openShift` copies `register.branchId ?? null` onto shift + opening movement; `recordCash` copies `shift.branchId`; `closeShift` report includes `branchId`; `postCashSale` sets movement `branchId` from the resolved open shift.
- Expenses: `createExpense` accepts optional `branchId`; shift-linked expenses inherit `shift.branchId`; void adjustment posts to the same branch context (existing register lookup already scopes correctly).
- Registers: create/update accept optional `branchId` (validated); list/detail embed branch name? Detail embeds `{ branchId, branchName }` — service returns row + name lookup (null-safe).

- [ ] **Step 1: No new failing test file — extend two existing tests**

Append to `apps/api/src/sales/nest/sales.service.test.ts` (new describe; uses existing `setupSale` helper + a branch created inline):

```ts
describe("phase9a sale branch scope", () => {
  it("stores branchId from input and deducts branch-keyed stock", async () => {
    const { createMemoryDb } = await import("../../common/memory.db");
    const db = createMemoryDb();
    const branch = await db.createBranch({ businessId: "b1", name: "North", type: "store", isActive: true });
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", branchId: branch.id, productId: prod.id, qtyOnHand: 10 });
    const { SalesService } = await import("./sales.service");
    const svc = new SalesService(db);
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, branchId: branch.id,
    }, ALL);
    expect(draft.branchId).toBe(branch.id);
    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "br-sale-1", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    expect((await db.findBalance(prod.id, "b1", branch.id))!.qtyOnHand).toBe(8);
    expect(await db.findBalance(prod.id, "b1", null)).toBeNull();
  });
});
```

The last assertion is confused (null-branch balance was never created → `findBalance` returns null, and `0 - 0` is silly). Self-review fix: replace with an explicit null-scope check:

```ts
    expect(await db.findBalance(prod.id, "b1", null)).toBeNull();
```

meaning the branch-keyed deduction did not leak into the legacy null scope. (Requires `findBalance` to return null for missing keys — existing memory behavior ✓.)

Append to `apps/api/src/inventory/nest/inventory.service.test.ts` a branch-keyed movement test:

```ts
describe("phase9a inventory branch scope", () => {
  it("keeps balances per branch and validates branch movement input", async () => {
    const { createMemoryDb } = await import("../../common/memory.db");
    const { InventoryService } = await import("./inventory.service");
    const db = createMemoryDb();
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement("b1", "u1", "r1", { productId: prod.id, type: "receive", qtyDelta: 7, branchId: "br1" });
    expect((await db.findBalance(prod.id, "b1", "br1"))!.qtyOnHand).toBe(7);
    expect(await db.findBalance(prod.id, "b1", null)).toBeNull();
  });
});
```

Check `recordMovement`'s input type name before writing (`MovementInput` in inventory.service.ts — verify field addition point during implementation; the test passes `branchId` which must exist on the input type after Step 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts src/inventory/nest/inventory.service.test.ts`
Expected: FAIL — `draft.branchId` undefined / `branchId` unknown input (service ignores it until Step 3; the findBalance-with-branch assertions fail on missing port support... note `findBalance` 3-arg form lands in Task 3's port change — Task 4 consumes it).

- [ ] **Step 3: Implement all service edits per the Rules above**

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/api test` (full API suite — proves null-scope behavior unchanged)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/inventory/nest/inventory.service.ts apps/api/src/sales/nest/sales.service.ts apps/api/src/refunds/nest/refund.service.ts apps/api/src/shifts/nest/shift.service.ts apps/api/src/expenses/nest/expense.service.ts apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/sales/nest/sales.service.test.ts apps/api/src/inventory/nest/inventory.service.test.ts
git commit -m "feat: add phase9a branch keys across services"
```

### Task 5: Branch and transfer HTTP layer

**Files:**
- Create: `apps/api/src/branches/nest/branch.controller.ts` + `branch.module.ts`
- Create: `apps/api/src/transfers/nest/transfer.controller.ts` + `transfer.module.ts`
- Modify: `apps/api/src/app.module.ts` (register both + factories)
- Modify: `apps/api/src/common/http-helpers.ts` (add `TRANSFER_INVALID_STATE: 409`)
- Modify: `apps/api/src/sales/nest/sales.controller.ts`, `shift.controller.ts`, `inventory` controller, `expense.controller.ts` (thread `branchId` from parsed bodies — schemas already extended in Task 1)
- Create: `apps/api/test/branch.contract.test.ts`, `apps/api/test/transfer.contract.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4 services, Task 1 Zod schemas, guard/`fail`/`statusFor`/`rid` patterns.
- Produces: routes `GET/POST /api/v1/branches`, `PATCH /api/v1/branches/:id`, `GET/POST /api/v1/transfers`, `GET /api/v1/transfers/:id`, `POST /api/v1/transfers/:id/dispatch|receive|cancel`. Task 6 tests edges over these routes.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on POST/PATCH; branch writes check owner/manager role (else 403); transfer writes pass `granted` (service enforces `inventory.adjust`); dispatch/receive/cancel require `Idempotency-Key` (missing → 400); explicit `res.status(...)` (201 creates, 200 actions); replay returns `200 { ..., replayed: true }`.

- [ ] **Step 1: Write the failing contract tests**

`branch.contract.test.ts` (owner fixtures via register; file-scoped `jar()`):

```ts
describe("phase9a branch HTTP contract", () => {
  it("creates branches and rejects duplicates + cashier writes", ...); // POST → 201; dup name → 400 VALIDATION
  it("lists branches scoped to the business", ...); // second business sees []
  it("rejects unauthenticated reads", ...); // 401 TENANT_REQUIRED
});
```

Cashier-write denial over HTTP needs a cashier session — no invite API exists (documented Phase 8 gap). Assert the gate at the service level in the contract file instead (import BranchService with `{} as never`... service needs a DbPort — use `createMemoryDb()` import like catalog permission tests do with `AuthService`... catalog tests construct `new AuthService({} as never)` because rolePermissions is pure. BranchService.createBranch needs db for duplicate check. Use real `createMemoryDb()`: `new BranchService(createMemoryDb())`, call createBranch with role "cashier" → FORBIDDEN. Honest and direct.)

`transfer.contract.test.ts` (register owner, create branches A/B via API, product + stock 10 on A via API... stock on branch A requires movement `branchId` — movement schema extended in Task 1 ✓):

```ts
describe("phase9a transfer HTTP contract", () => {
  it("full lifecycle over HTTP with dual ledger entries", ...); // create → dispatch → receive; balances per branch via inventory/balances? balances endpoint has no branch filter... assert via GET product movements? Simplest: assert statuses + GET transfer detail shows lines; branch balances asserted at service level already (Task 3). HTTP asserts: 201s, status transitions, detail embeds lines.
  it("rejects double dispatch with TRANSFER_INVALID_STATE", ...);
  it("rejects unauthenticated access", ...);
});
```

Keep HTTP assertions to status codes, transitions, and embeds (deep ledger math lives in service tests — no duplication).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/api test -- test/branch.contract.test.ts test/transfer.contract.test.ts`
Expected: FAIL — 500s on `/api/v1/branches` (no routes yet).

- [ ] **Step 3: Write minimal controllers + modules + wiring + pass-throughs**

Mirror `shift.controller.ts` structure. Wire into `app.module.ts` + `createTestApp`. Add the code. Sales/shift/inventory/expense controllers: add `branchId: parsed.data.branchId` to service call inputs (fields already optional in services after Task 4).

- [ ] **Step 4: Run tests to verify they pass**

Run both files. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/branches/nest/branch.controller.ts apps/api/src/branches/nest/branch.module.ts apps/api/src/transfers/nest/transfer.controller.ts apps/api/src/transfers/nest/transfer.module.ts apps/api/src/app.module.ts apps/api/src/common/http-helpers.ts apps/api/src/sales/nest/sales.controller.ts apps/api/src/shifts/nest/shift.controller.ts apps/api/src/inventory/nest/inventory.controller.ts apps/api/src/expenses/nest/expense.controller.ts apps/api/test/branch.contract.test.ts apps/api/test/transfer.contract.test.ts
git commit -m "feat: add phase9a branch transfer http layer"
```

Check the inventory controller file name before implementing (`inventory/nest/inventory.controller.ts` per Phase 3 plan ✓) and the register-create handler name in the shift controller (`createRegister`? verify — the shift service has createRegister; the controller route is POST /registers — read the handler to thread branchId correctly).

### Task 6: Reports branch filter, branches view, transfer edge coverage, migration proof

**Files:**
- Modify: `apps/api/src/reports/nest/reporting.service.ts` (`branchId` filter on overview/sales/products/inventory/cash + `getBranchesReport`)
- Modify: `apps/api/src/reports/nest/reporting.controller.ts` (pass `branchId`; add `GET /api/v1/reports/branches`)
- Modify: `apps/api/test/transfer.contract.test.ts` (append edge describe)
- Modify: `apps/api/test/dashboard.contract.test.ts` (append branch-filter assertions)? No — keep dashboard file untouched (it asserts unfiltered totals that branch tests could disturb... separate app instances per file, so no interference; still, put branch report assertions in the transfer file's new block to keep concerns together. Decision: new `describe` in transfer.contract.test.ts covering both transfer edges AND the branches report.)

**Interfaces:**
- Consumes: Tasks 3-5.
- Produces: filtered analytics + comparison view; proof of migration 0001→0009 on live Postgres.

Service rules:
- `ReportQuery` gains `branchId?: string` (interface edit; all existing callers pass objects without it — additive, no breakage).
- Overview/sales/products: filter settled sales by `branchId` when present (null/undefined = all scopes); topProducts aggregate from filtered sales.
- Inventory report: gains optional `branchId` — health counts + lowStock filtered to the branch's balances (balances carry branchId after Task 4); movements section stays all-time business-wide (documented: movement rows carry branchId post-9a, but pre-9a rows are null-scoped — filtering would undercount history, so the movements section is intentionally unfiltered).
- Cash report: filter shifts by `registerId` (exists) — add `branchId` filter via shift.branchId.
- `getBranchesReport(businessId, { dateFrom?, dateTo?, compare? }, role, granted)`: per-branch rows for every active branch + an `unscoped` row when null-branch settled activity exists in range: `{ branchId: string | null, name, type, sales, orders, margin }` (`margin` omitted... margin needs profit math per branch — compute like products report when `cost.view` present, else null key present? Convention from products report: keys present with null values when unauthorized. Follow it: `margin: number | null`). Sorted by sales desc. Includes `generatedAt/range/compare/compareLabel`.
- Controller: `GET /api/v1/reports/branches` parses `reportsQuerySchema` (branchId irrelevant here — ignore if passed... Zod object with branchId optional; service ignores it for this view. Fine.)

Edge tests to append:

```ts
describe("phase9a transfer edges", () => {
  it("rejects same-branch and unknown-branch transfers with VALIDATION", ...);
  it("rejects receive-before-dispatch and cancel-after-receive", ...);
  it("rejects cashier transfer writes (service-level gate)", ...); // new TransferService(createMemoryDb()), createTransfer with [] → FORBIDDEN
  it("returns NOT_FOUND for another tenant's transfer", ...);
  it("compares branches in the report view", ...); // seed sales on two branches via API (draft+complete with branchId), assert branches report rows reconcile: sum(branch sales) + unscoped == overview total
});
```

Seeding branch sales over HTTP needs products with branch stock: create product (global), receive stock with `branchId` (movement schema extended ✓), draft/complete with `branchId` ✓ (all wired in Task 5).

- [ ] **Step 1-2: Write tests, watch them fail** (routes exist from Task 5 for transfer edges; branches report route does NOT → that test fails first as required).
- [ ] **Step 3: Implement service + controller changes.**
- [ ] **Step 4: Prove migrations 0001→0009 on live Postgres** (isolated `pos-db-phase9a` on 5433, same pattern as prior proofs; `\dt` 27 tables + `Sale_branchId...`? no new Sale index in 9a — 27 tables: 26 + Branch + StockTransfer + StockTransferLine = 29? Count: prior 26 included... Phase 6 proof showed 26 tables. +3 new = 29. Assert `\dt` row count 29. Container removed after.)
- [ ] **Step 5: Full API suite green, then commit**

```bash
git add apps/api/src/reports/nest/reporting.service.ts apps/api/src/reports/nest/reporting.controller.ts apps/api/test/transfer.contract.test.ts
git commit -m "test: add phase9a branch analytics and transfer edge coverage"
```

### Task 7: Branches/transfers web UI + dashboard filter (uses frontend-design)

**Files:**
- Create: `apps/web/src/lib/branches.ts`, `apps/web/test/branches.test.ts`
- Create: `apps/web/src/app/branches/page.tsx`, `transfers/page.tsx`, `transfers/[id]/page.tsx`, `reports/branches/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (branch filter dropdown on dashboard + links), `pos/page.tsx` (show register's branch? skip — registers already imply it; instead surface transfer links nowhere in POS. Decision: POS untouched.)
- Modify: `apps/web/src/app/registers/page.tsx` (branch picker on create), `shifts/page.tsx` (show branch), `sales/page.tsx` (branch filter input? add branch dropdown sourced from /branches — yes, one select)

**Interfaces:**
- Consumes: Tasks 5-6 routes via `apiFetch`; role from `GET /api/v1/me`.
- Produces: branch/transfer management UI, filtered analytics views.

Design (frontend-design skill): same appliance language — tabular numerals, text+shape lifecycle states (`DRAFT`, `IN TRANSIT`, `RECEIVED`, `CANCELLED` as text badges), no gradients. Signature for this phase: the transfer detail as a two-column source→destination ledger (out movements left, in movements right).

Web rules: `"use client"` + TanStack Query; CSRF for mutations; branch CRUD hidden unless owner/manager (`canManageBranches` in lib, tested); server authoritative.

Lib (`branches.ts`):

```ts
const MANAGE_ROLES = new Set(["owner", "manager"]);

export function canManageBranches(role: string): boolean {
  return MANAGE_ROLES.has(role);
}

export function transferStatusLabel(status: string): string {
  if (status === "IN_TRANSIT") return "IN TRANSIT";
  return status;
}

export function buildBranchesQuery(): string {
  return "/api/v1/branches";
}
```

Test (`branches.test.ts`): manage gates (manager true/cashier false), status labels (IN_TRANSIT→"IN TRANSIT", DRAFT→"DRAFT", RECEIVED→"RECEIVED"), query builder string.

Pages: branches CRUD list; transfers list (status filter) + create form (branch pickers + dynamic product/qty rows, client-side only) + detail with lifecycle buttons calling dispatch/receive/cancel (each with fresh `crypto.randomUUID()` idempotency key) + movement trail; reports/branches table; dashboard branch filter + nav links.

- [ ] **Steps 1-5: TDD then commit** (`feat: add phase9a branch transfer web ui`)

### Task 8: Exit gate and verification

**Files:**
- Create: `tests/phase9a-exit.test.ts`
- Create: `scripts/verify-phase9a.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase9a line via `Add-Content`)

**Interfaces:**
- Consumes: all Phase 9a deliverables.
- Produces: Phase 9a exit proof.

Exit test (`tests/phase9a-exit.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { canTransitionTransfer } from "../apps/api/src/transfers/transfer-math";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { BranchService } from "../apps/api/src/branches/nest/branch.service";
import { TransferService } from "../apps/api/src/transfers/nest/transfer.service";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { ReportingService } from "../apps/api/src/reports/nest/reporting.service";

const GRANT = ["discount.override", "sale.void", "sale.refund", "cost.view", "inventory.adjust"];
const ALL = [...GRANT];

async function setup() {
  const db = createMemoryDb();
  const branches = new BranchService(db);
  const a = await branches.createBranch("b1", "u1", "r0", { name: "North" }, "owner");
  const b = await branches.createBranch("b1", "u1", "r0", { name: "South" }, "owner");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", branchId: a.id, productId: prod.id, qtyOnHand: 20 });
  return { db, branches, transfers: new TransferService(db), sales: new SalesService(db), reports: new ReportingService(db), a: a.id, b: b.id, productId: prod.id };
}

describe("phase9a exit", () => {
  it("transfers stock between branches with dual ledger entries", async () => {
    const { db, transfers, a, b, productId } = await setup();
    const t = await transfers.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 6 }],
    }, GRANT);
    await transfers.dispatchTransfer("b1", "u1", "r2", t.id, "exit9a-d1");
    await transfers.receiveTransfer("b1", "u1", "r3", t.id, "exit9a-r1");
    expect((await db.findBalance(productId, "b1", a))!.qtyOnHand).toBe(14);
    expect((await db.findBalance(productId, "b1", b))!.qtyOnHand).toBe(6);
    const out = await db.listMovementsByBusiness("b1");
    expect(out.filter((m) => m.type === "transfer_out" && m.branchId === a).length).toBe(1);
    expect(out.filter((m) => m.type === "transfer_in" && m.branchId === b).length).toBe(1);
  });
  it("branch lifecycle guards hold", () => {
    expect(canTransitionTransfer("DRAFT", "IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(() => canTransitionTransfer("DRAFT", "RECEIVED")).toThrow("TRANSFER_INVALID_STATE");
    expect(() => canTransitionTransfer("RECEIVED", "CANCELLED")).toThrow("TRANSFER_INVALID_STATE");
  });
  it("branch-filtered analytics reconcile with unfiltered totals", async () => {
    const { sales, reports, a, productId } = await setup();
    const draft = await sales.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, branchId: a,
    }, ALL);
    await sales.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit9a-s1", granted: ALL,
    });
    await db.updateSale(draft.id, "b1", { createdAt: new Date("2026-09-10T10:00:00.000Z") });
```

PROBLEM: `db` is not destructured in that test (`const { sales, reports, a, productId }`). Self-review fix: destructure `db` too:

```ts
  it("branch-filtered analytics reconcile with unfiltered totals", async () => {
    const { db, sales, reports, a, productId } = await setup();
```

continuing:

```ts
    const range = { dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none" };
    const all = await reports.getSalesReport("b1", range, "owner", ALL);
    const filtered = await reports.getSalesReport("b1", { ...range, branchId: a }, "owner", ALL);
    expect(filtered.totals.netRevenue).toBe(5000);
    expect(all.totals.netRevenue).toBe(5000);
    const branches = await reports.getBranchesReport("b1", range, "owner", ALL);
    const row = branches.rows.find((r) => r.branchId === a)!;
    expect(row.sales).toBe(5000);
    expect(branches.rows.reduce((s, r) => s + r.sales, 0)).toBe(all.totals.netRevenue);
  });
```

```ts
  it("legacy null-scope sales still complete without a branch", async () => {
    const { db, sales, productId } = await setup();
    const draft = await sales.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const done = await sales.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit9a-s2", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    expect(done.sale.branchId).toBeNull();
  });
});
```

Check `getSalesReport` signature: `(businessId, query, role, granted)` — exit passes `range` object without granularity... type requires it? Make granularity optional in the service signature (defaults day) — Task 6 must accept the query as given. Note for implementer: service `ReportQuery.granularity?` already optional ✓ (Phase 7 interface has it optional).

Verify script (`scripts/verify-phase9a.test.mjs`):

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0009_phase9a_branches/migration.sql"),
  existsSync("packages/validation/src/branches.schema.ts"),
  existsSync("apps/api/src/branches/nest/branch.service.ts"),
  existsSync("apps/api/src/transfers/transfer-math.ts"),
  existsSync("apps/api/src/transfers/nest/transfer.service.ts"),
  existsSync("apps/api/src/branches/nest/branch.controller.ts"),
  existsSync("apps/api/src/transfers/nest/transfer.controller.ts"),
  existsSync("apps/api/test/branch.contract.test.ts"),
  existsSync("apps/api/test/transfer.contract.test.ts"),
  existsSync("apps/web/src/app/branches/page.tsx"),
  existsSync("apps/web/src/app/transfers/page.tsx"),
  existsSync("apps/web/src/app/reports/branches/page.tsx"),
  existsSync("tests/phase9a-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE9A_OK");
} else {
  console.error("PHASE9A_MISSING");
  process.exit(1);
}
```

- [ ] **Steps 1-5: write exit test (fails until Tasks 2-6 land), verify script, CI append, full verification `pnpm test && pnpm test:exit && node scripts/verify-phase9a.test.mjs && pnpm typecheck`, commit** (`test: add phase9a exit gate and verification`)
