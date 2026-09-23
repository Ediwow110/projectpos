# Phase 4 POS and Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 4 per `docs/superpowers/specs/2026-09-23-phase4-pos-payments-design.md` so a real business can complete a sale without duplicate charge, silent failure, or ambiguous inventory effect.

**Architecture:** One new NestJS `SalesModule` following Phase 1/2/3 conventions exactly: Zod validation at controller edge, `SessionGuard` + `CsrfGuard`, permission gates via `AuthService.rolePermissions()`, `withScope` tenant scoping, append-only audit, memory-DB contract tests via `supertest`. Pure domain logic in `apps/api/src/sales/`. Atomic `completeSale` writes sale + payments + inventory `sale` movements in one service call.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 2.1.8, supertest, Next.js 15 + React 19 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-23-phase4-pos-payments-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, no float totals (PLAN.md 6.2).
- Tenant derived server-side from authenticated membership only, never from client tenantId claim (FR-TENANT-01).
- Every business-owned table includes businessId, every read and write scoped via `withScope`.
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC on wire, `X-Request-Id` correlation.
- Cursor pagination for sales list (limit default 50, cap 100); bounded page pagination for receipt/item reads where used.
- `Idempotency-Key` header required on `POST /api/v1/sales/complete`, `POST /api/v1/payments/:id/reconcile`, `POST /api/v1/sales/:id/refund-request`; uniqueness on `(businessId, key, commandType)`.
- Audit log append-only; sale snapshots keep cost (no secrets in sale rows).
- Cookie `pos_session` + `X-CSRF-Token` on mutations (Phase 1, unchanged).
- Permission gates reuse Phase 1 `SENSITIVE_ACTIONS` keys; no new permission keys.
- No Customer table, no CashMovement table, no provider SDKs, no printer hardware, no shifts, no reports, no branches, no offline, no billing, no AI.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/database/prisma/schema.prisma`: repair `Product` block (fields on lines 171-173 sit outside the model braces — move them inside), add `Sale` + `SaleItem` + `Payment` + `HeldSale` + `SaleIdempotency` models, add relation lists on `Business` (Task 1).
- `packages/database/prisma/migrations/0005_phase4_sales/migration.sql`: create tables + indexes (Task 1).
- `packages/validation/src/sales.schema.ts`: draft/complete/reconcile/refund/query Zod schemas (Task 1).
- `packages/validation/test/sales.schema.test.ts` (Task 1).
- `apps/api/src/sales/totals.ts`: `computeSaleTotals`, `requiresDiscountOverride` (Task 2).
- `apps/api/src/sales/state-machine.ts`: `VALID_TRANSITIONS`, `transitionSale` (Task 2).
- `apps/api/src/sales/idempotency.ts`: `COMMAND_TYPES`, `fingerprintPayload` (Task 2).
- `apps/api/src/sales/sales.test.ts`: domain unit tests (Task 2).
- `apps/api/src/common/db.port.ts`: `DbSale`, `DbSaleItem`, `DbPayment`, `DbHeldSale`, `DbIdempotency`, sales methods (Task 3).
- `apps/api/src/common/memory.db.ts`: in-memory sales implementation (Task 3).
- `apps/api/src/sales/nest/sales.service.ts` + `sales.service.test.ts` (Task 4).
- `apps/api/src/sales/nest/sales.controller.ts` + `sales.module.ts` (Task 5).
- `apps/api/src/app.module.ts`: register `SalesController` + `SalesService` (Task 5).
- `apps/api/src/common/http-helpers.ts`: add `SALE_INVALID_TRANSITION: 409`, `PAYMENT_TOTAL_MISMATCH: 400`, `IDEMPOTENCY_MISMATCH: 409`, `PAYMENT_UNKNOWN: 202` to `CODE_STATUS` (Task 5).
- `apps/api/test/sales.contract.test.ts`: supertest contract tests (Task 5, extended Task 6).
- `apps/web/src/lib/sales.ts` + `apps/web/test/sales.test.ts` (Task 7).
- `apps/web/src/app/pos/page.tsx`, `apps/web/src/app/receipts/[saleId]/page.tsx` (Task 7).
- `tests/phase4-exit.test.ts`, `scripts/verify-phase4.test.mjs`, CI extension (Task 8).

### Task 1: Schema plus validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (repair Product block; append Sale/SaleItem/Payment/HeldSale/SaleIdempotency; extend Business)
- Create: `packages/database/prisma/migrations/0005_phase4_sales/migration.sql`
- Create: `packages/validation/src/sales.schema.ts`
- Modify: `packages/validation/src/index.ts` (append `export * from "./sales.schema";`)
- Create: `packages/validation/test/sales.schema.test.ts`

**Interfaces:**
- Consumes: Phase 3 `InventoryMovement`/`InventoryBalance` models, `moneyMinorSchema` pattern.
- Produces: `draftCreateSchema`, `completeSchema`, `reconcileSchema`, `refundRequestSchema`, `salesQuerySchema`, `PAYMENT_METHODS`; Prisma `Sale`/`SaleItem`/`Payment`/`HeldSale`/`SaleIdempotency` models.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/sales.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { draftCreateSchema, completeSchema, reconcileSchema } from "../src/sales.schema";

describe("phase4 sales schemas", () => {
  it("rejects empty cart lines", () => {
    expect(() => draftCreateSchema.parse({ lines: [] })).toThrow();
  });
  it("rejects zero quantity", () => {
    expect(() =>
      draftCreateSchema.parse({ lines: [{ productId: "p1", qty: 0 }] }),
    ).toThrow();
  });
  it("rejects unknown payment method", () => {
    expect(() =>
      completeSchema.parse({
        saleId: "s1",
        payments: [{ method: "bitcoin", amountMinor: 100 }],
        idempotencyKey: "key-12345",
      }),
    ).toThrow();
  });
  it("rejects unknown reconcile outcome", () => {
    expect(() => reconcileSchema.parse({ outcome: "MAYBE" })).toThrow();
  });
  it("accepts a minimal valid draft", () => {
    const out = draftCreateSchema.parse({ lines: [{ productId: "p1", qty: 2 }] });
    expect(out.lines[0].qty).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/sales.schema.test.ts`
