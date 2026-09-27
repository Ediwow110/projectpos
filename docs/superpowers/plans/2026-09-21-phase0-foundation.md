# Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 0 foundation (PLAN.md 17): monorepo, tenant context, auth session model, RBAC policy, API conventions, money rules, audit shape, logging, test harness, migrations, env, so a tenant-scoped authenticated read passes and cross-tenant access fails safely.

**Architecture:** pnpm plus Turborepo modular monolith per PLAN.md 5.1. Next.js web calls NestJS REST at /api/v1 backed by PostgreSQL via Prisma. Explicit module boundaries with private internals. No Redis, workers, storage, or offline in Phase 0.

**Tech Stack:** TypeScript strict end-to-end, Node 24, pnpm 9.15.9, Turborepo, Next.js plus React plus Tailwind, NestJS REST, PostgreSQL 16, Prisma ORM plus migrations, Zod validation, Vitest plus Playwright, Docker Postgres local.

**Spec:** docs/superpowers/specs/2026-09-21-phase0-design.md, source G PLAN.md sections 5, 6, 11, 17 Phase 0. PLAN.md is authoritative on conflicts, design spec second, this plan third.

## Global Constraints

- TypeScript strict end-to-end, integer minor units for money, no float totals. (PLAN.md 6.2)
- Tenant derived server-side from authenticated membership only, never from client tenantId claim. (PLAN.md 5.4, FR-TENANT-01)
- Every business-owned table includes businessId, every read and write scoped. (PLAN.md 6.1, FR-TENANT-01)
- API versioned /api/v1, error envelope code message correlationId fields, ISO8601 UTC on wire. (PLAN.md 5.4)
- Cursor pagination for high-volume lists, bounded page pagination for catalog screens. (PLAN.md 5.4)
- Idempotency-Key header contract reserved, enforced Phase 4. (PLAN.md 5.4, 6.5)
- Audit log append-only, no app-level update or delete, redacted sensitive values. (PLAN.md 6.7)
- Secrets outside source control, env separation local staging prod. (PLAN.md 7, 14.1)
- Password hashing adaptive algorithm, secure httpOnly SameSite cookies, CSRF on mutations, rate limits on login and reset. (PLAN.md 7)
- CI runs typecheck, lint, unit plus integration tests, migration check, build, selected E2E. (PLAN.md 14.1)
- No Redis, workers, storage, offline, POS UI, catalog, inventory ledger, payments, shifts, reports, branches, billing, integrations, AI in Phase 0. (PLAN.md 5.1, 17)
- Every task follows TDD red green refactor, minimal code, frequent commits.

---

## File Structure

- Root: package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, docker compose, gitignore, nvmrc, env example, CI workflow (Task 1, done commit 07c554f)
- packages/types: shared money types, API envelope, pagination, tenant, audit shape (Task 2, PLAN.md 5.4, 6.2, 6.7)
- packages/validation: shared Zod schemas rejecting negative prices, bad quantities, excess discounts (Task 2, PLAN.md 6.2, 11)
- packages/config: TS base, env helper with separation local staging prod (Task 2, PLAN.md 11, 14.1)
- packages/database: Prisma schema Phase 0 subset plus tenant helper plus tests (Task 3, PLAN.md 6.1, 6.7)
- packages/auth: session and permission contracts, server-side tenant derivation (Task 4, PLAN.md 4.1, 7)
- apps/api: errors, correlation, logging, guards, audit write, v1 me and health, contract tests (Task 5, PLAN.md 5.4, 13.3, 14.2)
- apps/web: status page hitting api v1 me, no POS UI (Task 6, PLAN.md 5.1)
- tests plus CI plus migrations check plus rollback notes (Task 7, PLAN.md 13.1, 14.1)

### Task 1: Monorepo scaffold and toolchain (DONE commit 07c554f)

PLAN.md 5.2, 11, 14.1. Produces workspace scripts build lint typecheck test, Turbo pipeline, Docker Postgres pos-db.

