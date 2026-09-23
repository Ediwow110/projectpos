# Phase 8 Security and Stability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 8 per `docs/superpowers/specs/2026-09-23-phase8-security-stability-design.md` so the security abuse suite passes and performance budgets are measured.

**Architecture:** No new runtime subsystem. Four artifact kinds: (1) audit docs written by reading every controller/guard/migration, (2) a supertest abuse suite locking safe behavior plus targeted fixes for gaps, (3) hardening code (headers middleware, rate limiters, validation tightening) with unit/contract tests, (4) operational docs + scripts (backup/restore, runbooks, load harness) and Playwright E2E wiring. Every code change follows TDD; docs are verified by existence + review, scripts by real execution.

**Tech Stack:** TypeScript strict, Node 24, pnpm 9.15.9, NestJS 11, PostgreSQL 16, Vitest 2.1.8, supertest, `@playwright/test` (new devDependency, installed via `pnpm add -D @playwright/test`), zero-dependency Node scripts (no other new deps).

**Spec:** `docs/superpowers/specs/2026-09-23-phase8-security-stability-design.md`. PLAN.md (`G:\Vscode\PLAN.md`) is authoritative on conflicts, the spec second, this plan third.

## Global Constraints

- Hardening only: no product features. Any feature-shaped discovery becomes a dated follow-up note in the audit doc, never scope creep.
- Every behavior claim in an audit doc must be backed by a named passing test (cite the file + test name).
- Error envelopes keep stable `code` values; new codes only with `CODE_STATUS` entries.
- Rate limiters must not trip existing contract suites (each suite uses fresh app instances; thresholds calibrated with headroom; full suite green proves it).
- No new runtime dependencies except `@playwright/test` (dev-only). No new tables unless the index audit justifies exactly one migration with a stated query.
- Secrets never enter source control; scripts read `$DATABASE_URL` from the environment.
- Every task follows TDD red-green-refactor for code; docs/scripts verified by execution. Frequent commits.

---

## File Structure

- `docs/superpowers/audits/2026-09-23-phase8-authorization.md`: route guard table + tenant matrix + index review (Task 1).
- `apps/api/test/abuse.contract.test.ts`: IDOR/tenant/escalation/session abuse (Task 2).
- `apps/api/test/abuse-payments.contract.test.ts`: payment/validation/refund/shift/export/upload abuse (Task 3).
- `apps/api/src/common/security-headers.middleware.ts` + wiring in `app.module.ts` + `main.ts` (Task 4).
- `apps/api/src/common/rate-limit.ts`: no change (helper already correct); new limiter instances in money-moving controllers (Task 4).
- `apps/api/src/auth/nest/auth.controller.ts`: export `cookieOpts` for flag tests (Task 4).
- `apps/web/next.config.js`: security headers (Task 4).
- `packages/validation/src/catalog.schema.ts`: `imageUrl` protocol refine (Task 4).
- `apps/api/src/common/log-context.ts` + unit test (Task 5).
- `docs/superpowers/runbooks/alerts.md` (Task 5).
- `scripts/backup.sh`, `scripts/restore.sh` (Task 6).
- `docs/superpowers/runbooks/backup-restore.md`, `incidents.md` (Task 6).
- `scripts/load/dashboard-mix.mjs`, `docs/superpowers/audits/2026-09-23-phase8-performance.md` (Task 7).
- `playwright.config.ts`, `tests/e2e/critical-path.spec.ts`, `tests/e2e/roles.spec.ts`, `tests/e2e/helpers.ts` (Task 8).
- `.github/workflows/ci.yml`: typecheck step + e2e job (Task 8).
- `tests/phase8-exit.test.ts`, `scripts/verify-phase8.test.mjs` (Task 8).

### Task 1: Authorization, tenant, and index audit docs

**Files:**
- Create: `docs/superpowers/audits/2026-09-23-phase8-authorization.md`