Expected: FAIL with cannot find module `../src/sales.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/sales.schema.ts`:

```ts
import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const PAYMENT_METHODS = [
  "cash",
  "card",
  "gcash",
  "maya",
  "bank_transfer",
  "other",
] as const;

export const draftLineSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
  lineDiscountMinor: moneyMinorSchema.default(0),
});

export const draftCreateSchema = z.object({
  lines: draftLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  customerId: z.string().min(1, "VALIDATION").optional(),
  customerName: z.string().trim().max(120, "VALIDATION").optional(),
  notes: z.string().trim().max(500, "VALIDATION").optional(),
  orderDiscountMinor: moneyMinorSchema.default(0),
});

export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  providerRef: z.string().trim().max(128, "VALIDATION").optional(),
});

export const completeSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  payments: paymentInputSchema.array().min(1, "VALIDATION").max(10, "VALIDATION"),
  idempotencyKey: z.string().min(8, "VALIDATION").max(128, "VALIDATION"),
});

export const reconcileSchema = z.object({
  outcome: z.enum(["SUCCEEDED", "FAILED"]),
});

export const refundRequestSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});

export const salesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(50),
  status: z.string().trim().max(32, "VALIDATION").optional(),
});
```

Append `export * from "./sales.schema";` to `packages/validation/src/index.ts`.

Repair `packages/database/prisma/schema.prisma`: move the orphaned lines (`preventOversell`, `movements`, `balances`) inside the `Product` model block, then append:

```prisma
model Sale {
  id             String     @id @default(cuid())
  businessId     String
  receiptNo      String
  status         String     @default("DRAFT")
  subtotalMinor  Int        @default(0)
  discountMinor  Int        @default(0)
  taxMinor       Int        @default(0)
  totalMinor     Int        @default(0)
  paidMinor      Int        @default(0)
  changeMinor    Int        @default(0)
  currency       String     @default("PHP")
  customerId     String?
  customerName   String?
  notes          String?
  actorId        String
  requestId      String
  idempotencyKey String?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  business       Business   @relation(fields: [businessId], references: [id])
  items          SaleItem[]
  payments       Payment[]
  @@unique([businessId, receiptNo])
  @@unique([businessId, idempotencyKey])
  @@index([businessId, status, createdAt])
}

model SaleItem {
  id                String  @id @default(cuid())
  businessId        String
  saleId            String
  productId         String
  name              String
  unit              String  @default("pc")
  qty               Int
  priceMinor        Int
  costMinor         Int     @default(0)
  taxRateBps        Int?
  lineDiscountMinor Int     @default(0)
  lineTotalMinor    Int
  sale              Sale    @relation(fields: [saleId], references: [id])
  @@index([businessId, saleId])
}

model Payment {
  id             String   @id @default(cuid())
  businessId     String
  saleId         String
  method         String
  amountMinor    Int
  status         String   @default("SUCCEEDED")
  providerRef    String?
  idempotencyKey String
  createdAt      DateTime @default(now())
  business       Business @relation(fields: [businessId], references: [id])
  sale           Sale     @relation(fields: [saleId], references: [id])
  @@unique([businessId, idempotencyKey])
  @@unique([businessId, providerRef])
  @@index([businessId, saleId])
}

model HeldSale {
  id         String    @id @default(cuid())
  businessId String
  actorId    String
  payload    Json
  createdAt  DateTime  @default(now())
  resumedAt  DateTime?
  business   Business  @relation(fields: [businessId], references: [id])
  @@index([businessId, actorId])
}

model SaleIdempotency {
  id          String   @id @default(cuid())
  businessId  String
  key         String
  commandType String
  fingerprint String
  resultId    String
  createdAt   DateTime @default(now())
  business    Business @relation(fields: [businessId], references: [id])
  @@unique([businessId, key, commandType])
}
```

Also add `sales Sale[]`, `payments Payment[]`, `heldSales HeldSale[]`, `idempotencyKeys SaleIdempotency[]` relation lists to the `Business` model.

Create `packages/database/prisma/migrations/0005_phase4_sales/migration.sql`:

```sql
CREATE TABLE "Sale" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "receiptNo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "discountMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "paidMinor" INTEGER NOT NULL DEFAULT 0,
  "changeMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "customerId" TEXT,
  "customerName" TEXT,
  "notes" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sale_businessId_receiptNo_key" ON "Sale"("businessId", "receiptNo");
CREATE UNIQUE INDEX "Sale_businessId_idempotencyKey_key" ON "Sale"("businessId", "idempotencyKey");
CREATE INDEX "Sale_businessId_status_createdAt_idx" ON "Sale"("businessId", "status", "createdAt");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SaleItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'pc',
  "qty" INTEGER NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "costMinor" INTEGER NOT NULL DEFAULT 0,
  "taxRateBps" INTEGER,
  "lineDiscountMinor" INTEGER NOT NULL DEFAULT 0,
  "lineTotalMinor" INTEGER NOT NULL,
  CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleItem_businessId_saleId_idx" ON "SaleItem"("businessId", "saleId");
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
  "providerRef" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_businessId_idempotencyKey_key" ON "Payment"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "Payment_businessId_providerRef_key" ON "Payment"("businessId", "providerRef");
CREATE INDEX "Payment_businessId_saleId_idx" ON "Payment"("businessId", "saleId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HeldSale" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumedAt" TIMESTAMP(3),
  CONSTRAINT "HeldSale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HeldSale_businessId_actorId_idx" ON "HeldSale"("businessId", "actorId");
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SaleIdempotency" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "commandType" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleIdempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaleIdempotency_businessId_key_commandType_key" ON "SaleIdempotency"("businessId", "key", "commandType");
ALTER TABLE "SaleIdempotency" ADD CONSTRAINT "SaleIdempotency_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (5 new schema tests plus existing suite).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/sales.schema.ts packages/validation/src/index.ts packages/validation/test/sales.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0005_phase4_sales/migration.sql
git commit -m "feat: add phase4 sales schema and validation contracts"
```