- [x] **Step 1: Write the failing test** `scripts/verify-scaffold.test.mjs` checks package.json private true plus workspace files exist.
- [x] **Step 2: Run test to verify it fails** Ran `node scripts/verify-scaffold.test.mjs`, got FAIL ENOENT package.json.
- [x] **Step 3: Write minimal implementation** package.json private true pnpm 9.15.9 turbo scripts, workspace yaml, turbo json, docker compose postgres 16, gitignore, nvmrc 24, tsconfig base, env example, CI workflow.
- [x] **Step 4: Run test to verify it passes** Ran `node scripts/verify-scaffold.test.mjs`, got PASS SCAFFOLD_OK exit 0.
- [x] **Step 5: Commit** Committed `chore: scaffold phase0 monorepo toolchain` as 07c554f.

### Task 2: Shared contracts - types, validation, config

PLAN.md 5.4, 6.2, 6.7, 11. No float money, envelope code message correlationId fields, ISO8601 UTC, pagination, env separation.

**Files:**
- Create: packages/types/package.json
- Create: packages/types/src/money.ts
- Create: packages/types/src/api.ts
- Create: packages/types/src/tenant.ts
- Create: packages/types/src/audit.ts
- Create: packages/types/src/index.ts
- Create: packages/types/test/money.test.ts
- Create: packages/validation/package.json
- Create: packages/validation/src/money.schema.ts
- Create: packages/validation/src/api.schema.ts
- Create: packages/validation/src/index.ts
- Create: packages/validation/test/money.schema.test.ts
- Create: packages/config/package.json
- Create: packages/config/src/env.ts
- Create: packages/config/src/index.ts
- Create: packages/config/test/env.test.ts

**Interfaces:**
- Consumes: PLAN.md 5.4 envelope pagination, 6.2 integer minor units PHP, 6.7 audit fields, 11 stack, 14.1 env separation
- Produces: MoneyMinor brand plus addMoney subtractMoney, ApiErrorEnvelope code message correlationId fields, PaginationParams, TenantContext businessId userId, AuditAction shape, moneySchema rejecting negatives, env loader
- [ ] **Step 1: Write the failing money unit test** Create file `packages/types/test/money.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { addMoney, subtractMoney } from "../src/money";

describe("money minor units PLAN 6.2", () => {
  it("adds integer centavos", () => {
    expect(addMoney(10050 as any, 250 as any)).toBe(10300);
  });
  it("rejects float input", () => {
    expect(() => addMoney(10.5 as any, 5 as any)).toThrow();
  });
  it("subtracts centavos", () => {
    expect(subtractMoney(1000 as any, 400 as any)).toBe(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/types test`
Expected: FAIL with cannot find module ../src/money.
- [ ] **Step 3: Write minimal types implementation** Create `packages/types/package.json`:

```json
{
  "name": "@pos/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

Create `packages/types/src/money.ts`:

```ts
export type MoneyMinor = number & { readonly __brand: "MoneyMinor" };

export function assertInteger(n: number): void {
  if (!Number.isInteger(n)) throw new Error("MONEY_NOT_INTEGER");
}

export function toMoneyMinor(n: number): MoneyMinor {
  assertInteger(n);
  return n as MoneyMinor;
}

export function addMoney(a: number, b: number): MoneyMinor {
  assertInteger(a);
  assertInteger(b);
  return ((a as number) + (b as number)) as MoneyMinor;
}

export function subtractMoney(a: number, b: number): MoneyMinor {
  assertInteger(a);
  assertInteger(b);
  return ((a as number) - (b as number)) as MoneyMinor;
}
```

Create `packages/types/src/api.ts`:

```ts
export interface ApiErrorEnvelope {
  code: string;
  message: string;
  correlationId: string;
  fields?: Record<string, string[]>;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit: number;
}

