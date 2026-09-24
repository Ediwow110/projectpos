# Phase 11 Requirement Closures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 11 per `docs/superpowers/specs/2026-09-25-phase11-closures-design.md`: close every non-UI requirement gap from the 2026-09-25 PLAN.md audit — payment methods as configuration, audit shape, `settings.write`, membership management, refund threshold, post-close corrections, session active business, email verification, support grants, receipt download/share — plus metrics, CI hygiene, and the missing threat tests. All prior suites stay green.

**Architecture:** Additive only, in the existing modular monolith. One migration (0012) adds four small tables (`EmailVerificationToken`, `PlatformSupportGrant`, `ShiftCorrection`, `ReceiptShare`) and one nullable `Session.activeBusinessId` column. New routes: memberships, platform grants, receipt download/share, metrics. `AuditEntry` gains optional `at/reason/before/after`. **No `apps/web` changes — the UI is owned by another workstream.**

**Tech Stack:** TypeScript strict, NestJS 11 REST (`/api/v1`), Zod 3.23.8, Vitest 3.2.7, supertest. One new dependency: none (all work uses existing deps; metrics emit plain text).

**Spec:** `docs/superpowers/specs/2026-09-25-phase11-closures-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units, no float arithmetic.
- Tenant derived server-side from authenticated membership; `withScope` on every new service method.
- All changes additive (nullable/optional or new tables) — prior behavior unchanged, proved by all prior suites staying green.
- `/api/v1` routes, error envelope `{ code, message, correlationId, fields? }`, explicit `res.status(...)` on every POST; `SessionGuard` + CSRF on mutations except where the spec says otherwise (share-token read, metrics).
- Audit entries append-only; new audit fields optional so existing call sites stay valid.
- No `apps/web` edits of any kind (frontend owned by another AI).
- Every task follows TDD red-green-refactor; commit after each task.

---

## File Structure

- `packages/database/prisma/migrations/0012_phase11_closures/migration.sql` — 4 tables + Session column (Task 1).
- `packages/database/prisma/schema.prisma` — 4 new models + `activeBusinessId` on Session + `emailVerified` on User (Task 1).
- `packages/validation/src/settings.schema.ts` — `paymentMethodSchema`, `refundThresholdSchema`, `emailVerificationFlagSchema` (Task 1).
- `apps/api/src/common/db.port.ts` + `memory.db.ts` — port additions (Task 2).
- `apps/api/src/business/nest/business.service.ts` — `settings.write` gate + snapshots (Task 3).
- `apps/api/src/sales/nest/sales.service.ts`, `sales.controller.ts`, `expenses/nest/expense.service.ts` — configured payment methods (Task 4).
- `apps/api/src/memberships/nest/membership.service.ts` + `membership.controller.ts` (Task 5).
- `apps/api/src/refunds/nest/refund.service.ts`, `packages/auth/src/permissions.ts`, `apps/api/src/tenant/seed.ts` — refund threshold (Task 6).
- `apps/api/src/shifts/nest/shift.service.ts` + controller — corrections (Task 7).
- `apps/api/src/auth/nest/auth.service.ts` + `common/session.guard.ts` — active business + email verification (Tasks 8, 9).
- `apps/api/src/billing/nest/platform.controller.ts` — support grants (Task 10).
- `apps/api/src/sales/nest/sales.service.ts` + controller — receipt download/share (Task 11).
- `apps/api/src/common/metrics.ts` + `metrics.controller.ts` + middleware (Task 12).
- `.github/workflows/ci.yml`, `apps/api/test/hardening.contract.test.ts` (Task 13).
- `tests/phase11-exit.test.ts`, `scripts/verify-phase11.test.mjs` (Task 14).

### Task 1: Migration 0012, Prisma models, validation schemas

**Files:**
- Create: `packages/database/prisma/migrations/0012_phase11_closures/migration.sql`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/validation/src/phase11.schema.ts`
- Modify: `packages/validation/src/index.ts`
- Create: `packages/validation/test/phase11.schema.test.ts`

**Interfaces:** Produces `paymentMethodConfigSchema` (array items `{ key: string min1 max32, label: string min1 max40 }`, min 1 max 20), `refundThresholdSchema` (`thresholdMinor: number.int().min(0)`), `emailVerificationSchema` (`requireEmailVerification: boolean`), `correctionSchema` (`amountMinor: int nonzero`, `reason: string min 3 max 200`), `supportGrantSchema` (`purpose: string min 3 max 200`, `ttlMinutes: int min 1 max 60`, `actorId: string min 1 max 80`). Tasks 4-10 consume these names.

- [ ] **Step 1: Write the failing schema test**

Create `packages/validation/test/phase11.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  correctionSchema,
  emailVerificationSchema,
  paymentMethodConfigSchema,
  refundThresholdSchema,
  supportGrantSchema,
} from "../src/phase11.schema";

describe("phase11 schemas", () => {
  it("accepts a configured payment method list", () => {
    const out = paymentMethodConfigSchema.parse([
      { key: "cash", label: "Cash" },
      { key: "gcash", label: "GCash" },
    ]);
    expect(out).toHaveLength(2);
  });
  it("rejects empty method keys and oversized lists", () => {
    expect(() => paymentMethodConfigSchema.parse([{ key: "", label: "x" }])).toThrow();
    expect(() => paymentMethodConfigSchema.parse([])).toThrow();
  });
  it("validates refund threshold and email flag", () => {
    expect(refundThresholdSchema.parse({ thresholdMinor: 5000 }).thresholdMinor).toBe(5000);
    expect(() => refundThresholdSchema.parse({ thresholdMinor: -1 })).toThrow();
    expect(emailVerificationSchema.parse({ requireEmailVerification: true }).requireEmailVerification).toBe(true);
  });
  it("requires a reason and nonzero correction, bounds grant ttl", () => {
    expect(() => correctionSchema.parse({ amountMinor: 0, reason: "why" })).toThrow();
    expect(() => correctionSchema.parse({ amountMinor: 100, reason: "no" })).toThrow();
    expect(correctionSchema.parse({ amountMinor: -500, reason: "counted wrong" }).amountMinor).toBe(-500);
    expect(supportGrantSchema.parse({ purpose: "invoice support", ttlMinutes: 30, actorId: "ops" }).ttlMinutes).toBe(30);
    expect(() => supportGrantSchema.parse({ purpose: "x", ttlMinutes: 61, actorId: "ops" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/phase11.schema.test.ts`
Expected: FAIL — cannot find module `../src/phase11.schema`.

- [ ] **Step 3: Write schema + Prisma models + migration**

Create `packages/validation/src/phase11.schema.ts`:

```ts
import { z } from "zod";

export const paymentMethodConfigSchema = z
  .object({
    key: z.string().trim().min(1, "VALIDATION").max(32, "VALIDATION").regex(/^[a-z0-9_]+$/, "VALIDATION"),
    label: z.string().trim().min(1, "VALIDATION").max(40, "VALIDATION"),
  })
  .array()
  .min(1, "VALIDATION")
  .max(20, "VALIDATION");

export const refundThresholdSchema = z.object({
  thresholdMinor: z.number().int("MONEY_NOT_INTEGER").min(0, "VALIDATION"),
});

export const emailVerificationSchema = z.object({
  requireEmailVerification: z.boolean(),
});

export const correctionSchema = z.object({
  amountMinor: z.number().int("MONEY_NOT_INTEGER").refine((v) => v !== 0, "VALIDATION"),
  reason: z.string().trim().min(3, "VALIDATION").max(200, "VALIDATION"),
});

export const supportGrantSchema = z.object({
  purpose: z.string().trim().min(3, "VALIDATION").max(200, "VALIDATION"),
  ttlMinutes: z.number().int("VALIDATION").min(1, "VALIDATION").max(60, "VALIDATION"),
  actorId: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
});
```