**Interfaces:**
- Consumes: every `apps/api/src/*/nest/*.controller.ts`, guards in `apps/api/src/common/`, `SENSITIVE_ACTIONS` in `packages/auth/src/permissions.ts`, all `packages/database/prisma/migrations/*/migration.sql` index statements.
- Produces: the audit table other tasks verify against. Task 2/3 tests cite its rows.

- [ ] **Step 1: Write the audit by reading code (no test yet — this is the map)**

Read each controller file under `apps/api/src/*/nest/` and record one row per route: `METHOD PATH | SessionGuard | CsrfGuard | role/permission gate | verdict`. Controllers to cover: auth, tenant, business, catalog, inventory, sales, shifts, customers, expenses, refunds, reporting. Guard patterns: class-level `@UseGuards(SessionGuard)`; method-level `@UseGuards(CsrfGuard)` on POST/PATCH; gates via `rolePermissions(...)` or role sets (`SELL_ROLES`, `REGISTER_MANAGERS`, owner/manager checks) or service-level `granted` checks.

Tenant matrix section: one row per entity (User, Business, Category, Product, InventoryMovement, InventoryBalance, Sale, SaleItem, Payment, HeldSale, SaleIdempotency, Register, Shift, CashMovement, Customer, Refund, RefundItem, Expense): `existing cross-tenant test (file + test name) | missing?`. Mark missing ones — each missing row becomes a test in Task 2/3, not a shrug.

Index review section: list every `CREATE [UNIQUE] INDEX` across migrations 0001-0007 with the query pattern it serves (e.g. `Sale(businessId, status, createdAt)` → history/report scans; `SaleIdempotency(businessId, key, commandType)` → replay lookups). Flag gaps with a stated query; only gaps with a stated query may proceed to a migration (none expected — record the verdict either way).

- [ ] **Step 2: Verify the audit reads correctly**

Run: `node -e "const s=require('fs').readFileSync('docs/superpowers/audits/2026-09-23-phase8-authorization.md','utf8'); for (const h of ['## Route table','## Tenant matrix','## Index review','## Findings']) { if(!s.includes(h)) throw new Error('missing '+h); } console.log('AUDIT_STRUCTURE_OK')"`
Expected: `AUDIT_STRUCTURE_OK`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audits/2026-09-23-phase8-authorization.md
git commit -m "docs: add phase8 authorization tenant index audit"
```

### Task 2: Abuse suite part 1 — IDOR, tenant isolation, escalation, sessions, CSRF

**Files:**
- Create: `apps/api/test/abuse.contract.test.ts`

**Interfaces:**
- Consumes: Task 1 audit table (every test cites its row), `createTestApp`, `jar()` cookie pattern.
- Produces: locked safe behavior for identity/tenant/session threats. Task 8 exit gate runs this file.

- [ ] **Step 1: Write the failing abuse tests**

Create `apps/api/test/abuse.contract.test.ts` with two businesses (owner A + owner B fixtures via `/api/v1/auth/register`), a product + sale under A, and these tests:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookieA: string;
let csrfA: string;
let cookieB: string;
let productA: string;
let saleA: string;
let customerA: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const ra = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-abuse@example.com",
    password: "correct-horse-12", businessName: "Store A",
  });
  cookieA = jar(ra.headers["set-cookie"]);
  csrfA = ra.body.csrfToken;
  const rb = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Bo", email: "bo-abuse@example.com",
    password: "correct-horse-12", businessName: "Store B",
  });
  cookieB = jar(rb.headers["set-cookie"]);
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productA = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ productId: productA, type: "opening_stock", qtyDelta: 50 });
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ lines: [{ productId: productA, qty: 1 }] });
  const done = await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .set("Idempotency-Key", "abuse-setup-01")
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
  saleA = done.body.id;
  const cust = await request(app.getHttpServer()).post("/api/v1/customers")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ name: "Private A" });
  customerA = cust.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase8 abuse: identity and tenancy", () => {
  it("rejects IDOR reads on foreign product, sale, and customer with NOT_FOUND", async () => {
    for (const path of [`/api/v1/products/${productA}`, `/api/v1/sales/${saleA}`, `/api/v1/customers/${customerA}`]) {
      const res = await request(app.getHttpServer()).get(path).set("Cookie", cookieB);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    }
  });

  it("rejects foreign writes (PATCH product, void sale) without effect", async () => {
    const patch = await request(app.getHttpServer()).patch(`/api/v1/products/${productA}`)
      .set("Cookie", cookieB).set("X-CSRF-Token", csrfA)
      .send({ priceMinor: 1 });
    expect([401, 403, 404]).toContain(patch.status);
    const mine = await request(app.getHttpServer()).get(`/api/v1/products/${productA}`).set("Cookie", cookieA);
    expect(mine.body.priceMinor).toBe(2500);
  });

  it("rejects expired sessions on mutations", async () => {
    // Sessions expire after 30 days; forge expiry by asserting the guard shape:
    // an unknown token must yield TENANT_REQUIRED, never data.
    const res = await request(app.getHttpServer()).get("/api/v1/sales")
      .set("Cookie", "pos_session=forged-token");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("rejects CSRF-less mutations per module area", async () => {
    const noCsrf = [
      request(app.getHttpServer()).post("/api/v1/products").set("Cookie", cookieA).send({ name: "X", priceMinor: 1 }),
      request(app.getHttpServer()).post("/api/v1/sales/drafts").set("Cookie", cookieA).send({ lines: [] }),
      request(app.getHttpServer()).post("/api/v1/customers").set("Cookie", cookieA).send({ name: "X" }),
      request(app.getHttpServer()).post("/api/v1/expenses").set("Cookie", cookieA).send({ category: "X", amountMinor: 1, method: "cash" }),
    ];
    for (const r of noCsrf) {
      const res = await r;
      expect(res.status).toBe(403);
      expect(["CSRF_MISMATCH", "CSRF_REQUIRED"]).toContain(res.body.code);
    }
  });

  it("reports cross-tenant overview as zeros, never foreign rows", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/dashboard/overview?dateFrom=2020-01-01T00:00:00.000Z&dateTo=2020-02-01T00:00:00.000Z&compare=none")
      .set("Cookie", cookieB);
    expect(res.status).toBe(200);
    expect(res.body.kpis.netRevenue.value).toBe(0);
    expect(res.body.topProducts).toEqual([]);
  });
});
```

