# Phase 9b Offline Design - Online POS

**Date:** 2026-09-24
**Source spec:** `G:\Vscode\PLAN.md` sections 15 (Offline and Resilience Roadmap, all of 15.1 + 15.2), 6.5 (payment/idempotency rules), FR-PAY-04, 17 (Phase 9, second half)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-24-phase9a-multibranch-design.md` (all Phase 0-9a behavior preserved; every existing suite must stay green)
**Successor (deferred):** Phase 10 SaaS billing and integrations. AI remains a deferred patch, not a criterion here.

## Goal

Implement PLAN.md 17 Phase 9, second half, covering the full §15.2 sequence: offline catalog cache, durable command queue, sync with per-transaction sync state, reconciliation with staff review, and device/clock/support handling.

**Exit (adapted from PLAN.md 15 + 17):** a cashier loses connectivity mid-shift, keeps selling for cash against the cached catalog, reconnects, and every offline sale replays to `SYNCED` with a server receipt — while any sale the server rejects (oversold stock, revoked permission) lands in a review queue instead of silently becoming authoritative — with all Phase 0-9a suites still green.

## Why this shape (approach record)

Three sync designs were evaluated against PLAN.md's hard constraint — *"offline sales must not silently become authoritative when the server later rejects stock, payment, or policy constraints"* (§15.2):

- **Chosen: outbox with idempotent replay.** The client persists every offline command with its idempotency key + fingerprint (§6.5 pattern, already built in Phases 4-9a) and replays FIFO through the *existing* idempotent endpoints on reconnect. Rejections arrive as existing codes (`INSUFFICIENT_STOCK`, `IDEMPOTENCY_MISMATCH`, `FORBIDDEN`) and map to per-transaction sync states for staff review.
- **Rejected: locally authoritative sales with server compensation.** Makes offline sales look final then unwinds them (receipt renumbering, debt adjustments) — the exact silent-authority failure PLAN.md forbids.
- **Rejected: convergent replicas (CRDT/last-writer-wins).** Money and guarded stock need one transactional authority (PostgreSQL); replicas abandon the modular-monolith simplicity principle (§1.4).

## Architecture

All new durable state lives in the web client. The server gains two small reads and one small table; every money/stock decision stays in the existing transactional path:

```text
Browser (Next.js + sync layer)
  IndexedDB: catalog | categories | settings | balances* | outbox | syncState | meta
  Connectivity monitor (navigator.onLine + GET /api/v1/health heartbeat)
  Replay worker (FIFO, backoff, skip-and-continue)
    | HTTPS, same /api/v1 idempotent endpoints (sale.complete, sync.check)
    v
NestJS modular monolith (+ tiny SyncModule: sync/check + devices)
    |
    v
PostgreSQL (+ Device table; SaleIdempotency already exists and is reused)
```

`*` balances are last-known display hints only, always labeled stale. No offline path ever writes authoritative stock, money, or receipts — the client records *intent*, the server decides.

§15.1 readiness (already in place, reused as-is): stable client transaction IDs, idempotency keys persisted before the first attempt with `(businessId, key, commandType)` uniqueness and fingerprint mismatch rejection, explicit sale state transitions, client display status kept separate from server status, and a POS cart that already updates locally without per-click round trips.

## Data Model

### Client: IndexedDB (versioned, `pos-sync-v1` `[SPEC-DEFAULT]`)

```text
catalog      productId -> product snapshot + cachedAt
categories   categoryId -> category snapshot + cachedAt
settings     key -> business settings snapshot + cachedAt
balances     (branchId, productId) -> { qtyOnHand, cachedAt, stale: true }
outbox       localId -> OutboxCommand (durable, written before first attempt)
syncState    localId -> { status, attempts, lastError, serverReceiptNo?, updatedAt }
meta         { lastSyncAt, deviceId, schemaVersion }
```

```text
OutboxCommand
  localId (crypto.randomUUID), commandType ("sale.complete"),
  key (idempotency key), fingerprint (sha256 over payload, same canonicalization),
  payload (draft lines snapshot + cash payments + branchId + registerId + actorId),
  queuedAt (client clock, display ordering only), status, attempts
```

### Server: one new table, one migration

```text
Device
  id, businessId, userId, label, revokedAt?, createdAt
  @@index([businessId, userId])

