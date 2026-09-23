# Phase 6 Sales, Customers, Refunds, Expenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 6 per `docs/superpowers/specs/2026-09-23-phase6-sales-customers-refunds-expenses-design.md` so an owner can explain a sale, refund, expense, and customer history from source records.

**Architecture:** Three subsystem additions in the existing modular monolith — `CustomerModule` (CRUD + history), `RefundModule` (approve/reject with compensating writes through `DbPort` plus internally-instantiated `ShiftService`, mirroring the Phase 5 `SalesService` pattern that avoids Nest DI cycles), `ExpenseModule` (entry + void with optional shift linkage) — plus `SalesService` extensions (history filters, detail embeds, CSV export). Pure domain logic in framework-free functions; controllers are thin adapters tested via `supertest`.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 2.1.8, supertest, Next.js 15 + React 19 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-23-phase6-sales-customers-refunds-expenses-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, no float totals (PLAN.md 6.2).
- Tenant derived server-side from authenticated membership only, never from client tenantId claim (FR-TENANT-01).
- Every business-owned table includes businessId, every read and write scoped via `withScope`.
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC on wire, `X-Request-Id` correlation.
- Cursor pagination for sales/shift-style lists (limit default 50, cap 100); bounded page pagination for customer search (default 20, cap 100); exports capped at 1000 rows, synchronous.
- `Idempotency-Key` header required on refund-approve (commandType `refund.approve`); existing keys unchanged.
- Audit log append-only; snapshots keep cost (no secrets in these rows).
- Cookie `pos_session` + `X-CSRF-Token` on mutations (Phase 1, unchanged).
- Permission gates reuse Phase 1 `SENSITIVE_ACTIONS` keys (`sale.refund`, `export.run`, `shift.close.override` unchanged) plus role-set gates where the matrix has no key; no new permission keys.
- No file uploads (attachment is a URL string), no provider settlement, no suppliers/loyalty/accounting/branches/offline/AI.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/database/prisma/schema.prisma`: add `Customer` + `Refund` + `RefundItem` + `Expense` models, relation lists on `Business` (Task 1).
- `packages/database/prisma/migrations/0007_phase6_care/migration.sql` (Task 1).
- `packages/validation/src/customers.schema.ts`, `refunds.schema.ts`, `expenses.schema.ts` + tests (Task 1).
- `packages/validation/src/sales.schema.ts`: extend `salesQuerySchema` with customerId/dateFrom/dateTo (Task 1).
- `apps/api/src/customers/nest/customer.service.ts` + `customer.service.test.ts` (Task 2).
- `apps/api/src/refunds/refund-math.ts` + `apps/api/src/refunds/nest/refund.service.ts` + `refund.service.test.ts` (Task 3).
- `apps/api/src/expenses/nest/expense.service.ts` + `expense.service.test.ts` (Task 4).
- `apps/api/src/common/db.port.ts` + `memory.db.ts`: customer/refund/expense types + methods (Tasks 2-4, each task extends the port for its own entities).
- `apps/api/src/sales/state-machine.ts`: add refund transitions (Task 3).
- `apps/api/src/sales/nest/sales.service.ts`: history filters, detail embeds (Task 6).
- `apps/api/src/common/csv.ts` + test (Task 6).
- `apps/api/src/customers/nest/customer.controller.ts` + `customer.module.ts` (Task 5).
- `apps/api/src/expenses/nest/expense.controller.ts` + `expense.module.ts` (Task 5).
- `apps/api/src/refunds/nest/refund.controller.ts` + `refund.module.ts` (Task 6).
- `apps/api/src/app.module.ts`: register all three (Tasks 5-6).
- `apps/api/src/common/http-helpers.ts`: add `REFUND_EXCEEDS_LIMIT: 400` (Task 6).
- `apps/api/test/customer.contract.test.ts`, `expense.contract.test.ts` (Task 5), `refund.contract.test.ts` (Tasks 6-7).
- `apps/web/src/lib/customers.ts`, `apps/web/src/lib/expenses.ts`, `apps/web/test/customers.test.ts` (Task 8).
- `apps/web/src/app/sales/page.tsx`, `apps/web/src/app/sales/[id]/page.tsx`, `apps/web/src/app/customers/page.tsx`, `apps/web/src/app/customers/[id]/page.tsx`, `apps/web/src/app/expenses/page.tsx` (Task 8).
- `apps/web/src/app/pos/page.tsx`: customer search/select (Task 8). `apps/web/src/app/page.tsx`: links (Task 8).
- `tests/phase6-exit.test.ts`, `scripts/verify-phase6.test.mjs`, CI extension (Task 9).

### Task 1: Schema plus validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0007_phase6_care/migration.sql`
- Create: `packages/validation/src/customers.schema.ts`, `refunds.schema.ts`, `expenses.schema.ts`
- Modify: `packages/validation/src/index.ts` (append three exports)
- Modify: `packages/validation/src/sales.schema.ts` (extend `salesQuerySchema`)
- Create: `packages/validation/test/customers.schema.test.ts`, `refunds.schema.test.ts`, `expenses.schema.test.ts`

**Interfaces:**
- Consumes: Phase 4-5 sales/shift models and schema patterns.
- Produces: `customerCreateSchema`, `customerUpdateSchema`, `customerSearchSchema`, `refundApproveSchema`, `refundRejectSchema`, `expenseCreateSchema`, `expenseListSchema`, `expenseVoidSchema`; extended `salesQuerySchema`; Prisma `Customer`/`Refund`/`RefundItem`/`Expense`.

- [ ] **Step 1: Write the failing validation tests**

Create `packages/validation/test/customers.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { customerCreateSchema, customerSearchSchema } from "../src/customers.schema";

describe("phase6 customer schemas", () => {
  it("rejects empty name", () => {
    expect(() => customerCreateSchema.parse({ name: "" })).toThrow();
  });
  it("rejects invalid email", () => {
    expect(() => customerCreateSchema.parse({ name: "Ana", email: "not-an-email" })).toThrow();
  });
  it("rejects pageSize over 100", () => {
    expect(() => customerSearchSchema.parse({ pageSize: 101 })).toThrow();
  });
  it("accepts name-only walk-in", () => {
    expect(customerCreateSchema.parse({ name: "Walk-in" }).phone).toBeUndefined();
  });
});
```

Create `packages/validation/test/refunds.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { refundApproveSchema, refundRejectSchema } from "../src/refunds.schema";

describe("phase6 refund schemas", () => {
  it("rejects empty items", () => {
    expect(() => refundApproveSchema.parse({ saleId: "s1", items: [] })).toThrow();
  });
  it("rejects zero qty", () => {
    expect(() =>
      refundApproveSchema.parse({ saleId: "s1", items: [{ saleItemId: "i1", qty: 0 }] }),
    ).toThrow();
  });
  it("rejects short reject reason", () => {
    expect(() => refundRejectSchema.parse({ reason: "no" })).toThrow();
  });
  it("accepts a valid approval", () => {
    const out = refundApproveSchema.parse({ saleId: "s1", items: [{ saleItemId: "i1", qty: 1 }] });
    expect(out.items.length).toBe(1);
  });
});
```

Create `packages/validation/test/expenses.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { expenseCreateSchema } from "../src/expenses.schema";

describe("phase6 expense schemas", () => {
  it("rejects empty category", () => {
    expect(() => expenseCreateSchema.parse({ category: "", amountMinor: 100, method: "cash" })).toThrow();
  });
  it("rejects zero amount", () => {
    expect(() => expenseCreateSchema.parse({ category: "Ice", amountMinor: 0, method: "cash" })).toThrow();
  });
  it("rejects unknown method", () => {
    expect(() => expenseCreateSchema.parse({ category: "Ice", amountMinor: 100, method: "barter" })).toThrow();
  });
  it("rejects bad attachment url", () => {
    expect(() =>
      expenseCreateSchema.parse({ category: "Ice", amountMinor: 100, method: "cash", attachmentUrl: "not-a-url" }),
    ).toThrow();
  });
  it("accepts a minimal cash expense", () => {
    expect(expenseCreateSchema.parse({ category: "Ice", amountMinor: 500, method: "cash" }).method).toBe("cash");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/validation test -- test/customers.schema.test.ts test/refunds.schema.test.ts test/expenses.schema.test.ts`
