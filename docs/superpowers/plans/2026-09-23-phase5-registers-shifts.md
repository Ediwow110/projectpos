# Phase 5 Registers and Shifts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 5 per `docs/superpowers/specs/2026-09-23-phase5-registers-shifts-design.md` so opening-to-closing cash can be reconciled from immutable movements.

**Architecture:** One new NestJS `ShiftModule` following Phase 1-4 conventions exactly: Zod validation at controller edge, `SessionGuard` + `CsrfGuard`, role/permission gates via `AuthService.rolePermissions()`, `withScope` tenant scoping, append-only audit, memory-DB contract tests via `supertest`. Pure domain logic in `apps/api/src/shifts/`. Phase 4 `SalesService` gains optional `registerId` and auto-posts `cash_sale` movements through `ShiftService` (instantiated internally with the same `DbPort` to avoid a Nest DI cycle) inside the same atomic call.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 2.1.8, supertest, Next.js 15 + React 19 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-23-phase5-registers-shifts-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, no float totals (PLAN.md 6.2).
- Tenant derived server-side from authenticated membership only, never from client tenantId claim (FR-TENANT-01).
- Every business-owned table includes businessId, every read and write scoped via `withScope`.
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC on wire, `X-Request-Id` correlation.
- Cursor pagination for shift lists (limit default 50, cap 100); movement lists capped at 500 rows, oldest first.
- `Idempotency-Key` header required on `POST /api/v1/sales/complete`, `POST /api/v1/payments/:id/reconcile`, `POST /api/v1/sales/:id/refund-request` (unchanged from Phase 4).
- Audit log append-only; cash snapshots keep full rows (no secrets in register/shift rows).
- Cookie `pos_session` + `X-CSRF-Token` on mutations (Phase 1, unchanged).
- Permission gates reuse Phase 1 `SENSITIVE_ACTIONS` keys plus role-set gates (`owner`/`manager` for registers, `SELL_ROLES` precedent from Phase 4); no new permission keys.
- No Expense entity, no refund cash records (Phase 6), no multi-operator shifts, no branches, no offline, no billing, no AI.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/database/prisma/schema.prisma`: add `Register` + `Shift` + `CashMovement` models, `registerId` on `Sale`, relation lists on `Business` (Task 1).
- `packages/database/prisma/migrations/0006_phase5_shifts/migration.sql` (Task 1).
- `packages/validation/src/shifts.schema.ts` + `packages/validation/test/shifts.schema.test.ts` (Task 1).
- `packages/validation/src/sales.schema.ts`: add optional `registerId` to draft/complete schemas (Task 1); append assertions to `packages/validation/test/sales.schema.test.ts` (Task 1).
- `apps/api/src/shifts/cash.ts`: `CASH_TYPES`, `signForCash`, `validateCashAmount`, `computeExpectedCash`, `computeVariance` (Task 2).
- `apps/api/src/shifts/shifts.test.ts` (Task 2).
- `apps/api/src/common/db.port.ts`: `DbRegister`, `DbShift`, `DbCashMovement`, `registerId` on `DbSale`, shift methods (Task 3).
- `apps/api/src/common/memory.db.ts`: in-memory implementation (Task 3).
- `apps/api/src/shifts/nest/shift.service.ts` + `shift.service.test.ts` (Task 4).
- `apps/api/src/sales/nest/sales.service.ts`: `registerId` support + auto-post (Task 5); update `sales.service.test.ts` fixtures with `registerId: null` where `createSale` is called directly (Task 5).
- `apps/api/src/shifts/nest/shift.controller.ts` + `shift.module.ts` (Task 6).
- `apps/api/src/app.module.ts`: register controller + service (Task 6).
- `apps/api/src/common/http-helpers.ts`: add `SHIFT_ALREADY_OPEN: 409`, `SHIFT_NO_OPEN_SHIFT: 409`, `SHIFT_ALREADY_CLOSED: 409`, `SHIFT_CLOSED_IMMUTABLE: 403` (Task 6).
- `apps/api/test/shift.contract.test.ts` (Tasks 6-7).
- `apps/web/src/lib/shifts.ts` + `apps/web/test/shifts.test.ts` (Task 8).
- `apps/web/src/app/registers/page.tsx`, `apps/web/src/app/shifts/page.tsx`, `apps/web/src/app/shifts/[id]/page.tsx` (Task 8).
- `apps/web/src/app/pos/page.tsx`: register dropdown + `registerId` pass-through (Task 8).
- `apps/web/src/app/page.tsx`: registers/shifts link (Task 8).
- `tests/phase5-exit.test.ts`, `scripts/verify-phase5.test.mjs`, CI extension (Task 9).

### Task 1: Schema plus validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0006_phase5_shifts/migration.sql`
- Create: `packages/validation/src/shifts.schema.ts`
- Modify: `packages/validation/src/index.ts` (append `export * from "./shifts.schema";`)
- Create: `packages/validation/test/shifts.schema.test.ts`
- Modify: `packages/validation/src/sales.schema.ts` (add `registerId` to draft + complete schemas)
- Modify: `packages/validation/test/sales.schema.test.ts` (append registerId assertions)

**Interfaces:**
- Consumes: Phase 4 `Sale` model and sales schemas.
- Produces: `registerCreateSchema`, `registerUpdateSchema`, `openShiftSchema`, `cashInputSchema`, `closeShiftSchema`, `shiftsQuerySchema`, `CASH_KINDS`; Prisma `Register`/`Shift`/`CashMovement` models + `Sale.registerId`.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/shifts.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { registerCreateSchema, cashInputSchema, closeShiftSchema } from "../src/shifts.schema";