Migration 0010_phase9b_devices: CREATE TABLE "Device" (+ index).
```

`SaleIdempotency` (existing, Phase 4) is reused for outbox reconciliation — no new money/stock tables, no new columns on existing tables.

### Sync-state machine (client-side, per command)

```text
QUEUED -- online detected --> SENDING -- 2xx applied --> SYNCED
QUEUED --> SENDING -- replayable error --> FAILED_RETRYABLE -- backoff --> SENDING
SENDING -- INSUFFICIENT_STOCK | IDEMPOTENCY_MISMATCH | FORBIDDEN --> CONFLICT
CONFLICT -- manager retry --> SENDING
CONFLICT -- manager resolve (reason + audit) --> RESOLVED
```

Backoff `[SPEC-DEFAULT]`: 5 s, 30 s, 5 min, then manual retry only. FIFO replay with skip-and-continue: a `CONFLICT` never head-of-line-blocks later commands; order is preserved except for skipped conflicts, which is safe because every command is idempotent and stock-checked server-side at replay.

## Approved offline commands `[SPEC-DEFAULT]`

PLAN.md §15.2 says "approved offline commands" without naming them. The approved set is **cash sales only**:

- **Allowed offline:** `sale.complete` with cash-only payments (physical cash settles in-hand; no provider involved).
- **Online-only (controls disabled offline with a plain explanation):** card, GCash, Maya, bank transfer (provider settlement cannot complete offline — queuing them would manufacture unresolvable `UNKNOWN` states, violating FR-PAY-04); refunds, voids, over-threshold discounts, stock transfers, branch management (permission-sensitive or policy-guarded; the server must judge them live).

The POS payment panel shows only the cash tab offline; attempting anything else explains connectivity is required. No blind retry anywhere: the UI never re-sends without showing the resulting state.

## Offline sale flow

1. Cashier sells against the cached catalog; totals compute locally with the same money policy (integer minor units, snapshot prices from cache).
2. On Pay, the client writes the outbox command + `QUEUED` sync row, assigns a provisional receipt `OFFLINE-<8 hex>` `[SPEC-DEFAULT]`, and shows it **marked "Pending sync — not yet a final receipt."**
3. On reconnect, the replay worker sends commands FIFO to `POST /api/v1/sales/complete` with the original `Idempotency-Key`. Success → `SYNCED`, provisional receipt replaced by the server `receiptNo` (both kept: `provisionalReceiptNo` stays on the local record for till reconciliation).
4. Duplicate delivery (retry after a timeout that actually applied) returns the original sale with `replayed: true` — nothing posts twice, by the existing Phase 4 guarantee.

## Reconciliation and review

Replay rejections map deterministically, never silently:

| Server response | Sync state | Staff action |
|---|---|---|
| `2xx` applied | `SYNCED` | none |
| `INSUFFICIENT_STOCK` | `CONFLICT` | manager receives stock then retries, or resolves manually |
| `SHIFT_NO_OPEN_SHIFT` (shift closed during the outage) | `CONFLICT` | manager reopens a shift then retries, or resolves manually |
| `FORBIDDEN` (permissions changed mid-outage) | `CONFLICT` | manager/owner reviews |
| `IDEMPOTENCY_MISMATCH` | `CONFLICT` | review (unreachable with stable fingerprints; surfaced, not swallowed) |
| Network/timeout, 5xx, 429 | `FAILED_RETRYABLE` | automatic backoff retry |

`/sync` review queue lists every non-`SYNCED` command with its server response, attempts, and two manager actions: **Retry** (re-attempt replay) and **Resolve** (attested manual resolution with a required reason; audit `sync.resolve`; the local record is kept, marked resolved, never deleted). Cash already changed hands, so resolution is always explicit — there is no code path that drops a queued sale.

## Connectivity, clock, devices, support (PLAN.md §15.2 steps 1 + 5)

- **Connectivity:** `navigator.onLine` plus a heartbeat `GET /api/v1/health` every 15 s when degradation is suspected `[SPEC-DEFAULT]`; a persistent banner shows Online / Offline / Syncing(n) / Conflicts(n). Every offline-capable screen states its data freshness (`catalog as of <time>`).
- **Clock/skew:** the heartbeat response carries server time; skew beyond 5 min `[SPEC-DEFAULT]` raises a warning (client `queuedAt` is display-only; server timestamps stay authoritative).
- **Devices:** `POST /api/v1/devices` enrolls `{ label }` (owner/manager/self for own account `[SPEC-DEFAULT]`); `GET /api/v1/devices` lists; `POST /api/v1/devices/:id/revoke` revokes (owner/manager, or self). A revoked device's sessions are revoked with it; its outbox stays on the device until it syncs or is wiped — documented, with a support force-restore path via `sync/check`.
- **Local protection (honest boundary):** IndexedDB relies on OS/browser-profile protection in v1; no card numbers or secrets are ever cached (cash-only offline makes this structural, not policy). Documented as a limitation, not a claim.
- **Support tools:** outbox inspector (per-command payload/fingerprint/attempts) and `sync/check`-driven resync for rebuilt devices.

## Permissions (FR-RBAC-01/02)

No new permission keys. Offline sale requires the same grants as online (`sale.complete` path; cashier role suffices for cash). Replay is authorized against the *reconnecting session's current* grants — revoked permissions surface as `CONFLICT`, not silent success. Device revoke: owner/manager or self. Sync resolve: owner/manager (`inventory.adjust` holders review stock conflicts in practice; gate is role-based owner/manager `[SPEC-DEFAULT]`).

## API Endpoints

All under `/api/v1`, `SessionGuard` everywhere, `CsrfGuard` on mutations, envelope `{ code, message, correlationId, fields? }`:

```text
POST   /api/v1/sync/check          { keys: [{ key, commandType }] }
  -> { applied: [{ key, resultId }], unknown: [{ key }], serverTime }
  (lets a rebuilt/replacement device reconcile its outbox; reads SaleIdempotency)