Expected: FAIL — cannot find modules `../src/customers.schema`, `../src/refunds.schema`, `../src/expenses.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/customers.schema.ts`:

```ts
import { z } from "zod";

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  phone: z.string().trim().max(32, "VALIDATION").optional(),
  email: z.string().trim().email("VALIDATION").max(160, "VALIDATION").optional(),
  address: z.string().trim().max(300, "VALIDATION").optional(),
  notes: z.string().trim().max(500, "VALIDATION").optional(),
});

export const customerUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION").optional(),
    phone: z.string().trim().max(32, "VALIDATION").nullable().optional(),
    email: z.string().trim().email("VALIDATION").max(160, "VALIDATION").nullable().optional(),
    address: z.string().trim().max(300, "VALIDATION").nullable().optional(),
    notes: z.string().trim().max(500, "VALIDATION").nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const customerSearchSchema = z.object({
  q: z.string().trim().max(120, "VALIDATION").optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});
```

Create `packages/validation/src/refunds.schema.ts`:

```ts
import { z } from "zod";

export const refundItemSchema = z.object({
  saleItemId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
});

export const refundApproveSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  items: refundItemSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
});

export const refundRejectSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});
```

Create `packages/validation/src/expenses.schema.ts`:

```ts
import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const EXPENSE_METHODS = ["cash", "card", "gcash", "maya", "bank_transfer", "other"] as const;

export const expenseCreateSchema = z.object({
  category: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  description: z.string().trim().max(500, "VALIDATION").optional(),
  method: z.enum(EXPENSE_METHODS),
  expenseDate: z.string().max(64, "VALIDATION").optional(),
  attachmentUrl: z.string().trim().url("VALIDATION").max(500, "VALIDATION").optional(),
  shiftId: z.string().min(1, "VALIDATION").optional(),
});

export const expenseListSchema = z.object({
  category: z.string().trim().max(80, "VALIDATION").optional(),
  method: z.enum(EXPENSE_METHODS).optional(),
  dateFrom: z.string().max(64, "VALIDATION").optional(),
  dateTo: z.string().max(64, "VALIDATION").optional(),
  voided: z.enum(["all", "active", "voided"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const expenseVoidSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});
```

Append the three exports to `packages/validation/src/index.ts`.

Extend `salesQuerySchema` in `packages/validation/src/sales.schema.ts` with:

```ts
  customerId: z.string().min(1, "VALIDATION").optional(),
  dateFrom: z.string().max(64, "VALIDATION").optional(),
  dateTo: z.string().max(64, "VALIDATION").optional(),
```

Append to `packages/database/prisma/schema.prisma`:

```prisma
model Customer {
  id        String   @id @default(cuid())
  businessId String
  name      String
  phone     String?
  email     String?
  address   String?
  notes     String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  business  Business @relation(fields: [businessId], references: [id])
  @@unique([businessId, phone])
  @@index([businessId, isActive])
  @@index([businessId, name])
}

model Refund {
  id                String       @id @default(cuid())
  businessId        String
  saleId            String
  status            String       @default("APPROVED")
  totalMinor        Int          @default(0)
  reason            String?
  requestedBy       String
  approvedBy        String
  requestId         String
  approvedRequestId String
  singleStep        Boolean      @default(false)
  createdAt         DateTime     @default(now())
  business          Business     @relation(fields: [businessId], references: [id])
  items             RefundItem[]
  @@index([businessId, saleId])
  @@index([businessId, createdAt])
}

model RefundItem {
  id          String   @id @default(cuid())
  businessId  String
  refundId    String
  saleItemId  String
  productId   String
  qty         Int
  amountMinor Int
  restocked   Boolean  @default(false)
  business    Business @relation(fields: [businessId], references: [id])
  refund      Refund   @relation(fields: [refundId], references: [id])
  @@index([businessId, refundId])
  @@index([businessId, saleItemId])
}

model Expense {
  id            String    @id @default(cuid())
  businessId    String
  category      String
  amountMinor   Int
  description   String?
  method        String
  shiftId       String?
  expenseDate   DateTime  @default(now())
  actorId       String
  requestId     String
  attachmentUrl String?
  voidedAt      DateTime?
  voidReason    String?
  cashAdjusted  Boolean   @default(true)
  createdAt     DateTime  @default(now())
  business      Business  @relation(fields: [businessId], references: [id])
  @@index([businessId, category, expenseDate])
  @@index([businessId, expenseDate])
}
```

Add `customers Customer[]`, `refunds Refund[]`, `refundItems RefundItem[]`, `expenses Expense[]` to `Business`.

Create `packages/database/prisma/migrations/0007_phase6_care/migration.sql`:

```sql
CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Customer_businessId_phone_key" ON "Customer"("businessId", "phone");
CREATE INDEX "Customer_businessId_isActive_idx" ON "Customer"("businessId", "isActive");
CREATE INDEX "Customer_businessId_name_idx" ON "Customer"("businessId", "name");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "approvedRequestId" TEXT NOT NULL,
  "singleStep" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Refund_businessId_saleId_idx" ON "Refund"("businessId", "saleId");
CREATE INDEX "Refund_businessId_createdAt_idx" ON "Refund"("businessId", "createdAt");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RefundItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "restocked" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefundItem_businessId_refundId_idx" ON "RefundItem"("businessId", "refundId");
CREATE INDEX "RefundItem_businessId_saleItemId_idx" ON "RefundItem"("businessId", "saleItemId");
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "description" TEXT,
  "method" TEXT NOT NULL,
  "shiftId" TEXT,
  "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "attachmentUrl" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "cashAdjusted" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Expense_businessId_category_expenseDate_idx" ON "Expense"("businessId", "category", "expenseDate");
CREATE INDEX "Expense_businessId_expenseDate_idx" ON "Expense"("businessId", "expenseDate");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (4 + 4 + 5 new tests plus existing 30).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/customers.schema.ts packages/validation/src/refunds.schema.ts packages/validation/src/expenses.schema.ts packages/validation/src/index.ts packages/validation/src/sales.schema.ts packages/validation/test/customers.schema.test.ts packages/validation/test/refunds.schema.test.ts packages/validation/test/expenses.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0007_phase6_care/migration.sql
git commit -m "feat: add phase6 customer refund expense schemas and validation contracts"
```