### Task 2: Sales domain helpers (totals, state machine, idempotency)

**Files:**
- Create: `apps/api/src/sales/totals.ts`
- Create: `apps/api/src/sales/state-machine.ts`
- Create: `apps/api/src/sales/idempotency.ts`
- Create: `apps/api/src/sales/sales.test.ts`

**Interfaces:**
- Consumes: Task 1 Zod output shapes (plain cart lines with snapshot prices).
- Produces: `computeSaleTotals`, `requiresDiscountOverride`, `VALID_TRANSITIONS`, `transitionSale`, `COMMAND_TYPES`, `fingerprintPayload`. Task 4 uses these exact names and signatures.

- [ ] **Step 1: Write the failing domain test**

Create `apps/api/src/sales/sales.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { computeSaleTotals, requiresDiscountOverride } from "./totals";
import { transitionSale } from "./state-machine";
import { fingerprintPayload } from "./idempotency";

describe("phase4 sales domain", () => {
  it("computes subtotal, tax, and total in minor units", () => {
    const out = computeSaleTotals({
      lines: [
        { qty: 2, priceMinor: 2500, costMinor: 1000, taxRateBps: 1200, lineDiscountMinor: 0 },
        { qty: 1, priceMinor: 1000, costMinor: 400, taxRateBps: null, lineDiscountMinor: 100 },
      ],
      orderDiscountMinor: 0,
      businessTaxRateBps: null,
    });
    expect(out.subtotalMinor).toBe(5900);
    expect(out.taxMinor).toBe(600);
    expect(out.totalMinor).toBe(6500);
  });
  it("caps order discount at subtotal and never goes negative", () => {
    const out = computeSaleTotals({ lines: [], orderDiscountMinor: 99999, businessTaxRateBps: null });
    expect(out.totalMinor).toBe(0);
  });
  it("flags discounts above threshold for override", () => {
    expect(
      requiresDiscountOverride({ orderDiscountMinor: 200, subtotalMinor: 1000, lines: [] }),
    ).toBe(true);
    expect(
      requiresDiscountOverride({ orderDiscountMinor: 50, subtotalMinor: 1000, lines: [] }),
    ).toBe(false);
  });
  it("allows DRAFT->PENDING_PAYMENT->PAID->COMPLETED and rejects skips", () => {
    expect(transitionSale("DRAFT", "PENDING_PAYMENT")).toBe("PENDING_PAYMENT");
    expect(() => transitionSale("DRAFT", "COMPLETED")).toThrow("SALE_INVALID_TRANSITION");
    expect(() => transitionSale("COMPLETED", "DRAFT")).toThrow("SALE_INVALID_TRANSITION");
  });
  it("fingerprints deterministically regardless of key order", () => {
    expect(fingerprintPayload({ b: 1, a: 2 })).toBe(fingerprintPayload({ a: 2, b: 1 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/sales/sales.test.ts`
Expected: FAIL with cannot find module `./totals`.

- [ ] **Step 3: Write minimal domain implementation**

Create `apps/api/src/sales/totals.ts`:

```ts
export interface TotalsLine {
  qty: number;
  priceMinor: number;
  costMinor: number;
  taxRateBps: number | null;
  lineDiscountMinor: number;
}

export interface TotalsResult {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

function lineGross(line: TotalsLine): number {
  return line.qty * line.priceMinor;
}

function lineTax(line: TotalsLine, businessTaxRateBps: number | null): number {
  const rate = line.taxRateBps ?? businessTaxRateBps;
  if (rate === null || rate === 0) return 0;
  const net = Math.max(0, lineGross(line) - line.lineDiscountMinor);
  return Math.round((net * rate) / 10000);
}

export function computeSaleTotals(input: {
  lines: TotalsLine[];
  orderDiscountMinor: number;
  businessTaxRateBps: number | null;
}): TotalsResult {
  let subtotal = 0;
  let tax = 0;
  for (const line of input.lines) {
    subtotal += Math.max(0, lineGross(line) - line.lineDiscountMinor);
    tax += lineTax(line, input.businessTaxRateBps);
  }
  const discount = Math.min(Math.max(0, input.orderDiscountMinor), subtotal);
  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxMinor: tax,
    totalMinor: Math.max(0, subtotal - discount + tax),
  };
}

export function requiresDiscountOverride(input: {
  orderDiscountMinor: number;
  subtotalMinor: number;
  lines: Array<{ lineDiscountMinor: number; qty: number; priceMinor: number }>;
}): boolean {
  if (input.subtotalMinor > 0 && input.orderDiscountMinor * 10 > input.subtotalMinor) return true;
  return input.lines.some((l) => l.lineDiscountMinor * 5 > l.qty * l.priceMinor);
}
```

Create `apps/api/src/sales/state-machine.ts`:

```ts
export const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_PAYMENT", "VOIDED"],
  PENDING_PAYMENT: ["PAID", "PAYMENT_FAILED", "PAYMENT_UNKNOWN", "VOIDED"],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "VOIDED"],
  PAYMENT_UNKNOWN: ["RECONCILED", "VOIDED"],
  RECONCILED: ["PENDING_PAYMENT"],
  PAID: ["COMPLETED"],
  COMPLETED: ["REFUND_REQUESTED"],
  REFUND_REQUESTED: [],
  VOIDED: [],
};

export function transitionSale(from: string, to: string): string {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new Error("SALE_INVALID_TRANSITION");
  return to;
}
```

