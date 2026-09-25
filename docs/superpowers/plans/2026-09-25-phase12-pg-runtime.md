# Phase 12 PostgreSQL Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 12 per `docs/superpowers/specs/2026-09-25-phase12-pg-runtime-design.md`: swap the runtime store to PostgreSQL behind `DATABASE_URL`, with transaction-scoped advisory locks making every existing service critical section atomic and cross-process safe — all memory suites stay green.

**Architecture:** `PgDbPort` composes per-family modules over a `pg` pool; `AsyncLocalStorage` gives nested port calls the transaction client; `withLock` = `pg_advisory_xact_lock` + transaction. Boot branches on `DATABASE_URL`. No service edits except `this.withLock` → `this.db.withLock`.

**Tech Stack:** `pg` + `@types/pg` (the phase's new dependencies), existing Vitest/NestJS stack, docker-compose Postgres for tests.

**Spec:** `docs/superpowers/specs/2026-09-25-phase12-pg-runtime-design.md` (translation rules §"Translation rules" are binding for every family). PLAN.md authoritative, spec second, plan third.

## Global Constraints

- Memory stays the default store; **no existing memory suite changes** — the only allowed edits to existing files are the app.module factory branch and the service lock call target.
- Every family module obeys the spec's translation rules (quoted PascalCase SQL, parameterized writes, explicit timestamps, tenant filters identical to memory, no invented error codes, no schema changes — 0001→0012 are final).
- Family tasks are TDD: parity tests against PgDbPort run red (method missing / wrong shape) before the SQL lands.
- Every task ends green: memory suites AND (from Task 1 on) the pg harness.
- No `apps/web` edits. Parallel frontend workstream owns `apps/web/**` and may hold `pnpm-lock.yaml`; run `pnpm install` carefully and re-verify `git diff pnpm-lock.yaml` contains only the `pg` entries.

---

## File Structure

- `apps/api/src/common/pg/context.ts` — pool, ALS transaction context, `withLock`, `withTransaction`, `nid` (Task 1)
- `apps/api/src/common/pg/pg-<family>.ts` — one module per family (Tasks 3-12)
- `apps/api/src/common/pg/pg.db.ts` — the `DbPort` facade (Task 13, grows per task)
- `apps/api/src/common/pg/pg-plans-seed.ts` — plan-seed rows shared by harness + boot
- `apps/api/test/pg/helpers.ts` + `apps/api/vitest.pg.config.ts` — the pg harness (Task 1)
- `apps/api/test/pg/pg-<family>.test.ts` — parity tests per family
- `apps/api/src/common/memory.db.ts` — gains `withLock`/`withTransaction` (Task 2); otherwise untouched
- `apps/api/src/app.module.ts` — boot branch (Task 13)
- `.github/workflows/ci.yml` — pg test job (Task 15); `tests/phase12-exit.test.ts`; `scripts/verify-phase12.test.mjs`

### Task 1: Foundation — dependency, harness, context, settings + audit families

**Files:** Create `apps/api/src/common/pg/context.ts`, `pg/pg-settings.ts`, `pg/pg-audit.ts`, `pg-plans-seed.ts`, `test/pg/helpers.ts`, `test/pg/pg-foundation.test.ts`, `apps/api/vitest.pg.config.ts`; `apps/api/package.json` (+`pg`, `@types/pg`, script `test:pg`).

**Interfaces produced:** `PgContext` = `{ pool, nid, withLock<T>(key: string, fn: () => Promise<T>): Promise<T>, withTransaction<T>(fn: (ctx: PgContext) => Promise<T>): Promise<T>, client(): Promise<{ client, release }> }`; family modules export `(ctx: PgContext) => DbPort-fragment` objects.

`context.ts` core (the pattern everything else leans on):

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";

export function nid(prefix: string): string { /* identical to memory.db */ }

export class PgContext {
  private pool: Pool;
  private als = new AsyncLocalStorage<PoolClient>();
  constructor(url: string) { this.pool = new Pool({ connectionString: url, max: 10 }); }
  async client(): Promise<PoolClient> {
    const tx = this.als.getStore();
    if (tx) return tx;
    return this.pool.connect();
  }
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tx = this.als.getStore();
    if (tx) return fn(); // nested lock inside a transaction: the outer one owns it
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      const out = await this.als.run(client, fn);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  // every family method: const c = await this.client(); try { ...result } finally { if (!txHeld) c.release(); }
}
```

Harness `test/pg/helpers.ts`: `withPg(fn)` — connects to `postgres://pos:pos@localhost:5432/pos`, one-time `CREATE DATABASE pos_test_pg` (ignore duplicate) + apply `0001→0012` once tracked in `_migrations`, then per test: truncate all tables except `_migrations`, re-insert the four plan rows (same JSON as migration 0011), build `new PgDbPort(...)` and call `fn(port)`. `vitest.pg.config.ts`: `test: { fileParallelism: false, testTimeout: 30000 }`, include `test/pg/**/*.test.ts`.

**Steps:** (1) write `pg-foundation.test.ts` — getSettings round-trip, saveSettings overwrite, appendAudit stamps `at`, plan seed rows present, `withLock` serializes two concurrent counters and rolls back on throw (write inside lock, throw, assert write gone); (2) red — no module; (3) implement `context.ts`, `pg-settings.ts` (`getSettings`/`saveSettings` over `"Setting"`), `pg-audit.ts` (`appendAudit` stamps `at`, `listAudit` ordered by `at`); (4) green via `pnpm --filter @pos/api test:pg` (docker-compose db must be up: `docker compose -f docker/docker-compose.yml up -d db`); (5) commit `feat: add pg runtime foundation`.

### Task 2: Port-level locks — memory port + services

**Files:** Modify `apps/api/src/common/db.port.ts` (`withLock<T>(key, fn)` + `withTransaction<T>(fn)` on `DbPort`), `memory.db.ts` (move the services' promise-chain map here), and the five services owning private locks (sales, shifts, inventory, refunds, transfers, billing) — change `this.withLock(key, ...)` → `this.db.withLock(key, ...)` and delete the private helpers.

**Steps:** (1) failing test in `apps/api/src/common/audit.test.ts`: `db.withLock("k", ...)` serializes and memory `withTransaction` nests; (2) red; (3) implement + mechanical service edits; (4) full memory suite green; (5) commit `refactor: move locks into the db port`.

### Tasks 3-12: Family modules (TDD parity per family)

Each task: (1) write `test/pg/pg-<family>.test.ts` mirroring the family's memory-suite assertions through PgDbPort (same inputs → same rows, same filters, same cursor behavior, same cross-tenant null/[]); (2) red; (3) implement `pg-<family>.ts` under the translation rules; (4) `test:pg` + memory suites green; (5) commit `feat: add pg <family>`.

| Task | Family file | Methods (from db.port.ts) | Tricky bits |
|---|---|---|---|
| 3 | `pg-tenants.ts` | findUserByEmail/ById, createUser, updateUserPassword, setUserEmailVerified, business create/find, memberships (list/find/create/update), sessions (create/find/list/update/revoke×2), reset tokens, email-verification tokens | Role mapping: `createMembership` upserts `Role(businessId,name)`→`roleId`; membership reads join `Role.name`; `revokeAllUserSessions` = one UPDATE |
| 4 | `pg-catalog.ts` | categories CRUD, products CRUD (create/list/find/update/archive paths via update) | search lives in catalog service (no port method) — port parity only |
| 5 | `pg-inventory.ts` | createMovement, listMovements×2, listMovementsPage (afterId cursor), upsertBalance, findBalance, listBalances | page cursor = `id > $after ORDER BY id LIMIT` matching memory; balance upsert keyed (businessId, productId, branchId) |
| 6 | `pg-sales.ts` | createSale/findSaleById/updateSale, listSaleItems/createSaleItem, payments (create/list/bySale), idempotency (find/claim), held sales (save/list/find/delete), findLatestSaleForRegister, listSalesByBusiness | `claimIdempotency` = `INSERT ... ON CONFLICT DO NOTHING` → re-read; concurrent loser returns null-sale path exactly as memory |
| 7 | `pg-shifts.ts` | registers CRUD, open/close via createShift/updateShift, cash movements (create/list by shift), findOpenShiftByRegister, hasShiftForRegister, listShiftsByBusiness, shift counter reads | open-shift uniqueness stays service-locked (advisory) — no new constraint |
| 8 | `pg-people.ts` | customers CRUD+search, expenses CRUD+void, refunds + refund items, refundable reads | void = update with `voidedAt/voidReason` (never delete) |
| 9 | `pg-branches.ts` | branches CRUD, transfers + transfer lines, state transitions via update | transfer lines write dual movements through inventory family at service level — port parity only |
| 10 | `pg-devices.ts` | devices (create/list/find/revoke, revokeSessionsByDevice), sync reads | device revoke also revokes sessions — single UPDATE each |
| 11 | `pg-billing.ts` | plans (list/findByKey), subscriptions (upsert/get/update), invoices (issue→create, list, update), usage counters (get/set/records), flags (set/get incl. global NULL businessId), `claimWebhookEvent` + webhook reads/updates/delete | `setFlag` upsert with NULL businessId → `ON CONFLICT` partial-index aware (`WHERE "businessId" IS NULL` vs `= $1`); `claimWebhookEvent` = `INSERT ... ON CONFLICT (provider, "eventId") DO NOTHING` → winner returns row, loser null |
| 12 | `pg-integrations.ts` | api tokens, printers + print jobs (claimNextJob with expectedStatus compare-and-set), display tokens, receipt shares, support grants, shift corrections | `claimNextJob` = single `UPDATE ... SET status='SENT', attempts=attempts+1 WHERE id = (SELECT id ... WHERE status=$expected ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` |

### Task 13: Facade completes DbPort + boot swap

**Files:** `pg/pg.db.ts` (`export class PgDbPort implements DbPort` composing all families + `withLock`/`withTransaction` from context), `app.module.ts` factory:

```ts
{
  provide: "DbPort",
  useFactory: () =>
    process.env["DATABASE_URL"]
      ? new PgDbPort(process.env["DATABASE_URL"])
      : createMemoryDb(),
},
```

**Steps:** (1) failing check — `tsc` fails while any DbPort method is unimplemented (the facade compiles only when complete, so Task 13 is red until Tasks 3-12 land; during Tasks 3-12 `pg.db.ts` stays `class PgDbPort implements DbPort` with the not-yet-implemented families throwing `new Error("PG_NOT_IMPLEMENTED")` — parity tests still prove the landed families); (2) implement the facade, wire the boot branch; (3) boot smoke: `DATABASE_URL=... tsx src/main.ts` starts, `/api/v1/health` 401, register→product→sale round-trips against Postgres; (4) all suites green; (5) commit `feat: swap runtime store to postgres behind DATABASE_URL`.

### Task 14: Two-instance concurrency proof

**Files:** `apps/api/test/pg/pg-two-instance.test.ts`.

Prove the audit's exit criterion with two separate `PgContext`s (separate connections, same DB):
1. last stock: product qtyOnHand 1; both instances run the service-level complete-sale flow inside `withLock("sales:b1")`; exactly one succeeds, one throws `INSUFFICIENT_STOCK`, ledger sum == balance, no orphan rows;
2. idempotent completion: same key, both instances call `claimIdempotency` — one claims, one re-reads the winner's row (`replayed` semantics);
3. webhook claim: same `eventId` both instances — one row wins, loser null;
4. register cap under Free plan: two concurrent `withCap`-style lock bodies — exactly one membership/register over the cap.

(1) runs through `SalesService` constructed over the PgDbPort to prove services are unmodified but now cross-process safe. **Steps:** red (memory port passes but pg fails on any non-transactional method), fix, green, commit `test: prove cross-process safety on postgres`.

### Task 15: CI, exit gate, verification

**Files:** `.github/workflows/ci.yml` (new `pg` job reusing the e2e job's postgres service: `pnpm --filter @pos/api test:pg`), `tests/phase12-exit.test.ts` (pg parity smoke + boot-branch unit test with a fake env), `scripts/verify-phase12.test.mjs` (file-existence + ci-content checks, prints `PHASE12_OK`).

**Steps:** (1) exit test red; (2) wire; (3) full gate: `pnpm test && pnpm test:exit && node scripts/verify-phase12.test.mjs && pnpm typecheck && pnpm build`; (4) migration proof re-run (`verify-phase11-migration.mjs` covers 0001→0012 — no new migration this phase); (5) commit `test: add phase12 exit gate and verification`; (6) record execution notes (deviations from this plan) in this file.

## Self-Review

1. **Spec coverage:** pool+driver (Task 1) ✓; ALS transaction context (Tasks 1, 13) ✓; advisory locks + service refactor (Task 2) ✓; all ~143 methods mapped via families (Tasks 3-12; the table enumerates the port surface exhaustively) ✓; Role mapping (Task 3) ✓; boot flag (Task 13) ✓; two-instance proof (Task 14) ✓; CI/gate (Task 15) ✓; no schema change (constraint) ✓; no apps/web edits (constraint) ✓.
2. **Placeholders:** Tasks 3-12 are deliberately rule-driven (spec's translation rules bind every method); each names its methods exhaustively and calls out the non-obvious ones with the exact strategy. The facade's `PG_NOT_IMPLEMENTED` error keeps every intermediate state honest and testable.
3. **Type consistency:** `PgContext`/`withLock`/`withTransaction` names identical across Tasks 1, 2, 13; family signatures mirror `db.port.ts` verbatim (parity tests enforce).

## Execution Notes

All 15 tasks landed on `phase11-hardening` (one commit per task). What changed after the plan was written:

1. **Two runtime-parity migrations, not zero.** The spec deferred schema changes, but the parity sweep (`scripts/check-runtime-schema-parity.mjs`, kept as a repo tool) found real gaps the memory runtime had papered over: 0013 adds `User.name`, `Session.authenticatedAt`, `BusinessMembership.deactivatedAt`, `Sale.completedAt`; **0014** fixes a Phase-9a DDL bug where `InventoryBalance`'s unique index `(businessId, productId)` made branch-scoped stock rows impossible (transfers need them) — replaced with a branch-aware `NULLS NOT DISTINCT` index; **0015** adds `ReceiptCounter` because `nextReceiptNo` must produce gap-preserving per-business sequences (a `MAX()`-derived number would reuse skipped numbers and break parity).
2. **Family modules were built by dispatched subagents** (tenants first as the gold standard, then catalog/inventory, sales/shifts, people/branches, devices+billing/integrations — two at a time). Every agent wrote its parity tests first and mirrored `memory.db.ts`; three agents caught brief-vs-contract divergences by verifying `db.port.ts`/DDL over the task text, as instructed. The `PgDbPort` delegates are generated from the interface by `scripts/generate-pg-delegates.mjs`.
3. **Concurrency tests must be order-agnostic.** Advisory locks and `ON CONFLICT` claims guarantee mutual exclusion, not which instance wins; two tests initially assumed the first caller wins and failed under real scheduling. The two-instance proof now asserts exactly-one-winner with either ordering.
4. **FKs the memory store never had** surface in tests: fabricated ids like `"b-race"` violate `Product_businessId_fkey` on PostgreSQL — tests create real parent rows now.
5. **Idempotency claim semantics preserved exactly:** the pg `claimIdempotency` throws `IDEMPOTENCY_REPLAY` on losing `INSERT ... ON CONFLICT DO NOTHING` (memory throws the same), and `claimWebhookEvent` returns the row/null — the service layer converts null to `WEBHOOK_IN_PROGRESS` as before.
6. **Parallel pg test runs need isolated databases.** Concurrent family suites sharing `pos_test_pg` truncate each other's fixtures; later batches got their own databases (`pos_test_dbill`, `pos_test_integ`). The suite itself is serial (`fileParallelism: false`) and fully deterministic in a single run.
7. **Live boot proof:** the API booted with `DATABASE_URL` against the migrated test database and completed register → product → opening stock → register → draft → cash sale over HTTP (`COMPLETED`, receipt `2026-000001`).

Final gate: pg suite 128/128 (12 files, including the two-instance proof), memory 345/345, exit 60/60 (`PHASE12_OK`, `PHASE11_MIGRATION_OK` with 45 tables), typecheck, build — all green.

### Post-phase follow-ups (same session)

1. **E2E runs on the real stack.** The Playwright suite executes with the API booted on `DATABASE_URL` (locally against a disposable `pos_e2e` database prepared by the new idempotent `scripts/apply-migrations.mjs`; CI's e2e job now applies migrations and runs its Postgres service for real instead of declaring it unused). Result: **24/24 green**, with two test-resilience fixes and zero backend changes — worker-unique registration emails (both Playwright projects can start a spec in the same millisecond, colliding on the unique email) and cold-start timeouts for Next dev's on-demand route compilation plus first-query latency. Verified in a throwaway git worktree because the frontend workstream's in-flight UI redesign in the main tree predates the current e2e selectors.
2. **Rate limits are cross-process.** The limiter backend is pluggable (`setRateLimitBackend`): memory (default, per-process) or `PgRateLimitBackend` — one table (`RateLimitHit`, migration 0016), a per-key advisory lock so concurrent hits serialize and the count is exact (a first single-CTE version silently undercounted: data-modifying CTEs cannot see each other's effects in one statement), prune-on-hit keeps it bounded. All seven limiters (login, reset, import, money ×2, refund-approve, API-token 60/min) share it; boot installs the pg backend exactly when `DATABASE_URL` is set. Proven live: six bad logins against the pg-backed API answer 401, 401, 401, 401, 401, 429.
3. **Operational note:** the store requires current migrations — booting against a database missing a migration fails at first limiter use (500s), so always run `scripts/apply-migrations.mjs` (CI and the e2e flow do).