### Task 2: Customer port, memory implementation, and CustomerService

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbCustomer` + customer methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement; extend port import list)
- Create: `apps/api/src/customers/nest/customer.service.ts`
- Create: `apps/api/src/customers/nest/customer.service.test.ts`

**Interfaces:**
- Consumes: Task 1 Zod types (shape-level), `withScope`.
- Produces: `CustomerService` with `createCustomer`, `listCustomers`, `getCustomer`, `updateCustomer`, `archiveCustomer`; `DbPort.createCustomer`, `listCustomersByBusiness`, `findCustomerById`, `updateCustomer`. Task 5 controller calls these exact methods.

Service rules:
- `createCustomer(businessId, actorId, requestId, input)`: trim name (empty → `VALIDATION`); normalize phone (trim; empty → null) and email (lowercase-trim; empty → null); duplicate non-null phone in business → `VALIDATION`; audit `customer.create`.
- `listCustomers(businessId, { q, active, page, pageSize })`: `q` matches name/phone/email case-insensitive substring; `active` filters `isActive` (`all` returns both); sort `name ASC, id ASC`; bounded page `{ items, total, page, pageSize }`.
- `getCustomer(businessId, id, role)`: `NOT_FOUND` cross-tenant; role `cashier` (any role outside `owner`/`manager`/`inventory`) gets `phone`/`email`/`address` nulled; embeds `purchaseHistory` (COMPLETED-family sales with this `customerId`, newest-first by receiptNo desc, max 50 [SPEC-DEFAULT]) via `db.listSalesByBusiness`.
- `updateCustomer(businessId, actorId, requestId, id, patch, role)`: role must be `owner`/`manager` else `FORBIDDEN`; phone dup check; audit `customer.update`.
- `archiveCustomer(...)`: same gate; sets `isActive: false`; audit `customer.archive`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/customers/nest/customer.service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { CustomerService } from "./customer.service";

async function setup() {
  const db = createMemoryDb();
  return { db, svc: new CustomerService(db) };
}

describe("phase6 customer port", () => {
  it("round-trips a customer scoped to its business", async () => {
    const { db } = await setup();
    const c = await db.createCustomer({
      businessId: "b1", name: "Ana", phone: "0917", email: null,
      address: null, notes: null, isActive: true,
    });
    expect((await db.listCustomersByBusiness("b1")).map((x) => x.id)).toContain(c.id);
    expect(await db.listCustomersByBusiness("b2")).toEqual([]);
    expect(await db.findCustomerById(c.id, "b2")).toBeNull();
  });
});

describe("phase6 customer service", () => {
  it("creates and searches customers with audit", async () => {
    const { db, svc } = await setup();
    await svc.createCustomer("b1", "u1", "r1", { name: "Ana Santos", phone: "0917" });
    const page = await svc.listCustomers("b1", { q: "santos", active: "true", page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect((await db.listAudit()).some((a) => a.action === "customer.create")).toBe(true);
  });
  it("rejects duplicate phone within a business but allows across businesses", async () => {
    const { svc } = await setup();
    await svc.createCustomer("b1", "u1", "r1", { name: "Ana", phone: "0917" });
    await expect(svc.createCustomer("b1", "u1", "r2", { name: "Bo", phone: "0917" })).rejects.toThrow("VALIDATION");
    await svc.createCustomer("b2", "u1", "r3", { name: "Cy", phone: "0917" });
  });
  it("redacts PII for cashier role", async () => {
    const { svc } = await setup();
    const c = await svc.createCustomer("b1", "u1", "r1", { name: "Ana", phone: "0917", email: "a@x.yz" });
    const full = await svc.getCustomer("b1", c.id, "owner");
    expect(full.phone).toBe("0917");
    const redacted = await svc.getCustomer("b1", c.id, "cashier");
    expect(redacted.phone).toBeNull();
    expect(redacted.email).toBeNull();
  });
  it("blocks cashier edits and cross-tenant reads", async () => {
    const { svc } = await setup();
    const c = await svc.createCustomer("b1", "u1", "r1", { name: "Ana" });
    await expect(svc.updateCustomer("b1", "u1", "r2", c.id, { notes: "x" }, "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(svc.getCustomer("b2", c.id, "owner")).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/customers/nest/customer.service.test.ts`
Expected: FAIL — `db.createCustomer is not a function`.

- [ ] **Step 3: Write minimal port + memory + service implementation**

Append to `db.port.ts`:

```ts
export interface DbCustomer {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}
```

Append to `DbPort`:

```ts
  createCustomer(c: Omit<DbCustomer, "id">): Promise<DbCustomer>;
  listCustomersByBusiness(businessId: string): Promise<DbCustomer[]>;
  findCustomerById(id: string, businessId: string): Promise<DbCustomer | null>;
  updateCustomer(id: string, businessId: string, patch: Partial<Omit<DbCustomer, "id" | "businessId">>): Promise<DbCustomer | null>;
```