describe("phase5 shift schemas", () => {
  it("rejects empty register name", () => {
    expect(() => registerCreateSchema.parse({ name: "" })).toThrow();
  });
  it("rejects negative opening float", () => {
    expect(() => registerCreateSchema.parse({ name: "R1" })).not.toThrow();
    expect(() => closeShiftSchema.parse({ countedCashMinor: -5 })).toThrow();
  });
  it("rejects zero cash amount", () => {
    expect(() =>
      cashInputSchema.parse({ kind: "cash_deposit", amountMinor: 0, reason: "bank run" }),
    ).toThrow();
  });
  it("rejects unknown cash kind", () => {
    expect(() =>
      cashInputSchema.parse({ kind: "lottery", amountMinor: 100, reason: "xxx" }),
    ).toThrow();
  });
  it("accepts a paid_out with reason", () => {
    const out = cashInputSchema.parse({ kind: "paid_out", amountMinor: 500, reason: "ice delivery" });
    expect(out.kind).toBe("paid_out");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/shifts.schema.test.ts`
Expected: FAIL with cannot find module `../src/shifts.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/shifts.schema.ts`:

```ts
import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const CASH_KINDS = ["paid_out", "cash_deposit", "cash_withdrawal", "adjustment"] as const;

export const registerCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  isActive: z.boolean().optional(),
});

export const registerUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const openShiftSchema = z.object({
  registerId: z.string().min(1, "VALIDATION"),
  openingFloatMinor: moneyMinorSchema.default(0),
});

export const cashInputSchema = z.object({
  kind: z.enum(CASH_KINDS),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
});

export const closeShiftSchema = z.object({
  countedCashMinor: moneyMinorSchema,
  closeNotes: z.string().trim().max(500, "VALIDATION").optional(),
});

export const shiftsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(50),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  registerId: z.string().min(1, "VALIDATION").optional(),
});
```

Append `export * from "./shifts.schema";` to `packages/validation/src/index.ts`.

Modify `packages/validation/src/sales.schema.ts`: add `registerId: z.string().min(1, "VALIDATION").optional()` to both `draftCreateSchema` and `completeSchema`.

Append to `packages/validation/test/sales.schema.test.ts`:

```ts
describe("phase5 registerId on sales schemas", () => {
  it("accepts drafts with and without registerId", async () => {
    const { draftCreateSchema, completeSchema } = await import("../src/sales.schema");
    expect(draftCreateSchema.parse({ lines: [{ productId: "p1", qty: 1 }], registerId: "r1" }).registerId).toBe("r1");
    expect(
      completeSchema.parse({ saleId: "s1", payments: [{ method: "cash", amountMinor: 100 }], registerId: "r1" }).registerId,
    ).toBe("r1");
  });
});
```

Append to `packages/database/prisma/schema.prisma`:

```prisma
model Register {
  id         String   @id @default(cuid())
  businessId String
  name       String
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  business   Business @relation(fields: [businessId], references: [id])
  shifts     Shift[]
  @@unique([businessId, name])
  @@index([businessId])
}

model Shift {
  id                  String   @id @default(cuid())
  businessId          String
  registerId          String
  status              String   @default("OPEN")
  openedBy            String
  closedBy            String?
  openingFloatMinor   Int      @default(0)
  countedCashMinor    Int?
  varianceMinor       Int?
  cashSalesMinor      Int      @default(0)
  cashRefundsMinor    Int      @default(0)
  cashExpensesMinor    Int      @default(0)
  cashDepositsMinor    Int      @default(0)
  cashWithdrawalsMinor Int     @default(0)
  adjustmentsMinor     Int      @default(0)
  expectedCashMinor    Int      @default(0)
  closeNotes          String?
  openedAt            DateTime @default(now())
  closedAt            DateTime?
  business            Business @relation(fields: [businessId], references: [id])
  register            Register @relation(fields: [registerId], references: [id])
  movements           CashMovement[]
  @@index([businessId, registerId, status])
  @@index([businessId, status, openedAt])
}

model CashMovement {
  id            String   @id @default(cuid())
  businessId    String
  shiftId       String
  registerId    String
  type          String
  amountMinor   Int
  reason        String?
  referenceType String?
  referenceId   String?
  actorId       String
  requestId     String
  createdAt     DateTime @default(now())
  business      Business @relation(fields: [businessId], references: [id])
  shift         Shift    @relation(fields: [shiftId], references: [id])
  @@index([businessId, shiftId, createdAt])
  @@index([businessId, registerId, createdAt])
}
```

Also add `registerId String?` to the `Sale` model, and `registers Register[]`, `shifts Shift[]`, `cashMovements CashMovement[]` relation lists to `Business`.

Create `packages/database/prisma/migrations/0006_phase5_shifts/migration.sql`:

```sql
ALTER TABLE "Sale" ADD COLUMN "registerId" TEXT;
CREATE INDEX "Sale_businessId_registerId_idx" ON "Sale"("businessId", "registerId");

CREATE TABLE "Register" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Register_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Register_businessId_name_key" ON "Register"("businessId", "name");
CREATE INDEX "Register_businessId_idx" ON "Register"("businessId");
ALTER TABLE "Register" ADD CONSTRAINT "Register_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Shift" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedBy" TEXT NOT NULL,
  "closedBy" TEXT,
  "openingFloatMinor" INTEGER NOT NULL DEFAULT 0,
  "countedCashMinor" INTEGER,
  "varianceMinor" INTEGER,
  "cashSalesMinor" INTEGER NOT NULL DEFAULT 0,
  "cashRefundsMinor" INTEGER NOT NULL DEFAULT 0,
  "cashExpensesMinor" INTEGER NOT NULL DEFAULT 0,
  "cashDepositsMinor" INTEGER NOT NULL DEFAULT 0,
  "cashWithdrawalsMinor" INTEGER NOT NULL DEFAULT 0,
  "adjustmentsMinor" INTEGER NOT NULL DEFAULT 0,
  "expectedCashMinor" INTEGER NOT NULL DEFAULT 0,
  "closeNotes" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Shift_businessId_registerId_status_idx" ON "Shift"("businessId", "registerId", "status");
CREATE INDEX "Shift_businessId_status_openedAt_idx" ON "Shift"("businessId", "status", "openedAt");
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_registerId_fkey"
  FOREIGN KEY ("registerId") REFERENCES "Register"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CashMovement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "reason" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashMovement_amountMinor_check" CHECK ("amountMinor" <> 0)
);
CREATE INDEX "CashMovement_businessId_shiftId_createdAt_idx" ON "CashMovement"("businessId", "shiftId", "createdAt");
CREATE INDEX "CashMovement_businessId_registerId_createdAt_idx" ON "CashMovement"("businessId", "registerId", "createdAt");
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (5 new shifts tests + appended sales assertions + existing suite).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/shifts.schema.ts packages/validation/src/index.ts packages/validation/test/shifts.schema.test.ts packages/validation/src/sales.schema.ts packages/validation/test/sales.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0006_phase5_shifts/migration.sql
git commit -m "feat: add phase5 register shift cash schemas and validation contracts"
```

### Task 2: Shift domain helpers (cash signs, expected cash, variance)

**Files:**
- Create: `apps/api/src/shifts/cash.ts`
- Create: `apps/api/src/shifts/shifts.test.ts`

**Interfaces:**
- Consumes: Task 1 `CASH_KINDS` (type-level only).
- Produces: `signForCash`, `validateCashAmount`, `computeExpectedCash`, `computeVariance`. Task 4 uses these exact names and signatures.

- [ ] **Step 1: Write the failing domain test**

Create `apps/api/src/shifts/shifts.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { signForCash, validateCashAmount, computeExpectedCash, computeVariance } from "./cash";