Create `apps/api/src/sales/idempotency.ts`:

```ts
import { createHash } from "node:crypto";

export const COMMAND_TYPES = ["sale.complete", "payment.reconcile", "refund.request"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export function fingerprintPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/sales/sales.test.ts`
Expected: PASS (5 tests; tax check: line1 net 5000 * 1200/10000 = 600, line2 null rate = 0; subtotal 5000 + 900 = 5900; total 6500).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sales/totals.ts apps/api/src/sales/state-machine.ts apps/api/src/sales/idempotency.ts apps/api/src/sales/sales.test.ts
git commit -m "feat: add phase4 sales domain helpers"
```

### Task 3: DbPort extension plus memory implementation

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbSale`, `DbSaleItem`, `DbPayment`, `DbHeldSale`, `DbIdempotency`, sales methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement sales methods)

**Interfaces:**
- Consumes: Task 2 helpers (service uses them; memory DB stores rows as given).
- Produces: `DbPort.createSale`, `findSaleById`, `listSalesByBusiness`, `updateSale`, `createSaleItem`, `listSaleItems`, `createPayment`, `findPaymentById`, `listPaymentsBySale`, `updatePayment`, `createHeldSale`, `findHeldSaleById`, `markHeldResumed`, `claimIdempotency`, `findIdempotency`, `nextReceiptNo`. Task 4 uses these exact names.

- [ ] **Step 1: Write the failing port test**