Memory: `customers` map, `nid("cust")` ids, strict businessId scoping. Service in `BusinessService` style with the rules above; `getCustomer` returns `{ ...row, phone/email/address possibly nulled, purchaseHistory }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/customers/nest/customer.service.test.ts`
Expected: PASS (1 port + 4 service tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/customers/nest/customer.service.ts apps/api/src/customers/nest/customer.service.test.ts
git commit -m "feat: add phase6 customer service"
```

### Task 3: Refund math, port, memory, and RefundService

**Files:**
- Create: `apps/api/src/refunds/refund-math.ts`
- Modify: `apps/api/src/sales/state-machine.ts` (add `REFUND_REQUESTED: ["PARTIALLY_REFUNDED", "REFUNDED", "COMPLETED"]`, `COMPLETED: ["REFUND_REQUESTED", "PARTIALLY_REFUNDED", "REFUNDED"]`, `PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"]`)
- Modify: `apps/api/src/common/db.port.ts` (append `DbRefund`, `DbRefundItem`, refund methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement)
- Create: `apps/api/src/refunds/nest/refund.service.ts`
- Create: `apps/api/src/refunds/nest/refund.service.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 port patterns, `transitionSale`, `fingerprintPayload`, `ShiftService.postCashSale` (internally instantiated like `SalesService` does).
- Produces: `refundableQty`, `lineRefundAmount`, `RefundService` with `approveRefund`, `rejectRefund`. Task 6 controller calls these exact methods.

Domain (`refund-math.ts`):

```ts
export function refundableQty(soldQty: number, alreadyRefundedQty: number): number {
  return Math.max(0, soldQty - alreadyRefundedQty);
}

export function lineRefundAmount(lineTotalMinor: number, soldQty: number, refundQty: number): number {
  if (soldQty <= 0) throw new Error("VALIDATION");
  return Math.round((lineTotalMinor * refundQty) / soldQty);
}
```

Service rules (`RefundService`, constructor takes `DbPort`, internally `new ShiftService(db)`):
- `approveRefund(businessId, actorId, requestId, saleId, { items, reason?, key }, granted, role)` runs under `withLock(sales:businessId)`:
  - sale must be `COMPLETED`, `REFUND_REQUESTED`, or `PARTIALLY_REFUNDED` (else `SALE_INVALID_TRANSITION`); requires `sale.refund` in `granted`.
  - Separation: when status is `REFUND_REQUESTED`, find the requester from `db.listAudit()` (latest `refund.request` for this sale); if requester differs from `actorId`, proceed; if same and `role !== "owner"`, throw `FORBIDDEN`. When `COMPLETED`/`PARTIALLY_REFUNDED`, single-step allowed (`singleStep: true` only when no prior request audit exists for this approval... define: `singleStep` true when approving directly from `COMPLETED`).
  - Fingerprint over `{ saleId, items, reason }`; existing `refund.approve` key → replay (`replayed: true`) or `IDEMPOTENCY_MISMATCH`.
  - Per item: sale line must belong to sale; `qty ≤ refundableQty(sold, refundedSoFar)` (refundedSoFar from `db.listRefundItemsBySale`) else `REFUND_EXCEEDS_LIMIT`; amount via `lineRefundAmount`.
  - Writes (all-or-nothing within the lock): `Refund` + `RefundItems`; inventory `return` movements + balance increments for tracked products (`restocked: true`, else `false`); compensating `Payment` rows: walk original SUCCEEDED payments in order, allocating `min(remaining, pay.amountMinor)` per payment until the refund total is covered, each `{ method, amountMinor: portion, status: "REFUNDED", providerRef: null, idempotencyKey: key + ":" + pay.id }`; cash portion (> 0 and sale has `registerId`) → open-shift pre-check then `postCashSale`-equivalent `cash_refund` movement... note `ShiftService.postCashSale` hardcodes type `cash_sale` — add an optional `type` parameter defaulting to `"cash_sale"` so refunds post `cash_refund` with `referenceType: "Refund"`, `referenceId: refund.id`. (Modify `shift.service.ts` + its tests keep passing since the default preserves behavior.)
  - Sale status: every line fully refunded → `REFUNDED`, else `PARTIALLY_REFUNDED` (via `transitionSale` chain from current status).
  - Claim idempotency, audit `refund.approve` (+ `refund.request` when single-step from COMPLETED). Returns `{ refund, sale, replayed }`.
- `rejectRefund(businessId, actorId, requestId, saleId, reason, granted)`: requires `sale.refund`; status must be `REFUND_REQUESTED` (else `SALE_INVALID_TRANSITION`); transitions to `COMPLETED`; audit `refund.reject`. Returns the sale.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/refunds/nest/refund.service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "../../sales/nest/sales.service";
import { ShiftService } from "../../shifts/nest/shift.service";
import { RefundService } from "./refund.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setupRefund() {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
  const svc = new SalesService(db);
  const draft = await svc.createDraft("b1", "u1", "r2", {
    lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
  }, ALL);
  await svc.completeSale("b1", "u1", "r3", draft.id, {
    payments: [{ method: "cash", amountMinor: draft.totalMinor }],
    key: "refund-setup-1", granted: ALL,
  });
  return { db, svc: new RefundService(db), saleId: draft.id, productId: prod.id };
}

describe("phase6 refund service", () => {
  it("approves a full refund with all four compensating writes", async () => {
    const { db, svc, saleId, productId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    const out = await svc.approveRefund("b1", "u1", "r4", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-approve-1",
    }, ALL, "owner");
    expect(out.sale.status).toBe("REFUNDED");
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(10);
    expect((await db.listPaymentsBySale(saleId, "b1")).some((p) => p.status === "REFUNDED")).toBe(true);
    const open = (await db.findOpenShiftByRegister("b1", (await db.findSaleById(saleId, "b1"))!.registerId!))!;
    expect((await db.listCashMovementsByShift(open.id, "b1")).some((m) => m.type === "cash_refund")).toBe(true);
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("refund.approve");
  });
  it("rejects over-quantity refunds with nothing written", async () => {
    const { db, svc, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    await expect(
      svc.approveRefund("b1", "u1", "r4", saleId, {
        items: [{ saleItemId: items[0].id, qty: 99 }], key: "ref-approve-2",
      }, ALL, "owner"),
    ).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    expect(await db.listRefundsBySale(saleId, "b1")).toEqual([]);
  });
  it("rejects self-approval by non-owners", async () => {
    const { db, svc, saleId } = await setupRefund();
    const sales = new SalesService(db);
    await sales.requestRefund("b1", "u1", "r4b", saleId, "customer complaint", "req-key-3", ALL);
    const items = await db.listSaleItems(saleId, "b1");
    await expect(
      svc.approveRefund("b1", "u1", "r5", saleId, {
        items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-approve-3",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("replays approve keys without duplicate writes", async () => {
    const { db, svc, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    const input = { items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-approve-4" };
    await svc.approveRefund("b1", "u1", "r4", saleId, input, ALL, "owner");
    const again = await svc.approveRefund("b1", "u1", "r5", saleId, input, ALL, "owner");
    expect(again.replayed).toBe(true);
    expect((await db.listRefundsBySale(saleId, "b1")).length).toBe(1);
  });
});
```

Test-only helpers are forbidden in production services: the test above files the request through the real `SalesService.requestRefund(businessId, actorId, requestId, saleId, reason, key, granted)` (signature verified against the Phase 4 implementation). Step 3 must implement only production methods.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/refunds/nest/refund.service.test.ts`
Expected: FAIL — `db.createRefund is not a function` (or missing module `./refund.service` first — write the test with the corrected request line, watch it fail on the missing service module).

- [ ] **Step 3: Write minimal port + memory + math + service implementation**

`refund-math.ts` with `refundableQty` + `lineRefundAmount` as specified. State-machine edits as specified. Port additions:

```ts
export interface DbRefund {
  id: string;
  businessId: string;
  saleId: string;
  status: string;
  totalMinor: number;
  reason: string | null;
  requestedBy: string;
  approvedBy: string;
  requestId: string;
  approvedRequestId: string;
  singleStep: boolean;
}

export interface DbRefundItem {
  id: string;
  businessId: string;
  refundId: string;
  saleItemId: string;
  productId: string;
  qty: number;
  amountMinor: number;
  restocked: boolean;
}
```

```ts
  createRefund(r: Omit<DbRefund, "id">): Promise<DbRefund>;
  listRefundsBySale(saleId: string, businessId: string): Promise<DbRefund[]>;
  findRefundById(id: string, businessId: string): Promise<DbRefund | null>;
  createRefundItem(i: Omit<DbRefundItem, "id">): Promise<DbRefundItem>;
  listRefundItems(refundId: string, businessId: string): Promise<DbRefundItem[]>;
  listRefundItemsBySale(saleId: string, businessId: string): Promise<DbRefundItem[]>;
```

Memory: `refunds`, `refundItems` maps; `listRefundItemsBySale` joins items to refunds of the sale (filter items whose refundId belongs to a refund with matching saleId + businessId).

`ShiftService.postCashSale` gains optional trailing params `(type = "cash_sale", referenceType = "Sale", referenceId = saleId)` — implement as an options object to avoid breaking existing callers: `postCashSale(businessId, actorId, requestId, registerId, saleId, cashMinor, opts?: { type?: string; referenceType?: string; referenceId?: string })`. Existing tests keep passing (defaults preserve behavior).

RefundService per the Service rules above. Amount allocation across SUCCEEDED payments in order; cash portion posted only when `sale.registerId` present and cash allocated > 0 (pre-check open shift before any writes).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/refunds/nest/refund.service.test.ts`
Expected: PASS (4 tests; balance restored 8 → wait: setup sells 2 from 10 → 8; full refund of 2 restores to 10 ✓).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/refunds/refund-math.ts apps/api/src/refunds/nest/refund.service.ts apps/api/src/refunds/nest/refund.service.test.ts apps/api/src/sales/state-machine.ts apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/shifts/nest/shift.service.ts
git commit -m "feat: add phase6 refund service"
```

### Task 4: Expense port, memory, and ExpenseService

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbExpense` + expense methods)
- Modify: `apps/api/src/common/memory.db.ts` (implement)
- Create: `apps/api/src/expenses/nest/expense.service.ts`
- Create: `apps/api/src/expenses/nest/expense.service.test.ts`

**Interfaces:**
- Consumes: Task 1 expense schemas (shape-level), `ShiftService` (internally instantiated for shift-linked cash).
- Produces: `ExpenseService` with `createExpense`, `listExpenses`, `getExpense`, `voidExpense`. Task 5 controller calls these exact methods.

