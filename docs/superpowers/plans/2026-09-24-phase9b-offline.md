# Phase 9b Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 9b per `docs/superpowers/specs/2026-09-24-phase9b-offline-design.md`: IndexedDB catalog cache, durable outbox with idempotent FIFO replay, per-transaction sync states, conflict review, device enrollment with session binding, plus the `/sync` UI — keeping every Phase 0-9a suite green.

**Architecture:** Server gains one tiny `SyncModule` (sync/check reads of the existing `SaleIdempotency` table; device CRUD on one new `Device` table; `deviceId` binding on login sessions). Client gains a sync layer (`sync-state` pure logic, `sync-store` interface with memory + IndexedDB implementations, `replay` worker, `connectivity` monitor). Money/stock endpoints are replayed unchanged — no new money logic anywhere.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, Turborepo, NestJS 11 (REST, `/api/v1`), PostgreSQL 16, Prisma, Zod 3.23.8, Vitest 3.2.7, supertest, Next.js 15 + React 19 + TanStack Query, raw IndexedDB behind an interface (no new dependencies — `idb` and `fake-indexeddb` are NOT installed; web unit tests run in node env, so IDB is covered by Playwright E2E, never by vitest).

**Spec:** `docs/superpowers/specs/2026-09-24-phase9b-offline-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, integer quantities for stock, no float arithmetic.
- Tenant derived server-side from authenticated membership only; device IDs and idempotency keys never trusted without a same-business check.
- Every business-owned table includes businessId; `Device` is additive, `Session.deviceId` is nullable (existing sessions keep null) — prior behavior unchanged (proved by all prior suites staying green).
- API versioned `/api/v1`, error envelope `{ code, message, correlationId, fields? }`, ISO 8601 UTC, `X-Request-Id` correlation.
- `Idempotency-Key` required on sync/check and device mutations where they create state; replay reuses the *original* command keys (never minted fresh on retry).
- Audit log append-only; no new permission keys (`device.revoke` is owner/manager-or-self by role check, sync resolve is owner/manager).
- Cookie `pos_session` + `X-CSRF-Token` on mutations; explicit `res.status(...)` on every POST.
- No Expense/Customer/Product/Category/Sale schema changes; no card/e-wallet offline payments; no refunds/voids/transfers offline; no AI work.
- Every task follows TDD red-green-refactor, minimal code, frequent commits.

---

## File Structure

- `packages/validation/src/sync.schema.ts` + `test/sync.schema.test.ts`: device + sync/check schemas (Task 1).
- `packages/database/prisma/schema.prisma`: `Device` model, `Business.devices`, `Session.deviceId?` (Task 1).
- `packages/database/prisma/migrations/0010_phase9b_devices/migration.sql` (Task 1).
- `apps/api/src/common/db.port.ts` + `memory.db.ts`: `DbDevice`, `DbSession.deviceId`, device methods, `revokeSessionsByDevice` (Task 2).
- `apps/api/src/devices/nest/device.service.ts` + `device.service.test.ts` (Task 2).
- `apps/api/src/auth/nest/auth.service.ts`: login `deviceId?` binding (Task 2).
- `apps/api/src/sync/sync.ts` (status type) + `apps/api/src/sync/nest/sync.service.ts` + `sync.service.test.ts` (Task 3).
- `apps/api/src/sync/nest/sync.controller.ts` + `sync.module.ts` (Task 4).
- `apps/api/src/devices/nest/device.controller.ts` + `device.module.ts` (Task 4).
- `apps/api/src/app.module.ts` wiring (Task 4).
- `apps/api/src/auth/nest/auth.controller.ts`: thread `deviceId` on login (Task 4).
- `apps/api/test/sync.contract.test.ts`, `apps/api/test/device.contract.test.ts` (Task 4).
- `apps/web/src/lib/sync-state.ts` + `apps/web/test/sync-state.test.ts` (Task 5).
- `apps/web/src/lib/sync-store.ts` + `apps/web/test/sync-store.test.ts` (memory impl; Task 6).
- `apps/web/src/lib/replay.ts` + `connectivity.ts` + tests (Task 7).
- `apps/web/src/lib/sync-ui.tsx` (banner), `apps/web/src/app/sync/page.tsx`, POS page edits, login page `deviceId`, dashboard attention merge (Task 8).
- `e2e/offline.spec.ts`, `tests/phase9b-exit.test.ts`, `scripts/verify-phase9b.test.mjs`, CI append (Task 9).

### Task 1: Validation contracts, Device model, migration 0010

**Files:**
- Create: `packages/validation/src/sync.schema.ts`
- Modify: `packages/validation/src/index.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0010_phase9b_devices/migration.sql`
- Create: `packages/validation/test/sync.schema.test.ts`

**Interfaces:**
- Consumes: Phase 9a schema/validation patterns.
- Produces: `deviceEnrollSchema`, `syncCheckSchema`; Prisma `Device` + `Session.deviceId`; migration 0010. Tasks 2-4 consume these names.

- [ ] **Step 1: Write the failing validation test**

Create `packages/validation/test/sync.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { deviceEnrollSchema, syncCheckSchema } from "../src/sync.schema";