Wait — the overview range 2020-01-01→2020-02-01 is 31 days, under the 366-day cap ✓. And business B has no sales → zeros regardless of range ✓.

The PATCH-with-B-cookie-but-A-CSRF test: CSRF guard checks the `pos_csrf` cookie against the header — cookieB's jar includes B's own `pos_csrf`, but the header carries A's token → mismatch → 403 before reaching tenant logic. Status assertion accepts 401/403/404 — honest about guard ordering (CSRF runs before the handler). The no-effect assertion (price unchanged) is the load-bearing check.

- [ ] **Step 2: Run tests to verify they pass-or-fail honestly**

Run: `pnpm --filter @pos/api test -- test/abuse.contract.test.ts`
Expected: PASS if prior phases did their jobs (these lock behavior); any FAIL becomes a Task 2-Step 3 fix (do not adjust the test to match buggy behavior — fix the code).

- [ ] **Step 3: Fix genuine findings only, then commit**

```bash
git add apps/api/test/abuse.contract.test.ts
git commit -m "test: add phase8 identity tenancy abuse suite"
```

(If Step 2 surfaced a real gap, fix the production code first in the same task, note the finding in the audit doc's Findings section, and re-run green before committing.)

### Task 3: Abuse suite part 2 — payments, validation, refunds, shifts, exports, uploads

**Files:**
- Create: `apps/api/test/abuse-payments.contract.test.ts`

**Interfaces:**
- Consumes: Task 1 audit rows for money-moving routes.
- Produces: locked safe behavior for financial/validation threats.

- [ ] **Step 1: Write the abuse tests**

Create `apps/api/test/abuse-payments.contract.test.ts` (same `jar()` + owner fixture pattern; seed product with stock 5):

```ts
describe("phase8 abuse: money and validation", () => {
  it("rejects duplicate charges on idempotency replay without new movements", ...); // complete twice, same key → same sale id; inventory movements count unchanged; balance unchanged
  it("rejects reused keys with different payloads (IDEMPOTENCY_MISMATCH)", ...); // same key, different qty → 409
  it("rejects negative/zero quantities and prices", ...); // draft { qty: -1 } → 400; product priceMinor: -5 → 400 (VALIDATION or MONEY_NEGATIVE — assert code from the envelope, whichever the route returns; check the actual code when writing: productCreateSchema surfaces VALIDATION for negatives? moneyMinorSchema fails with MONEY_NEGATIVE... the controller maps Zod failures to 400 VALIDATION uniformly — assert 400 + VALIDATION)
  it("rejects over-threshold discounts without override", ...); // covered at service level; assert over HTTP as cashier-equivalent? HTTP tests run as owner (has override). Assert the gate structurally: owner with huge discount succeeds (has permission) — and separately assert AuthService.rolePermissions("cashier") lacks discount.override (unit). Both halves prove the gate.
  it("rejects split-total mismatch", ...); // card underpay → PAYMENT_TOTAL_MISMATCH (already covered; re-assert here as the abuse canonical)
  it("rejects concurrent oversell (exactly one INSUFFICIENT_STOCK)", ...); // two drafts qty 5 on stock 5, Promise.allSettled completes → 1 fulfilled + 1 INSUFFICIENT_STOCK (service-level pattern, asserted over HTTP)
  it("rejects over-quantity refunds and self-approval", ...); // REFUND_EXCEEDS_LIMIT; non-owner self-approve FORBIDDEN (already covered in refund suites — re-assert the codes here as the abuse canonical with distinct keys)
  it("rejects double shift close and closed-shift writes", ...); // SHIFT_ALREADY_CLOSED / SHIFT_CLOSED_IMMUTABLE
  it("rejects exports without export.run at the service gate (unit)", ...); // HTTP owner has export.run; assert cashier denial at the AuthService.rolePermissions level + controller 403 shape via... controller checks rolePermissions inline. Unit-assert rolePermissions("cashier") lacks export.run AND that the export handler calls the gate (code-reading assertion is weak — instead: temporarily... no. Alternative honest approach: assert via a second business whose... roles are per-registration; all test sessions are owners. So HTTP-level cashier export denial is untestable without a member-invite API (doesn't exist). Record this as a documented gap with a service/permission-level test instead of faking it.)
  it("rejects malicious attachment/image URLs", ...); // javascript:alert(1), data:text/html, 600-char URL → VALIDATION on product imageUrl + expense attachmentUrl
  it("rejects oversized JSON bodies", ...); // 200kb description → 413 (verify Nest default limit during implementation; if the default differs, assert the documented value)
});
```

Two honest unknowns the implementer must resolve while writing (not placeholders — verification steps): the exact Zod-failure code for negative prices (read `catalog.controller.ts` error mapping: Zod failures → 400 VALIDATION — assert that), and the exact oversize-body status (check by running; Nest default is 413 — assert what the server actually returns, and if it is NOT 413, add an explicit `json({ limit })` setting in `main.ts` to make it so, documenting the value).

- [ ] **Step 2: Run tests to verify**

Run: `pnpm --filter @pos/api test -- test/abuse-payments.contract.test.ts`
Expected: all PASS except possibly the URL/body tests if gaps exist → fix code (see Step 3), never weaken tests.

- [ ] **Step 3: Fix genuine findings**

Known likely fix (verify during implementation): `imageUrl` in `catalog.schema.ts` uses bare `z.string().url()` which ACCEPTS `javascript:` URLs (WHATWG URL parses them). Tighten with `.refine((u) => u.startsWith("http://") || u.startsWith("https://"), { message: "VALIDATION" })` on `imageUrl` (and audit `attachmentUrl` — expense service already protocol-checks; add the same refine at schema level for defense in depth). Re-run green.

```bash
git add apps/api/test/abuse-payments.contract.test.ts packages/validation/src/catalog.schema.ts packages/validation/src/expenses.schema.ts
git commit -m "test: add phase8 money validation abuse suite"
```

### Task 4: Session, cookie, rate-limit, and header hardening

**Files:**
- Modify: `apps/api/src/common/security-headers.middleware.ts` (create), `apps/api/src/app.module.ts` (wire into `configure()`), `apps/api/src/main.ts` (explicit JSON body limit + middleware for standalone boot)
- Modify: `apps/api/src/auth/nest/auth.controller.ts` (export `cookieOpts`)
- Modify: money-moving controllers (add 60/min/business limiters: sales `complete` + `reconcile`, refunds `approve`, catalog `import` keeps 5/min) — files: `apps/api/src/sales/nest/sales.controller.ts`, `apps/api/src/refunds/nest/refund.controller.ts`
- Modify: `apps/web/next.config.js` (headers)
- Create: `apps/api/test/hardening.contract.test.ts`

**Interfaces:**
- Consumes: `createRateLimiter` (exists), `cookieOpts` (exported), guard patterns.
- Produces: headers on every response, flags on cookies, limiters that don't trip suites. Task 8 runs these tests.

Middleware (`apps/api/src/common/security-headers.middleware.ts`):

```ts
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if ((process.env["NODE_ENV"] ?? "development") === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  }
}
```

Wire: in `AppModule.configure`, apply alongside `RequestIdMiddleware` for `"*"`; in `main.ts`, `app.use(cookieParser()...)` stays, plus `app.use(json({ limit: "100kb" }))`... `main.ts` currently sets no body limit — Nest's default is 100kb; make it explicit: `import { json } from "express"; app.use(json({ limit: "100kb" }) as RequestHandler);` and document the value in the audit doc (this also settles Task 3's oversize-body question: assert 413).