Append `export * from "./phase11.schema";` to `packages/validation/src/index.ts`.

Append to `packages/database/prisma/schema.prisma` (verify exact model/relation style against the `ApiToken`/`DisplayToken` blocks first):

```prisma
model EmailVerificationToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id])
}

model PlatformSupportGrant {
  id        String    @id @default(cuid())
  purpose   String
  actorId   String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
}

model ShiftCorrection {
  id          String   @id @default(cuid())
  businessId  String
  shiftId     String
  amountMinor Int
  reason      String
  actorId     String
  requestId   String
  createdAt   DateTime @default(now())
  business    Business @relation(fields: [businessId], references: [id])
  shift       Shift    @relation(fields: [shiftId], references: [id])

  @@index([businessId, shiftId])
}

model ReceiptShare {
  id         String   @id @default(cuid())
  businessId String
  saleId     String
  tokenHash  String   @unique
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  business   Business @relation(fields: [businessId], references: [id])

  @@index([businessId, saleId])
}
```

Add to `User`: `emailVerified Boolean @default(true)` and `verificationTokens EmailVerificationToken[]`; to `Session`: `activeBusinessId String?` (+ relation to Business, `ON DELETE SET NULL`); to `Shift`: `corrections ShiftCorrection[]`; to `Business`: `corrections ShiftCorrection[]`, `receiptShares ReceiptShare[]`.

Create `packages/database/prisma/migrations/0012_phase11_closures/migration.sql` in the exact style of 0011 (`TEXT` ids, `TIMESTAMP(3)`, PK, FKs to `"User"("id")` cascade / `"Business"("id")` cascade / `"Shift"("id")` cascade, `"Session"("activeBusinessId")` FK to `"Business"("id")` `ON DELETE SET NULL`), then:

```sql
ALTER TABLE "Session" ADD COLUMN "activeBusinessId" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "ShiftCorrection_businessId_shiftId_idx" ON "ShiftCorrection"("businessId", "shiftId");
CREATE INDEX "ReceiptShare_businessId_saleId_idx" ON "ReceiptShare"("businessId", "saleId");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test` — Expected: PASS (new file plus existing suites).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/phase11.schema.ts packages/validation/src/index.ts packages/validation/test/phase11.schema.test.ts packages/database/prisma
git commit -m "feat: add phase11 schemas and migration 0012"
```

### Task 2: DbPort additions, memory impl, AuditEntry enrichment

**Files:**
- Modify: `apps/api/src/common/db.port.ts`
- Modify: `apps/api/src/common/memory.db.ts`
- Modify: `apps/api/src/business/nest/business.service.ts` (snapshot audit)
- Modify: `apps/api/src/billing/nest/billing.service.ts` (reason on plan/flag audits)
- Create: `apps/api/src/common/audit.test.ts`

**Interfaces:** Produces (all on `DbPort`):
- `AuditEntry` gains optional `at?: Date; reason?: string; before?: unknown; after?: unknown`.
- `createEmailVerificationToken(t: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>`; `findEmailVerificationToken(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null>`; `markEmailVerificationTokenUsed(id: string): Promise<void>`; `setUserEmailVerified(userId: string, verified: boolean): Promise<void>`; `findUserByEmail(email: string): Promise<DbUser | null>` (verify whether a login lookup already exists — reuse that name if so).
- `createSupportGrant(g: { purpose: string; actorId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>`; `findValidSupportGrant(tokenHash: string): Promise<{ id: string; purpose: string; actorId: string; expiresAt: Date } | null>`; `markSupportGrantUsed(id: string): Promise<void>`.
- `createShiftCorrection(c: { businessId: string; shiftId: string; amountMinor: number; reason: string; actorId: string; requestId: string }): Promise<DbShiftCorrection>`; `listShiftCorrections(businessId: string, shiftId: string): Promise<DbShiftCorrection[]>`; `DbShiftCorrection = DbShiftCorrection-shaped interface (id, businessId, shiftId, amountMinor, reason, actorId, requestId, createdAt)`.
- `createReceiptShare(s: { businessId: string; saleId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>`; `findValidReceiptShare(tokenHash: string): Promise<{ id: string; businessId: string; saleId: string; expiresAt: Date } | null>`.
- `updateSession(id: string, patch: { activeBusinessId: string | null }): Promise<void>`; `DbSession` gains `activeBusinessId?: string | null`.
- `DbMembership` gains `deactivatedAt?: Date | null`; `updateMembership(id: string, businessId: string, patch: { deactivatedAt: Date | null }): Promise<void>`.
- `DbUser` gains `emailVerified?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/common/audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "./memory.db";

describe("phase11 port additions", () => {
  it("stamps audit rows with a timestamp and keeps optional context", async () => {
    const db = createMemoryDb();
    await db.appendAudit({
      businessId: "b1", actorId: "u1", action: "settings.write",
      entityType: "Business", entityId: "b1", requestId: "r1",
      before: { a: 1 }, after: { a: 2 }, reason: "owner update",
    });
    const row = (await db.listAudit()).at(-1)!;
    expect(row.at).toBeInstanceOf(Date);
    expect(row.before).toEqual({ a: 1 });
    expect(row.reason).toBe("owner update");
  });
  it("stores and single-uses an email verification token", async () => {
    const db = createMemoryDb();
    await db.createEmailVerificationToken({ userId: "u1", tokenHash: "h1", expiresAt: new Date(Date.now() + 60000) });
    const found = await db.findEmailVerificationToken("h1");
    expect(found).not.toBeNull();
    await db.markEmailVerificationTokenUsed(found!.id);
    expect((await db.findEmailVerificationToken("h1"))!.usedAt).not.toBeNull();
  });
  it("returns only unexpired unused support grants", async () => {
    const db = createMemoryDb();
    await db.createSupportGrant({ purpose: "p", actorId: "ops", tokenHash: "g1", expiresAt: new Date(Date.now() + 60000) });
    await db.createSupportGrant({ purpose: "p", actorId: "ops", tokenHash: "g2", expiresAt: new Date(Date.now() - 60000) });
    expect((await db.findValidSupportGrant("g1"))!.purpose).toBe("p");
    expect(await db.findValidSupportGrant("g2")).toBeNull();
    const g1 = await db.findValidSupportGrant("g1");
    await db.markSupportGrantUsed(g1!.id);
    expect(await db.findValidSupportGrant("g1")).toBeNull();
  });
  it("persists session active business and membership deactivation", async () => {
    const db = createMemoryDb();
    const user = await db.createUser({ name: "U", email: `u${Date.now()}@x.test`, passwordHash: "h" });
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const m = await db.createMembership({ businessId: biz.id, userId: user.id, role: "owner" });
    const session = await db.createSession({
      userId: user.id, businessId: biz.id, tokenHash: "tok", expiresAt: new Date(Date.now() + 60000),
      authenticatedAt: new Date(), ip: null, userAgent: null,
    });
    await db.updateSession(session.id, { activeBusinessId: biz.id });
    expect((await db.findSessionById(session.id))!.activeBusinessId).toBe(biz.id);
    await db.updateMembership(m.id, biz.id, { deactivatedAt: new Date() });
    expect((await db.findMembership(user.id, biz.id))!.deactivatedAt).not.toBeNull();
  });
});
```

If `createSession`/`findSessionById` port names differ, use the actual names (check `auth.service.ts` session creation first) and adjust the test — the assertions stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/common/audit.test.ts`
Expected: FAIL — `db.createEmailVerificationToken is not a function` (and `at` undefined on audit rows).

- [ ] **Step 3: Implement port + memory + call-site enrichment**

`db.port.ts`: extend `AuditEntry` with the four optional fields; add `DbShiftCorrection` interface; extend `DbSession`/`DbUser`/`DbMembership`; add the methods listed above. `memory.db.ts`: implement each with the established map style; `appendAudit` stores `{ ...e, at: e.at ?? new Date() }`; `findMembership` returns the row as stored (deactivation filtering happens in callers — keep the port dumb); `findValidSupportGrant`/`findValidReceiptShare` filter `usedAt === null && expiresAt > now`.

Enrich two call sites:
- `business.service.ts patchSettings`: `appendAudit({ ..., before: current, after: next })` (keep existing fields).
- `billing.service.ts changePlan` and `setFlag`: add `reason: \`plan ${planKey}\`` / `reason: \`flag ${key}=${enabled}\``.

- [ ] **Step 4: Run test to verify it passes, then the adjacent suites**

Run: `pnpm --filter @pos/api test -- src/common/audit.test.ts src/billing src/business`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/common/audit.test.ts apps/api/src/business/nest/business.service.ts apps/api/src/billing/nest/billing.service.ts
git commit -m "feat: add phase11 port surface and audit context"
```

### Task 3: `settings.write` enforcement on business settings

**Files:**
- Modify: `apps/api/src/business/nest/business.controller.ts` (and/or `business.service.ts` — follow the existing inline-gate pattern)
- Modify: `apps/api/test/hardening.contract.test.ts`

**Interfaces:** Consumes `granted: string[]` already threaded to the controller. Produces: `PATCH /api/v1/business/settings` returns 403 `FORBIDDEN` when the actor lacks `settings.write`; owner passes, manager/cashier denied (role seed already withholds it).

- [ ] **Step 1: Write the failing contract test**

Append to `apps/api/test/hardening.contract.test.ts` (reuse the file's existing register/jar helpers):

```ts
it("denies business settings to roles without settings.write", async () => {
  const owner = await jar(app); // existing helper: registers owner, returns agent
  const settings = await owner.patch("/api/v1/business/settings").send({ receiptFooter: "x" });
  expect(settings.status).toBe(200);
  // Seed a manager session over HTTP is impossible (no invite yet in this test's
  // business): assert the gate at the service level with a manager grant.
  const { BusinessService } = await import("../src/business/nest/business.service");
  const { createMemoryDb } = await import("../src/common/memory.db");
  const db = createMemoryDb();
  const biz = await db.createBusiness({ name: "S", currency: "PHP" });
  const svc = new BusinessService(db);
  await expect(svc.patchSettings(biz.id, "u-mgr", { receiptFooter: "x" }, "r1", ["sale.refund"]))
    .rejects.toThrow("FORBIDDEN");
  await expect(svc.patchSettings(biz.id, "u-owner", { receiptFooter: "x" }, "r2", ["settings.write"]))
    .resolves.toBeTruthy();
});
```

If `patchSettings` does not yet take a `granted` parameter, the failing test defines the new signature `(businessId, actorId, patch, requestId, granted)` — the controller passes `req.auth.granted`. Adjust the existing call sites accordingly.

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter @pos/api test -- test/hardening.contract.test.ts` (service test fails: no gate).

- [ ] **Step 3: Implement** — first line of `patchSettings` body:

```ts
if (!granted.includes("settings.write")) throw new Error("FORBIDDEN");
```

Controller passes `req.auth.granted`. Check `business.controller.ts` for how `granted` reaches sibling routes and follow the same accessor.

- [ ] **Step 4: Run to verify PASS** — same file plus `test/me.contract.test.ts` (settings-adjacent). Expected: PASS.

- [ ] **Step 5: Commit** — `git add apps/api/src/business apps/api/test/hardening.contract.test.ts && git commit -m "feat: enforce settings.write on business settings"`

### Task 4: Payment methods as tenant configuration (FR-PAY-01)

**Files:**
- Modify: `packages/validation/src/sales.schema.ts` (`method: z.string().trim().min(1).max(32)`; keep `PAYMENT_METHODS` export, rename usage to defaults)
- Modify: `apps/api/src/tenant/seed.ts` (defaultSettings gains `paymentMethods`)
- Modify: `apps/api/src/sales/nest/sales.service.ts` (resolve configured methods, validate each payment leg)
- Modify: `apps/api/src/sales/nest/sales.controller.ts` (`GET /payments/methods` returns configured list)
- Modify: `apps/api/src/expenses/nest/expense.service.ts` (replace hardcoded `METHODS` set with the same resolution)
- Create: `apps/api/src/sales/payment-methods.ts` (shared resolver) + `payment-methods.test.ts`
- Modify: `apps/api/test/sales.contract.test.ts`

**Interfaces:** Produces `resolvePaymentMethods(db, businessId): Promise<Array<{ key: string; label: string }>>` in `apps/api/src/sales/payment-methods.ts`:

```ts
import type { DbPort } from "../common/db.port";

export const DEFAULT_PAYMENT_METHODS: Array<{ key: string; label: string }> = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "other", label: "Other" },
];

export async function resolvePaymentMethods(
  db: DbPort,
  businessId: string,
): Promise<Array<{ key: string; label: string }>> {
  const settings = await db.getSettings(businessId);
  const raw = settings["paymentMethods"];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw as Array<{ key: string; label: string }>;
  }
  return DEFAULT_PAYMENT_METHODS;
}
```

- [ ] **Step 1: Write the failing tests**

`apps/api/src/sales/payment-methods.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { DEFAULT_PAYMENT_METHODS, resolvePaymentMethods } from "./payment-methods";

describe("phase11 configured payment methods", () => {
  it("falls back to the six defaults when settings are unset", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(DEFAULT_PAYMENT_METHODS);
  });
  it("returns the configured list when set", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    await db.saveSettings(biz.id, { ...(await db.getSettings(biz.id)), paymentMethods: [{ key: "cash", label: "Cash" }, { key: "shopee_pay", label: "ShopeePay" }] });
    const out = await resolvePaymentMethods(db, biz.id);
    expect(out.map((m) => m.key)).toEqual(["cash", "shopee_pay"]);
  });
});
```

Append to `apps/api/test/sales.contract.test.ts`:

```ts
it("accepts a configured method and rejects an unconfigured one", async () => {
  const { agent, headers, productId } = await seededSale(); // reuse the file's existing seeded-sale helper
  // Configure methods down to cash + shopee_pay via the service (no settings UI by design).
  const { createMemoryDb } = await import("../src/common/memory.db");
  void createMemoryDb; // contract tests run against the shared in-memory app store; set via API-free path below
  ...
});
```

The contract file's exact seam: `sales.contract.test.ts` tests run against the app's shared `DbPort`. If the file already reaches the store (look for `app.get("DbPort")`), use it:

```ts
const db = app.get<DbPort>("DbPort");
await db.saveSettings(businessId, { ...(await db.getSettings(businessId)), paymentMethods: [{ key: "cash", label: "Cash" }] });
const ok = await agent.post("/api/v1/sales/complete").set(headers).send({ saleId, payments: [{ method: "cash", amountMinor: total }], idempotencyKey: `pm-${Date.now()}` });
expect(ok.status).toBe(201);
const bad = await agent.post("/api/v1/sales/complete").set(headers).send({ saleId: otherSaleId, payments: [{ method: "gcash", amountMinor: total2 }], idempotencyKey: `pm2-${Date.now()}` });
expect(bad.status).toBe(400);
expect(bad.body.code).toBe("VALIDATION");
```

If no `app.get("DbPort")` precedent exists, cover the accept/reject paths at the service level (`sales.service.completeSale` with a seeded Free-plan business over `createMemoryDb`) — the resolver is what changes, the seam is the same.

- [ ] **Step 2: Run to verify FAIL** — resolver missing; service accepts any enum value today (unconfigured gcash would pass, so the reject assertion fails).

- [ ] **Step 3: Implement** — resolver file as above; `sales.service.completeSale` after zod parse:

```ts
const methods = await resolvePaymentMethods(this.db, businessId);
const configured = new Set(methods.map((m) => m.key));
for (const p of input.payments) {
  if (!configured.has(p.method)) throw new Error("VALIDATION");
}
```

`expense.service.ts`: replace `const METHODS = new Set([...])` with the same configured-set check (`if (!configured.has(input.method)) throw new Error("VALIDATION")`). `sales.controller.ts` methods route:

```ts
const methods = await resolvePaymentMethods(this.db, businessId);
res.json({ methods });
```

`tenant/seed.ts` `defaultSettings` gains `{ key: "paymentMethods", value: DEFAULT_PAYMENT_METHODS }` (import from `../../sales/payment-methods`).

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/sales src/expenses test/sales.contract.test.ts test/expense.contract.test.ts`. Expected: PASS (defaults keep every existing test green).

- [ ] **Step 5: Commit** — `git commit -m "feat: resolve payment methods from business settings"`

### Task 5: Membership management with the users cap (FR-RBAC-02, §16.2)

**Files:**
- Create: `apps/api/src/memberships/nest/membership.service.ts`, `membership.controller.ts`, `membership.service.test.ts`
- Modify: `apps/api/src/app.module.ts` (wire controller/provider), `apps/api/src/billing/nest/billing.service.ts` (`requireCreate("users")` counts only active memberships), `apps/api/src/common/session.guard.ts` (deactivated membership = no access)

**Interfaces:** Produces:
- `POST /api/v1/memberships` `{ email, name, role }` (role ∈ manager|cashier|inventory) → `201 { membershipId, userId, tempPassword? }` — `tempPassword` present only for newly created users, shown once. Existing user by email → membership added, no temp password.
- `GET /api/v1/memberships` → `{ items: [{ id, userId, name, email, role, deactivatedAt }] }`.
- `POST /api/v1/memberships/:id/deactivate` → `{ ok: true }`.
- `MembershipService.create(businessId, actorId, requestId, granted, input)`, `.list(businessId)`, `.deactivate(businessId, actorId, requestId, granted, membershipId)`.

- [ ] **Step 1: Write the failing service test**

`apps/api/src/memberships/nest/membership.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { MembershipService } from "./membership.service";

const OWNER = ["user.manage", "settings.write", "sale.refund"];

describe("phase11 membership management", () => {
  it("invites a new member with a one-time temp password and enforces user.manage", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    const out = await svc.create(biz.id, "u1", "r1", OWNER, { email: `c${Date.now()}@x.test`, name: "CashIER", role: "cashier" });
    expect(out.tempPassword).toMatch(/^.{16}$/);
    const members = await svc.list(biz.id);
    expect(members.items).toHaveLength(1);
    await expect(svc.create(biz.id, "u1", "r2", ["sale.refund"], { email: `d${Date.now()}@x.test`, name: "X", role: "cashier" }))
      .rejects.toThrow("FORBIDDEN");
  });
  it("rejects a second owner and counts only active members against the cap", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    await expect(svc.create(biz.id, "u1", "r1", OWNER, { email: `o${Date.now()}@x.test`, name: "O", role: "owner" }))
      .rejects.toThrow("VALIDATION");
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({ businessId: biz.id, planId: free.id, status: "active", trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z") });
    for (let i = 0; i < 2; i++) {
      await svc.create(biz.id, "u1", `r-${i}`, OWNER, { email: `m${i}-${Date.now()}@x.test`, name: `M${i}`, role: "cashier" });
    }
    await expect(svc.create(biz.id, "u1", "r-cap", OWNER, { email: `m3-${Date.now()}@x.test`, name: "M3", role: "cashier" }))
      .rejects.toThrow("PLAN_LIMIT");
    const members = await svc.list(biz.id);
    const second = members.items.find((m) => m.role === "cashier")!;
    await svc.deactivate(biz.id, "u1", "r-deact", OWNER, second.id);
    const ok = await svc.create(biz.id, "u1", "r-after", OWNER, { email: `m4-${Date.now()}@x.test`, name: "M4", role: "cashier" });
    expect(ok.membershipId).toBeTruthy();
  });
});
```

(The Free cap is 3 users; the owner seat plus two invited cashiers fills it; deactivating frees a seat.)

- [ ] **Step 2: Run to verify FAIL** — module missing.

- [ ] **Step 3: Implement**

`membership.service.ts`: gate `user.manage` first; validate role against `["manager", "cashier", "inventory"]`; `new BillingService(this.db).requireCreate(businessId, actorId, requestId, "users")` before the write; look up `findUserByEmail` — when absent `createUser` with `hashPassword(tempPassword)` (16 chars from `randomBytes(12)` base64url) and `emailVerified: true`, when present reuse; `createMembership({ businessId, userId, role })`; audit `member.invited` / `member.deactivated`; `deactivate` requires the target membership in this business and refuses to deactivate the last owner (count active owners; if 1 and target is it → `VALIDATION`).

`billing.service.ts` `requireCreate` `"users"` branch: `const members = await this.db.listMembershipsByBusiness(businessId); used = members.filter((m) => !m.deactivatedAt).length`.

`session.guard.ts`: treat a membership with `deactivatedAt != null` as missing (`TENANT_MISMATCH` path) — read the guard's membership check and add the filter at that call site, not in the port.

Controller: `SessionGuard`-protected routes per the existing controller style (copy `expense.controller.ts` structure; `granted` accessor identical), explicit `res.status(201)` on create.

`app.module.ts`: add provider + controller to both module lists, same factory style as expenses.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/memberships src/billing test/plan-limits.contract.test.ts test/me.contract.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: add membership management with users cap"`

### Task 6: Refund approval threshold (FR-REFUND-02)

**Files:**
- Modify: `packages/auth/src/permissions.ts` (add `"refund.override"` to `SENSITIVE_ACTIONS`)
- Modify: `apps/api/src/tenant/seed.ts` (exclude `refund.override` from manager, cashier, inventory)
- Modify: `apps/api/src/refunds/nest/refund.service.ts` (threshold check in `approveRefund`)
- Modify: `apps/api/test/refund.contract.test.ts`

**Interfaces:** Settings key `refundApprovalThresholdMinor` (int ≥ 0, absent/null = policy unchanged). Above threshold: approver must hold `refund.override` (owner only after the seed change). Requester≠approver rule unchanged and still applies first.

- [ ] **Step 1: Write the failing contract test**

Append to `apps/api/test/refund.contract.test.ts` (reuse the file's sale + refund helpers):

```ts
it("requires refund.override above the configured threshold", async () => {
  const db = app.get<DbPort>("DbPort"); // if no store accessor exists, seed via the service path shown in Task 4
  const settings = await db.getSettings(businessId);
  await db.saveSettings(businessId, { ...settings, refundApprovalThresholdMinor: 10000 });
  // manager requests a 250.00 refund; owner (not requester) approves -> OK
  // manager requests a 300.00 refund; owner approves without refund.override role is impossible;
  // use an inventory-role approver holding sale.refund but not refund.override -> FORBIDDEN
});
```

Concretely assert: small refund (≤ threshold) approver without `refund.override` succeeds; large refund same approver throws `FORBIDDEN`; owner approves the large one. If the contract file cannot reach the store, split: HTTP for the small-refund path, service-level for the threshold paths (`new RefundService(db)` with seeded sale, mirroring `sales.split.test.ts` setup).

- [ ] **Step 2: Run to verify FAIL** — threshold ignored (large refund succeeds for non-owner).

- [ ] **Step 3: Implement**

```ts
const settings = await this.db.getSettings(businessId);
const threshold = settings["refundApprovalThresholdMinor"];
if (typeof threshold === "number" && refundTotalMinor > threshold && !granted.includes("refund.override")) {
  throw new Error("FORBIDDEN");
}
```

placed after the existing `sale.refund` gate in `approveRefund`, where `refundTotalMinor` is the approved refund total the method already computes. Seed filters: add `p !== "refund.override"` to manager, cashier, and inventory filter chains. `packages/auth` exports update automatically via `SENSITIVE_ACTIONS`.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/refunds test/refund.contract.test.ts packages/auth test/abuse-payments.contract.test.ts`. Expected: PASS (no threshold set → unchanged behavior).

- [ ] **Step 5: Commit** — `git commit -m "feat: add refund approval threshold policy"`

### Task 7: Post-close shift corrections (FR-CASH-04)

**Files:**
- Modify: `apps/api/src/shifts/nest/shift.service.ts`, `shift.controller.ts`
- Modify: `apps/api/test/shift.contract.test.ts`

**Interfaces:** Produces `POST /api/v1/shifts/:id/corrections { amountMinor, reason }` → `201 { correction }` (closed shifts only — open shifts use cash movements; `VALIDATION` otherwise). Permission: `shift.close.override` via `granted`, plus the register/shift role gate the close route already uses. `GET /api/v1/shifts/:id` response gains `corrections: Array<{ amountMinor, reason, actorId, createdAt }>` and `correctedExpectedCash: number | null` (sum only when corrections exist).

- [ ] **Step 1: Write the failing contract test**

Append to `apps/api/test/shift.contract.test.ts`:

```ts
it("records an audited correction on a closed shift and surfaces it in the report", async () => {
  const { agent, headers, shiftId } = await openedAndClosedShift(); // reuse the file's open+close helper
  const blocked = await agent.post(`/api/v1/shifts/${shiftId}/cash`).set(headers).send({ kind: "adjustment", amountMinor: 100, reason: "late" });
  expect(blocked.status).toBe(403); // SHIFT_CLOSED_IMMUTABLE family still holds
  const ok = await agent.post(`/api/v1/shifts/${shiftId}/corrections`).set(headers).send({ amountMinor: -500, reason: "counted before last drop" });
  expect(ok.status).toBe(201);
  expect(ok.body.correction.amountMinor).toBe(-500);
  const report = await agent.get(`/api/v1/shifts/${shiftId}`).set(headers);
  expect(report.body.corrections).toHaveLength(1);
  expect(report.body.correctedExpectedCash).toBe(report.body.expectedCash - 500);
  const badPayload = await agent.post(`/api/v1/shifts/${shiftId}/corrections`).set(headers).send({ amountMinor: 0, reason: "nothing" });
  expect(badPayload.status).toBe(400);
});
```

(If the helper's closed shift has expected ≠ 0, assert against `report.body.expectedCash - 500` computed from the response, not a literal.)

- [ ] **Step 2: Run to verify FAIL** — 404 (no route).

- [ ] **Step 3: Implement** — service method:

```ts
async addCorrection(businessId: string, actorId: string, requestId: string, granted: string[], shiftId: string, input: { amountMinor: number; reason: string }): Promise<DbShiftCorrection> {
  withScope(businessId, {});
  if (!granted.includes("shift.close.override")) throw new Error("FORBIDDEN");
  const shift = await this.db.findShiftById(shiftId, businessId);
  if (!shift) throw new Error("NOT_FOUND");
  if (shift.closedAt === null) throw new Error("VALIDATION");
  const row = await this.db.createShiftCorrection({ businessId, shiftId, amountMinor: input.amountMinor, reason: input.reason, actorId, requestId });
  await this.db.appendAudit({ businessId, actorId, action: "shift.corrected", entityType: "Shift", entityId: shiftId, requestId, reason: input.reason });
  return row;
}
```

(Check the actual finder name — `getShift` reads via an existing port method; reuse it.) `getShift` gains:

```ts
const corrections = await this.db.listShiftCorrections(businessId, shiftId);
// correctedExpectedCash = corrections.length ? expectedCash + corrections.reduce((s, c) => s + c.amountMinor, 0) : null
```

Controller route parses with `correctionSchema`, `res.status(201)`.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/shifts test/shift.contract.test.ts tests/../../phase5` is wrong scope; run `pnpm --filter @pos/api test -- src/shifts test/shift.contract.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: add audited post-close shift corrections"`

### Task 8: Active business persisted on the session (FR-TENANT-02)

**Files:**
- Modify: `apps/api/src/auth/nest/auth.service.ts`, `auth.controller.ts`
- Modify: `apps/api/src/common/session.guard.ts`
- Modify: `apps/api/test/http.contract.test.ts`

**Interfaces:** `POST /auth/active-business { businessId }` now persists `session.activeBusinessId = businessId` after the membership check (and audits `business.switched`). `SessionGuard` resolves the tenant as `session.activeBusinessId ?? session.businessId`, then verifies membership on the resolved value (existing behavior preserved when null). Response body gains `{ activeBusinessId }`.

- [ ] **Step 1: Write the failing contract test**

Append to `apps/api/test/http.contract.test.ts` (use the file's existing two-business or Task 5 invite helpers; if none exist, invite over HTTP from Task 5's new endpoint — owner of business A invites the existing user to A, the user switches):

```ts
it("persists the active business switch on the session", async () => {
  // owner2 exists (second registered business). owner invites owner2's user into business1 via POST /memberships.
  const switched = await agent2.post("/api/v1/auth/active-business").set(headers2).send({ businessId: business1Id });
  expect(switched.status).toBe(200);
  expect(switched.body.activeBusinessId).toBe(business1Id);
  const me = await agent2.get("/api/v1/me").set(headers2);
  expect(me.body.business.id).toBe(business1Id);
});
```

- [ ] **Step 2: Run to verify FAIL** — `/me` still reports the login-pinned business.

- [ ] **Step 3: Implement** — in `auth.service.activeBusiness`, after the membership validation that already exists: `await this.db.updateSession(sessionId, { activeBusinessId: businessId })` (the service needs the session id — read it the same way logout does) and audit `business.switched`. In `session.guard.ts`, replace the single `session.businessId` resolution with `const target = session.activeBusinessId ?? session.businessId;` and run the existing membership check against `target`.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- test/http.contract.test.ts test/sessions.test.ts test/tenant.guard.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: persist active business on the session"`

### Task 9: Email verification behind a flag (FR-AUTH-01)

**Files:**
- Modify: `apps/api/src/auth/nest/auth.service.ts` (register/login), `auth.controller.ts` (verify-email route)
- Modify: `apps/api/src/common/http-helpers.ts` (`EMAIL_UNVERIFIED: 403`)
- Modify: `apps/api/test/password.test.ts` or new `apps/api/test/email-verification.test.ts`

**Interfaces:** Settings flag `requireEmailVerification` (boolean; absent = false → zero change). When true at registration: user created `emailVerified: false`; response gains `verificationToken` (32-hex, single-use, 24 h `[SPEC-DEFAULT]`); login answers 403 `EMAIL_UNVERIFIED` until `POST /api/v1/auth/verify-email { token }` → `200 { verified: true }`. New users created via Task 5 memberships are `emailVerified: true` (invited by an owner, no email loop).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/email-verification.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/common/memory.db";
import { AuthService } from "../src/auth/nest/auth.service";

describe("phase11 email verification", () => {
  it("defaults to no verification gate", async () => {
    const db = createMemoryDb();
    const auth = new AuthService(db);
    const stamp = Date.now();
    await auth.register({ ownerName: "O", email: `a${stamp}@x.test`, password: "long-enough-pass", businessName: "B" });
    const login = await auth.login({ email: `a${stamp}@x.test`, password: "long-enough-pass" });
    expect(login).toBeTruthy();
  });
  it("gates login until the token is redeemed when the flag is on", async () => {
    const db = createMemoryDb();
    const auth = new AuthService(db);
    const stamp = Date.now();
    const bizSeeds = await auth.register({ ownerName: "O", email: `b${stamp}@x.test`, password: "long-enough-pass", businessName: "B" });
    await db.saveSettings((bizSeeds as { businessId: string }).businessId, {
      ...(await db.getSettings((bizSeeds as { businessId: string }).businessId)),
      requireEmailVerification: true,
    });
    // re-register a fresh user under the flag
    const reg = await auth.register({ ownerName: "O2", email: `c${stamp}@x.test`, password: "long-enough-pass", businessName: "B2" });
    const token = (reg as unknown as { verificationToken: string }).verificationToken;
    expect(typeof token).toBe("string");
    await expect(auth.login({ email: `c${stamp}@x.test`, password: "long-enough-pass" })).rejects.toThrow("EMAIL_UNVERIFIED");
    await auth.verifyEmail(token);
    expect(await auth.login({ email: `c${stamp}@x.test`, password: "long-enough-pass" })).toBeTruthy();
  });
});
```

Adjust to the actual `register` return shape (it returns session/csrf today — read `auth.service.ts` first and carry the businessId through whatever it returns; the token assertion is the contract).

- [ ] **Step 2: Run to verify FAIL** — no `verificationToken`, login never gated.

- [ ] **Step 3: Implement**

- `register`: read settings first; if `requireEmailVerification === true`: create user with `emailVerified: false`, generate `token = randomBytes(16).toString("hex")`, `createEmailVerificationToken({ userId, tokenHash: sha256(token), expiresAt: now+24h })`, include `verificationToken: token` in the return; else `emailVerified: true`.
- `login`: after credential check, `if (user.emailVerified === false) throw new Error("EMAIL_UNVERIFIED")`.
- `verifyEmail(token)`: `findEmailVerificationToken(sha256(token))` → missing/used/expired → `VALIDATION`; mark used; `setUserEmailVerified(userId, true)`; audit `email.verified`.
- Controller: `POST /auth/verify-email` public (no session), zod `{ token: string min 10 max 128 }`, `res.status(200)`.
- `http-helpers.ts`: `EMAIL_UNVERIFIED: 403`.
- Task 5's `MembershipService.create` passes `emailVerified: true` on `createUser`.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- test/email-verification.test.ts test/sessions.test.ts test/password.test.ts test/http.contract.test.ts`. Expected: PASS (flag off everywhere else).

- [ ] **Step 5: Commit** — `git commit -m "feat: add opt-in email verification gate"`

### Task 10: Time-bounded platform support grants (FR-PLATFORM-01)

**Files:**
- Modify: `apps/api/src/billing/nest/platform.controller.ts`
- Create: `apps/api/src/billing/nest/support-grants.test.ts`

**Interfaces:** Produces:
- `POST /api/v1/platform/grants` (platform key ONLY) `{ purpose, ttlMinutes, actorId }` → `201 { grantId, token, expiresAt }` — `token` = `sup_<16hex>_<32hex>`, sha256 at rest, shown once.
- All existing platform routes accept `x-support-grant: <token>` as an alternative to `x-platform-key` while the grant is unexpired and unused; the grant is marked used on first platform mutation. Each granted action appends audit `platform.grant.use` with `entityId: grantId`, `reason: purpose`, plus the action's own audit row.

- [ ] **Step 1: Write the failing test**

`apps/api/src/billing/nest/support-grants.test.ts`:

```ts
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env["PLATFORM_API_KEY"] = "test-platform-key";

import { createMemoryDb } from "../../common/memory.db";
import { tokenHash } from "../../apitokens/token"; // reuse the existing sha256 helper; check its real export name first

describe("phase11 support grants", () => {
  it("mints a grant through the service and expires it", async () => {
    const { SupportGrantService } = await import("./support-grant.service");
    const db = createMemoryDb();
    const svc = new SupportGrantService(db);
    const grant = await svc.mint({ purpose: "invoice investigation", ttlMinutes: 30, actorId: "ops-oncall" }, "r1");
    expect(grant.token).toMatch(/^sup_[0-9a-f]{16}_[0-9a-f]{32}$/);
    const resolved = await svc.resolve(grant.token);
    expect(resolved!.purpose).toBe("invoice investigation");
    await svc.consume(resolved!.id);
    expect(await svc.resolve(grant.token)).toBeNull();
    await expect(svc.mint({ purpose: "x", ttlMinutes: 61, actorId: "ops" }, "r2")).rejects.toThrow("VALIDATION");
  });
});
```

If `tokenHash` does not exist in `apitokens/token.ts`, inline `createHash("sha256").update(token).digest("hex")` in the service (one place, exported).

- [ ] **Step 2: Run to verify FAIL** — service missing.

- [ ] **Step 3: Implement**

Create `apps/api/src/billing/nest/support-grant.service.ts` with `mint` (validates via `supportGrantSchema`, `expiresAt = now + ttlMinutes*60_000`, token format above, audit `support.grant.minted`) and `resolve`/`consume` as the port methods from Task 2. `platform.controller.ts`:

```ts
private async platformGuard(req: Request, res: Response): Promise<boolean> {
  const grantHeader = req.headers["x-support-grant"];
  if (typeof grantHeader === "string" && grantHeader.length > 0) {
    const grant = await this.grants.resolve(grantHeader);
    if (!grant) { fail(res, 403, "FORBIDDEN", "Support grant invalid or expired", req); return false; }
    (req as Request & { supportGrant?: { id: string; purpose: string } }).supportGrant = grant;
    return true;
  }
  // existing x-platform-key path unchanged
}
```

After each successful platform mutation, when `req.supportGrant` is set: `markSupportGrantUsed(grant.id)` + `appendAudit({ businessId: targetBusinessId, actorId: "platform", action: "platform.grant.use", entityType: "SupportGrant", entityId: grant.id, requestId, reason: grant.purpose })`. New route `POST /grants` requires the plain platform key (reject grant-header callers), parses with `supportGrantSchema`, `res.status(201)`.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/billing test/billing.contract.test.ts test/webhook.contract.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: add time-bounded platform support grants"`

### Task 11: Receipt download and share (FR-RECEIPT-01)

**Files:**
- Modify: `apps/api/src/sales/nest/sales.service.ts` (`downloadReceipt`, `createShareToken`), `sales.controller.ts`
- Create: `apps/api/src/sales/receipt-text.ts` + `receipt-text.test.ts`
- Modify: `apps/api/test/sales.contract.test.ts`

**Interfaces:** Produces:
- `renderReceiptText(receipt): string` — plain-text renderer (business-agnostic): `Receipt <no>`, item lines `name x qty — <lineTotal>`, then Subtotal/Discount/Tax/Total/Paid/Change and a tender line, all money as `(minor/100).toFixed(2)`.
- `GET /receipts/:saleId/download` → `200 text/plain; Content-Disposition: attachment; filename="receipt-<no>.txt"`.
- `POST /receipts/:saleId/share` → `201 { token, expiresAt }` (32-hex, sha256 at rest, 24 h `[SPEC-DEFAULT]`).
- `GET /receipts/shared/:token` — **no SessionGuard** (explicit, like the display feed) → `200 { receiptNo, status, items, totals }` or 404 when expired/unknown.

- [ ] **Step 1: Write the failing unit test**

`apps/api/src/sales/receipt-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderReceiptText } from "./receipt-text";

describe("phase11 receipt text", () => {
  it("renders items, totals, and change", () => {
    const text = renderReceiptText({
      receiptNo: "2026-000001",
      status: "COMPLETED",
      items: [{ name: "Audit Coke", qty: 1, lineTotalMinor: 2500 }],
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500,
      paidMinor: 5000, changeMinor: 2500,
      tenders: [{ method: "cash", amountMinor: 5000 }],
    });
    expect(text).toContain("Receipt 2026-000001");
    expect(text).toContain("Audit Coke x 1 — 25.00");
    expect(text).toContain("TOTAL 25.00");
    expect(text).toContain("CHANGE 25.00");
    expect(text).toContain("cash 50.00");
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module missing.

- [ ] **Step 3: Implement** the renderer, then wire:

```ts
async downloadReceipt(businessId: string, saleId: string): Promise<{ filename: string; text: string }> {
  const receipt = await this.receiptData(businessId, saleId);
  return { filename: `receipt-${receipt.receiptNo}.txt`, text: renderReceiptText({ /* map receiptData fields */ }) };
}

async createShareToken(businessId: string, actorId: string, requestId: string, saleId: string): Promise<{ token: string; expiresAt: Date }> {
  await this.receiptData(businessId, saleId); // 404 when not visible
  const token = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 3600_000);
  await this.db.createReceiptShare({ businessId, saleId, tokenHash: sha256(token), expiresAt });
  await this.db.appendAudit({ businessId, actorId, action: "receipt.shared", entityType: "Sale", entityId: saleId, requestId });
  return { token, expiresAt };
}

async sharedReceipt(token: string): Promise<{ receiptNo: string; status: string; items: Array<{ name: string; qty: number; lineTotalMinor: number }>; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; paidMinor: number; changeMinor: number }> {
  const share = await this.db.findValidReceiptShare(sha256(token));
  if (!share) throw new Error("NOT_FOUND");
  return this.receiptData(share.businessId, share.saleId) with the same projection;
}
```

Controller: download route sets the two headers and `res.send(text)`; share route `res.status(201)`; shared route before `SessionGuard` in the controller's route list (check how display.controller.ts opts out and copy that mechanism), explicit status on POST.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/sales test/sales.contract.test.ts`. Contract addition: one HTTP test — complete a sale, GET download returns `text/plain` with the receipt number in the body, POST share then GET `/receipts/shared/<token>` returns 200 with the same receipt number, and an expired token (seed via db with `expiresAt` in the past) returns 404. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: add receipt download and share tokens"`

### Task 12: Metrics endpoint (§14.2)

**Files:**
- Create: `apps/api/src/common/metrics.ts` + `metrics.test.ts` + `metrics.controller.ts`
- Modify: `apps/api/src/app.module.ts` (provider/controller), `apps/api/src/main.ts` or middleware wiring (counter middleware), `apps/api/src/auth/nest/auth.controller.ts` + `rate-limit.ts` path (auth failures), `apps/api/src/sales/nest/sales.service.ts` (completed + unknown), `apps/api/src/inventory/nest/inventory.service.ts` (failures)
- Modify: `apps/api/test/logging.test.ts` (or new `apps/api/test/metrics.contract.test.ts`)

**Interfaces:** Produces in `metrics.ts`:

```ts
const counters = new Map<string, number>();
export function incrementMetric(name: string, labels: Record<string, string> = {}): void {
  const key = `${name}${Object.keys(labels).length ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}` : ""}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}
export function renderMetrics(): string {
  const lines = [...counters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`);
  return `${lines.join("\n")}\n`;
}
export function resetMetricsForTests(): void { counters.clear(); }
```

Metric names (exactly what `runbooks/alerts.md` names): `pos_http_requests_total{method,status}`, `pos_auth_failures_total`, `pos_sales_completed_total`, `pos_payment_unknown_total`, `pos_inventory_failures_total`. Route `GET /api/v1/metrics` — 403 `FORBIDDEN` unless `Authorization: Bearer $METRICS_TOKEN` and `METRICS_TOKEN` is set; `Content-Type: text/plain; version=0.0.4`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/common/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { incrementMetric, renderMetrics, resetMetricsForTests } from "./metrics";

describe("phase11 metrics", () => {
  it("counts and renders labeled counters", () => {
    resetMetricsForTests();
    incrementMetric("pos_sales_completed_total");
    incrementMetric("pos_http_requests_total", { method: "POST", status: "201" });
    incrementMetric("pos_http_requests_total", { method: "POST", status: "201" });
    const text = renderMetrics();
    expect(text).toContain("pos_sales_completed_total 1");
    expect(text).toContain('pos_http_requests_total{method="POST",status="201"} 2');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module missing.

- [ ] **Step 3: Implement** — metrics.ts as above; a tiny middleware after `SecurityHeadersMiddleware` that calls `incrementMetric("pos_http_requests_total", { method: req.method, status: String(res.statusCode) })` in the response `finish` event (`res.on("finish", ...)`); increment `pos_auth_failures_total` where login rejects bad credentials (the same place the rate limiter counts attempts); `pos_payment_unknown_total` in the sales path that returns `PAYMENT_UNKNOWN`; `pos_sales_completed_total` on successful completion; `pos_inventory_failures_total` where `INSUFFICIENT_STOCK` is thrown. Controller with the bearer check (constant-time compare via the `timingSafeEqual` helper pattern already used in `platform-key.ts`), wired in `app.module.ts`.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- src/common/metrics.test.ts test/logging.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: add metrics endpoint with plan runbook counters"`

### Task 13: CI hygiene + missing threat tests (§13.3, §18 #14)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/api/test/abuse.contract.test.ts` (append a describe block)

**Interfaces:** CI verify job gains `pnpm lint`, `pnpm build`, `pnpm audit --prod --audit-level critical` steps after `pnpm test`. New tests: (a) a role without `export.run` calling `GET /api/v1/sales/export` gets 403 `FORBIDDEN`; (b) closing a shift with an override reason but a role without `shift.close.override` gets 403 `FORBIDDEN`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/abuse.contract.test.ts` (use the file's helpers; mirror its existing denial-assertion style):

```ts
describe("phase11 threat coverage", () => {
  it("denies ledger export to roles without export.run", async () => {
    // register owner (has export.run) -> assert 200 on GET /api/v1/sales/export
    // service-level: same export call with granted: [] -> FORBIDDEN (mirror Task 3's seam if the route has no roleless path)
  });
  it("denies shift close override to roles without shift.close.override", async () => {
    // open shift as owner; attempt POST /shifts/:id/close with an override payload from a session whose role lacks the permission -> 403
    // (seed the second session over HTTP via Task 5 memberships if available, else service-level)
  });
});
```

Concretize both with the same HTTP-or-service seam decision used in Tasks 3/6; the assertions are 403 `FORBIDDEN` from the gate, and 200/201 for the authorized twin.

- [ ] **Step 2: Run to verify FAIL** — the denial paths must already return 403 (enforcement exists per the audit); if a test passes immediately, it is testing existing behavior — reshape it so the assertion targets the *gap*: if both denials already hold, reframe Task 13's test step as recording them (they are the audit's "missing test" gap, not a code gap) and mark them `# proves §13.3 coverage` — then verify the CI steps are the failing part (lint/build steps absent from ci.yml).

- [ ] **Step 3: Implement** — add the three CI steps in the verify job after the test step:

```yaml
      - name: Lint
        run: pnpm lint
      - name: Build
        run: pnpm build
      - name: Production dependency audit
        run: pnpm audit --prod --audit-level critical
```

If `pnpm lint` or `pnpm build` fail on pre-existing issues, fix the lint findings that are trivial (unused vars) and, for anything structural, record it in the plan's execution notes instead of expanding this task's scope.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter @pos/api test -- test/abuse.contract.test.ts test/hardening.contract.test.ts` and `pnpm lint && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "test: close threat-coverage gaps and add ci lint build audit"`

### Task 14: Phase 11 exit gate and verification

**Files:**
- Create: `tests/phase11-exit.test.ts`
- Create: `scripts/verify-phase11.test.mjs`
- Modify: `.github/workflows/ci.yml` (append the verify-phase11 line next to the other verify scripts)

**Interfaces:** Consumes all Phase 11 deliverables. Produces the phase exit proof.

- [ ] **Step 1: Write the exit test**

`tests/phase11-exit.test.ts` (root vitest, same import style as `phase10-exit.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { resolvePaymentMethods } from "../apps/api/src/sales/payment-methods";
import { renderReceiptText } from "../apps/api/src/sales/receipt-text";
import { renderMetrics, incrementMetric, resetMetricsForTests } from "../apps/api/src/common/metrics";

describe("phase11 exit", () => {
  it("resolves configured payment methods with defaults fallback", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    expect((await resolvePaymentMethods(db, biz.id)).map((m) => m.key)).toContain("cash");
    await db.saveSettings(biz.id, { ...(await db.getSettings(biz.id)), paymentMethods: [{ key: "cash", label: "Cash" }] });
    expect((await resolvePaymentMethods(db, biz.id)).map((m) => m.key)).toEqual(["cash"]);
  });
  it("renders receipt text with change", () => {
    expect(renderReceiptText({
      receiptNo: "2026-000002", status: "COMPLETED",
      items: [{ name: "X", qty: 2, lineTotalMinor: 5000 }],
      subtotalMinor: 5000, discountMinor: 0, taxMinor: 0, totalMinor: 5000,
      paidMinor: 10000, changeMinor: 5000, tenders: [{ method: "cash", amountMinor: 10000 }],
    })).toContain("CHANGE 50.00");
  });
  it("emits runbook metric names", () => {
    resetMetricsForTests();
    incrementMetric("pos_payment_unknown_total");
    expect(renderMetrics()).toContain("pos_payment_unknown_total 1");
  });
  it("audits carry timestamps and snapshots", async () => {
    const db = createMemoryDb();
    await db.appendAudit({ businessId: "b", actorId: "u", action: "settings.write", entityType: "Business", entityId: "b", requestId: "r", before: { a: 1 }, after: { a: 2 } });
    const row = (await db.listAudit()).at(-1)!;
    expect(row.at).toBeInstanceOf(Date);
    expect(row.after).toEqual({ a: 2 });
  });
});
```

- [ ] **Step 2: Verify script**

`scripts/verify-phase11.test.mjs` in the style of `scripts/verify-phase10.test.mjs`: `existsSync` over migration 0012, `phase11.schema.ts`, `membership.service.ts` + controller, `support-grant.service.ts`, `receipt-text.ts`, `metrics.ts` + `metrics.controller.ts`, `email-verification.test.ts`, updated `ci.yml` (assert it contains `pnpm lint` and `verify-phase11`), and `tests/phase11-exit.test.ts`. Prints `PHASE11_OK` else exit 1.

- [ ] **Step 3: Run the full gate**

Run: `pnpm test && pnpm test:exit && node scripts/verify-phase11.test.mjs && pnpm typecheck`
Expected: all PASS, `PHASE11_OK`.

- [ ] **Step 4: Migration proof**

Isolated Postgres on port 5433 (`pos-db-phase11`), apply 0001→0012, assert **44** tables (40 + 4 new) and the `Session.activeBusinessId` column; remove the container. Record the transcript in the plan's execution notes.

- [ ] **Step 5: Commit**

```bash
git add tests/phase11-exit.test.ts scripts/verify-phase11.test.mjs .github/workflows/ci.yml
git commit -m "test: add phase11 exit gate and verification"
```

## Self-Review

1. **Spec coverage:** payment methods as config (Task 4) ✓; audit shape + snapshots (Tasks 2, 3) ✓; settings.write (Task 3) ✓; memberships + users cap (Task 5) ✓; refund threshold (Task 6) ✓; post-close corrections (Task 7) ✓; active business (Task 8) ✓; email verification (Task 9) ✓; support grants (Task 10) ✓; receipt download/share (Task 11) ✓; metrics (Task 12) ✓; CI + threat tests (Task 13) ✓; exit gate (Task 14) ✓. UI-adjacent gaps (Settings page, held-sales list, receipt UI links, freshness display, keyboard/focus) intentionally absent — frontend workstream.
2. **Placeholders:** Tasks 3, 4, 6, 11, 13 name an HTTP-vs-service seam decision explicitly with the exact fallback (service-level over `createMemoryDb`, mirroring `sales.split.test.ts`) — each states the assertion, not a TBD.
3. **Type consistency:** `resolvePaymentMethods` used identically in Tasks 4/14; `AuditEntry.at/reason/before/after` names identical in Tasks 2/3/10/14; `createShiftCorrection/listShiftCorrections` (Task 2 defines, Task 7 consumes); `createReceiptShare/findValidReceiptShare` (Task 2 defines, Task 11 consumes); `findValidSupportGrant/markSupportGrantUsed` (Task 2 defines, Task 10 consumes); `refund.override` added to `SENSITIVE_ACTIONS` once (Task 6) and excluded in all three non-owner seeds.