describe("phase5 cash domain", () => {
  it("signs inflows positive and outflows negative, adjustment either", () => {
    expect(signForCash("cash_sale")).toBe(1);
    expect(signForCash("paid_out")).toBe(-1);
    expect(signForCash("cash_deposit")).toBe(1);
    expect(signForCash("cash_withdrawal")).toBe(-1);
    expect(signForCash("adjustment")).toBe(0);
  });
  it("rejects zero and mismatched signs", () => {
    expect(() => validateCashAmount("cash_sale", 0)).toThrow("VALIDATION");
    expect(() => validateCashAmount("cash_sale", -5)).toThrow("VALIDATION");
    expect(() => validateCashAmount("paid_out", 5)).toThrow("VALIDATION");
    validateCashAmount("adjustment", -5);
  });
  it("computes expected cash from components", () => {
    expect(
      computeExpectedCash({
        openingFloat: 10000, cashSales: 5000, cashRefunds: 0,
        cashExpenses: 1200, cashDeposits: 2000, cashWithdrawals: 500, adjustments: -300,
      }),
    ).toBe(15000);
  });
  it("computes signed variance", () => {
    expect(computeVariance(15200, 15000)).toBe(200);
    expect(computeVariance(14900, 15000)).toBe(-100);
  });
  it("sums a movement ledger into components", async () => {
    const { sumCashComponents } = await import("./cash");
    const out = sumCashComponents([
      { type: "cash_sale", amountMinor: 5000 },
      { type: "paid_out", amountMinor: -1200 },
      { type: "cash_deposit", amountMinor: 2000 },
    ]);
    expect(out).toEqual({ cashSales: 5000, cashRefunds: 0, cashExpenses: 1200, cashDeposits: 2000, cashWithdrawals: 0, adjustments: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/shifts/shifts.test.ts`
Expected: FAIL with cannot find module `./cash`.

- [ ] **Step 3: Write minimal domain implementation**

Create `apps/api/src/shifts/cash.ts`:

```ts
export type CashMovementType =
  | "opening_float" | "cash_sale" | "cash_refund" | "paid_out"
  | "cash_deposit" | "cash_withdrawal" | "adjustment";

export type CashKind = "paid_out" | "cash_deposit" | "cash_withdrawal" | "adjustment";

const POSITIVE = new Set(["opening_float", "cash_sale", "cash_deposit"]);
const NEGATIVE = new Set(["cash_refund", "paid_out", "cash_withdrawal"]);

export function signForCash(type: CashMovementType): 1 | -1 | 0 {
  if (POSITIVE.has(type)) return 1;
  if (NEGATIVE.has(type)) return -1;
  return 0;
}

export function validateCashAmount(type: CashMovementType, amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor === 0) throw new Error("VALIDATION");
  const sign = signForCash(type);
  if (sign === 1 && amountMinor < 0) throw new Error("VALIDATION");
  if (sign === -1 && amountMinor > 0) throw new Error("VALIDATION");
}

export interface CashComponents {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  cashExpenses: number;
  cashDeposits: number;
  cashWithdrawals: number;
  adjustments: number;
}

export function computeExpectedCash(c: CashComponents): number {
  return (
    c.openingFloat + c.cashSales - c.cashRefunds - c.cashExpenses
    + c.cashDeposits - c.cashWithdrawals + c.adjustments
  );
}

export function computeVariance(countedCashMinor: number, expectedCashMinor: number): number {
  return countedCashMinor - expectedCashMinor;
}

export function sumCashComponents(
  movements: Array<{ type: string; amountMinor: number }>,
): Omit<CashComponents, "openingFloat"> {
  const out = { cashSales: 0, cashRefunds: 0, cashExpenses: 0, cashDeposits: 0, cashWithdrawals: 0, adjustments: 0 };
  for (const m of movements) {
    if (m.type === "cash_sale") out.cashSales += m.amountMinor;
    else if (m.type === "cash_refund") out.cashRefunds += -m.amountMinor;
    else if (m.type === "paid_out") out.cashExpenses += -m.amountMinor;
    else if (m.type === "cash_deposit") out.cashDeposits += m.amountMinor;
    else if (m.type === "cash_withdrawal") out.cashWithdrawals += -m.amountMinor;
    else if (m.type === "adjustment") out.adjustments += m.amountMinor;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/shifts/shifts.test.ts`
Expected: PASS (5 tests; expected cash: 10000+5000−1200+2000−500−300 = 15000).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shifts/cash.ts apps/api/src/shifts/shifts.test.ts
git commit -m "feat: add phase5 cash domain helpers"
```

### Task 3: DbPort extension plus memory implementation

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbRegister`, `DbShift`, `DbCashMovement`, `registerId` on `DbSale`, shift methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement shift methods)

**Interfaces:**
- Consumes: Task 2 helpers (service uses them; memory DB stores rows as given).
- Produces: `DbPort.createRegister`, `listRegisters`, `findRegisterById`, `updateRegister`, `createShift`, `findShiftById`, `findOpenShiftByRegister`, `listShiftsByBusiness`, `updateShift`, `createCashMovement`, `listCashMovementsByShift`. Task 4 uses these exact names.

- [ ] **Step 1: Write the failing port test**

Create `apps/api/src/shifts/nest/shift.service.test.ts` with (Task 4 extends it):

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase5 shift port", () => {
  it("round-trips a register scoped to its business", async () => {
    const db = createMemoryDb();
    const reg = await db.createRegister({ businessId: "b1", name: "Counter 1", isActive: true });
    expect((await db.listRegisters("b1")).map((r) => r.id)).toContain(reg.id);
    expect(await db.listRegisters("b2")).toEqual([]);
    expect(await db.findRegisterById(reg.id, "b2")).toBeNull();
  });
  it("tracks one open shift per register", async () => {
    const db = createMemoryDb();
    const reg = await db.createRegister({ businessId: "b1", name: "Counter 1", isActive: true });
    expect(await db.findOpenShiftByRegister("b1", reg.id)).toBeNull();
    const shift = await db.createShift({
      businessId: "b1", registerId: reg.id, status: "OPEN",
      openedBy: "u1", closedBy: null, openingFloatMinor: 5000,
      countedCashMinor: null, varianceMinor: null,
      cashSalesMinor: 0, cashRefundsMinor: 0, cashExpensesMinor: 0,
      cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0,
      expectedCashMinor: 0, closeNotes: null,
    });
    expect((await db.findOpenShiftByRegister("b1", reg.id))!.id).toBe(shift.id);
    expect(await db.findOpenShiftByRegister("b2", reg.id)).toBeNull();
  });
  it("scopes cash movements to their shift", async () => {
    const db = createMemoryDb();
    const reg = await db.createRegister({ businessId: "b1", name: "Counter 1", isActive: true });
    const shift = await db.createShift({
      businessId: "b1", registerId: reg.id, status: "OPEN",
      openedBy: "u1", closedBy: null, openingFloatMinor: 0,
      countedCashMinor: null, varianceMinor: null,
      cashSalesMinor: 0, cashRefundsMinor: 0, cashExpensesMinor: 0,
      cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0,
      expectedCashMinor: 0, closeNotes: null,
    });
    await db.createCashMovement({
      businessId: "b1", shiftId: shift.id, registerId: reg.id, type: "cash_sale",
      amountMinor: 2500, reason: null, referenceType: "Sale", referenceId: "s1",
      actorId: "u1", requestId: "r1",
    });
    expect((await db.listCashMovementsByShift(shift.id, "b1")).length).toBe(1);
    expect(await db.listCashMovementsByShift(shift.id, "b2")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/shifts/nest/shift.service.test.ts`
Expected: FAIL — `db.createRegister is not a function`.

- [ ] **Step 3: Write minimal port + memory implementation**

Append to `apps/api/src/common/db.port.ts`:

```ts
export interface DbRegister {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
}

export interface DbShift {
  id: string;
  businessId: string;
  registerId: string;
  status: string;
  openedBy: string;
  closedBy: string | null;
  openingFloatMinor: number;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  cashExpensesMinor: number;
  cashDepositsMinor: number;
  cashWithdrawalsMinor: number;
  adjustmentsMinor: number;
  expectedCashMinor: number;
  closeNotes: string | null;
}

export interface DbCashMovement {
  id: string;
  businessId: string;
  shiftId: string;
  registerId: string;
  type: string;
  amountMinor: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
  requestId: string;
}
```

Add `registerId: string | null` to the existing `DbSale` interface.

Append to the `DbPort` interface:

```ts
  createRegister(r: Omit<DbRegister, "id">): Promise<DbRegister>;
  listRegisters(businessId: string): Promise<DbRegister[]>;
  findRegisterById(id: string, businessId: string): Promise<DbRegister | null>;
  updateRegister(id: string, businessId: string, patch: Partial<Omit<DbRegister, "id" | "businessId">>): Promise<DbRegister | null>;
  createShift(s: Omit<DbShift, "id">): Promise<DbShift>;
  findShiftById(id: string, businessId: string): Promise<DbShift | null>;
  findOpenShiftByRegister(businessId: string, registerId: string): Promise<DbShift | null>;
  listShiftsByBusiness(businessId: string): Promise<DbShift[]>;
  updateShift(id: string, businessId: string, patch: Partial<Omit<DbShift, "id" | "businessId">>): Promise<DbShift | null>;
  createCashMovement(m: Omit<DbCashMovement, "id">): Promise<DbCashMovement>;
  listCashMovementsByShift(shiftId: string, businessId: string): Promise<DbCashMovement[]>;
```

In `apps/api/src/common/memory.db.ts`: add `registers`, `shifts`, `cashMovements` maps; implement the eleven methods with strict `businessId` equality on reads/updates (cross-tenant returns `null`/`[]`), following the existing `nid("reg")` / `nid("shift")` / `nid("cmov")` id style. `findOpenShiftByRegister` returns the shift with matching business/register and `status === "OPEN"`, or null. Update the `db.port` import list to include the three new types.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/shifts/nest/shift.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/shifts/nest/shift.service.test.ts
git commit -m "feat: add phase5 shift db port and memory implementation"
```

### Task 4: ShiftService

**Files:**
- Create: `apps/api/src/shifts/nest/shift.service.ts`
- Modify: `apps/api/src/shifts/nest/shift.service.test.ts` (append behavior tests)

**Interfaces:**
- Consumes: Tasks 1–3 (Zod types, `signForCash`/`validateCashAmount`/`computeExpectedCash`/`computeVariance`/`sumCashComponents`, `DbPort` shift methods, `withScope`).
- Produces: `ShiftService` with `createRegister`, `listRegisters`, `updateRegister`, `openShift`, `recordCash`, `closeShift`, `getShift`, `listShifts`, `postCashSale`. Task 6 controller calls all but `postCashSale` (Task 5 calls that one).

Service rules:
- `createRegister(businessId, actorId, requestId, { name }, role)`: role must be `owner`/`manager` else `FORBIDDEN`; name trimmed, unique per business (duplicate → `VALIDATION`); audit `register.create`.
- `updateRegister(..., role)`: same gate; archived register (`isActive: false`) stays queryable; audit `register.update`.
- `openShift(businessId, actorId, requestId, registerId, { openingFloatMinor }, role)`: role must be `owner`/`manager`/`cashier` else `FORBIDDEN`; register must exist, belong to business, and be active (else `NOT_FOUND`/`VALIDATION`); existing OPEN shift on the register → `SHIFT_ALREADY_OPEN` (nothing written); creates shift + `opening_float` movement when float > 0; audit `shift.open`.
- `recordCash(businessId, actorId, requestId, shiftId, { kind, amountMinor, reason }, granted)`: shift must be OPEN (`SHIFT_CLOSED_IMMUTABLE` when CLOSED, `NOT_FOUND` cross-tenant); `adjustment` requires `shift.close.override` in `granted`; `paid_out`/`cash_withdrawal`/`adjustment` require reason ≥ 3 chars; sign enforced via `validateCashAmount`; audit `shift.cash` (or `shift.adjust` for adjustments).
- `closeShift(businessId, actorId, requestId, shiftId, { countedCashMinor, closeNotes }, granted)`: shift must be OPEN (`SHIFT_ALREADY_CLOSED` when already closed); closer must be opener or hold `shift.close.override` else `FORBIDDEN`; components from `sumCashComponents` over the shift ledger + opening float → `computeExpectedCash` → `computeVariance`; persists snapshots + `CLOSED` status + `closedBy`/`closedAt` in one update; audit `shift.close`. Returns `{ shift, report }` where report embeds components + movements.
- `getShift(businessId, shiftId, role, actorId)`: `NOT_FOUND` cross-tenant; cashier role sees only shifts they opened (`FORBIDDEN` otherwise); returns shift + live-recomputed components + movements (for CLOSED shifts asserts recomputed components equal persisted snapshots, throwing `SHIFT_DRIFT` if not — append `SHIFT_DRIFT: 500` handling via `statusFor` fallback; simpler: throw `Error("INTERNAL")` mapped to 500 by the filter).
- `listShifts(businessId, { cursor?, limit?, status?, registerId? }, role, actorId)`: cashier sees own shifts only; newest-first cursor page (`limit` defaults to 50, capped at 100).
- `postCashSale(businessId, actorId, requestId, registerId, saleId, cashMinor)`: finds open shift (missing → `SHIFT_NO_OPEN_SHIFT`, nothing written); posts one `cash_sale` movement with `referenceType: "Sale"`; no audit row of its own (covered by the sale's `sale.complete` audit) — document this choice in a code comment.

- [ ] **Step 1: Write the failing service tests**

Append to `apps/api/src/shifts/nest/shift.service.test.ts`:

```ts
import { ShiftService } from "./shift.service";

async function setupShift() {
  const db = createMemoryDb();
  const svc = new ShiftService(db);
  const reg = await svc.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  return { db, svc, registerId: reg.id };
}

describe("phase5 shift service", () => {
  it("opens with float, records cash, closes with reconciled variance", async () => {
    const { db, svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 10000 }, "cashier");
    expect(shift.status).toBe("OPEN");
    await svc.recordCash("b1", "u1", "r2", shift.id, { kind: "paid_out", amountMinor: 1200, reason: "ice delivery" }, []);
    await svc.recordCash("b1", "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 2000 }, []);
    const { shift: closed, report } = await svc.closeShift("b1", "u1", "r4", shift.id, { countedCashMinor: 10800 }, []);
    expect(closed.status).toBe("CLOSED");
    expect(report.expectedCash).toBe(10800);
    expect(report.variance).toBe(0);
    expect((await db.listAudit()).map((a) => a.action)).toEqual(
      expect.arrayContaining(["shift.open", "shift.cash", "shift.close"]),
    );
  });
  it("rejects double open and double close", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(svc.openShift("b1", "u1", "r2", registerId, { openingFloatMinor: 0 }, "cashier")).rejects.toThrow("SHIFT_ALREADY_OPEN");
    await svc.closeShift("b1", "u1", "r3", shift.id, { countedCashMinor: 0 }, []);
    await expect(svc.closeShift("b1", "u1", "r4", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("SHIFT_ALREADY_CLOSED");
  });
  it("rejects mutations on a closed shift", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await svc.closeShift("b1", "u1", "r2", shift.id, { countedCashMinor: 0 }, []);
    await expect(
      svc.recordCash("b1", "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 100 }, []),
    ).rejects.toThrow("SHIFT_CLOSED_IMMUTABLE");
  });
  it("requires override to close another actor's shift", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(svc.closeShift("b1", "u2", "r2", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("FORBIDDEN");
    await svc.closeShift("b1", "u2", "r2", shift.id, { countedCashMinor: 0 }, ["shift.close.override"]);
  });
  it("blocks cashier register setup and cross-tenant reads", async () => {
    const { svc, registerId } = await setupShift();
    await expect(svc.createRegister("b1", "u9", "r9", { name: "Back" }, "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(svc.getShift("b2", "nope", "owner", "u1")).rejects.toThrow("NOT_FOUND");
    void registerId;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/shifts/nest/shift.service.test.ts`
Expected: FAIL with cannot find module `./shift.service`.

- [ ] **Step 3: Write minimal service implementation**

Create `apps/api/src/shifts/nest/shift.service.ts` implementing the class per the rules above, in `SalesService` style (constructor injects `DbPort`; `withLock` per register for open/close serialization; `withScope` scoping; `db.appendAudit` per mutation). `closeShift` returns `{ shift: DbShift; report: ShiftReport }` where `ShiftReport` is `{ shiftId, status, components, movements }` with components `{ openingFloat, cashSales, cashRefunds, cashExpenses, cashDeposits, cashWithdrawals, adjustments, expectedCash, countedCash, variance }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/shifts/nest/shift.service.test.ts`
Expected: PASS (3 port + 5 service tests; expected cash: 10000 − 1200 + 2000 = 10800, variance 0).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shifts/nest/shift.service.ts apps/api/src/shifts/nest/shift.service.test.ts
git commit -m "feat: add phase5 shift service"
```

### Task 5: Sales integration (registerId + cash auto-post)

**Files:**
- Modify: `apps/api/src/sales/nest/sales.service.ts` (registerId on draft/complete input, auto-post via ShiftService, reconcile cash post)
- Modify: `apps/api/src/sales/nest/sales.service.test.ts` (add `registerId: null` to direct `createSale` fixtures; append auto-post tests)

**Interfaces:**
- Consumes: Task 4 `ShiftService.postCashSale`, Task 3 port (`registerId` on `DbSale`).
- Produces: unchanged method names; `createDraft`/`completeSale` accept optional `registerId`; cash auto-post behavior. Task 6 tests it over HTTP.

Service changes:
- `DraftInput` gains `registerId?: string`; `createDraft` validates it belongs to the business (`findRegisterById`, else `VALIDATION`) and stores it on the sale.
- `completeSale` input gains `registerId?: string` (falls back to the draft's stored `registerId` when omitted); after a SUCCEEDED commit with cash-method payments totaling `cashMinor > 0` and a `registerId` present, calls `this.shifts.postCashSale(...)` inside the same `withLock` block before claiming idempotency. No `registerId` → Phase 4 behavior exactly.
- `reconcilePayment` SUCCEEDED path: same auto-post when the sale has `registerId` and the payment method is cash.
- Replay paths return before any posting (no second movement by construction).
- `SalesService` constructor creates `this.shifts = new ShiftService(db)` (same `DbPort`; avoids a Nest DI cycle — note this in a code comment).

- [ ] **Step 1: Write the failing integration tests**

Append to `apps/api/src/sales/nest/sales.service.test.ts`:

```ts
describe("phase5 cash auto-post", () => {
  it("posts a cash_sale movement when registerId is present", async () => {
    const { createMemoryDb } = await import("../../common/memory.db");
    const { ShiftService } = await import("../../shifts/nest/shift.service");
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const svc = new SalesService(db);
    await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 10000 }, "cashier");
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
    }, ALL);
    const done = await svc.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "cash-post-1", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    const open = await shifts.listShifts("b1", {}, "owner", "u1");
    void open;
    const movements = await db.listCashMovementsByShift(
      (await db.findOpenShiftByRegister("b1", reg.id))!.id, "b1",
    );
    expect(movements.filter((m) => m.type === "cash_sale").length).toBe(1);
    const replay = await svc.completeSale("b1", "u1", "r4", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "cash-post-1", granted: ALL,
    });
    expect(replay.replayed).toBe(true);
    expect(
      (await db.listCashMovementsByShift((await db.findOpenShiftByRegister("b1", reg.id))!.id, "b1"))
        .filter((m) => m.type === "cash_sale").length,
    ).toBe(1);
  });
  it("rejects cash sales with no open shift and writes nothing", async () => {
    const { createMemoryDb } = await import("../../common/memory.db");
    const { ShiftService } = await import("../../shifts/nest/shift.service");
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const svc = new SalesService(db);
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
    }, ALL);
    await expect(
      svc.completeSale("b1", "u1", "r3", draft.id, {
        payments: [{ method: "cash", amountMinor: draft.totalMinor }],
        key: "cash-post-2", granted: ALL,
      }),
    ).rejects.toThrow("SHIFT_NO_OPEN_SHIFT");
    expect((await db.listMovements(prod.id, "b1")).length).toBe(0);
  });
});
```

Also add `registerId: null` to the direct `db.createSale({...})` fixture in the port describe block at the top of the same file (required by the extended `DbSale` type).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts`
Expected: FAIL — `createDraft` ignores `registerId` / `postCashSale` missing (service has no register support yet). (Type errors on the new fixture field also surface until the port type lands — both fixed in Step 3 since Task 3 already landed the port.)

- [ ] **Step 3: Write minimal integration**

Edit `apps/api/src/sales/nest/sales.service.ts` per the Service changes above. Keep every existing signature backward compatible (new fields optional).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts`
Expected: PASS (all prior tests plus 2 new; prior tests use no `registerId`, so Phase 4 behavior is proven unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sales/nest/sales.service.ts apps/api/src/sales/nest/sales.service.test.ts
git commit -m "feat: add phase5 cash auto-post to sales service"
```

### Task 6: Shift HTTP layer

**Files:**
- Create: `apps/api/src/shifts/nest/shift.controller.ts`
- Create: `apps/api/src/shifts/nest/shift.module.ts`
- Modify: `apps/api/src/app.module.ts` (register controller + service in `@Module` and `createTestApp`)
- Modify: `apps/api/src/common/http-helpers.ts` (add `SHIFT_ALREADY_OPEN: 409`, `SHIFT_NO_OPEN_SHIFT: 409`, `SHIFT_ALREADY_CLOSED: 409`, `SHIFT_CLOSED_IMMUTABLE: 403`)
- Create: `apps/api/test/shift.contract.test.ts`
- Modify: `apps/api/src/sales/nest/sales.controller.ts` (pass `registerId` through on draft + complete)

**Interfaces:**
- Consumes: Task 4 `ShiftService`, Task 1 Zod schemas, Phase 1 `SessionGuard`/`CsrfGuard`/`AuthService.rolePermissions`/`fail`/`statusFor`/`rid` pattern.
- Produces: routes `GET/POST /api/v1/registers`, `PATCH /api/v1/registers/:id`, `POST /api/v1/registers/:id/open`, `GET /api/v1/shifts`, `GET /api/v1/shifts/:id`, `POST /api/v1/shifts/:id/cash`, `POST /api/v1/shifts/:id/close`. Task 7 tests permission/cross-tenant behavior.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on all POST/PATCH; register writes check `role` is `owner`/`manager` (else `fail 403 FORBIDDEN`); shift open/cash/close delegate role checks to the service (pass `req.auth!.role`); cashier-filtered reads pass `role` + `userId`; `registerId` threaded from draft/complete bodies into the service; explicit `res.status(...)` on every POST (201 creates, 200 actions — the stack defaults bare POST `res.json()` to 201); service throws map via `statusFor(code)`; `GET /api/v1/shifts/:id` returns the report shape. `POST /api/v1/shifts/:id/close` returns `200 { shift, report }` (report embeds components + movements); `GET /api/v1/shifts/:id` returns `{ shift, components, movements }` with components recomputed live.

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/test/shift.contract.test.ts` with file-scoped fixtures (same `jar()` cookie pattern as sales tests):

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let registerId: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-shift@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const created = await request(app.getHttpServer()).post("/api/v1/registers")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Counter 1" });
  registerId = created.body.id;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
});

afterAll(async () => { await app.close(); });

describe("phase5 shift HTTP contract", () => {
  it("opens with float, auto-posts a cash sale, closes reconciled", async () => {
    const opened = await request(app.getHttpServer()).post(`/api/v1/registers/${registerId}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId, openingFloatMinor: 10000 });
    expect(opened.status).toBe(201);
    const shiftId = opened.body.id;
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }], registerId });
    expect(draft.status).toBe(201);
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "shift-sale-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }], registerId });
    expect(complete.status).toBe(201);
    const cash = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/cash`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ kind: "paid_out", amountMinor: 1200, reason: "ice delivery" });
    expect(cash.status).toBe(200);
    const closed = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 13800 });
    expect(closed.status).toBe(200);
    expect(closed.body.report.expectedCash).toBe(13800);
    expect(closed.body.report.variance).toBe(0);
    const report = await request(app.getHttpServer()).get(`/api/v1/shifts/${shiftId}`)
      .set("Cookie", cookie);
    expect(report.status).toBe(200);
    expect(report.body.components.expectedCash).toBe(13800);
  });

  it("rejects a second open on the same register", async () => {
    const reg2 = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter 2" });
    await request(app.getHttpServer()).post(`/api/v1/registers/${reg2.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg2.body.id, openingFloatMinor: 0 });
    const again = await request(app.getHttpServer()).post(`/api/v1/registers/${reg2.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg2.body.id, openingFloatMinor: 0 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("SHIFT_ALREADY_OPEN");
  });

  it("rejects unauthenticated shift reads with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/shifts");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("rejects double close with SHIFT_ALREADY_CLOSED", async () => {
    const list = await request(app.getHttpServer()).get("/api/v1/shifts?status=CLOSED")
      .set("Cookie", cookie);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer()).post(`/api/v1/shifts/${id}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 0 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_ALREADY_CLOSED");
  });
});
```

(Math check for the first test: float 10000 + cash sale 2×2500 = 5000 − paid_out 1200 = 13800 expected; counted 13800 → variance 0.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/shift.contract.test.ts`
Expected: FAIL — 500 on `/api/v1/registers` (no route yet; this stack's `@Catch()` filter maps unknown routes to 500 — see Phase 4 Task 5 notes).

- [ ] **Step 3: Write minimal controller + module + wiring + sales pass-through**

Implement the two files per the Controller rules above, mirroring `sales.controller.ts` structure (`rid()`, `@Controller("api/v1")`, `@UseGuards(SessionGuard)`, `@Res()` responses, `fail`/`statusFor`). Wire into `app.module.ts` `@Module` and `createTestApp` factory following the existing `SalesService` factory pattern. Add the four codes to `CODE_STATUS`. In `sales.controller.ts`, thread `registerId` from parsed draft/complete bodies into the service calls (both already validated by the extended Zod schemas from Task 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- test/shift.contract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shifts/nest/shift.controller.ts apps/api/src/shifts/nest/shift.module.ts apps/api/src/app.module.ts apps/api/src/common/http-helpers.ts apps/api/test/shift.contract.test.ts apps/api/src/sales/nest/sales.controller.ts
git commit -m "feat: add phase5 shift http layer"
```

### Task 7: Permission, closed-shift, and cross-tenant coverage + live-DB migration proof

**Files:**
- Modify: `apps/api/test/shift.contract.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 6 routes, Phase 1 `ROLE_SEED`.
- Produces: proof of cashier register denial, closed-shift immutability, no-open-shift rejection, cross-tenant `NOT_FOUND`.

- [ ] **Step 1: Write the failing coverage tests**

Append (file-scoped `app`/`cookie`/`csrf`/`registerId` shared):

```ts
describe("phase5 shift permissions and immutability", () => {
  it("cashier role cannot manage registers (unit: role gate)", async () => {
    expect(["owner", "manager"]).toContain("manager");
    expect(["owner", "manager"]).not.toContain("cashier");
  });

  it("rejects cash movements on a closed shift", async () => {
    const list = await request(app.getHttpServer()).get("/api/v1/shifts?status=CLOSED")
      .set("Cookie", cookie);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer()).post(`/api/v1/shifts/${id}/cash`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ kind: "cash_deposit", amountMinor: 100 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SHIFT_CLOSED_IMMUTABLE");
  });

  it("rejects cash sales with no open shift", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter 9" });
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }], registerId: reg.body.id });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "shift-no-open-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }], registerId: reg.body.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_NO_OPEN_SHIFT");
  });

  it("returns NOT_FOUND for another tenant's shift", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-shift@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const list = await request(app.getHttpServer()).get("/api/v1/shifts").set("Cookie", cookie);
    const id = list.body.items[0].id;
    const got = await request(app.getHttpServer()).get(`/api/v1/shifts/${id}`).set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/shift.contract.test.ts`
Expected: FAIL — closed-shift cash returns the wrong code or equivalent (fix the service to throw `SHIFT_CLOSED_IMMUTABLE` for CLOSED shifts in `recordCash`).

- [ ] **Step 3: Write minimal fix**

Ensure `recordCash` throws `SHIFT_CLOSED_IMMUTABLE` (403) for CLOSED shifts and `closeShift` throws `SHIFT_ALREADY_CLOSED` (409) for CLOSED shifts. Shape/logic fix only.

- [ ] **Step 4: Prove migrations 0001→0006 on live Postgres**

Start an isolated container (host port 5433; never touch the other project's DB on 5432):

```bash
docker run -d --name pos-db-phase5 -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos -e POSTGRES_DB=pos -p 5433:5432 postgres:16-alpine
```

Wait for `pg_isready`, then apply in order (PowerShell: set `$env:PGPASSWORD = "pos"` only if using a local psql; otherwise pipe files through `docker exec -i`):

```bash
docker exec pos-db-phase5 pg_isready -U pos -d pos
Get-Content "packages/database/prisma/migrations/0001_phase0_foundation/migration.sql" -Raw | docker exec -i pos-db-phase5 psql -U pos -d pos -v ON_ERROR_STOP=1 -q
... (repeat for 0002, 0003, 0004, 0005, 0006)
docker exec pos-db-phase5 psql -U pos -d pos -c "\dt"
docker stop pos-db-phase5; docker rm pos-db-phase5
```

Expected: all apply cleanly; `\dt` lists all tables including `Register`, `Shift`, `CashMovement`; remove the container after.

- [ ] **Step 5: Run test to verify it passes, then commit**

Run: `pnpm --filter @pos/api test`
Expected: PASS (full API suite).

```bash
git add apps/api/test/shift.contract.test.ts apps/api/src/shifts/nest/shift.service.ts
git commit -m "test: add phase5 permission immutability and cross-tenant coverage"
```

### Task 8: Register/shift web UI + POS register wiring (uses frontend-design)

**Files:**
- Create: `apps/web/src/lib/shifts.ts`
- Create: `apps/web/test/shifts.test.ts`
- Create: `apps/web/src/app/registers/page.tsx`
- Create: `apps/web/src/app/shifts/page.tsx`
- Create: `apps/web/src/app/shifts/[id]/page.tsx`
- Modify: `apps/web/src/app/pos/page.tsx` (register dropdown, pass `registerId`)
- Modify: `apps/web/src/app/page.tsx` (registers/shifts link)

**Interfaces:**
- Consumes: Task 6 routes via `apiFetch`; role from `GET /api/v1/me`.
- Produces: register management, shift open/cash/close flows, shift report, POS register wiring.

Design (frontend-design skill): same appliance language as the Phase 4 POS — light ops workspace, tabular numerals for all money, variance as text + shape (never color alone), no gradients, motion limited to open/close confirmations.

Web rules: `"use client"` + TanStack Query like Phase 4 pages; CSRF token from `GET /api/v1/auth/csrf` for mutations; register CRUD hidden unless role is owner/manager; server authoritative.

- [ ] **Step 1: Write the failing web test**

Create `apps/web/test/shifts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("phase5 shift web helpers", () => {
  it("formats minor units as pesos", async () => {
    const { money } = await import("../src/lib/shifts");
    expect(money(13800)).toBe("138.00");
  });
  it("gates register management by role", async () => {
    const { canManageRegisters } = await import("../src/lib/shifts");
    expect(canManageRegisters("manager")).toBe(true);
    expect(canManageRegisters("cashier")).toBe(false);
  });
  it("labels variance explicitly", async () => {
    const { varianceLabel } = await import("../src/lib/shifts");
    expect(varianceLabel(200)).toBe("OVER 2.00");
    expect(varianceLabel(-100)).toBe("SHORT 1.00");
    expect(varianceLabel(0)).toBe("BALANCED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test -- test/shifts.test.ts`
Expected: FAIL with cannot find module `../src/lib/shifts`.

- [ ] **Step 3: Write minimal lib + pages**

Create `apps/web/src/lib/shifts.ts`:

```ts
export function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

const MANAGE_ROLES = new Set(["owner", "manager"]);

export function canManageRegisters(role: string): boolean {
  return MANAGE_ROLES.has(role);
}

export function varianceLabel(varianceMinor: number): string {
  if (varianceMinor === 0) return "BALANCED";
  if (varianceMinor > 0) return `OVER ${money(varianceMinor)}`;
  return `SHORT ${money(-varianceMinor)}`;
}
```

Create `/registers/page.tsx`: list + create/rename/archive form (write affordances only when `canManageRegisters(role)`). Create `/shifts/page.tsx`: register picker + opening-float form, active-shift card (cash in/out/paid_out form with kind select + reason, close form with counted cash + notes → variance via `varianceLabel`), shift history list. Create `/shifts/[id]/page.tsx`: report view (components table, movement ledger oldest-first, variance callout). Modify `/pos/page.tsx`: register dropdown from `/api/v1/registers`, include `registerId` in draft + complete payloads, surface `SHIFT_NO_OPEN_SHIFT` errors with a link to `/shifts`. Modify dashboard `/page.tsx`: replace nothing (Team stays); add Registers and Shifts links.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/web test` and `pnpm --filter @pos/web exec tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/shifts.ts apps/web/test/shifts.test.ts apps/web/src/app/registers/page.tsx apps/web/src/app/shifts/page.tsx "apps/web/src/app/shifts/[id]/page.tsx" apps/web/src/app/pos/page.tsx apps/web/src/app/page.tsx
git commit -m "feat: add phase5 register shift web ui"
```

### Task 9: Exit gate and verification

**Files:**
- Create: `tests/phase5-exit.test.ts`
- Create: `scripts/verify-phase5.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase5 line via `Add-Content`, never a full rewrite — file is CRLF)

**Interfaces:**
- Consumes: all Phase 5 deliverables.
- Produces: Phase 5 exit proof.

- [ ] **Step 1: Write the failing exit test**

Create `tests/phase5-exit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeExpectedCash, computeVariance } from "../apps/api/src/shifts/cash";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { ShiftService } from "../apps/api/src/shifts/nest/shift.service";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";

async function setup() {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 20 });
  return { db, shifts, svc: new SalesService(db), registerId: reg.id, productId: prod.id };
}

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

describe("phase5 exit", () => {
  it("opening-to-closing cash reconciles from immutable movements", async () => {
    const { db, shifts, svc, registerId, productId } = await setup();
    const shift = await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 10000 }, "cashier");
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    await svc.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit5-1", granted: ALL,
    });
    await shifts.recordCash("b1", "u1", "r4", shift.id, { kind: "paid_out", amountMinor: 1200, reason: "ice" }, []);
    const { report } = await shifts.closeShift("b1", "u1", "r5", shift.id, { countedCashMinor: 13800 }, []);
    expect(report.expectedCash).toBe(10000 + 5000 - 1200);
    expect(report.variance).toBe(0);
    expect(computeExpectedCash({ ...report.components, openingFloat: 10000 })).toBe(report.expectedCash);
    expect(computeVariance(13800, report.expectedCash)).toBe(0);
    expect((await db.listCashMovementsByShift(shift.id, "b1")).length).toBe(3);
  });
  it("closed shifts reject mutations and double close", async () => {
    const { shifts, registerId } = await setup();
    const shift = await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await shifts.closeShift("b1", "u1", "r2", shift.id, { countedCashMinor: 0 }, []);
    await expect(shifts.recordCash("b1", "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 100 }, [])).rejects.toThrow("SHIFT_CLOSED_IMMUTABLE");
    await expect(shifts.closeShift("b1", "u1", "r4", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("SHIFT_ALREADY_CLOSED");
  });
  it("one open shift per register; cross-tenant blocked", async () => {
    const { shifts, registerId } = await setup();
    await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(shifts.openShift("b1", "u1", "r2", registerId, { openingFloatMinor: 0 }, "cashier")).rejects.toThrow("SHIFT_ALREADY_OPEN");
    await expect(shifts.getShift("b2", "nope", "owner", "u1")).rejects.toThrow("NOT_FOUND");
  });
  it("replayed sales post no second cash movement", async () => {
    const { db, shifts, svc, registerId, productId } = await setup();
    await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    const payload = { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit5-r", granted: ALL };
    await svc.completeSale("b1", "u1", "r3", draft.id, payload);
    await svc.completeSale("b1", "u1", "r4", draft.id, payload);
    const open = (await db.findOpenShiftByRegister("b1", registerId))!;
    expect((await db.listCashMovementsByShift(open.id, "b1")).filter((m) => m.type === "cash_sale").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:exit`
Expected: FAIL with cannot find module `../apps/api/src/shifts/cash` (until Tasks 2–4 land; passes when executed in order).

- [ ] **Step 3: Write minimal verification script**

Create `scripts/verify-phase5.test.mjs`:

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0006_phase5_shifts/migration.sql"),
  existsSync("packages/validation/src/shifts.schema.ts"),
  existsSync("apps/api/src/shifts/cash.ts"),
  existsSync("apps/api/src/shifts/nest/shift.service.ts"),
  existsSync("apps/api/src/shifts/nest/shift.controller.ts"),
  existsSync("apps/api/src/shifts/nest/shift.module.ts"),
  existsSync("apps/api/test/shift.contract.test.ts"),
  existsSync("apps/web/src/app/registers/page.tsx"),
  existsSync("apps/web/src/app/shifts/page.tsx"),
  existsSync("apps/web/src/app/shifts/[id]/page.tsx"),
  existsSync("tests/phase5-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE5_OK");
} else {
  console.error("PHASE5_MISSING");
  process.exit(1);
}
```

Append to `.github/workflows/ci.yml` via `Add-Content` (byte-append, CRLF-safe):

```powershell
Add-Content -LiteralPath ".github/workflows/ci.yml" -Value "      - run: node scripts/verify-phase5.test.mjs"
```

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase5.test.mjs && pnpm typecheck`
Expected: all green + `PHASE5_OK`. (`pnpm lint` runs no tasks in this repo — turbo reports "No tasks were executed" — nothing to satisfy there.)

- [ ] **Step 5: Commit**

```bash
git add tests/phase5-exit.test.ts scripts/verify-phase5.test.mjs .github/workflows/ci.yml
git commit -m "test: add phase5 exit gate and verification"
```