Create `apps/api/src/sales/nest/sales.service.test.ts` with (Task 4 extends it):

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase4 sales port", () => {
  it("round-trips a sale scoped to its business", async () => {
    const db = createMemoryDb();
    const sale = await db.createSale({
      businessId: "b1", receiptNo: "2026-000001", status: "DRAFT",
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
      paidMinor: 0, changeMinor: 0, currency: "PHP",
      customerId: null, customerName: null, notes: null,
      actorId: "u1", requestId: "r1", idempotencyKey: null,
    });
    expect(await db.findSaleById(sale.id, "b1")).not.toBeNull();
    expect(await db.findSaleById(sale.id, "b2")).toBeNull();
    expect(await db.listSalesByBusiness("b2")).toEqual([]);
  });
  it("claims idempotency keys once per command type", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({
      businessId: "b1", key: "k1", commandType: "sale.complete",
      fingerprint: "fp1", resultId: "s1",
    });
    await expect(
      db.claimIdempotency({
        businessId: "b1", key: "k1", commandType: "sale.complete",
        fingerprint: "fp1", resultId: "s1",
      }),
    ).rejects.toThrow("IDEMPOTENCY_REPLAY");
    expect(await db.findIdempotency("b1", "k1", "sale.complete")).not.toBeNull();
  });
  it("issues sequential receipt numbers per business", async () => {
    const db = createMemoryDb();
    const first = await db.nextReceiptNo("b1");
    const second = await db.nextReceiptNo("b1");
    expect(first).not.toBe(second);
    expect(await db.nextReceiptNo("b2")).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts`
Expected: FAIL — `db.createSale is not a function`.

- [ ] **Step 3: Write minimal port + memory implementation**

Append to `apps/api/src/common/db.port.ts`:

```ts
export interface DbSale {
  id: string;
  businessId: string;
  receiptNo: string;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  currency: string;
  customerId: string | null;
  customerName: string | null;
  notes: string | null;
  actorId: string;
  requestId: string;
  idempotencyKey: string | null;
}

export interface DbSaleItem {
  id: string;
  businessId: string;
  saleId: string;
  productId: string;
  name: string;
  unit: string;
  qty: number;
  priceMinor: number;
  costMinor: number;
  taxRateBps: number | null;
  lineDiscountMinor: number;
  lineTotalMinor: number;
}

export interface DbPayment {
  id: string;
  businessId: string;
  saleId: string;
  method: string;
  amountMinor: number;
  status: string;
  providerRef: string | null;
  idempotencyKey: string;
}

export interface DbHeldSale {
  id: string;
  businessId: string;
  actorId: string;
  payload: unknown;
  resumedAt: Date | null;
}

export interface DbIdempotency {
  businessId: string;
  key: string;
  commandType: string;
  fingerprint: string;
  resultId: string;
}
```

Append to the `DbPort` interface:

```ts
  createSale(s: Omit<DbSale, "id">): Promise<DbSale>;
  findSaleById(id: string, businessId: string): Promise<DbSale | null>;
  listSalesByBusiness(businessId: string): Promise<DbSale[]>;
  updateSale(id: string, businessId: string, patch: Partial<Omit<DbSale, "id" | "businessId">>): Promise<DbSale | null>;
  createSaleItem(i: Omit<DbSaleItem, "id">): Promise<DbSaleItem>;
  listSaleItems(saleId: string, businessId: string): Promise<DbSaleItem[]>;
  createPayment(p: Omit<DbPayment, "id">): Promise<DbPayment>;
  findPaymentById(id: string, businessId: string): Promise<DbPayment | null>;
  listPaymentsBySale(saleId: string, businessId: string): Promise<DbPayment[]>;
  updatePayment(id: string, businessId: string, patch: Partial<Omit<DbPayment, "id" | "businessId">>): Promise<DbPayment | null>;
  createHeldSale(h: Omit<DbHeldSale, "id">): Promise<DbHeldSale & { id: string }>;
  findHeldSaleById(id: string, businessId: string): Promise<(DbHeldSale & { id: string }) | null>;
  markHeldResumed(id: string, businessId: string): Promise<void>;
  claimIdempotency(r: DbIdempotency): Promise<void>;
  findIdempotency(businessId: string, key: string, commandType: string): Promise<DbIdempotency | null>;
  nextReceiptNo(businessId: string): Promise<string>;
```

In `apps/api/src/common/memory.db.ts`: add `sales`, `saleItems`, `payments`, `heldSales`, `idempotency` maps plus a `receiptSeq: Map<string, number>`; `claimIdempotency` throws `IDEMPOTENCY_REPLAY` when the same `(businessId, key, commandType)` exists; `nextReceiptNo` returns `${year}-${String(seq).padStart(6, "0")}` with per-business sequence starting at 1. All reads filter by strict `businessId` equality (cross-tenant returns `null`/`[]`). Follow the existing `nid("sale")` id style.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/sales/nest/sales.service.test.ts
git commit -m "feat: add phase4 sales db port and memory implementation"
```

### Task 4: SalesService

**Files:**
- Create: `apps/api/src/sales/nest/sales.service.ts`
- Modify: `apps/api/src/sales/nest/sales.service.test.ts` (append service behavior tests)

**Interfaces:**
- Consumes: Tasks 1–3 (Zod types, `computeSaleTotals`/`requiresDiscountOverride`/`transitionSale`/`fingerprintPayload`, `DbPort` sales + catalog + inventory methods, `withScope`).
- Produces: `SalesService` with `createDraft`, `holdSale`, `resumeSale`, `voidSale`, `completeSale`, `reconcilePayment`, `requestRefund`, `getSale`, `listSales`, `receiptData`. Task 5 controller calls these exact methods. `completeSale` returns `{ sale: SaleWithLines, replayed: boolean }` where `SaleWithLines` is the sale row plus embedded `items` and `payments` arrays; `reconcilePayment` returns `{ sale: SaleWithLines, payment }`. The controller spreads the sale object at the top level for `complete` (`201 { ...sale, replayed: false }`, replay `200 { ...sale, replayed: true }`, unknown `202 { code: "PAYMENT_UNKNOWN", sale }`) and returns `{ sale, payment }` for reconcile.

Service rules:
- `createDraft(businessId, actorId, requestId, input)`: snapshot each line from the catalog product in the same business (missing/cross-tenant/inactive product → `NOT_FOUND`/`VALIDATION`); discount above threshold without `discount.override` in `granted` → `FORBIDDEN`; compute totals; `receiptNo` from `nextReceiptNo`; status `DRAFT`; audit `sale.draft`.
- `completeSale(businessId, actorId, requestId, saleId, payments, key, granted)`: sale must be `DRAFT`/`PENDING_PAYMENT` (else `SALE_INVALID_TRANSITION`); fingerprint = `fingerprintPayload({ saleId, payments })`; existing idempotency with same key+type returns original sale with `replayed: true`; same key with different fingerprint → `IDEMPOTENCY_MISMATCH`; payments sum must equal total (cash may overpay; change recorded; non-cash over/underpay → `PAYMENT_TOTAL_MISMATCH`); oversell guard per tracked line via `findBalance` (would-go-negative with `preventOversell` → `INSUFFICIENT_STOCK`, nothing written); on success: transition to `PAID` then `COMPLETED`, persist `SUCCEEDED` payments, `sale` inventory movements + balance updates for tracked lines, claim idempotency, audit `sale.complete`. Unknown-outcome simulation: payments with `providerRef` starting `"unknown-"` persist as `UNKNOWN` and move the sale to `PAYMENT_UNKNOWN` (returned with 202 semantics; controller maps to `PAYMENT_UNKNOWN` code).
- `reconcilePayment(businessId, actorId, requestId, paymentId, outcome, key)`: payment must be `UNKNOWN` (else `SALE_INVALID_TRANSITION`); idempotent by key; `SUCCEEDED` with now-sufficient stock finalizes the sale to `COMPLETED` (writes movements then), `FAILED` moves sale to `PAYMENT_FAILED`; audit `payment.reconcile`.
- `holdSale`/`resumeSale`: own-actor drafts only (other actor's draft → `FORBIDDEN`); `resumeSale` clears `resumedAt` via `markHeldResumed`; audits `sale.hold`/`sale.resume`.
- `voidSale`: requires `sale.void` in `granted`, reason min 3 chars; only non-COMPLETED sales; audit `sale.void`.
- `requestRefund`: requires `sale.refund`, only `COMPLETED` sales, reason min 3; moves to `REFUND_REQUESTED`; audit `refund.request`.
- `getSale` returns sale + items + payments with cost redacted unless `granted` includes `cost.view`; cross-tenant → `NOT_FOUND`. `listSales` returns newest-first cursor page `{ items, nextCursor }`. `receiptData` returns the receipt JSON shape from the spec.

- [ ] **Step 1: Write the failing service tests**

Append to `apps/api/src/sales/nest/sales.service.test.ts`:

```ts
import { SalesService } from "./sales.service";

async function setupSale() {
  const { createMemoryDb } = await import("../../common/memory.db");
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
  const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view", "price.edit"];
  return { db, svc: new SalesService(db), productId: prod.id, ALL };
}

describe("phase4 sales service", () => {
  it("drafts and completes a sale with stock decrease and audit", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    expect(draft.status).toBe("DRAFT");
    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "key-00001", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(8);
    expect((await db.listAudit()).some((a) => a.action === "sale.complete")).toBe(true);
  });
  it("replays the same idempotency key without a second sale", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const first = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "key-replay", granted: ALL,
    });
    const second = await svc.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "key-replay", granted: ALL,
    });
    expect(second.replayed).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);
    expect((await db.listSalesByBusiness("b1")).filter((s) => s.status === "COMPLETED").length).toBe(1);
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(9);
  });
  it("rejects oversell with INSUFFICIENT_STOCK and writes nothing", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 99, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await expect(
      svc.completeSale("b1", "u1", "r2", draft.id, {
        payments: [{ method: "cash", amountMinor: draft.totalMinor }],
        key: "key-oversell", granted: ALL,
      }),
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect((await db.listMovements(productId, "b1")).length).toBe(0);
  });
  it("rejects over-threshold discount without override", async () => {
    const { svc, productId } = await setupSale();
    await expect(
      svc.createDraft("b1", "u1", "r1", {
        lines: [{ productId, qty: 1, lineDiscountMinor: 0 }],
        orderDiscountMinor: 1000,
      }, []),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("blocks cross-tenant sale reads with NOT_FOUND", async () => {
    const { svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await expect(svc.getSale("b2", draft.id, ALL)).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts`
Expected: FAIL with cannot find module `./sales.service`.

- [ ] **Step 3: Write minimal service implementation**

Create `apps/api/src/sales/nest/sales.service.ts` implementing the class per the rules above, in `CatalogService`/`InventoryService` style (constructor injects `DbPort`; methods take `(businessId, actorId, requestId, ...)` plus `granted: string[]` where permission-gated). Use `withScope` for scoping, Task 2 helpers for totals/transitions/fingerprints, `db.appendAudit` per mutation (`sale.draft`, `sale.hold`, `sale.resume`, `sale.complete`, `sale.void`, `payment.reconcile`, `refund.request`). `completeSale` returns `{ sale, replayed: boolean }`; reconcile returns `{ sale, payment }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/sales/nest/sales.service.test.ts`
Expected: PASS (3 port + 5 service tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sales/nest/sales.service.ts apps/api/src/sales/nest/sales.service.test.ts
git commit -m "feat: add phase4 sales service"
```

### Task 5: Sales HTTP layer

**Files:**
- Create: `apps/api/src/sales/nest/sales.controller.ts`
- Create: `apps/api/src/sales/nest/sales.module.ts`
- Modify: `apps/api/src/app.module.ts` (register controller + service in `@Module` and `createTestApp`)
- Modify: `apps/api/src/common/http-helpers.ts` (add `SALE_INVALID_TRANSITION: 409`, `PAYMENT_TOTAL_MISMATCH: 400`, `IDEMPOTENCY_MISMATCH: 409`, `PAYMENT_UNKNOWN: 202` to `CODE_STATUS`)
- Create: `apps/api/test/sales.contract.test.ts`

**Interfaces:**
- Consumes: Task 4 `SalesService`, Task 1 Zod schemas, Phase 1 `SessionGuard`/`CsrfGuard`/`AuthService.rolePermissions`/`fail`/`statusFor`/`rid` pattern.
- Produces: routes `POST /api/v1/sales/drafts`, `POST /api/v1/sales/:id/hold`, `POST /api/v1/sales/:id/resume`, `POST /api/v1/sales/:id/void`, `POST /api/v1/sales/complete`, `GET /api/v1/sales`, `GET /api/v1/sales/:id`, `POST /api/v1/payments/:id/reconcile`, `GET /api/v1/payments/methods`, `GET /api/v1/receipts/:saleId`, `POST /api/v1/sales/:id/refund-request`. Task 6 tests permission/cross-tenant behavior.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on all POSTs; `Idempotency-Key` header required on complete/reconcile/refund-request (missing → `fail(res, 400, "VALIDATION", ...)`); role permission checks via `this.auth.rolePermissions(auth.role)` for `discount.override` (pre-check before draft), `sale.void`, `sale.refund`; cost redaction on detail via `cost.view`; Zod `safeParse` failures → `400 VALIDATION` (oversize/import-style errors n/a); service throws map via `statusFor(code)`; UNKNOWN completion returns `202 { code: "PAYMENT_UNKNOWN", sale }` with reconcile guidance and no blind-retry copy.

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/test/sales.contract.test.ts` with file-scoped fixtures (same `jar()` cookie pattern as catalog/inventory tests):

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
    ownerName: "Ana", email: "ana-sale@example.com",
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
});

afterAll(async () => { await app.close(); });

describe("phase4 sales HTTP contract", () => {
  it("drafts and completes a cash sale end-to-end with receipt", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }] });
    expect(draft.status).toBe(201);
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-0001")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(complete.status).toBe(201);
    expect(complete.body.status).toBe("COMPLETED");
    const receipt = await request(app.getHttpServer()).get(`/api/v1/receipts/${draft.body.id}`)
      .set("Cookie", cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.receiptNo).toBeTruthy();
  });

  it("replays the same idempotency key without a duplicate", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const first = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-replay")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-replay")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects split-total mismatch with PAYMENT_TOTAL_MISMATCH", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-mismatch")
      .send({ saleId: draft.body.id, payments: [{ method: "card", amountMinor: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYMENT_TOTAL_MISMATCH");
  });

  it("rejects unauthenticated sales read with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/sales");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/sales.contract.test.ts`
Expected: FAIL — 404 on `/api/v1/sales/drafts` (no route yet).

- [ ] **Step 3: Write minimal controller + module + wiring**

Implement the two files per the Controller rules above, mirroring `inventory.controller.ts` structure (`rid()`, `@Controller("api/v1")`, `@UseGuards(SessionGuard)`, `@Res()` responses, `fail`/`statusFor`). Wire into `app.module.ts` `@Module` and `createTestApp` factory following the existing `InventoryService` factory pattern. Add the four codes to `CODE_STATUS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- test/sales.contract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sales/nest/sales.controller.ts apps/api/src/sales/nest/sales.module.ts apps/api/src/app.module.ts apps/api/src/common/http-helpers.ts apps/api/test/sales.contract.test.ts
git commit -m "feat: add phase4 sales http layer"
```

### Task 6: Permission, UNKNOWN reconcile, cross-tenant coverage + live-DB migration proof

**Files:**
- Modify: `apps/api/test/sales.contract.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 5 routes, Phase 1 `ROLE_SEED` (cashier lacks `sale.void`/`sale.refund`/`discount.override`).
- Produces: proof of FORBIDDEN cashier void/refund, UNKNOWN→reconcile round-trip, NOT_FOUND cross-tenant access.

- [ ] **Step 1: Write the failing coverage tests**

Append (file-scoped `app`/`cookie`/`csrf`/`productId` shared):

```ts
describe("phase4 sales permissions, unknown, and cross-tenant", () => {
  it("cashier role lacks sale.void and sale.refund", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("sale.void");
    expect(svc.rolePermissions("cashier")).not.toContain("sale.refund");
    expect(svc.rolePermissions("manager")).toContain("sale.refund");
  });

  it("unknown provider outcome returns 202 with reconcile path", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-unknown")
      .send({
        saleId: draft.body.id,
        payments: [{ method: "gcash", amountMinor: draft.body.totalMinor, providerRef: "unknown-1" }],
      });
    expect(res.status).toBe(202);
    expect(res.body.code).toBe("PAYMENT_UNKNOWN");
    const paymentId = res.body.sale.payments[0].id;
    const rec = await request(app.getHttpServer()).post(`/api/v1/payments/${paymentId}/reconcile`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "rec-key-1")
      .send({ outcome: "SUCCEEDED" });
    expect(rec.status).toBe(200);
    expect(rec.body.sale.status).toBe("COMPLETED");
  });

  it("returns NOT_FOUND for another tenant's sale", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-sale@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const list = await request(app.getHttpServer()).get("/api/v1/sales").set("Cookie", cookie);
    const id = list.body.items[0].id;
    const got = await request(app.getHttpServer()).get(`/api/v1/sales/${id}`).set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });

  it("holds and resumes a draft", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const held = await request(app.getHttpServer()).post(`/api/v1/sales/${draft.body.id}/hold`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(held.status).toBe(200);
    const resumed = await request(app.getHttpServer()).post(`/api/v1/sales/${draft.body.id}/resume`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe("DRAFT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/sales.contract.test.ts`
Expected: FAIL — reconcile shape mismatch or equivalent (fix the route to return `{ sale, payment }`).

- [ ] **Step 3: Write minimal fix**

Ensure `POST /api/v1/payments/:id/reconcile` returns `200 { sale, payment }` and `POST /api/v1/sales/complete` UNKNOWN path returns `202 { code: "PAYMENT_UNKNOWN", sale }`. Shape fix only.

- [ ] **Step 4: Prove migrations 0001→0005 on live Postgres**

Run against `pos-db-phase3` (host port 5433), resetting first if tables exist:

```bash
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0001_phase0_foundation/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0002_phase1_auth/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0003_phase2_catalog/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0004_phase3_inventory/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -f packages/database/prisma/migrations/0005_phase4_sales/migration.sql
PGPASSWORD=pos psql -h localhost -p 5433 -U pos -d pos -c '\dt'
```

Expected: all apply cleanly; `\dt` lists all tables including `Sale`, `SaleItem`, `Payment`, `HeldSale`, `SaleIdempotency`.

- [ ] **Step 5: Run test to verify it passes, then commit**

Run: `pnpm --filter @pos/api test`
Expected: PASS (full API suite).

```bash
git add apps/api/test/sales.contract.test.ts apps/api/src/sales/nest/sales.controller.ts
git commit -m "test: add phase4 permission unknown-reconcile and cross-tenant coverage"
```

### Task 7: POS web UI (uses frontend-design)

**Files:**
- Create: `apps/web/src/lib/sales.ts`
- Create: `apps/web/test/sales.test.ts`
- Create: `apps/web/src/app/pos/page.tsx`
- Create: `apps/web/src/app/receipts/[saleId]/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (link to `/pos`)

**Interfaces:**
- Consumes: Task 5 routes via `apiFetch`; role from `GET /api/v1/me`; catalog search endpoint for product lookup.
- Produces: cashier POS workspace, receipt view/print page.

Design (frontend-design skill): POS is an appliance — commit to an **appliance/utilitarian** direction. Persistent cart rail, tabular numerals, large PAY target, status as text + shape (never color alone), generous touch targets for tablet. No gradients, no decorative motion — motion budget goes to add-item/payment confirmations only.

Web rules: `"use client"` + TanStack Query like Phase 2/3 pages; CSRF token from `GET /api/v1/auth/csrf` for mutations plus `Idempotency-Key` generated per complete attempt via `crypto.randomUUID()`; hide void/refund/discount-override affordances without the matching permission; server authoritative.

- [ ] **Step 1: Write the failing web test**

Create `apps/web/test/sales.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("phase4 pos web helpers", () => {
  it("sums a local cart in minor units", async () => {
    const { cartTotal } = await import("../src/lib/sales");
    expect(cartTotal([{ qty: 2, priceMinor: 2500, lineDiscountMinor: 0 }])).toBe(5000);
  });
  it("gates void and refund affordances by permission", async () => {
    const { canVoidSale, canRequestRefund } = await import("../src/lib/sales");
    expect(canVoidSale(["sale.void"])).toBe(true);
    expect(canVoidSale([])).toBe(false);
    expect(canRequestRefund(["sale.refund"])).toBe(true);
    expect(canRequestRefund([])).toBe(false);
  });
  it("builds the complete-sale payload with idempotency key", async () => {
    const { buildCompletePayload } = await import("../src/lib/sales");
    const out = buildCompletePayload("s1", [{ method: "cash", amountMinor: 100 }], "key-1");
    expect(out).toEqual({
      saleId: "s1",
      payments: [{ method: "cash", amountMinor: 100 }],
      idempotencyKey: "key-1",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test -- test/sales.test.ts`
Expected: FAIL with cannot find module `../src/lib/sales`.

- [ ] **Step 3: Write minimal lib + pages**

Create `apps/web/src/lib/sales.ts`:

```ts
export interface CartLine {
  qty: number;
  priceMinor: number;
  lineDiscountMinor: number;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, l.qty * l.priceMinor - l.lineDiscountMinor), 0);
}

export function canVoidSale(granted: string[]): boolean {
  return granted.includes("sale.void");
}

export function canRequestRefund(granted: string[]): boolean {
  return granted.includes("sale.refund");
}

export function buildCompletePayload(
  saleId: string,
  payments: Array<{ method: string; amountMinor: number }>,
  idempotencyKey: string,
): { saleId: string; payments: Array<{ method: string; amountMinor: number }>; idempotencyKey: string } {
  return { saleId, payments, idempotencyKey };
}
```

Create `/pos/page.tsx`: left product search (reuse catalog search endpoint) + grid; right cart rail (qty steppers, line discount, notes, customer input, hold/resume buttons) + totals + PAY opening the payment panel (method tabs from `/api/v1/payments/methods`, amount received, change, split editor, processing/success/failed/unknown states with reconcile guidance). Create `/receipts/[saleId]/page.tsx`: receipt view + print button with 58/80mm print CSS. Add dashboard link to `/pos`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sales.ts apps/web/test/sales.test.ts apps/web/src/app/pos/page.tsx "apps/web/src/app/receipts/[saleId]/page.tsx" apps/web/src/app/page.tsx
git commit -m "feat: add phase4 pos and receipt web ui"
```

### Task 8: Exit gate and verification

**Files:**
- Create: `tests/phase4-exit.test.ts`
- Create: `scripts/verify-phase4.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase4 line, byte-preserving — file is CRLF)
- Modify: root `package.json` (no change needed — `test:exit` already covers `tests/`)

**Interfaces:**
- Consumes: all Phase 4 deliverables.
- Produces: Phase 4 exit proof.

- [ ] **Step 1: Write the failing exit test**

Create `tests/phase4-exit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSaleTotals } from "../apps/api/src/sales/totals";
import { transitionSale } from "../apps/api/src/sales/state-machine";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";

async function setup() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 5 });
  return { db, svc: new SalesService(db), productId: prod.id, ALL: ["discount.override", "sale.void", "sale.refund", "cost.view"] };
}

describe("phase4 exit", () => {
  it("completes a sale without duplicate charge or ambiguous inventory", async () => {
    const { db, svc, productId, ALL } = await setup();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit-key-1", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    const bal = await db.findBalance(productId, "b1");
    const ledger = await db.listMovements(productId, "b1");
    expect(bal!.qtyOnHand).toBe(3);
    expect(ledger.reduce((s, m) => s + m.qtyDelta, 0)).toBe(-2);
    expect(ledger.every((m) => m.type === "sale")).toBe(true);
    expect(done.sale.totalMinor).toBe(computeSaleTotals({
      lines: [{ qty: 2, priceMinor: 2500, costMinor: 1000, taxRateBps: null, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0, businessTaxRateBps: null,
    }).totalMinor);
  });
  it("invalid transitions rejected", () => {
    expect(() => transitionSale("DRAFT", "COMPLETED")).toThrow("SALE_INVALID_TRANSITION");
  });
  it("concurrent last-stock sales: one succeeds, ledger consistent", async () => {
    const { db, svc, productId, ALL } = await setup();
    const a = await svc.createDraft("b1", "u1", "ra", {
      lines: [{ productId, qty: 5, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const b = await svc.createDraft("b1", "u1", "rb", {
      lines: [{ productId, qty: 5, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const results = await Promise.allSettled([
      svc.completeSale("b1", "u1", "rc", a.id, {
        payments: [{ method: "cash", amountMinor: a.totalMinor }], key: "exit-ca", granted: ALL,
      }),
      svc.completeSale("b1", "u1", "rd", b.id, {
        payments: [{ method: "cash", amountMinor: b.totalMinor }], key: "exit-cb", granted: ALL,
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const blocked = results.filter(
      (r) => r.status === "rejected" && String(r.reason).includes("INSUFFICIENT_STOCK"),
    ).length;
    expect(ok).toBe(1);
    expect(blocked).toBe(1);
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(0);
  });
  it("unknown payment is recoverable through reconcile", async () => {
    const { svc, productId, ALL } = await setup();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const pending = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "gcash", amountMinor: draft.totalMinor, providerRef: "unknown-9" }],
      key: "exit-ku", granted: ALL,
    });
    expect(pending.sale.status).toBe("PAYMENT_UNKNOWN");
    const paymentId = pending.sale.payments[0].id;
    const rec = await svc.reconcilePayment("b1", "u1", "r3", paymentId, "SUCCEEDED", "exit-kr");
    expect(rec.sale.status).toBe("COMPLETED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:exit`
Expected: FAIL with cannot find module `../apps/api/src/sales/totals` (until Tasks 2–4 land; passes when executed in order).

- [ ] **Step 3: Write minimal verification script**

Create `scripts/verify-phase4.test.mjs`:

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0005_phase4_sales/migration.sql"),
  existsSync("packages/validation/src/sales.schema.ts"),
  existsSync("apps/api/src/sales/totals.ts"),
  existsSync("apps/api/src/sales/state-machine.ts"),
  existsSync("apps/api/src/sales/idempotency.ts"),
  existsSync("apps/api/src/sales/nest/sales.service.ts"),
  existsSync("apps/api/src/sales/nest/sales.controller.ts"),
  existsSync("apps/api/src/sales/nest/sales.module.ts"),
  existsSync("apps/api/test/sales.contract.test.ts"),
  existsSync("apps/web/src/app/pos/page.tsx"),
  existsSync("apps/web/src/app/receipts/[saleId]/page.tsx"),
  existsSync("tests/phase4-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE4_OK");
} else {
  console.error("PHASE4_MISSING");
  process.exit(1);
}
```

Append `      - run: node scripts/verify-phase4.test.mjs` to `.github/workflows/ci.yml` byte-preserving (CRLF file — use byte append, never a full rewrite).

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase4.test.mjs && pnpm typecheck && pnpm lint`
Expected: all green + `PHASE4_OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/phase4-exit.test.ts scripts/verify-phase4.test.mjs .github/workflows/ci.yml
git commit -m "test: add phase4 exit gate and verification"
```