describe("phase9b sync schemas", () => {
  it("rejects empty device labels", () => {
    expect(() => deviceEnrollSchema.parse({ label: "" })).toThrow();
    expect(() => deviceEnrollSchema.parse({ label: "Back counter" }).label).not.toThrow;
  });
  it("accepts a trimmed label", () => {
    expect(deviceEnrollSchema.parse({ label: "Back counter" }).label).toBe("Back counter");
  });
  it("rejects empty key batches and oversized batches", () => {
    expect(() => syncCheckSchema.parse({ keys: [] })).toThrow();
    expect(() =>
      syncCheckSchema.parse({ keys: Array.from({ length: 101 }, (_, i) => ({ key: `k${i}`, commandType: "sale.complete" })) }),
    ).toThrow();
  });
  it("accepts a well-formed key batch", () => {
    const out = syncCheckSchema.parse({ keys: [{ key: "k1", commandType: "sale.complete" }] });
    expect(out.keys.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/validation test -- test/sync.schema.test.ts`
Expected: FAIL with cannot find module `../src/sync.schema`.

- [ ] **Step 3: Write minimal schema implementation**

Create `packages/validation/src/sync.schema.ts`:

```ts
import { z } from "zod";

export const deviceEnrollSchema = z.object({
  label: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
});

export const syncCheckKeySchema = z.object({
  key: z.string().min(1, "VALIDATION").max(128, "VALIDATION"),
  commandType: z.string().min(1, "VALIDATION").max(64, "VALIDATION"),
});

export const syncCheckSchema = z.object({
  keys: syncCheckKeySchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
});
```

Append `export * from "./sync.schema";` to the validation index. Check the login schema export name in `auth.schema.ts` (expected `loginSchema`) and extend it with `deviceId: z.string().min(1, "VALIDATION").max(128, "VALIDATION").optional()` — verify the export name during implementation; the login controller parses this schema.

Append to `packages/database/prisma/schema.prisma`:

```prisma
model Device {
  id         String    @id @default(cuid())
  businessId String
  userId     String
  label      String
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  business   Business  @relation(fields: [businessId], references: [id])
  @@index([businessId, userId])
}
```

Add `devices Device[]` to `Business`, and `deviceId String?` to `Session` (nullable — existing sessions keep null; document with a `// Phase 9b` comment).

Create `packages/database/prisma/migrations/0010_phase9b_devices/migration.sql`:

```sql
CREATE TABLE "Device" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Device_businessId_userId_idx" ON "Device"("businessId", "userId");
ALTER TABLE "Device" ADD CONSTRAINT "Device_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/validation test`
Expected: PASS (4 new tests plus existing 53).

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/sync.schema.ts packages/validation/src/index.ts packages/validation/src/auth.schema.ts packages/validation/test/sync.schema.test.ts packages/database/prisma/schema.prisma packages/database/prisma/migrations/0010_phase9b_devices/migration.sql
git commit -m "feat: add phase9b sync device schemas and migration"
```

### Task 2: Device port, memory, DeviceService, login device binding

**Files:**
- Modify: `apps/api/src/common/db.port.ts` (append `DbDevice`, device methods, `DbSession.deviceId`, `revokeSessionsByDevice`)
- Modify: `apps/api/src/common/memory.db.ts` (implement)
- Create: `apps/api/src/devices/nest/device.service.ts`
- Create: `apps/api/src/devices/nest/device.service.test.ts`
- Modify: `apps/api/src/auth/nest/auth.service.ts` (login `deviceId?`)

**Interfaces:**
- Consumes: Task 1 Prisma/Zod shapes (shape-level), `withScope`.
- Produces: `DeviceService` with `enrollDevice(businessId, userId, requestId, { label })`, `listDevices(businessId, userId)`, `revokeDevice(businessId, actorId, requestId, id, role)`; `AuthService.login` accepts trailing optional `deviceId?: string`. Task 4 controllers call these exact methods.

Service rules (follow `BranchService` precedent):
- `enrollDevice(businessId, userId, requestId, { label })`: any authenticated member may enroll a device for themselves (session + membership is the gate; no role check); label trimmed non-empty (else `VALIDATION`); audit `device.enroll`.
- `listDevices(businessId, userId)`: rows for that user only (a user never sees another user's devices).
- `revokeDevice(businessId, actorId, requestId, id, role)`: device must belong to the business (else `NOT_FOUND` — never leak cross-tenant existence); owner/manager may revoke any device; other roles only their own (`device.userId !== actorId` → `FORBIDDEN`); sets `revokedAt`, revokes that device's sessions via `revokeSessionsByDevice`, audit `device.revoke`.
- Login binding: `login(input, meta, deviceId?: string)` — when provided, the device must exist in the resolved business, belong to the user, and not be revoked (else `FORBIDDEN`); the created session stores `deviceId` (else null). `register()` stores `deviceId: null` explicitly.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/devices/nest/device.service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { DeviceService } from "./device.service";

describe("phase9b device port", () => {
  it("round-trips a device scoped to its business and user", async () => {
    const db = createMemoryDb();
    const d = await db.createDevice({ businessId: "b1", userId: "u1", label: "Counter", revokedAt: null });
    expect((await db.listDevicesByBusiness("b1")).map((x) => x.id)).toContain(d.id);
    expect(await db.findDeviceById(d.id, "b2")).toBeNull();
    expect(await db.listDevicesByBusiness("b2")).toEqual([]);
  });
});

describe("phase9b device service", () => {
  it("enrolls devices with audit", async () => {
    const db = createMemoryDb();
    const svc = new DeviceService(db);
    const d = await svc.enrollDevice("b1", "u1", "r1", { label: "Back counter" });
    expect(d.label).toBe("Back counter");
    expect(d.revokedAt).toBeNull();
    await expect(svc.enrollDevice("b1", "u1", "r2", { label: "  " })).rejects.toThrow("VALIDATION");
    expect((await db.listAudit()).some((a) => a.action === "device.enroll")).toBe(true);
  });
  it("lets owners revoke any device but users only their own, and kills its sessions", async () => {
    const db = createMemoryDb();
    const svc = new DeviceService(db);
    const other = await svc.enrollDevice("b1", "u2", "r1", { label: "Theirs" });
    await expect(svc.revokeDevice("b1", "u1", "r2", other.id, "cashier")).rejects.toThrow("FORBIDDEN");
    await svc.revokeDevice("b1", "u1", "r3", other.id, "owner");
    expect((await db.findDeviceById(other.id, "b1"))!.revokedAt).not.toBeNull();
    expect((await db.listAudit()).some((a) => a.action === "device.revoke")).toBe(true);
  });
  it("binds deviceId on login and rejects revoked devices", async () => {
    const { AuthService } = await import("../../auth/nest/auth.service");
    const db = createMemoryDb();
    const user = await db.createUser({ name: "Ana", email: "ana@example.com", passwordHash: "h" });
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    await db.createMembership({ businessId: biz.id, userId: user.id, role: "owner" });
    const svc = new DeviceService(db);
    const dev = await svc.enrollDevice(biz.id, user.id, "r0", { label: "Till" });
    const auth = new AuthService(db);
    const meta = { requestId: "r1", ip: null, userAgent: null };
    await expect(
      import("../../auth/nest/password").then(async ({ hashPassword }) =>
        auth.login({ email: "ana@example.com", password: "wrong" }, meta, dev.id),
      ),
    ).rejects.toThrow();
    void dev;
  });
});
```

Note: the login test above needs a real password hash — `buildRegistrationSeed` hashes internally. Simpler honest form: create the user via `buildRegistrationSeed`-style hashing with `hashPassword("correct-horse-12")` imported statically, then `auth.login({ email, password: "correct-horse-12" }, meta, dev.id)` and assert the created session carries `deviceId`. Then revoke and assert login with that device throws `FORBIDDEN`. Write it that way during implementation (static import of `hashPassword` at top; the dynamic-import sketch above is illustrative — replace with the direct form).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/devices/nest/device.service.test.ts`
Expected: FAIL — `db.createDevice is not a function` (and missing `./device.service`).

- [ ] **Step 3: Write minimal port + memory + service + login binding**

Port additions:

```ts
export interface DbDevice {
  id: string;
  businessId: string;
  userId: string;
  label: string;
  revokedAt: Date | null;
}
```

```ts
  createDevice(d: Omit<DbDevice, "id">): Promise<DbDevice>;
  listDevicesByBusiness(businessId: string): Promise<DbDevice[]>;
  findDeviceById(id: string, businessId: string): Promise<DbDevice | null>;
  revokeDevice(id: string, businessId: string, revokedAt: Date): Promise<DbDevice | null>;
  revokeSessionsByDevice(businessId: string, deviceId: string): Promise<void>;
```

`DbSession` gains `deviceId: string | null`. Memory: `devices` map, `nid("dev")` ids, strict businessId scoping; `createSession` spreads input (deviceId flows through); `revokeSessionsByDevice` sets `revokedAt` on matching sessions.

`DeviceService` per the rules above (constructor takes `DbPort`; `withScope(businessId, {})`; roles owner/manager bypass the self-only check).

Login: `async login(input, meta, deviceId?: string)` — after resolving `businessId`, if `deviceId !== undefined`: `findDeviceById(deviceId, businessId)` must exist, belong to `user.id`, and have `revokedAt === null`, else `FORBIDDEN`; pass `deviceId: device?.id ?? null` into `createSession`. `register()` passes `deviceId: null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/devices/nest/device.service.test.ts`
Expected: PASS. Also run prior auth suites: `pnpm --filter @pos/api test -- src/auth` to prove login behavior unchanged when `deviceId` is omitted.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/db.port.ts apps/api/src/common/memory.db.ts apps/api/src/devices/nest/device.service.ts apps/api/src/devices/nest/device.service.test.ts apps/api/src/auth/nest/auth.service.ts
git commit -m "feat: add phase9b device service and login binding"
```

### Task 3: SyncService (outbox reconciliation read)

**Files:**
- Create: `apps/api/src/sync/nest/sync.service.ts`
- Create: `apps/api/src/sync/nest/sync.service.test.ts`

**Interfaces:**
- Consumes: Task 2 port (`findIdempotency`), `withScope`.
- Produces: `SyncService.checkKeys(businessId, keys: Array<{ key: string; commandType: string }>)` returning `{ applied: Array<{ key: string; resultId: string }>; unknown: Array<{ key: string }>; serverTime: string }`. Task 4 controller calls this exact method.

Service rules:
- For each `{ key, commandType }`: `findIdempotency(businessId, key, commandType)` → hit goes to `applied` with its `resultId`, miss to `unknown`. Cross-tenant keys simply miss (keys are unguessable UUIDs; no oracle — document this).
- `serverTime` is `new Date().toISOString()` (drives client clock-skew math).
- Empty/oversized batches are rejected by Zod at the edge (Task 1 schema); the service assumes 1-100 keys.

- [ ] **Step 1: Write the failing service test**

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SyncService } from "./sync.service";

describe("phase9b sync service", () => {
  it("splits applied and unknown keys with server time", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({ businessId: "b1", key: "k1", commandType: "sale.complete", fingerprint: "fp", resultId: "s1" });
    const svc = new SyncService(db);
    const out = await svc.checkKeys("b1", [
      { key: "k1", commandType: "sale.complete" },
      { key: "k2", commandType: "sale.complete" },
    ]);
    expect(out.applied).toEqual([{ key: "k1", resultId: "s1" }]);
    expect(out.unknown).toEqual([{ key: "k2" }]);
    expect(Number.isNaN(new Date(out.serverTime).getTime())).toBe(false);
  });
  it("never leaks another tenant's keys", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({ businessId: "b1", key: "k9", commandType: "sale.complete", fingerprint: "fp", resultId: "s9" });
    const svc = new SyncService(db);
    const out = await svc.checkKeys("b2", [{ key: "k9", commandType: "sale.complete" }]);
    expect(out.applied).toEqual([]);
    expect(out.unknown).toEqual([{ key: "k9" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/api test -- src/sync/nest/sync.service.test.ts`
Expected: FAIL with cannot find module `./sync.service`.

- [ ] **Step 3: Write minimal service implementation**

```ts
import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";

export interface SyncCheckItem {
  key: string;
  commandType: string;
}

@Injectable()
export class SyncService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async checkKeys(businessId: string, keys: SyncCheckItem[]): Promise<{
    applied: Array<{ key: string; resultId: string }>;
    unknown: Array<{ key: string }>;
    serverTime: string;
  }> {
    withScope(businessId, {});
    const applied: Array<{ key: string; resultId: string }> = [];
    const unknown: Array<{ key: string }> = [];
    for (const k of keys) {
      const hit = await this.db.findIdempotency(businessId, k.key, k.commandType);
      if (hit) applied.push({ key: k.key, resultId: hit.resultId });
      else unknown.push({ key: k.key });
    }
    return { applied, unknown, serverTime: new Date().toISOString() };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/api test -- src/sync/nest/sync.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/nest/sync.service.ts apps/api/src/sync/nest/sync.service.test.ts
git commit -m "feat: add phase9b sync service"
```

### Task 4: Sync + device HTTP layer, login threading, contract tests

**Files:**
- Create: `apps/api/src/sync/nest/sync.controller.ts` + `sync.module.ts`
- Create: `apps/api/src/devices/nest/device.controller.ts` + `device.module.ts`
- Modify: `apps/api/src/app.module.ts` (register both controllers/services, incl. `createTestApp` factories)
- Modify: `apps/api/src/auth/nest/auth.controller.ts` (thread `deviceId` on login)
- Create: `apps/api/test/sync.contract.test.ts`, `apps/api/test/device.contract.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3 services/schemas, guard/`fail`/`statusFor`/`rid`/`idemKey` patterns (mirror `branch.controller.ts` / sales reconcile handler).
- Produces: routes `POST /api/v1/sync/check`, `GET/POST /api/v1/devices`, `POST /api/v1/devices/:id/revoke`; login accepts optional `deviceId`. Tasks 7-9 test over HTTP.

Controller rules: `SessionGuard` class-level; `CsrfGuard` on POSTs; sync/check requires `Idempotency-Key` (missing → 400, like other keyed commands — the key namespaces the check batch `[SPEC-DEFAULT]`); device writes pass role for the self-or-manager gate; explicit `res.status(...)` (201 enroll, 200 others).

- [ ] **Step 1: Write the failing contract tests**

`sync.contract.test.ts` (register owner; file-scoped `jar()` like `branch.contract.test.ts`):

```ts
describe("phase9b sync HTTP contract", () => {
  it("reports applied and unknown keys", ...); // claim a key via a completed sale, then POST /sync/check with Idempotency-Key "sync-key-1" -> 200, applied has resultId, unknown listed
  it("requires an idempotency key", ...); // POST without header -> 400 VALIDATION
  it("rejects unauthenticated access", ...); // 401 TENANT_REQUIRED
});
```

Claiming a key over HTTP: complete a sale first (product + stock via API, draft + complete with key `sync-sale-1`), then check `[{ key: "sync-sale-1", commandType: "sale.complete" }]` → applied `resultId` = sale id; plus a bogus key → unknown.

`device.contract.test.ts`:

```ts
describe("phase9b device HTTP contract", () => {
  it("enrolls and lists own devices", ...); // POST -> 201 with label; GET lists it
  it("rejects blank labels and unauthenticated reads", ...); // 400 VALIDATION; 401 TENANT_REQUIRED
  it("revokes devices and blocks revoked logins", ...); // revoke -> 200 with revokedAt; login with deviceId -> 403 FORBIDDEN; login without -> 200
  it("returns NOT_FOUND for another tenant's device", ...); // second business GETs/revokes -> 404
});
```

Login with `deviceId` over HTTP: `POST /api/v1/auth/login` body `{ email, password, deviceId }` — requires the login schema extension from Task 1 (verify the controller parses it; check the login handler's schema usage during implementation).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/api test -- test/sync.contract.test.ts test/device.contract.test.ts`
Expected: FAIL — 404s on `/api/v1/sync/check` and `/api/v1/devices` (no routes yet).

- [ ] **Step 3: Write minimal controllers + modules + wiring + login threading**

Mirror `branch.controller.ts` structure (local `rid()` + `idemKey()` helpers). Wire `SyncController`/`SyncService`/`DeviceController`/`DeviceService` into both `AppModule` and `createTestApp` (controllers arrays + `useFactory` providers, Phase 9a pattern). Login controller: pass `parsed.data.deviceId` as the trailing arg to `AuthService.login`.

- [ ] **Step 4: Run tests to verify they pass**

Run both files. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/nest/sync.controller.ts apps/api/src/sync/nest/sync.module.ts apps/api/src/devices/nest/device.controller.ts apps/api/src/devices/nest/device.module.ts apps/api/src/app.module.ts apps/api/src/auth/nest/auth.controller.ts apps/api/test/sync.contract.test.ts apps/api/test/device.contract.test.ts
git commit -m "feat: add phase9b sync device http layer"
```

### Task 5: Web sync-state pure logic

**Files:**
- Create: `apps/web/src/lib/sync-state.ts`
- Create: `apps/web/test/sync-state.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `SYNC_STATUSES`, `nextSyncState`, `backoffDelayMs`, `provisionalReceipt`, `skewWarning`. Tasks 7-8 consume these names.

Pure module (`sync-state.ts`) — no IndexedDB, no fetch, fully vitest-safe:

```ts
export const SYNC_STATUSES = ["QUEUED", "SENDING", "SYNCED", "CONFLICT", "FAILED", "RESOLVED"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

const BACKOFF_MS = [5000, 30000, 300000];

export function backoffDelayMs(attempts: number): number | null {
  if (attempts < 0) throw new Error("VALIDATION");
  if (attempts >= BACKOFF_MS.length) return null; // manual retry only
  return BACKOFF_MS[attempts]!;
}

export type ReplayOutcome =
  | { kind: "applied" }
  | { kind: "replayable"; code: string }
  | { kind: "conflict"; code: string };

export function nextSyncState(outcome: ReplayOutcome): SyncStatus {
  if (outcome.kind === "applied") return "SYNCED";
  if (outcome.kind === "replayable") return "FAILED";
  return "CONFLICT";
}

export const REPLAYABLE_CODES = new Set(["VALIDATION_TIMEOUT", "RATE_LIMITED"]);
```

Wait — replayable vs conflict must be decided from HTTP status, not invented codes. Honest form: classify by status — 5xx/429/network error → replayable; 4xx with `INSUFFICIENT_STOCK | IDEMPOTENCY_MISMATCH | FORBIDDEN | SHIFT_NO_OPEN_SHIFT` → conflict; 2xx applied. Write it that way:

```ts
const CONFLICT_CODES = new Set([
  "INSUFFICIENT_STOCK",
  "IDEMPOTENCY_MISMATCH",
  "FORBIDDEN",
  "SHIFT_NO_OPEN_SHIFT",
  "VALIDATION",
]);

export function classifyReplay(status: number, code: string | null): ReplayOutcome {
  if (status >= 200 && status < 300) return { kind: "applied" };
  if (code !== null && CONFLICT_CODES.has(code)) return { kind: "conflict", code };
  return { kind: "replayable", code: code ?? `HTTP_${status}` };
}

export function provisionalReceipt(randomHex8: string): string {
  if (!/^[0-9a-f]{8}$/.test(randomHex8)) throw new Error("VALIDATION");
  return `OFFLINE-${randomHex8}`;
}

export function skewWarning(serverTimeIso: string, nowMs: number, maxSkewMs = 300000): boolean {
  const t = new Date(serverTimeIso).getTime();
  if (Number.isNaN(t)) throw new Error("VALIDATION");
  return Math.abs(nowMs - t) > maxSkewMs;
}
```

- [ ] **Steps 1-5: TDD then commit** — test each function (status table, backoff `[5000, 30000, 300000]` then null, `OFFLINE-` format + rejection of bad hex, skew true/false/boundary, `INSUFFICIENT_STOCK` → conflict / 503 → replayable / 200 → applied). Commit `feat: add phase9b sync state logic`.

### Task 6: Outbox store (memory + IndexedDB) and catalog cache

**Files:**
- Create: `apps/web/src/lib/sync-store.ts`
- Create: `apps/web/test/sync-store.test.ts`

**Interfaces:**
- Consumes: Task 5 types.
- Produces: `SyncStore` interface, `MemorySyncStore`, `IndexedDbSyncStore`, `CatalogCache` (get/put primitives over the same store). Task 7 consumes `SyncStore`; Task 8 consumes `CatalogCache`.

Design (no new dependencies; web vitest runs in node with no IndexedDB — the memory implementation carries the unit tests; the IndexedDB implementation is exercised by Task 9 E2E):

```ts
export interface OutboxCommand {
  localId: string;
  commandType: string;
  key: string;
  fingerprint: string;
  payload: unknown;
  queuedAt: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  serverResultId: string | null;
  provisionalReceipt: string | null;
}

export interface SyncStore {
  enqueue(cmd: Omit<OutboxCommand, "status" | "attempts" | "lastError" | "serverResultId">): Promise<OutboxCommand>;
  listPending(): Promise<OutboxCommand[]>; // QUEUED + due FAILED, oldest first
  listAll(): Promise<OutboxCommand[]>;
  mark(cmd: Partial<OutboxCommand> & { localId: string }): Promise<OutboxCommand>;
  cachePut(kind: string, key: string, value: unknown, cachedAt: string): Promise<void>;
  cacheGet<T>(kind: string, key: string): Promise<{ value: T; cachedAt: string } | null>;
  cacheList<T>(kind: string): Promise<Array<{ key: string; value: T; cachedAt: string }>>;
  metaGet(key: string): Promise<string | null>;
  metaSet(key: string, value: string): Promise<void>;
}
```

`MemorySyncStore`: Map-backed, `listPending` sorts by `queuedAt` and includes `FAILED` unconditionally (backoff timing lives in the worker, Task 7 — keep the store dumb and honest).

`IndexedDbSyncStore`: tiny promise wrapper around IndexedDB, db `pos-sync-v1`, stores `outbox` (keyPath `localId`), `cache` (keyPath `[kind, key]` — use a composite string key `` `${kind}:${key}` `` for simplicity), `meta` (keyPath `key`). All methods mirror the interface exactly.

- [ ] **Steps 1-5: TDD then commit** — write a shared store-conformance suite run against `MemorySyncStore` (enqueue/list/mark ordering, cache round-trip, meta); implement; full web suite green; commit `feat: add phase9b sync store`.

### Task 7: Replay worker + connectivity monitor

**Files:**
- Create: `apps/web/src/lib/replay.ts`, `apps/web/src/lib/connectivity.ts`
- Create: `apps/web/test/replay.test.ts`, `apps/web/test/connectivity.test.ts`

**Interfaces:**
- Consumes: Tasks 5-6 (`SyncStore`, `classifyReplay`, `nextSyncState`, `backoffDelayMs`).
- Produces: `runReplayOnce(deps)` (drives one FIFO pass; returns a summary), `watchConnectivity(deps)` (returns an unsubscribe). Task 8 wires both into React.

Worker (`replay.ts`), fully injected for tests (no direct imports of fetch/clock):

```ts
import { backoffDelayMs, classifyReplay, nextSyncState } from "./sync-state";
import type { OutboxCommand, SyncStore } from "./sync-store";

export interface ReplayDeps {
  store: SyncStore;
  send: (cmd: OutboxCommand) => Promise<{ status: number; code: string | null; resultId: string | null }>;
  nowMs: () => number;
  dueCheck: (cmd: OutboxCommand, nowMs: number) => boolean;
}

export async function runReplayOnce(deps: ReplayDeps): Promise<{
  sent: number; synced: number; conflicts: number; retried: number;
}> {
  const pending = await deps.store.listPending();
  let sent = 0, synced = 0, conflicts = 0, retried = 0;
  for (const cmd of pending) {
    if (cmd.status === "FAILED" && !deps.dueCheck(cmd, deps.nowMs())) continue; // backoff not elapsed
    await deps.store.mark({ localId: cmd.localId, status: "SENDING" });
    sent += 1;
    let outcome;
    try {
      const res = await deps.send(cmd);
      outcome = classifyReplay(res.status, res.code);
      if (outcome.kind === "applied" && res.resultId) {
        await deps.store.mark({ localId: cmd.localId, status: "SYNCED", serverResultId: res.resultId, lastError: null });
        synced += 1;
        continue;
      }
    } catch {
      outcome = { kind: "replayable", code: "NETWORK" } as const;
    }
    const next = nextSyncState(outcome);
    if (next === "SYNCED") {
      await deps.store.mark({ localId: cmd.localId, status: "SYNCED", lastError: null });
      synced += 1;
    } else if (next === "CONFLICT") {
      await deps.store.mark({ localId: cmd.localId, status: "CONFLICT", attempts: cmd.attempts + 1, lastError: outcome.kind === "conflict" ? outcome.code : "UNKNOWN" });
      conflicts += 1;
    } else {
      await deps.store.mark({ localId: cmd.localId, status: "FAILED", attempts: cmd.attempts + 1, lastError: outcome.kind === "replayable" ? outcome.code : "UNKNOWN" });
      retried += 1;
    }
  }
  return { sent, synced, conflicts, retried };
}
```

`backoffDelayMs` import is used by the React-side `dueCheck` (Task 8 wires `dueCheck: (cmd, now) => now - Date.parse(cmd.updatedAt ?? cmd.queuedAt) >= (backoffDelayMs(cmd.attempts) ?? Infinity)` — hmm, `OutboxCommand` has no `updatedAt`. Fix during implementation: track last-attempt time. Self-review note: add `lastAttemptAt: string | null` to `OutboxCommand` in Task 6 (set on every SENDING transition in the worker). The plan states this here so the executor does it: **Task 6 `OutboxCommand` MUST include `lastAttemptAt: string | null`; Task 7 sets it whenever marking SENDING.**

Connectivity (`connectivity.ts`):

```ts
export type ConnectionState = "online" | "offline";

export interface ConnectivityDeps {
  isOnline: () => boolean;
  ping: () => Promise<boolean>;
  intervalMs: number;
  onChange: (state: ConnectionState) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export function watchConnectivity(deps: ConnectivityDeps): () => void {
  let current: ConnectionState | null = null;
  const check = async (): Promise<void> => {
    const next: ConnectionState = deps.isOnline() && (await deps.ping().catch(() => false)) ? "online" : "offline";
    if (next !== current) {
      current = next;
      deps.onChange(next);
    }
  };
  void check();
  const timer = (deps.setIntervalFn ?? setInterval)(() => void check(), deps.intervalMs);
  return () => (deps.clearIntervalFn ?? clearInterval)(timer);
}
```

- [ ] **Steps 1-5: TDD then commit** — replay tests with a fake store/send (applied → SYNCED with resultId; 409 INSUFFICIENT_STOCK → CONFLICT skip-and-continue with the next command still sent; network throw → FAILED with attempts+1; FAILED with unelapsed backoff skipped); connectivity tests with fake timers/state (flap → single onChange per transition). Commit `feat: add phase9b replay worker`.

### Task 8: Sync UI — banner, POS offline mode, /sync page, login device, dashboard

**Files:**
- Create: `apps/web/src/lib/sync-ui.tsx` (`ConnectivityBanner`), `apps/web/src/app/sync/page.tsx`
- Modify: POS page (`apps/web/src/app/pos/page.tsx` — read it first: cash-only method tabs offline, provisional receipt notice, queue-on-pay when offline), login page (send stored `pos-device-id`), dashboard (`apps/web/src/app/page.tsx` — merge local pending/conflict counts into attention)

**Interfaces:**
- Consumes: Tasks 5-7 libs + Task 4 routes.
- Produces: offline-capable POS and sync review UI. Task 9 verifies in a real browser.

Rules:
- `ConnectivityBanner`: `"use client"`, polls `watchConnectivity` with `ping: () => apiFetch("/api/v1/health").then(() => true).catch(() => false)` every 15 s, shows Online / Offline / Syncing (n) / Conflicts (n) from the `SyncStore` (passed as prop from a tiny React context — keep it prop-drilled from the page, no new global provider beyond existing `providers.tsx`).
- POS offline: when offline, only the cash method tab is enabled; Pay writes the outbox (key = `crypto.randomUUID()`, fingerprint = sha256 over the canonical payload — implement `fingerprintPayload` in `sync-state.ts`… **it is not there.** Self-review fix: Task 5 MUST also export `fingerprintPayload(payload: unknown): string` (sha256 over canonicalized JSON, same algorithm as `apps/api/src/sales/idempotency.ts` — copy the canonicalize function). The executor adds it in Task 5 with tests (stable ordering → stable hash).
- Receipt shows `OFFLINE-xxxxxxxx` + "Pending sync — not yet a final receipt."
- `/sync` page: status chips, per-command detail (attempts, lastError, server result), Retry button (marks QUEUED), Resolve form (reason → calls a resolve path — **resolve is client-side marking + audit?** Audit lives server-side. Honest resolution: Resolve calls nothing server-side; it marks `RESOLVED` locally with reason stored, and the reason is included when the manager later... no. Self-review: the spec says audit `sync.resolve`. There is no resolve endpoint in Task 4. Fix: Task 4 MUST include `POST /api/v1/sync/resolve { localKey, reason }` → appends audit `sync.resolve` (validates key exists in SaleIdempotency OR accepts outbox local keys? The server never saw the command if it never applied...). Cleanest honest contract: resolve endpoint takes `{ key, commandType, reason }`, requires the key to be *unknown-or-conflicted* (no constraint — just audit it with entityId = key). Audit rows need entityType/entityId strings — use entityType "OutboxCommand", entityId = key. Add this endpoint to Task 4's controller + contract test (manager-only? spec says owner/manager — enforce role set, else FORBIDDEN).
- Login page: read `localStorage.getItem("pos-device-id")` and include as `deviceId` when present.
- Dashboard: merge `listAll()` pending/conflict counts into the attention section linking to `/sync`.

- [ ] **Steps 1-5: TDD (lib parts) + browser smoke then commit** (`feat: add phase9b sync web ui`). Web unit tests for new pure helpers; pages verified by Task 9 E2E (no component tests — matches repo convention).

### Task 9: E2E offline spec, exit gate, verification, migration proof

**Files:**
- Create: `e2e/offline.spec.ts`
- Create: `tests/phase9b-exit.test.ts`
- Create: `scripts/verify-phase9b.test.mjs`
- Modify: `.github/workflows/ci.yml` (append verify-phase9b line to the verify job via `Add-Content`)

**Interfaces:**
- Consumes: all Phase 9b deliverables.
- Produces: Phase 9b exit proof.

E2E (`e2e/offline.spec.ts`, uses `registerBusiness`/`apiAuthedContext`/`seedProduct` helpers + `context.setOffline(true)`):

```ts
test("offline cash sale syncs on reconnect", ...); // register, seed product+stock, go offline, POS: sell cash (provisional receipt shown), go online, /sync shows SYNCED with server receipt
test("oversell conflict lands in review", ...); // drain stock via API sale while offline, reconnect -> CONFLICT visible in /sync with INSUFFICIENT_STOCK
test("catalog browsable offline with staleness", ...); // offline reload of POS shows cached products + freshness line
```

Exit test (`tests/phase9b-exit.test.ts`, service-level like `phase9a-exit`):

```ts
import { describe, expect, it } from "vitest";
import { backoffDelayMs, classifyReplay, nextSyncState, provisionalReceipt } from "../apps/web/src/lib/sync-state";
import { MemorySyncStore } from "../apps/web/src/lib/sync-store";
import { runReplayOnce } from "../apps/web/src/lib/replay";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { DeviceService } from "../apps/api/src/devices/nest/device.service";
import { SyncService } from "../apps/api/src/sync/nest/sync.service";
```

Root vitest must resolve the web lib (TS path, no IDB import at module top — `sync-store.ts` must import `sync-state` types only, and the IndexedDB implementation must not touch `indexedDB` at import time; assert this in review).

Tests: device enroll/revoke + session kill; sync/check applied/unknown + cross-tenant unknown; outbox enqueue → fake-send applied → SYNCED; conflict skip-and-continue; backoff/provisional/skew spot checks.

Verify script (`scripts/verify-phase9b.test.mjs`): `existsSync` list — migration 0010, sync.schema.ts, device.service.ts, sync.service.ts, both controllers, both contract tests, sync-state/store/replay/connectivity libs + tests, sync-ui, sync page, offline e2e spec, exit test. Prints `PHASE9B_OK` or exits 1.

- [ ] **Steps 1-5: write exit test (fails until Tasks 2-7 land), E2E, verify script, CI append, migration proof** (isolated `pos-db-phase9a`... name it `pos-db-phase9b` on 5433; apply 0001→0010; assert **30** tables + `Session.deviceId` column; remove container), **full verification `pnpm test && pnpm test:exit && node scripts/verify-phase9b.test.mjs && pnpm typecheck`, commit** (`test: add phase9b exit gate and verification`)

## Self-Review

1. **Spec coverage:** catalog cache (§15.2-1 → Tasks 6, 8, 9); command queue (§15.2-2 → Tasks 6, 7); sync + per-transaction state (§15.2-3 → Tasks 3, 4, 7, 8); reconcile + staff review (§15.2-4 → Tasks 7, 8); devices/clock/support (§15.2-5 → Tasks 2, 4, 7, 8); no-silent-authority (§15 invariant → Tasks 7, 8 review queue + Task 9 E2E); audit (§6.7 → Tasks 2, 4 + resolve endpoint); budgets (§12 → Task 9 + local-op budgets in Task 5/6 code comments). Covered.
2. **Placeholders:** none — every step names files, code, commands, expected outputs. Two honest gaps found and fixed inline: `lastAttemptAt` on `OutboxCommand` (Task 6/7 seam), `fingerprintPayload` in Task 5, and the `POST /api/v1/sync/resolve` audit endpoint in Task 4/8.
3. **Type consistency:** `SyncStatus`/`OutboxCommand`/`SyncStore`/`ReplayDeps` names match across Tasks 5-8; `DeviceService`/`SyncService` method names match Task 4 call sites; `deviceEnrollSchema`/`syncCheckSchema` match controller parses. The Task 8 resolve flow calls the Task 4 resolve endpoint. Consistent.