Rate limiters: module-level `const moneyLimiter = createRateLimiter(60, 60_000);` in sales + refund controllers; key `auth.businessId`; on trip `fail(res, 429, "RATE_LIMITED", ...)`. Contract suites issue <15 guarded calls per app instance — 60 gives 4x headroom; full suite green proves non-interference.

Cookie test: login → `set-cookie` includes `HttpOnly` and `SameSite=Lax` on `pos_session`; unit test on exported `cookieOpts({ protocol: "https" } as never)` with `NODE_ENV=production` asserts `secure: true` (restore env after).

- [ ] **Step 1: Write the failing hardening tests**

Create `apps/api/test/hardening.contract.test.ts`:

```ts
describe("phase8 hardening", () => {
  it("sets security headers on responses", ...); // GET /api/v1/sales unauthenticated → 401 AND headers nosniff/DENY/no-referrer present
  it("sets safe cookie flags on login", ...); // set-cookie has HttpOnly + SameSite=Lax
  it("rate-limits money commands at 60/min/business (unit: limiter semantics)", ...); // direct createRateLimiter(60, 60000) test: 60 hits pass, 61st trips, window reset works with fake now
  it("rejects CSRF-less refund approval", ...); // POST refund-approve with cookie but no token → 403
});
```

Plus unit test for `cookieOpts` secure behavior (in the same file via import from `../src/auth/nest/auth.controller`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pos/api test -- test/hardening.contract.test.ts`
Expected: FAIL — no headers, `cookieOpts` not exported, no limiters (headers test fails; others guide implementation).

- [ ] **Step 3: Write minimal implementation**

Middleware + wiring + `main.ts` limit + `cookieOpts` export + limiters + `next.config.js` headers:

```js
async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pos/api test -- test/hardening.contract.test.ts` then full `pnpm --filter @pos/api test`
Expected: PASS, no regressions (proves limiters don't trip suites).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/security-headers.middleware.ts apps/api/src/app.module.ts apps/api/src/main.ts apps/api/src/auth/nest/auth.controller.ts apps/api/src/sales/nest/sales.controller.ts apps/api/src/refunds/nest/refund.controller.ts apps/web/next.config.js apps/api/test/hardening.contract.test.ts
git commit -m "feat: add phase8 security headers rate limits cookie hardening"
```

### Task 5: Dependency review, upload review, observability tests, alerts doc

**Files:**
- Modify: `docs/superpowers/audits/2026-09-23-phase8-authorization.md` (append `## Dependency review` + `## Upload review` sections)
- Create: `apps/api/src/common/log-context.ts`, `apps/api/test/logging.test.ts`
- Create: `docs/superpowers/runbooks/alerts.md`

**Interfaces:**
- Consumes: `pnpm audit` output, grep proof of no multipart handling, existing logger.
- Produces: recorded audit verdicts, redaction helper, alerts inventory. No runtime behavior change except safer log contexts.

`log-context.ts`:

```ts
const SENSITIVE_KEYS = new Set(["password", "passwordHash", "token", "tokenHash", "csrfToken", "authorization"]);

export function toSafeLogContext(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : v;
  }
  return out;
}
```

Test (`logging.test.ts`): sensitive keys redacted, safe keys pass through, plus correlation-echo contract test (send `X-Request-Id: probe-123` to an unauthenticated route → 401 envelope `correlationId === "probe-123"`). If the echo test fails, fix `fail()`/`RequestIdMiddleware` wiring (both exist — this locks the behavior).

Alerts doc: metric inventory (request latency/error rate, DB latency, auth failures, transaction failures, payment unknown rate, inventory failures, POS sale success) as `pos_*` Prometheus-style names with example thresholds marked [SPEC-DEFAULT starting points]: sustained 5xx rate > 1% for 5 min; `PAYMENT_UNKNOWN` > 5% of payments for 15 min; failed-login spike > 20/min/IP already limited at 5/min (alert at limiter-trip rate); failed backup/restore; cross-tenant `NOT_FOUND`... cross-tenant anomalies aren't directly observable — alert on `FORBIDDEN` rate spike instead (documented honestly).

- [ ] **Step 1: Run `pnpm audit`, record, then write failing logging tests**
- [ ] **Step 2: Run tests to verify they fail** (`toSafeLogContext` missing)
- [ ] **Step 3: Implement helper + docs**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-09-23-phase8-authorization.md apps/api/src/common/log-context.ts apps/api/test/logging.test.ts docs/superpowers/runbooks/alerts.md
git commit -m "feat: add phase8 dependency observability alerts review"
```

### Task 6: Index audit verdict, backup/restore scripts + drill, incident playbooks

**Files:**
- Modify: `docs/superpowers/audits/2026-09-23-phase8-authorization.md` (append `## Index verdict`; add `0008_phase8_indexes/migration.sql` ONLY if a gap names its query)
- Create: `scripts/backup.sh`, `scripts/restore.sh`
- Create: `docs/superpowers/runbooks/backup-restore.md`, `docs/superpowers/runbooks/incidents.md`

**Interfaces:**
- Consumes: Task 1 index review, `pg_dump`/`pg_restore` inside the postgres image.
- Produces: working scripts (proven by a real drill), two runbooks.

Scripts (`scripts/backup.sh`, executable):

```sh
#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL must be set}"
TS=$(date +%Y%m%dT%H%M%S)
OUT=${BACKUP_DIR:-./backups}/pos-$TS.dump
mkdir -p "$(dirname "$OUT")"
pg_dump --format=custom --file="$OUT" "$DATABASE_URL"
echo "wrote $OUT"
```

`scripts/restore.sh`:

```sh
#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${BACKUP_FILE:?BACKUP_FILE must be set}"
pg_restore --clean --if-exists --dbname="$DATABASE_URL" "$BACKUP_FILE"
echo "restored $BACKUP_FILE"
```

Windows note: document PowerShell equivalents (`$env:DATABASE_URL=...; Get-Content ... | docker exec -i ...`) in the runbook — the same pattern prior migration proofs used.

Drill procedure (do it for real): start throwaway `pos-db-phase8` on port 5433, apply migrations 0001→0007, insert one business row... minimal honest drill: dump the migrated schema DB, drop schema, restore, `\dt` shows all 26 tables. Record the transcript (commands + outputs) into `backup-restore.md`. Retention/encryption/access rules per spec §8 values.

Incidents doc: five playbooks (payment reconciliation, inventory drift, failed deploy, database restore, credential compromise + support-access misuse note), each with symptoms → first 3 commands → escalation → audit entries to inspect.

- [ ] **Step 1: Write scripts + runbooks**
- [ ] **Step 2: Execute the drill for real and paste the transcript**
- [ ] **Step 3: Remove the drill container; commit**

```bash
git add scripts/backup.sh scripts/restore.sh docs/superpowers/runbooks/backup-restore.md docs/superpowers/runbooks/incidents.md
git commit -m "feat: add phase8 backup restore runbooks and drill"
```

### Task 7: Load harness, local cohorts, performance doc

**Files:**
- Create: `scripts/load/dashboard-mix.mjs`
- Create: `docs/superpowers/audits/2026-09-23-phase8-performance.md`

**Interfaces:**
- Consumes: §12 budgets (search p95 < 200 ms, barcode p95 < 150 ms, complete p95 < 500 ms, dashboard p95 < 1.0 s), running API + seeded data.
- Produces: repeatable harness + measured table. No production code changes unless a budget breaches (then: fix forward as a dated follow-up, or tune within this task if trivial).

Harness (`scripts/load/dashboard-mix.mjs`, zero-dep Node 24): args `BASE_URL EMAIL PASSWORD --concurrency N --duration SECS --catalog N`. Flow: register owner → create N products → stock each → open register+shift → loop workers: weighted mix (50% product search, 20% sale complete with `crypto.randomUUID()` keys, 20% dashboard overview, 10% sales list). Minimal cookie-jar over global `fetch` (parse `set-cookie`, resend `Cookie`, capture `csrfToken` from bodies). Collect per-operation latencies; print p50/p95/p99, throughput, error rate, and budget verdicts. Exit non-zero on any budget breach or error rate > 1%.

Cohorts: (1) baseline: 1 business, 50 products, concurrency 5, 60 s; (2) growth: concurrency 100, 120 s, catalog 500. Record the table (real numbers from the run) in the performance doc + the staging procedure (same script against staging URL with staging credentials — documented, not executed here).

API test server for the harness: the harness boots nothing itself — document starting `API_PORT=3001 pnpm --filter @pos/api start`... verify the api package has a `start` script during implementation; if missing, run via `node` against built output or `nest start` — record the exact working command in the doc (whatever actually works, verified by running it).

- [ ] **Step 1: Write the harness**
- [ ] **Step 2: Seed + run baseline cohort, record table**
- [ ] **Step 3: Run growth cohort, record table; commit**

```bash
git add scripts/load/dashboard-mix.mjs docs/superpowers/audits/2026-09-23-phase8-performance.md
git commit -m "test: add phase8 load harness and performance measurements"
```

### Task 8: Playwright wiring, E2E specs, visual verification, CI, exit gate

**Files:**
- Modify: root `package.json` (add `@playwright/test` devDependency via `pnpm add -D @playwright/test`, add `"e2e": "playwright test"` script), `apps/web/package.json` if e2e helpers live there (keep at root)
- Create: `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/critical-path.spec.ts`, `tests/e2e/roles.spec.ts`
- Modify: `.github/workflows/ci.yml` (add `pnpm typecheck` step; add `e2e` job with Playwright setup + Postgres service, PR-only)
- Create: `tests/phase8-exit.test.ts`, `scripts/verify-phase8.test.mjs`

**Interfaces:**
- Consumes: all prior tasks; known UI copy (verified against page sources during implementation — grep each asserted string before finalizing).
- Produces: green E2E locally + in CI; Phase 8 exit proof.

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  use: { baseURL: process.env["WEB_URL"] ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
  ],
  webServer: [
    { command: "pnpm --filter @pos/api start -- --port 3001", port: 3001, reuseExistingServer: true, env: { ...process.env, DATABASE_URL: process.env["E2E_DATABASE_URL"] ?? "" } as Record<string, string> },
    { command: "pnpm --filter @pos/web start -- --port 3000", port: 3000, reuseExistingServer: true },
  ],
});
```

(Verify the `start` scripts exist during implementation; adjust to the real commands — `apps/api` and `apps/web` package.json scripts must be read first. If no `start` script exists, add minimal ones as part of this task: api `start: node dist/main.js` requires a build... simpler honest path: document + implement whatever boots the apps; do not fake it.)

`tests/e2e/helpers.ts`: `registerBusiness(page, { ownerName, email, password, businessName })` via UI register form (read the actual form labels from `apps/web/src/app/register/page.tsx` during implementation — do not guess), `loginAs`, `apiSeed` (direct API calls with fetch for products/stock to keep specs fast).

`critical-path.spec.ts` (§13.2 verbatim): register → create employee... employee creation UI does not exist (no member-invite API — record as documented gap; create the cashier session by registering a second business? No — different tenant. Honest approach: the "employee" step uses a second user registered... which creates its own business. Hmm. The critical path needs two users in ONE business, which the product cannot do yet (no invite flow — Phase 1 scoped membership to registration only). Resolution: run the cashier steps as the same owner session but through the cashier UI surfaces (POS), and record the missing multi-user-in-one-business E2E as a dated follow-up tied to a future member-invite feature. Do not fake multi-user.)

Flow: register → create product → receive stock → create register → open shift → POS sale (cash) → receipt visible → history shows sale → shift report reconciles → dashboard shows revenue → close shift → audit... audit UI does not exist either — assert audit via API (`listAudit` has no HTTP endpoint...). Adjust: assert what the UI shows (shift report components, dashboard KPI), and assert audit coverage at the API level (existing audit assertions in service tests — cite them). Record honestly.

`roles.spec.ts`: owner (register/delete-gated actions visible), manager... same single-user limitation: all role UI checks run against role-gated affordances with the owner session EXCEPT cashier-denied elements asserted by direct navigation (e.g., visiting refund action shows it disabled/hidden for cashier? Without a cashier session, assert the owner sees them and unit tests prove cashier denial — cite `rolePermissions` tests). Honest scoping in the spec file header comment: full multi-session E2E awaits member-invite.

Visual verification: run both projects headed... headless with screenshots; review dashboard + POS at both viewports via the Playwright MCP browser tools before sign-off; attach nothing (screenshots to output dir, gitignored).

CI: add `- run: pnpm typecheck` to verify job; new `e2e` job:

```yaml
  e2e:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: pos
          POSTGRES_PASSWORD: pos
          POSTGRES_DB: pos
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.9 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium
      - run: pnpm e2e