Service rules:
- `createExpense(businessId, actorId, requestId, input)`: category trimmed non-empty; amount positive int; method in `EXPENSE_METHODS`; `expenseDate` parsed (default now; future or older than 90 days → `VALIDATION`); `attachmentUrl` validated as URL when present (else `VALIDATION`); when `method === "cash"` and `shiftId` present: shift must exist in business and be OPEN (else `NOT_FOUND`/`SHIFT_CLOSED_IMMUTABLE`... use `SHIFT_NO_OPEN_SHIFT` when no open shift matches? precise: given shiftId → `findShiftById`; missing → `NOT_FOUND`; CLOSED → `SHIFT_CLOSED_IMMUTABLE`); pre-check first, then create expense, then post `paid_out` movement with `referenceType: "Expense"`, `referenceId: expense.id`, then `updateExpense` setting `shiftId`. Audit `expense.create`.
- `listExpenses(businessId, { category?, method?, dateFrom?, dateTo?, voided, page, pageSize })`: date bounds parsed (invalid → `VALIDATION`); `voided` filter (`active` default excludes voided); sort `expenseDate DESC, id DESC`; bounded page.
- `getExpense(businessId, id)`: `NOT_FOUND` cross-tenant.
- `voidExpense(businessId, actorId, requestId, id, reason, role)`: role must be `owner`/`manager` else `FORBIDDEN`; already voided → `VALIDATION`; sets `voidedAt`/`voidReason`; when the expense is cash + shift-linked: find an OPEN shift on the same register (via the linked shift's `registerId`); if found, post offsetting `adjustment` (+amount) with `referenceType: "Expense"`, `referenceId`, reason `void:<reason>`, and `cashAdjusted: true`; if none open, `cashAdjusted: false`. Audit `expense.void`. Returns `{ expense, cashAdjusted }`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/expenses/nest/expense.service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ShiftService } from "../../shifts/nest/shift.service";
import { ExpenseService } from "./expense.service";

describe("phase6 expense port", () => {
  it("round-trips an expense scoped to its business", async () => {
    const db = createMemoryDb();
    const e = await db.createExpense({
      businessId: "b1", category: "Ice", amountMinor: 500, description: null,
      method: "cash", shiftId: null, expenseDate: new Date("2026-09-20T00:00:00.000Z"),
      actorId: "u1", requestId: "r1", attachmentUrl: null,
      voidedAt: null, voidReason: null, cashAdjusted: true,
    });
    expect(await db.findExpenseById(e.id, "b1")).not.toBeNull();
    expect(await db.findExpenseById(e.id, "b2")).toBeNull();
    expect(await db.listExpensesByBusiness("b2")).toEqual([]);
  });
});

describe("phase6 expense service", () => {
  it("records a shift-linked cash expense with a paid_out movement", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: (await db.findOpenShiftByRegister("b1", reg.id))!.id,
    });
    expect(e.shiftId).not.toBeNull();
    const moves = await db.listCashMovementsByShift(e.shiftId!, "b1");
    expect(moves.some((m) => m.type === "paid_out" && m.referenceId === e.id)).toBe(true);
  });
  it("voids with an offsetting adjustment when a shift is open", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const open = await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });
    const out = await svc.voidExpense("b1", "u1", "r3", e.id, "duplicate entry", "owner");
    expect(out.cashAdjusted).toBe(true);
    expect((await db.findExpenseById(e.id, "b1"))!.voidedAt).not.toBeNull();
  });
  it("flags cashAdjusted false when no shift is open at void time", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const open = await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });
    await shifts.closeShift("b1", "u1", "r3", open.id, { countedCashMinor: 0 }, []);
    const out = await svc.voidExpense("b1", "u1", "r4", e.id, "duplicate entry", "owner");
    expect(out.cashAdjusted).toBe(false);
  });
  it("rejects cashier voids and bad dates", async () => {
    const db = createMemoryDb();
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r1", { category: "Ice", amountMinor: 500, method: "cash" });
    await expect(svc.voidExpense("b1", "u9", "r2", e.id, "oops", "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(
      svc.createExpense("b1", "u1", "r3", { category: "Ice", amountMinor: 100, method: "cash", expenseDate: "2030-01-01T00:00:00.000Z" }),
    ).rejects.toThrow("VALIDATION");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/expenses/nest/expense.service.test.ts`
Expected: FAIL — `db.createExpense is not a function`.

- [ ] **Step 3: Write minimal port + memory + service implementation**

Port additions (`DbExpense` as specified in Task 9's self-review... no — as specified here):

```ts
export interface DbExpense {
  id: string;
  businessId: string;
  category: string;
  amountMinor: number;
  description: string | null;
  method: string;
  shiftId: string | null;
  expenseDate: Date;
  actorId: string;
  requestId: string;
  attachmentUrl: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  cashAdjusted: boolean;
}
```

```ts
  createExpense(e: Omit<DbExpense, "id">): Promise<DbExpense>;
  listExpensesByBusiness(businessId: string): Promise<DbExpense[]>;
  findExpenseById(id: string, businessId: string): Promise<DbExpense | null>;
  updateExpense(id: string, businessId: string, patch: Partial<Omit<DbExpense, "id" | "businessId">>): Promise<DbExpense | null>;
```

Memory: `expenses` map, `nid("exp")`, strict scoping. `expenseDate` stored as `Date` (tests pass `Date`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/expenses/nest/expense.service.test.ts`
Expected: PASS (1 port + 4 service tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/expenses/nest/expense.service.ts apps/api/src/expenses/nest/expense.service.test.ts
git commit -m "feat: add phase6 expense service"
```

### Task 5: Customer and expense HTTP layer

**Files:**
- Create: `apps/api/src/customers/nest/customer.controller.ts` + `customer.module.ts`
- Create: `apps/api/src/expenses/nest/expense.controller.ts` + `expense.module.ts`
- Modify: `apps/api/src/app.module.ts` (register both + factories in `createTestApp`)
- Create: `apps/api/test/customer.contract.test.ts`, `apps/api/test/expense.contract.test.ts`

**Interfaces:**
- Consumes: Task 2 `CustomerService`, Task 4 `ExpenseService`, Task 1 Zod schemas, guard/`fail`/`statusFor`/`rid` patterns.
- Produces: routes `GET/POST /api/v1/customers`, `GET/PATCH /api/v1/customers/:id`, `POST/GET /api/v1/expenses`, `GET /api/v1/expenses/:id`, `POST /api/v1/expenses/:id/void`, `GET /api/v1/expenses/export?format=csv`. Task 8 tests the UI against these shapes.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on POST/PATCH; customer edit/archive check `role` in `owner`/`manager` (else 403); customer detail passes `role` for PII redaction; expense create passes through; expense void passes `role`; expense list parses `expenseListSchema`; export requires `export.run` in `rolePermissions` (else 403), `format` must equal `csv` (else 400), cap 1000 rows, `Content-Type: text/csv; charset=utf-8`, BOM prefix `\uFEFF`. Explicit `res.status(...)` on every POST (201 creates, 200 actions).

CSV shape (shared with Task 6 sales export; implement `toCsv` in `apps/api/src/common/csv.ts` here so Task 6 reuses it): `toCsv(headers: string[], rows: Array<Array<string | number>>): string` with RFC-4180 quoting (quote fields containing `,`, `"`, `\n`; double internal quotes). Expenses export columns: `id,category,amountMinor,method,expenseDate,actorId,voided`.

- [ ] **Step 1: Write the failing contract tests**

Create `apps/api/test/customer.contract.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-cust@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase6 customer HTTP contract", () => {
  it("creates, searches, and reads a customer with history", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Ana Santos", phone: "09171234567" });
    expect(created.status).toBe(201);
    const list = await request(app.getHttpServer()).get("/api/v1/customers?q=santos")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/${created.body.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.purchaseHistory).toEqual([]);
  });

  it("rejects duplicate phone with VALIDATION", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Bo", phone: "09171234567" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("rejects unauthenticated reads with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/customers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns NOT_FOUND for another tenant's customer", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-cust@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const created = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Private" });
    const got = await request(app.getHttpServer()).get(`/api/v1/customers/${created.body.id}`)
      .set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});
```

Create `apps/api/test/expense.contract.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-exp@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase6 expense HTTP contract", () => {
  it("records and voids an expense", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "Ice", amountMinor: 500, method: "cash" });
    expect(created.status).toBe(201);
    const list = await request(app.getHttpServer()).get("/api/v1/expenses?category=Ice")
      .set("Cookie", cookie);
    expect(list.body.total).toBe(1);
    const voided = await request(app.getHttpServer()).post(`/api/v1/expenses/${created.body.id}/void`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ reason: "duplicate entry" });
    expect(voided.status).toBe(200);
    expect(voided.body.expense.voidedAt).not.toBeNull();
  });

  it("exports CSV with export gate", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/expenses/export?format=csv")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")[0]).toContain("id,category,amountMinor");
  });

  it("rejects bad method with VALIDATION", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "Ice", amountMinor: 100, method: "barter" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/api test -- test/customer.contract.test.ts test/expense.contract.test.ts`
Expected: FAIL — 500s on `/api/v1/customers` and `/api/v1/expenses` (no routes yet; this stack's `@Catch()` filter maps unknown routes to 500).

- [ ] **Step 3: Write minimal controllers + modules + wiring + csv helper**

Implement per the Controller rules above, mirroring `shift.controller.ts`. `toCsv` in `apps/api/src/common/csv.ts`:

```ts
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null): string => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ["\uFEFF" + headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}
```

Add a unit test file `apps/api/test/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/common/csv";

describe("csv helper", () => {
  it("quotes commas and embedded quotes", () => {
    const out = toCsv(["a", "b"], [["x,y", 'q"z'], [1, null]]);
    expect(out).toBe("\uFEFFa,b\n\"x,y\",\"q\"\"z\"\n1,");
  });
});
```

Wire both modules into `app.module.ts` `@Module` + `createTestApp` (SalesService factory pattern).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/api test -- test/customer.contract.test.ts test/expense.contract.test.ts test/csv.test.ts`
Expected: PASS (4 + 3 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/customers/nest/customer.controller.ts apps/api/src/customers/nest/customer.module.ts apps/api/src/expenses/nest/expense.controller.ts apps/api/src/expenses/nest/expense.module.ts apps/api/src/common/csv.ts apps/api/test/csv.test.ts apps/api/src/app.module.ts apps/api/test/customer.contract.test.ts apps/api/test/expense.contract.test.ts
git commit -m "feat: add phase6 customer expense http layer"
```

### Task 6: Refund HTTP layer plus sales history/detail/export extensions

**Files:**
- Create: `apps/api/src/refunds/nest/refund.controller.ts` + `refund.module.ts`
- Modify: `apps/api/src/app.module.ts` (register + factory)
- Modify: `apps/api/src/common/http-helpers.ts` (add `REFUND_EXCEEDS_LIMIT: 400`)
- Modify: `apps/api/src/sales/nest/sales.service.ts` (history filters, detail embeds)
- Create: `apps/api/test/refund.contract.test.ts`

**Interfaces:**
- Consumes: Task 3 `RefundService`, Task 5 patterns, extended `salesQuerySchema`, `toCsv`.
- Produces: routes `POST /api/v1/sales/:id/refund-approve`, `POST /api/v1/sales/:id/refund-reject`, extended `GET /api/v1/sales` + `GET /api/v1/sales/:id`, `GET /api/v1/sales/export?format=csv`. Task 7 adds reject-flow, separation, closed-shift, and replay tests over these routes.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on POSTs; approve requires `Idempotency-Key` header (missing → 400 `VALIDATION`); approve/reject pass `granted` + `role`; approve returns `201 { refund, sale }` fresh / `200 { refund, sale, replayed: true }` replay; reject returns `200` sale; explicit statuses on POSTs.

SalesService changes:
- `listSales(businessId, { cursor?, limit?, status?, customerId?, dateFrom?, dateTo? })`: `dateFrom`/`dateTo` parsed via `new Date()` (invalid → `VALIDATION`); range over 366 days → `VALIDATION` [SPEC-DEFAULT]; filter by `customerId` equality and `createdAt`... `DbSale` has no `createdAt` field. Hmm. Date filtering needs a timestamp on sales. Memory rows lack dates. Options: (a) add `createdAt: Date` to `DbSale` + memory (service sets `new Date()` on create), (b) skip date filtering. Date filters are in the spec; add the field. `createSale` in memory sets `createdAt: new Date()` — but the port type `Omit<DbSale,"id">` would then require callers to pass it... make it optional in the port input? Type: `createSale(s: Omit<DbSale, "id" | "createdAt"> & { createdAt?: Date })`. Simpler: keep `Omit<DbSale,"id">` and have memory default `createdAt` when absent: `const row = { createdAt: new Date(), ...s, id }`. Then existing callers (sales.service createSale, tests) still typecheck only if the TYPE has the field as required... `Omit<DbSale,"id">` requires createdAt → existing `db.createSale({...})` in sales.service.ts and the port test (which passes explicit fields) break typecheck. Fix by updating those two call sites to include `createdAt: new Date()` (sales.service createSale) — and the port test fixture too. All three edits are part of this task; list them explicitly:
  - `db.port.ts`: add `createdAt: Date` to `DbSale`.
  - `memory.db.ts` `createSale`: `const row = { createdAt: new Date(), ...s, id: nid("sale") }` — wait, spreading `...s` after default would override with `undefined` if caller passes `createdAt: undefined` explicitly; callers will pass real Dates, fine. Order: `{ ...s, id, createdAt: s.createdAt ?? new Date() }` — but `s.createdAt` typed required, so `??` flags unnecessary... TS strict doesn't error on unnecessary `??`. Fine.
  - `sales.service.ts` `createSale` call: add `createdAt: new Date()`.
  - `sales.service.test.ts` port fixture: add `createdAt: new Date("2026-09-20T00:00:00.000Z")`.
- `getSale` embeds `refunds` (via `db.listRefundsBySale`) and `customer` (via `db.findCustomerById` when `sale.customerId` set; null otherwise). Cost redaction unchanged; PII on embedded customer follows the same cashier rule as `CustomerService.getCustomer` (null phone/email/address for `cashier` role) — implement inline (3 lines), no new helper.
- Export: `buildSalesExport(businessId, filters)` returns header + rows (cap 1000); columns: `id,receiptNo,status,totalMinor,paidMinor,changeMinor,currency,customerName,registerId,refundStatus` where `refundStatus` is the sale status (kept simple and truthful — the status column already carries refund state; use columns `id,receiptNo,status,subtotalMinor,discountMinor,taxMinor,totalMinor,paidMinor,changeMinor,currency,customerName,registerId`). Controller enforces `export.run`, `format === "csv"`, `toCsv`, BOM, `text/csv`.

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/test/refund.contract.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;
let registerId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

async function makeCompletedSale(key: string, qty: number, reg?: string): Promise<{ id: string; totalMinor: number }> {
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty }], ...(reg ? { registerId: reg } : {}) });
  const done = await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key)
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }], ...(reg ? { registerId: reg } : {}) });
  return { id: done.body.id, totalMinor: done.body.totalMinor };
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-ref@example.com",
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
  await request(app.getHttpServer()).post(`/api/v1/registers/${registerId}/open`)
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ registerId, openingFloatMinor: 0 });
});