export interface PagePaginationParams {
  page: number;
  pageSize: number;
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
```

Create `packages/types/src/tenant.ts`:

```ts
export interface TenantContext {
  businessId: string;
  userId: string;
}
```

Create `packages/types/src/audit.ts`:

```ts
export interface AuditLogShape {
  businessId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeSnapshot: unknown | null;
  afterSnapshot: unknown | null;
  reason: string | null;
  requestId: string;
  ip: string | null;
  timestamp: string;
}
```

Create `packages/types/src/index.ts`:

```ts
export * from "./money";
export * from "./api";
export * from "./tenant";
export * from "./audit";
```
- [ ] **Step 4: Write failing validation test** Create `packages/validation/test/money.schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { moneyMinorSchema, priceSchema, quantitySchema } from "../src/money.schema";

describe("PLAN 6.2 schema guards", () => {
  it("rejects negative price", () => {
    expect(() => priceSchema.parse(-100)).toThrow();
  });
  it("rejects float money", () => {
    expect(() => moneyMinorSchema.parse(10.5)).toThrow();
  });
  it("rejects zero quantity", () => {
    expect(() => quantitySchema.parse(0)).toThrow();
  });
  it("accepts valid centavos price", () => {
    expect(priceSchema.parse(10050)).toBe(10050);
  });
});
```

- [ ] **Step 5: Write minimal validation implementation** Create `packages/validation/package.json` with name @pos/validation, deps zod 3.23.8, vitest 2.1.8, typescript 5.6.3. Create `packages/validation/src/money.schema.ts`:

```ts
import { z } from "zod";

export const moneyMinorSchema = z.number().int("MONEY_NOT_INTEGER").min(0, "MONEY_NEGATIVE");
export const priceSchema = moneyMinorSchema;
export const quantitySchema = z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE");
export const discountBpsSchema = z.number().int().min(0).max(10000);
```

Create `packages/validation/src/api.schema.ts`:

```ts
import { z } from "zod";

export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string(),
  fields: z.record(z.array(z.string())).optional(),
});

export const pagePaginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100),
});
```

Create `packages/validation/src/index.ts` re-exporting both schema files.

- [ ] **Step 6: Write failing env test** Create `packages/config/test/env.test.ts` asserting loadEnv reads DATABASE_URL and NODE_ENV, and throws on missing DATABASE_URL.

- [ ] **Step 7: Write minimal config implementation** Create `packages/config/package.json` name @pos/config. Create `packages/config/src/env.ts`:

```ts
export interface Env {
  nodeEnv: string;
  databaseUrl: string;
  apiPort: number;
  webPort: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source["DATABASE_URL"];
  if (!databaseUrl) throw new Error("ENV_MISSING_DATABASE_URL");
  return {
    nodeEnv: source["NODE_ENV"] ?? "development",
    databaseUrl,
    apiPort: Number(source["API_PORT"] ?? 3001),
    webPort: Number(source["WEB_PORT"] ?? 3000),
  };
}
```

Create `packages/config/src/index.ts` re-exporting env.ts.

- [ ] **Step 8: Run tests to verify all pass**

Run: `pnpm --filter @pos/types test`
Expected: PASS 3 tests.

Run: `pnpm --filter @pos/validation test`
Expected: PASS 4 tests.

Run: `pnpm --filter @pos/config test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/types packages/validation packages/config
git commit -m "feat: add phase0 shared money api tenant audit types validation config"
```
### Task 3: Database foundation - Prisma schema plus tenant helper

PLAN.md 6.1 core entities Phase 0 subset, 6.7 audit shape, FR-TENANT-01 businessId scoping, 14.1 migrations forward-applied with rollback notes.

**Files:**
- Create: packages/database/package.json
- Create: packages/database/prisma/schema.prisma
- Create: packages/database/src/tenant.ts
- Create: packages/database/src/index.ts
- Create: packages/database/test/tenant.test.ts
- Create: packages/database/README.md

**Interfaces:**
- Consumes: Task 2 TenantContext, AuditLogShape, Env loader
- Produces: Prisma models User Business BusinessMembership Role Permission Session AuditLog Setting, withScope(businessId) helper, requireTenant guards client tenantId

- [ ] **Step 1: Write failing tenant scope test** Create `packages/database/test/tenant.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { withScope, requireTenant } from "../src/tenant";