GET    /api/v1/devices
POST   /api/v1/devices             { label } -> 201
POST   /api/v1/devices/:id/revoke  -> 200
```

Unchanged and replayed as-is: `POST /api/v1/sales/complete` (with `Idempotency-Key`), drafts, catalog/settings reads (serve as cache fill). New stable codes: none — `VALIDATION`, `FORBIDDEN`, `NOT_FOUND` reused. Timestamps ISO 8601 UTC.

## Web UI (PLAN.md 8.2, 10)

Same appliance language (TanStack Query + `apiFetch`, CSRF, tabular numerals, text+shape states, no gradients):

- **Connectivity banner** (all pages): Online / Offline / Syncing (n) / Conflicts (n), with data-freshness line on catalog/inventory surfaces.
- **POS offline mode:** cached product grid/search works; payment panel cash-only with provisional-receipt notice; everything else disabled with reasons.
- **`/sync`:** outbox list with per-command status chips (`QUEUED`, `SENDING`, `SYNCED`, `CONFLICT`, `FAILED`, `RESOLVED`), the `/sync/check` resync button, and the conflict review actions (Retry / Resolve with reason).
- **Dashboard:** sync attention items (pending/conflict counts link to `/sync`).

## Audit (PLAN.md 6.7)

Append-only: `device.enroll`, `device.revoke`, `sync.resolve` (with reason + resolver), plus the normal `sale.complete` rows produced by replays (actor = original cashier, requestId = replay request). No updates/deletes.

## Test Strategy

TDD throughout. Vitest unit (sync-state transitions, backoff schedule, provisional numbering, fingerprint stability across serialize cycles, skew math), memory-DB integration + supertest contract (sync/check applied/unknown, device enroll/revoke gates, cross-tenant `NOT_FOUND`, replay idempotency over HTTP, conflict mapping), Playwright E2E with `context.setOffline` (offline cash sale → reconnect → `SYNCED` with server receipt; oversell → review queue; catalog browsable offline with staleness shown), exit test + verify script, CI extended.

## Performance Budgets (PLAN.md 12)

Cache reads and outbox writes are local: p95 < 50 ms `[SPEC-DEFAULT]`; replay of one command reuses the sale-creation budget (p95 < 500 ms after request reaches API); bulk reconnect of N commands is sequential FIFO, budgeted per command, with progress UI. No new server indexes (sync/check reads the existing `(businessId, key, commandType)` unique key).

## Exit Criteria

- Cashier completes a cash sale offline against cached catalog with a marked-provisional receipt; on reconnect it replays to `SYNCED` with a server receipt; duplicate delivery posts nothing twice.
- An offline sale the server rejects (oversold stock, revoked grant) lands in `/sync` as `CONFLICT` with its server reason; manager retry/resolve paths work; nothing disappears silently.
- Catalog browsable offline with explicit staleness; non-cash methods and refunds disabled offline with explanations.
- Migrations 0001→0010 apply cleanly on live Postgres (0010: `Device` table).
- All Phase 0-9a suites still green (server sale/payment/inventory paths untouched; additions are additive).

## Non-Goals (deferred)

Card/e-wallet/bank offline payments, offline refunds/voids/transfers, multi-device merge, Background Sync API / push, native apps, at-rest encryption beyond platform protection, franchise/warehouse automation, AI (deferred patch).
