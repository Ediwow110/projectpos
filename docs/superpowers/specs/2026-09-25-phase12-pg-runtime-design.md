# Phase 12 PostgreSQL Runtime Design - Online POS

**Date:** 2026-09-25
**Source spec:** `G:\Vscode\PLAN.md` §5.1 ("PostgreSQL (authoritative transactional store)"), §6.4-6.5 (transaction/locking rules), §11 (PostgreSQL), §14.1; the 2026-09-25 compliance audit's top-ranked divergence.
**Status:** Implementation-ready. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-25-phase11-closures-design.md` (all Phase 0-11 behavior preserved; every memory-backed suite stays green).
**Out of scope (owned elsewhere):** `apps/web` (frontend workstream). This phase changes API boot and persistence only; no UI edits.

## Goal

Replace the ephemeral in-memory runtime store with PostgreSQL as the authoritative store, per PLAN.md 5.1/11, without changing any service, controller, or test behavior: same `DbPort` interface, same error codes, same test expectations. Cross-process correctness — the audit's core objection — comes from real transactions and database-level locks: two app instances can now race the last unit of stock, an idempotency claim, and a webhook claim, and exactly one wins.

**Exit:** with `DATABASE_URL` set, the API boots on PostgreSQL and the full contract/abuse/exit suites pass against it, including a two-instance concurrency proof (concurrent last-stock sales and concurrent idempotent completions across separate connections); with it unset, boot is unchanged (memory) and every existing suite stays green.

## Approach record

Two structural facts drove this design. (1) The DbPort surface is ~143 async methods over 44 proven tables — a mapping this mechanical must be driven by written translation rules, not ad-hoc per-method judgment. (2) Every multi-write invariant in PLAN.md (§6.3 sale atomics, §6.5 idempotency, webhook claims) is currently enforced by service-level promise-chain locks that are valid only in-process. Rather than rewriting services, the port grows two primitives (`withLock`, transaction-scoped client reuse) that the PostgreSQL implementation implements with a transaction-scoped advisory lock, so **existing service code becomes transactional and cross-process safe without a single service edit** beyond the lock call target.

## Architecture

```text
NestJS services (unchanged)          Boot (app.module factory)
  DbPort interface (unchanged)  <--   DATABASE_URL set  -> PgDbPort (new)
        ^                                            DATABASE_URL unset -> createMemoryDb()
        |
  PgDbPort = pool + per-family modules + AsyncLocalStorage tx context
```

1. **Driver: `pg` (node-postgres)** with parameterized SQL against the migration DDL — the migrations are the schema source of truth (proven by `verify-phase*-migration` scripts); adding Prisma client codegen would put a second schema owner in the repo. This phase adds the phase's first justified new dependency (`pg`, `@types/pg`).
2. **Transaction context via `AsyncLocalStorage`.** Every port method obtains its client from an ALS store: inside `withLock`/`withTransaction` all nested port calls share one transaction client; outside, each call uses the pool in autocommit. Service code therefore needs no transaction plumbing.
3. **Locks: `pg_advisory_xact_lock(hashtext(key))`.** The port gains `withLock(key, fn)`. PostgreSQL implementation: BEGIN, take the transaction-scoped advisory lock, run `fn` (nested port calls join the transaction), COMMIT/ROLLBACK — the lock releases with the transaction, and the wrapped writes become atomic. Memory implementation: the existing promise-chain map moved from the services into the memory port, byte-for-byte semantics. Services switch from their private `this.withLock` to `this.db.withLock` — the only service edit in this phase.
4. **Boot flag.** `DATABASE_URL` set → `PgDbPort`; unset → `createMemoryDb()` (default, so local tests and every existing suite are unaffected). The pool is created lazily at boot; a failed connect fails boot loudly.
5. **IDs and times stay client-side** (`nid(prefix)` strings, `Date` params) — the DDL's `TEXT` ids and `TIMESTAMP(3)` columns already match the memory shapes exactly; no schema change and no migration in this phase (0011/0012 are proven and complete).
6. **Role mapping.** The runtime stores `membership.role` as a string; the DDL normalizes roles into `Role`/`RolePermission`. The port maps: `createMembership` upserts `Role(businessId, name)` and links `roleId`; membership reads join `Role` back to the string. Permission rows are written from `ROLE_SEED` at business creation (the memory path seeds roles the same way at registration).

## Translation rules (the mapping contract)

Every family module implements the same rules; a reviewer checks methods against these, not against memory.db line-by-line:

1. **Names:** quoted PascalCase identifiers exactly as in the migration DDL (`"SaleItem"."lineTotalMinor"`).
2. **Writes:** parameterized `$1`-style always; `createdAt`/`updatedAt` NOT NULL columns set explicitly (`Date` param or `CURRENT_TIMESTAMP`).
3. **Tenant scoping:** every read/write filters or validates `businessId` exactly as the memory method does (`withScope` stays service-side); cross-tenant reads return `null`/`[]`, never throw.
4. **Sort/pagination:** replicate the memory ordering (id or createdAt, same direction, same cursor semantics).
5. **Errors:** the port never invents error codes; duplicates hit the DDL's unique constraints only where the memory store already threw (idempotency claims, webhook eventId) — via `ON CONFLICT DO NOTHING` + re-read, so concurrent losers get the winner's row.
6. **JSON:** `Json` columns are JSONB; objects pass through; no stringifying in callers.
7. **Booleans/dates:** `pg` returns JS booleans and `Date`s for BOOLEAN/TIMESTAMP(3); no manual coercion.
8. **Family modules:** one file per family under `apps/api/src/common/pg/`, each exporting a plain object of methods closing over the pool/ALS helpers; `pg.db.ts` composes them into the `DbPort` class. A family is reviewable and testable in isolation.

## Test strategy

- **Harness:** `apps/api/test/pg/helpers.ts` — connects to the docker-compose Postgres (`postgres://pos:pos@localhost:5432/pos`), creates a disposable `pos_test_pg` database, applies migrations 0001→0012 once (tracked in a `_migrations` table), and truncates + re-seeds plan rows between tests. Vitest config `vitest.pg.config.ts` disables file parallelism (shared database); activated by `pnpm --filter @pos/api test:pg`.
- **Per-family parity tests:** each family test mirrors its memory-suite assertions against PgDbPort — same inputs, same results — proving the translation rules instead of re-proving behavior.
- **Two-instance proof (the exit criterion the audit asked for):** two separate pools/connections race `completeSale` for the last unit and the same idempotency key; exactly one `201`-equivalent succeeds, no partial writes, no double cash movement. Webhook claim and register-cap races are covered the same way.
- **Existing suites:** untouched and green (memory stays the default in tests).

## Explicit deferrals

- **Connection pooling tuning** (pool size, statement timeouts) — defaults plus a max of 10 `[SPEC-DEFAULT]`; measured in the §14.4 load work, not here.
- **Read replicas, prepared-statement caching** — not justified by any measured requirement yet.
- **`audit` table partitioning** — the append-only table is small until real traffic exists.