describe("PLAN FR-TENANT-01 tenant scoping", () => {
  it("scopes a query object with businessId", () => {
    expect(withScope("biz_1", { id: "x" })).toEqual({ id: "x", businessId: "biz_1" });
  });
  it("rejects empty businessId", () => {
    expect(() => requireTenant("")).toThrow();
  });
  it("never accepts client tenantId as authority without membership check", () => {
    expect(() => requireTenant(null as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/database test`
Expected: FAIL cannot find module ../src/tenant.

- [ ] **Step 3: Write minimal Prisma schema Phase 0 subset** Create `packages/database/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  memberships  BusinessMembership[]
  sessions     Session[]
}

model Business {
  id        String   @id @default(cuid())
  name      String
  currency  String   @default("PHP")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  memberships BusinessMembership[]
  sessions    Session[]
  auditLogs   AuditLog[]
  settings    Setting[]
}

model BusinessMembership {
  id         String   @id @default(cuid())
  businessId String
  userId     String
  roleId     String
  createdAt  DateTime @default(now())
  business   Business @relation(fields: [businessId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
  role       Role     @relation(fields: [roleId], references: [id])
  @@unique([businessId, userId])
  @@index([businessId])
  @@index([userId])
}

model Role {
  id          String               @id @default(cuid())
  businessId  String
  name        String
  permissions RolePermission[]
  memberships BusinessMembership[]
  @@unique([businessId, name])
  @@index([businessId])
}

model Permission {
  id    String           @id @default(cuid())
  key   String           @unique
  roles RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])
  @@id([roleId, permissionId])
}

model Session {
  id         String   @id @default(cuid())
  userId     String
  businessId String
  tokenHash  String   @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
  business   Business @relation(fields: [businessId], references: [id])
  @@index([businessId])
  @@index([userId])
}

model AuditLog {
  id             String   @id @default(cuid())
  businessId     String
  actorId        String
  action         String
  entityType     String
  entityId       String
  beforeSnapshot Json?
  afterSnapshot  Json?
  reason         String?
  requestId      String
  ip             String?
  createdAt      DateTime @default(now())
  business       Business @relation(fields: [businessId], references: [id])
  @@index([businessId, createdAt])
  @@index([businessId, entityType, entityId])
}

model Setting {
  id         String   @id @default(cuid())
  businessId String
  key        String
  value      Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  business   Business @relation(fields: [businessId], references: [id])
  @@unique([businessId, key])
  @@index([businessId])
}
```

Every business-owned model includes businessId per PLAN 6.1. No catalog sales inventory models in Phase 0 per Non-Goals. Branch is model boundary only, not created yet.

- [ ] **Step 4: Write minimal tenant helper** Create `packages/database/src/tenant.ts`:

```ts
export function requireTenant(businessId: string | null | undefined): string {
  if (!businessId || typeof businessId !== "string" || businessId.trim() === "") {
    throw new Error("TENANT_REQUIRED");
  }
  return businessId;
}

export function withScope<T extends object>(businessId: string, where: T): T & { businessId: string } {
  const valid = requireTenant(businessId);
  return { ...where, businessId: valid };
}
```

Create `packages/database/src/index.ts` re-exporting tenant.ts.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pos/database test`
Expected: PASS 3 tests.

- [ ] **Step 6: Create rollback notes** Create `packages/database/README.md` stating migrations are forward-applied via prisma migrate, rollback is restore from backup per PLAN 14.1, no down-migration of audit data.

- [ ] **Step 7: Commit**

```bash
git add packages/database
git commit -m "feat: add phase0 prisma schema and tenant scope helper"
```
### Task 4: Auth contracts - session plus permission policy

PLAN.md 4.1 FR-AUTH-01 FR-AUTH-02 FR-RBAC-01 FR-RBAC-02, PLAN.md 7 session expiry revocation CSRF rate limits.

**Files:**
- Create: packages/auth/package.json
- Create: packages/auth/src/session.ts
- Create: packages/auth/src/permissions.ts
- Create: packages/auth/src/index.ts
- Create: packages/auth/test/session.test.ts
- Create: packages/auth/test/permissions.test.ts

**Interfaces:**
- Consumes: Task 2 TenantContext, Task 3 Session model shape
- Produces: isSessionExpired, isSessionRevoked, deriveTenantFromMembership, hasPermission, SENSITIVE_ACTIONS list

- [ ] **Step 1: Write failing session plus permission tests** Create `packages/auth/test/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSessionExpired, isSessionRevoked } from "../src/session";

describe("PLAN 7 session guards", () => {
  it("expires past date", () => {
    expect(isSessionExpired(new Date("2020-01-01T00:00:00.000Z"))).toBe(true);
  });
  it("keeps future session", () => {
    expect(isSessionExpired(new Date(Date.now() + 3600_000))).toBe(false);
  });
  it("flags revoked session", () => {
    expect(isSessionRevoked(new Date())).toBe(true);
  });
});
```

Create `packages/auth/test/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasPermission } from "../src/permissions";

describe("PLAN FR-RBAC-01 scope check", () => {
  it("allows permission within same business scope", () => {
    expect(hasPermission(["sale.refund"], "sale.refund", "biz_1", "biz_1")).toBe(true);
  });
  it("denies cross-business scope even with permission key", () => {
    expect(hasPermission(["sale.refund"], "sale.refund", "biz_1", "biz_2")).toBe(false);
  });
  it("denies missing permission", () => {
    expect(hasPermission([], "settings.write", "biz_1", "biz_1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/auth test`
Expected: FAIL cannot find modules.

- [ ] **Step 3: Write minimal implementation** Create `packages/auth/src/session.ts`:

```ts
export interface SessionRecord {
  expiresAt: Date;
  revokedAt: Date | null;
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function isSessionRevoked(revokedAt: Date | null): boolean {
  return revokedAt !== null;
}

export function deriveTenantFromMembership(membershipBusinessId: string | null): string {
  if (!membershipBusinessId) throw new Error("TENANT_REQUIRED");
  return membershipBusinessId;
}
```

Create `packages/auth/src/permissions.ts`:

```ts
export const SENSITIVE_ACTIONS = [
  "price.edit",
  "cost.view",
  "discount.override",
  "sale.void",
  "sale.refund",
  "inventory.adjust",
  "user.manage",
  "settings.write",
  "export.run",
  "shift.close.override",
] as const;

export function hasPermission(
  granted: string[],
  required: string,
  grantedBusinessId: string,
  requestBusinessId: string,
): boolean {
  if (grantedBusinessId !== requestBusinessId) return false;
  return granted.includes(required);
}
```

Create `packages/auth/src/index.ts` re-exporting both.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/auth test`
Expected: PASS 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/auth
git commit -m "feat: add phase0 session expiry revocation and scoped permission checks"
```
### Task 5: API foundation - errors correlation logging guards audit v1 me health

PLAN.md 5.4 versioned api-v1 envelope correlationId ISO8601, PLAN.md 6.7 audit append-only, 7 server-side authorization, 13.3 abuse cases, 14.2 correlation logs.

**Files:**
- Create: apps/api/package.json
- Create: apps/api/tsconfig.json
- Create: apps/api/src/errors.ts
- Create: apps/api/src/correlation.ts
- Create: apps/api/src/logger.ts
- Create: apps/api/src/tenant.guard.ts
- Create: apps/api/src/audit.ts
- Create: apps/api/src/routes/me.ts
- Create: apps/api/src/routes/health.ts
- Create: apps/api/src/index.ts
- Create: apps/api/test/errors.test.ts
- Create: apps/api/test/tenant.guard.test.ts
- Create: apps/api/test/me.contract.test.ts

**Interfaces:**
- Consumes: Task 2 envelope schemas, Task 3 tenant helper, Task 4 session plus permission checks
- Produces: GET /api/v1/me requiring membership-derived tenant, GET /api/v1/health protected requiring auth plus membership, error() builder, getCorrelationId, createLogger, appendAudit

- [ ] **Step 1: Write failing error plus guard plus contract tests** Create `apps/api/test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { error } from "../src/errors";

describe("PLAN 5.4 error envelope", () => {
  it("builds code message correlationId envelope", () => {
    const e = error("TENANT_REQUIRED", "Tenant required", "req_1");
    expect(e).toEqual({ code: "TENANT_REQUIRED", message: "Tenant required", correlationId: "req_1" });
  });
  it("includes fields when provided", () => {
    const e = error("VALIDATION", "Bad", "req_2", { price: ["NEGATIVE"] });
    expect(e.fields?.price).toEqual(["NEGATIVE"]);
  });
});
```

Create `apps/api/test/tenant.guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authorize } from "../src/tenant.guard";

describe("PLAN FR-TENANT-01 manipulated tenant rejected", () => {
  it("rejects client tenantId differing from membership tenant", () => {
    expect(() => authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_2" })).toThrow();
  });
  it("rejects expired session", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ).toThrow();
  });
  it("rejects revoked session", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        revokedAt: new Date(),
      }),
    ).toThrow();
  });
  it("accepts valid membership-derived tenant", () => {
    expect(authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_1" })).toBe("biz_1");
  });
});
```

Create `apps/api/test/me.contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { me } from "../src/routes/me";

describe("PLAN Phase 0 exit scoped read", () => {
  it("returns tenant-scoped profile with ISO8601 timestamp", () => {
    const res = me({ businessId: "biz_1", userId: "user_1" }, "req_1");
    expect(res.businessId).toBe("biz_1");
    expect(typeof res.timestamp).toBe("string");
    expect(new Date(res.timestamp).toISOString()).toBe(res.timestamp);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/api test`
Expected: FAIL cannot find modules.

- [ ] **Step 3: Write minimal API implementation** Create `apps/api/src/errors.ts` exporting error() matching ApiErrorEnvelope. Create `apps/api/src/correlation.ts`:

```ts
export function getCorrelationId(headers: Record<string, string | undefined>, fallback = ""): string {
  const fromHeader = headers["x-request-id"];
  if (fromHeader && fromHeader.trim() !== "") return fromHeader;
  if (fallback.trim() !== "") return fallback;
  return `req_${Date.now()}`;
}
```

Create `apps/api/src/logger.ts`:

```ts
export interface LogFields {
  correlationId: string;
  businessId?: string;
  userId?: string;
  action?: string;
}

export function createLogger() {
  return {
    info(fields: LogFields, message: string): string {
      return JSON.stringify({ level: "info", message, ...fields, timestamp: new Date().toISOString() });
    },
  };
}
```

Create `apps/api/src/tenant.guard.ts`:

```ts
import { deriveTenantFromMembership, isSessionExpired, isSessionRevoked } from "@pos/auth";

export interface AuthorizeInput {
  membershipBusinessId: string | null;
  claimedBusinessId: string | null;
  expiresAt?: Date;
  revokedAt?: Date | null;
}

export function authorize(input: AuthorizeInput): string {
  if (input.expiresAt && isSessionExpired(input.expiresAt)) throw new Error("SESSION_EXPIRED");
  if (isSessionRevoked(input.revokedAt ?? null)) throw new Error("SESSION_REVOKED");
  const tenant = deriveTenantFromMembership(input.membershipBusinessId);
  if (input.claimedBusinessId !== null && input.claimedBusinessId !== tenant) {
    throw new Error("TENANT_MISMATCH");
  }
  return tenant;
}
```

Create `apps/api/src/audit.ts`:

```ts
export interface AuditWrite {
  businessId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
}

const store: AuditWrite[] = [];

export function appendAudit(entry: AuditWrite): AuditWrite {
  store.push(entry);
  return entry;
}

export function listAudit(): readonly AuditWrite[] {
  return store;
}

export function clearAudit(): void {
  store.length = 0;
}
```

Create `apps/api/src/routes/me.ts`:

```ts
export interface MeContext {
  businessId: string;
  userId: string;
}

export function me(ctx: MeContext, requestId: string): MeContext & { requestId: string; timestamp: string } {
  if (!ctx.businessId) throw new Error("TENANT_REQUIRED");
  return { ...ctx, requestId, timestamp: new Date().toISOString() };
}
```

Create `apps/api/src/routes/health.ts`:

```ts
export function health(ctx: { businessId: string }, requestId: string): { ok: boolean; requestId: string; timestamp: string } {
  if (!ctx.businessId) throw new Error("TENANT_REQUIRED");
  return { ok: true, requestId, timestamp: new Date().toISOString() };
}
```

Create `apps/api/src/index.ts` re-exporting all modules.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/api test`
Expected: PASS 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add phase0 api envelope correlation tenant guard audit me health"
```
### Task 6: Web status shell - no POS UI

PLAN.md 5.1 Next.js web app, Phase 0 Non-Goals no POS UI catalog inventory payments shifts reports.

**Files:**
- Create: apps/web/package.json
- Create: apps/web/tsconfig.json
- Create: apps/web/src/status.ts
- Create: apps/web/test/status.test.ts

**Interfaces:**
- Consumes: Task 5 GET /api/v1/me shape businessId userId requestId timestamp
- Produces: fetchStatus(apiBase) returning ok plus me payload, status page data only no POS components

- [ ] **Step 1: Write failing status fetch test** Create `apps/web/test/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fetchStatus } from "../src/status";

describe("Phase 0 web status", () => {
  it("returns scoped me payload from api base", async () => {
    const res = await fetchStatus("http://localhost:3001", async () => ({
      businessId: "biz_1",
      userId: "user_1",
      requestId: "req_1",
      timestamp: "2026-09-21T00:00:00.000Z",
    }));
    expect(res.ok).toBe(true);
    expect(res.me?.businessId).toBe("biz_1");
  });
  it("marks unauthorized when api throws", async () => {
    const res = await fetchStatus("http://localhost:3001", async () => {
      throw new Error("TENANT_REQUIRED");
    });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pos/web test`
Expected: FAIL cannot find module ../src/status.

- [ ] **Step 3: Write minimal implementation** Create `apps/web/src/status.ts`:

```ts
export interface MePayload {
  businessId: string;
  userId: string;
  requestId: string;
  timestamp: string;
}

export type Fetcher = () => Promise<MePayload>;

export async function fetchStatus(
  _apiBase: string,
  fetcher: Fetcher,
): Promise<{ ok: boolean; me?: MePayload; error?: string }> {
  try {
    const me = await fetcher();
    if (!me.businessId) return { ok: false, error: "TENANT_REQUIRED" };
    return { ok: true, me };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "UNKNOWN" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pos/web test`
Expected: PASS 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add phase0 web status shell hitting api me"
```

### Task 7: Phase 0 exit gate - cross-tenant contract plus CI hardening

PLAN.md 13.1 test layers unit integration contract, 13.3 abuse cases IDOR manipulated tenant expired revoked, 14.1 CI typecheck lint unit integration migration check build E2E, 17 Phase 0 exit.

**Files:**
- Modify: .github/workflows/ci.yml
- Create: tests/phase0-exit.test.ts
- Create: scripts/verify-phase0.test.mjs
- Modify: package.json

**Interfaces:**
- Consumes: Tasks 2-6 full chain
- Produces: exit gate proving scoped read passes, cross-tenant read write blocked, expired revoked rejected, manipulated tenant rejected, CI green

- [ ] **Step 1: Write failing exit gate test** Create `tests/phase0-exit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authorize } from "../apps/api/src/tenant.guard";
import { me } from "../apps/api/src/routes/me";
import { health } from "../apps/api/src/routes/health";
import { hasPermission } from "../packages/auth/src/permissions";

describe("PLAN Phase 0 exit", () => {
  it("authenticated scoped read passes", () => {
    const tenant = authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_1" });
    const res = me({ businessId: tenant, userId: "user_1" }, "req_1");
    expect(res.businessId).toBe("biz_1");
  });
  it("protected health requires tenant", () => {
    expect(() => health({ businessId: "" }, "req_1")).toThrow();
  });
  it("cross-tenant read blocked", () => {
    expect(() => authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_2" })).toThrow();
  });
  it("cross-tenant write blocked by scope check", () => {
    expect(hasPermission(["sale.refund"], "sale.refund", "biz_1", "biz_2")).toBe(false);
  });
  it("expired session mutation rejected", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ).toThrow();
  });
  it("revoked session mutation rejected", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        revokedAt: new Date(),
      }),
    ).toThrow();
  });
  it("manipulated tenant id rejected", () => {
    expect(() => authorize({ membershipBusinessId: null, claimedBusinessId: "biz_9" })).toThrow();
  });
});
```

Create `scripts/verify-phase0.test.mjs` checking package.json plus workspace packages plus prisma schema exists plus tenant helper exists.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/phase0-exit.test.ts`
Expected: FAIL missing workspace deps until pnpm install links packages.

Run: `node scripts/verify-phase0.test.mjs`
Expected: FAIL missing files before Tasks 2-6 done.

- [ ] **Step 3: Wire workspaces and CI** Add workspace package names @pos/types @pos/validation @pos/config @pos/database @pos/auth @pos/api @pos/web with vitest configs. Extend `.github/workflows/ci.yml` with typecheck lint test migration-check build jobs per PLAN 14.1. Add root package.json test script running vitest plus both verify scripts.

- [ ] **Step 4: Run full verification to pass**

Run: `node scripts/verify-scaffold.test.mjs`
Expected: PASS SCAFFOLD_OK.

Run: `node scripts/verify-phase0.test.mjs`
Expected: PASS PHASE0_OK.

Run: `pnpm test`
Expected: PASS all unit plus contract plus exit tests, zero failures.

- [ ] **Step 5: Commit**

```bash
git add tests scripts package.json .github/workflows/ci.yml
git commit -m "test: add phase0 exit gate cross-tenant and session rejection"
```