```

Exit test (`tests/phase8-exit.test.ts`): asserts security posture from unit-testable surface (limiter semantics, header middleware sets, cookie flags via exported helper, redaction helper, URL refine rejections) — 4-6 fast tests, no browser.

Verify script (`scripts/verify-phase8.test.mjs`): existence checks for abuse suites, audit doc, runbooks (3), backup scripts (2), load script, perf doc, playwright config, e2e specs (2), `tests/phase8-exit.test.ts` → `PHASE8_OK`. CI append via `Add-Content`.

- [ ] **Step 1: Wire Playwright + write specs against real UI copy (grep every asserted string first)**
- [ ] **Step 2: Run `pnpm e2e` locally green (both projects)**
- [ ] **Step 3: Visual verification via MCP browser at both viewports**
- [ ] **Step 4: CI updates + exit test + verify script**
- [ ] **Step 5: Full verification (`pnpm test && pnpm test:exit && node scripts/verify-phase8.test.mjs && pnpm typecheck`) then commit**

```bash
git add playwright.config.ts tests/e2e/ package.json pnpm-lock.yaml apps/web/package.json apps/api/package.json .github/workflows/ci.yml tests/phase8-exit.test.ts scripts/verify-phase8.test.mjs
git commit -m "test: add phase8 e2e coverage and exit gate"
```

(Add only files that actually changed — never `git add -A`.)