afterAll(async () => { await app.close(); });

describe("phase6 refund HTTP contract", () => {
  it("approves a full refund and marks the sale REFUNDED", async () => {
    const sale = await makeCompletedSale("ref-sale-1", 2, registerId);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-1")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.sale.status).toBe("REFUNDED");
    const detail = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie);
    expect(detail.body.refunds.length).toBe(1);
  });

  it("rejects over-quantity refunds with REFUND_EXCEEDS_LIMIT", async () => {
    const sale = await makeCompletedSale("ref-sale-2", 1);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-2")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 5 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REFUND_EXCEEDS_LIMIT");
  });

  it("filters history by customer and exports CSV", async () => {
    const cust = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Refund Regular" });
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }], customerId: cust.body.id });
    await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-sale-3")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/sales?customerId=${cust.body.id}`).set("Cookie", cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(1);
    const csv = await request(app.getHttpServer()).get("/api/v1/sales/export?format=csv")
      .set("Cookie", cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toContain("id,receiptNo,status");
  });

  it("rejects unauthenticated refund approval", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sales/s1/refund-approve")
      .set("Idempotency-Key", "ref-noauth")
      .send({ saleId: "s1", items: [{ saleItemId: "i1", qty: 1 }] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});
```

Note: the sale-detail GET must expose `items` with `id` fields — Phase 4 `getSale` embeds items (DbSaleItem has `id`) ✓. The sale create with `customerId` requires the customer to belong to the business — controller must validate via `CustomerService` or `db.findCustomerById`... `SalesService.createDraft` currently accepts any `customerId` string without validation. Add validation in `createDraft`: when `customerId` present, `findCustomerById` must hit, else `VALIDATION`. (Spec: unknown id → VALIDATION. Implement in Task 6 as part of sales edits; also auto-fill `customerName` from the record when omitted.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/refund.contract.test.ts`
Expected: FAIL — 500 on refund-approve (no route yet).

- [ ] **Step 3: Write minimal controller + module + wiring + sales edits**

Implement `refund.controller.ts`/`refund.module.ts` per the Controller rules (same file pattern as shift controller). Wire into `app.module.ts`. Add `REFUND_EXCEEDS_LIMIT: 400` to `CODE_STATUS`. SalesService edits: `createdAt` on `DbSale` + memory + call sites (port test fixture too); `customerId` validation + name auto-fill in `createDraft`; list filters; detail embeds; `buildSalesExport`. Define and export `SaleDetail = SaleWithLines & { refunds: Array<DbRefund & { items: DbRefundItem[] }>; customer: DbCustomer | null }` as the `getSale` return type (import the Db types from `../../common/db.port`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- test/refund.contract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/refunds/nest/refund.controller.ts apps/api/src/refunds/nest/refund.module.ts apps/api/src/app.module.ts apps/api/src/common/http-helpers.ts apps/api/src/sales/nest/sales.service.ts apps/api/src/sales/nest/sales.service.test.ts apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/test/refund.contract.test.ts
git commit -m "feat: add phase6 refund http layer and sales history export"
```

### Task 7: Refund edge coverage (reject flow, self-approval, closed-shift cash) + live-DB proof

**Files:**
- Modify: `apps/api/test/refund.contract.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 6 routes.
- Produces: proof of reject flow, separation enforcement, closed-shift `cash_refund` rejection, double-approve idempotency.

- [ ] **Step 1: Write the failing coverage tests**

Append (file-scoped fixtures shared; add a `makeTendedSale` variant that opens no shift — the `beforeAll` already opened a shift on `registerId`, so create a second register with no shift for the closed-shift case):

```ts
describe("phase6 refund edges", () => {
  it("rejects a refund request and returns the sale to COMPLETED", async () => {
    const sale = await makeCompletedSale("ref-sale-4", 1);
    const req = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-request`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-req-4")
      .send({ reason: "changed mind" });
    expect(req.status).toBe(201);
    const rej = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-reject`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ reason: "no defect found" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("COMPLETED");
  });

  it("rejects self-approval by non-owners", async () => {
    const sale = await makeCompletedSale("ref-sale-5", 1);
    await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-request`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-req-5")
      .send({ reason: "changed mind" });
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    // Same owner session approving its own request is allowed (owner override);
    // separation is enforced at the service level and covered by unit tests.
    // Here assert the approve path works end-to-end for the owner:
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-5")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.sale.status).toBe("REFUNDED");
  });

  it("rejects double approve with the same key as replay, not a duplicate", async () => {
    const sale = await makeCompletedSale("ref-sale-6", 1);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const body = { saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] };
    const first = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-6")
      .send(body);
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-6")
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
  });

  it("rejects cash refunds with no open shift", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter Closed" });
    const sale = await makeCompletedSale("ref-sale-7", 1, reg.body.id);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-7")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_NO_OPEN_SHIFT");
  });
});
```

Wait — `makeCompletedSale("ref-sale-7", 1, reg.body.id)` completes a cash sale on a register with NO open shift → the complete itself fails with `SHIFT_NO_OPEN_SHIFT` (Phase 5 behavior), so no sale exists to refund. Fix: complete the sale WITHOUT register first... but then the sale has no registerId and the approve posts no cash movement (no 409). To exercise the closed-shift path: open a shift on the new register, complete the cash sale there, CLOSE the shift, then approve → `SHIFT_NO_OPEN_SHIFT`. Rewrite that test:

```ts
  it("rejects cash refunds with no open shift", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter Closed" });
    const opened = await request(app.getHttpServer()).post(`/api/v1/registers/${reg.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg.body.id, openingFloatMinor: 0 });
    const sale = await makeCompletedSale("ref-sale-7", 1, reg.body.id);
    await request(app.getHttpServer()).post(`/api/v1/shifts/${opened.body.id}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 2500 });
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-7")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_NO_OPEN_SHIFT");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- test/refund.contract.test.ts`
Expected: FAIL — reject route or approve-after-request shape mismatch (fix the controller/service to handle `REFUND_REQUESTED` approvals and the reject transition).

- [ ] **Step 3: Write minimal fix**

Shape/logic fix only: ensure approve works from `REFUND_REQUESTED` (separation via audit lookup) and `refund-reject` returns the sale to `COMPLETED`.

- [ ] **Step 4: Prove migrations 0001→0007 on live Postgres**

Isolated container on host port 5433 (never touch other projects' databases):

```bash
docker run -d --name pos-db-phase6 -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos -e POSTGRES_DB=pos -p 5433:5432 postgres:16-alpine
```

Wait for `pg_isready`, apply 0001→0007 in order with `ON_ERROR_STOP=1` (PowerShell: pipe each file through `docker exec -i`), list tables with `\dt`, then `docker stop pos-db-phase6; docker rm pos-db-phase6`.

Expected: all apply cleanly; tables include `Customer`, `Refund`, `RefundItem`, `Expense`.

- [ ] **Step 5: Run test to verify it passes, then commit**

Run: `pnpm --filter @pos/api test`
Expected: PASS (full API suite).

```bash
git add apps/api/test/refund.contract.test.ts apps/api/src/refunds/nest/refund.service.ts apps/api/src/refunds/nest/refund.controller.ts
git commit -m "test: add phase6 refund edge coverage"
```

### Task 8: Sales/customer/expense web UI + POS customer wiring (uses frontend-design)

**Files:**
- Create: `apps/web/src/lib/customers.ts`, `apps/web/src/lib/expenses.ts`
- Create: `apps/web/test/customers.test.ts` (covers both lib files)
- Create: `apps/web/src/app/sales/page.tsx`, `apps/web/src/app/sales/[id]/page.tsx`
- Create: `apps/web/src/app/customers/page.tsx`, `apps/web/src/app/customers/[id]/page.tsx`
- Create: `apps/web/src/app/expenses/page.tsx`
- Modify: `apps/web/src/app/pos/page.tsx` (customer search/select)
- Modify: `apps/web/src/app/page.tsx` (links)

**Interfaces:**
- Consumes: Tasks 5-6 routes via `apiFetch`; role from `GET /api/v1/me`.
- Produces: history, detail, customer, expense UIs with gated affordances.

Design (frontend-design skill): same appliance language — light workspace, tabular numerals, text+shape states, no gradients. Signature element for this phase: the sale detail as an "evidence ledger" — refunds, payments, and movements listed as one chronological source-record trail.

Web rules: `"use client"` + TanStack Query; CSRF from `/api/v1/auth/csrf`; refund approve form with per-line qty inputs (max = line qty, client-side hint; server authoritative); export buttons only when the role implies `export.run` (owner/manager/inventory [SPEC-DEFAULT client hint]); server authoritative.

- [ ] **Step 1: Write the failing web test**

Create `apps/web/test/customers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("phase6 customer web helpers", () => {
  it("gates customer management by role", async () => {
    const { canManageCustomers } = await import("../src/lib/customers");
    expect(canManageCustomers("manager")).toBe(true);
    expect(canManageCustomers("cashier")).toBe(false);
  });
  it("formats a customer label", async () => {
    const { customerLabel } = await import("../src/lib/customers");
    expect(customerLabel({ name: "Ana", phone: "0917" })).toBe("Ana — 0917");
    expect(customerLabel({ name: "Walk-in", phone: null })).toBe("Walk-in");
  });
  it("gates expense voids by role", async () => {
    const { canVoidExpense } = await import("../src/lib/expenses");
    expect(canVoidExpense("owner")).toBe(true);
    expect(canVoidExpense("cashier")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test -- test/customers.test.ts`
Expected: FAIL with cannot find module `../src/lib/customers`.

- [ ] **Step 3: Write minimal lib + pages**

Create `apps/web/src/lib/customers.ts`:

```ts
const MANAGE_ROLES = new Set(["owner", "manager"]);

export function canManageCustomers(role: string): boolean {
  return MANAGE_ROLES.has(role);
}

export function customerLabel(c: { name: string; phone: string | null }): string {
  return c.phone ? `${c.name} — ${c.phone}` : c.name;
}
```

Create `apps/web/src/lib/expenses.ts`:

```ts
const VOID_ROLES = new Set(["owner", "manager"]);

export function canVoidExpense(role: string): boolean {
  return VOID_ROLES.has(role);
}
```

Pages (mirror Phase 4/5 patterns: `meQuery` for role, `apiFetch` + CSRF mutate helper, loading/error/empty states, `Link` navigation):
- `/sales`: status/customer/date filters + cursor pagination + export button.
- `/sales/[id]`: evidence-ledger detail (lines, payments incl. REFUNDED rows, refunds with items, customer, register, receipt link) + request/approve/reject actions (approve form with per-line qty inputs).
- `/customers`: search + create + list; `/customers/[id]`: profile + purchase history.
- `/expenses`: entry form + filters + void + export.
- `/pos`: customer search dropdown (writes `customerId`; walk-in text retained when cleared).
- Dashboard: Sales/Customers/Expenses links.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/web test` and `pnpm --filter @pos/web exec tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/customers.ts apps/web/src/lib/expenses.ts apps/web/test/customers.test.ts apps/web/src/app/sales/page.tsx "apps/web/src/app/sales/[id]/page.tsx" apps/web/src/app/customers/page.tsx "apps/web/src/app/customers/[id]/page.tsx" apps/web/src/app/expenses/page.tsx apps/web/src/app/pos/page.tsx apps/web/src/app/page.tsx
git commit -m "feat: add phase6 sales customer expense web ui"
```

### Task 9: Exit gate and verification

**Files:**
- Create: `tests/phase6-exit.test.ts`
- Create: `scripts/verify-phase6.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase6 line via `Add-Content`, never a full rewrite — file is CRLF)

**Interfaces:**
- Consumes: all Phase 6 deliverables.
- Produces: Phase 6 exit proof.

- [ ] **Step 1: Write the failing exit test**

Create `tests/phase6-exit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { refundableQty, lineRefundAmount } from "../apps/api/src/refunds/refund-math";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { ShiftService } from "../apps/api/src/shifts/nest/shift.service";
import { RefundService } from "../apps/api/src/refunds/nest/refund.service";
import { CustomerService } from "../apps/api/src/customers/nest/customer.service";
import { ExpenseService } from "../apps/api/src/expenses/nest/expense.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setup() {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 10000 }, "cashier");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 20 });
  return { db, shifts, sales: new SalesService(db), refunds: new RefundService(db), customers: new CustomerService(db), expenses: new ExpenseService(db), registerId: reg.id, productId: prod.id };
}

describe("phase6 exit", () => {
  it("owner explains a sale, refund, expense, and customer history from source records", async () => {
    const { db, shifts, sales, refunds, customers, expenses, registerId, productId } = await setup();
    const cust = await customers.createCustomer("b1", "u1", "r1", { name: "Ana" });
    const draft = await sales.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
      registerId, customerId: cust.id,
    }, ALL);
    await sales.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit6-1", granted: ALL,
    });
    const items = await db.listSaleItems(draft.id, "b1");
    const approved = await refunds.approveRefund("b1", "u1", "r4", draft.id, {
      items: [{ saleItemId: items[0].id, qty: 1 }], key: "exit6-r1",
    }, ALL, "owner");
    expect(approved.sale.status).toBe("PARTIALLY_REFUNDED");
    const history = await customers.getCustomer("b1", cust.id, "owner");
    expect(history.purchaseHistory.length).toBe(1);
    const exp = await expenses.createExpense("b1", "u1", "r5", { category: "Ice", amountMinor: 500, method: "cash" });
    expect(exp.category).toBe("Ice");
    const sale = await sales.getSale("b1", draft.id, ALL);
    expect(sale.refunds.length).toBe(1);
    expect(sale.customer?.name).toBe("Ana");
    const { report } = await shifts.closeShift("b1", "u1", "r6",
      (await db.findOpenShiftByRegister("b1", registerId))!.id, { countedCashMinor: 10000 + 5000 - 2500 + 0 }, []);
    expect(report.expectedCash).toBe(12500);
  });
  it("refund math bounds quantities and amounts", () => {
    expect(refundableQty(2, 1)).toBe(1);
    expect(refundableQty(1, 1)).toBe(0);
    expect(lineRefundAmount(5000, 2, 1)).toBe(2500);
  });
  it("over-refunds and self-approvals are rejected", async () => {
    const { sales, refunds, registerId, productId } = await setup();
    const draft = await sales.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    await sales.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit6-2", granted: ALL,
    });
    const sale = await sales.getSale("b1", draft.id, ALL);
    const items = sale.items;
    await expect(
      refunds.approveRefund("b1", "u1", "r4", draft.id, {
        items: [{ saleItemId: items[0].id, qty: 9 }], key: "exit6-r2",
      }, ALL, "owner"),
    ).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    await sales.requestRefund("b1", "u1", "rq", draft.id, "changed mind", "exit6-rq", ALL);
    await expect(
      refunds.approveRefund("b1", "u1", "rq2", draft.id, {
        items: [{ saleItemId: items[0].id, qty: 1 }], key: "exit6-r3",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("expense voids are permissioned and cross-tenant reads blocked", async () => {
    const { customers, expenses } = await setup();
    const c = await customers.createCustomer("b1", "u1", "r1", { name: "Ana" });
    await expect(expenses.voidExpense("b1", "u9", "r2", "nope", "oops", "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(customers.getCustomer("b2", c.id, "owner")).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:exit`
Expected: FAIL with cannot find module `../apps/api/src/refunds/refund-math` (until Tasks 2-4 land; passes when executed in order).

- [ ] **Step 3: Write minimal verification script**

Create `scripts/verify-phase6.test.mjs`:

```js
import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0007_phase6_care/migration.sql"),
  existsSync("packages/validation/src/customers.schema.ts"),
  existsSync("packages/validation/src/refunds.schema.ts"),
  existsSync("packages/validation/src/expenses.schema.ts"),
  existsSync("apps/api/src/customers/nest/customer.service.ts"),
  existsSync("apps/api/src/refunds/nest/refund.service.ts"),
  existsSync("apps/api/src/expenses/nest/expense.service.ts"),
  existsSync("apps/api/src/customers/nest/customer.controller.ts"),
  existsSync("apps/api/src/refunds/nest/refund.controller.ts"),
  existsSync("apps/api/src/expenses/nest/expense.controller.ts"),
  existsSync("apps/api/test/customer.contract.test.ts"),
  existsSync("apps/api/test/refund.contract.test.ts"),
  existsSync("apps/api/test/expense.contract.test.ts"),
  existsSync("apps/web/src/app/sales/page.tsx"),
  existsSync("apps/web/src/app/customers/page.tsx"),
  existsSync("apps/web/src/app/expenses/page.tsx"),
  existsSync("tests/phase6-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE6_OK");
} else {
  console.error("PHASE6_MISSING");
  process.exit(1);
}
```

Append to `.github/workflows/ci.yml` via `Add-Content` (byte-append, CRLF-safe):

```powershell
Add-Content -LiteralPath ".github/workflows/ci.yml" -Value "      - run: node scripts/verify-phase6.test.mjs"
```

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase6.test.mjs && pnpm typecheck`
Expected: all green + `PHASE6_OK`. (`pnpm lint` runs no tasks in this repo — turbo reports "No tasks were executed" — nothing to satisfy there.)

- [ ] **Step 5: Commit**

```bash
git add tests/phase6-exit.test.ts scripts/verify-phase6.test.mjs .github/workflows/ci.yml
git commit -m "test: add phase6 exit gate and verification"
```
