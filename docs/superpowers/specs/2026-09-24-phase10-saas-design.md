# Phase 10 SaaS Billing and Integrations Design - Online POS

**Date:** 2026-09-24
**Source spec:** `G:\Vscode\PLAN.md` sections 16.2 (SaaS commercial model), 17 (Phase 10), plus FR-PAY-01/04, FR-RECEIPT-01, §6.5, §7
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-24-phase9b-offline-design.md` (all Phase 0-9b behavior preserved; every existing suite must stay green)
**Successor (deferred):** Deferred intelligence patch (AI) — explicitly out.

## Goal

Implement PLAN.md 17 Phase 10 as one cycle: plans, subscriptions, usage limits, billing, webhooks, feature flags, payment integrations, accounting exports, printers, customer-facing display, and public API — with server-side entitlement enforcement per §16.2 ("never only hidden UI").

**Exit (adapted from PLAN.md 16.2 + 17):** a new business trials Pro then enforces Free caps server-side; grandfathered businesses keep working untouched; provider webhooks apply idempotently; an offline-capable cashier flow still syncs; printers, display, exports, and public API all work against test doubles — with all Phase 0-9b suites still green.

## Approach record

Two structural facts drove this design: (1) the repo has zero billing machinery (no plan/subscription/entitlement model anywhere), and (2) PLAN.md names no billing or payment provider and there are no live credentials. Therefore billing and provider settlement ship as **our own ledger + adapter interfaces** (`manual` and `test-double` adapters included; real-money SDKs explicitly out). Anything claiming a live provider without credentials would be theater; the interfaces make a future adapter a bounded task.

## Architecture

Two new module families in the existing modular monolith; no new infra, no workers, no cron (time-based transitions resolve lazily per request — YAGNI over schedulers):

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  BillingModule  plans, subscriptions, invoices, entitlements,
                 usage counters, feature flags, webhook ingestion
  IntegrationsModule  provider-settlement interface, accounting exports,
                 print-job queue, display feed, public API tokens
  Catalog/Sales/Payments/...  unchanged except entitlement gates at
                 existing mutation points (additive checks only)
```

Money/stock decisions stay in the existing transactional paths. Billing is a parallel ledger, neverInline in the sale commit path.

## Data Model (migration 0011_phase10_billing)

```text
Plan            id, key UNIQUE (free|basic|pro|enterprise), name,
                allowances JSON, pricesMinor JSON, isActive
Subscription    id, businessId UNIQUE, planId, status
                (trialing|active|past_due|canceled),
                trialEndsAt?, currentPeriodEnd, providerRef?
Invoice         id, businessId, subscriptionId, periodStart, periodEnd,
                amountMinor, currency, status (open|paid|void),
                issuedAt, paidAt?
UsageCounter    id, businessId, key, period, count, updatedAt
                @@unique([businessId, key, period])
FeatureFlag     id, businessId? (null = global default), key,
                enabled  @@unique([businessId, key]) with null-business rows
BillingWebhookEvent  id, provider, eventId UNIQUE, type, payload JSON,
                status (applied|unhandled|rejected), receivedAt
ApiToken        id, businessId, name, tokenHash UNIQUE, prefix,
                scopes JSON, revokedAt?, expiresAt?
PrinterDevice   id, businessId, branchId?, name, width (58|80),
                connection (test-double|manual)
PrintJob        id, businessId, printerId, receiptNo?, layout,
                status (QUEUED|SENT|FAILED), payload BYTES-as-base64,
                attempts
DisplayToken    id, businessId, registerId, tokenHash UNIQUE,
                expiresAt
```

Plans seed in-migration (Free/Basic/Pro/Enterprise per §16.2). Prices `[SPEC-DEFAULT]` (PHP minor, editable via Plan row by platform admin; flagged as the first value to revisit with real pricing): Basic ₱490/mo (49000), Pro ₱1,490/mo (149000), Enterprise contact-sales (0 = admin-granted only).

## Tiers, trials, grandfathering

Effective plan resolves per request: subscription plan, except `trialing` past `trialEndsAt` resolves to Free (lazy; transition audited on first observed expiry — no cron).

- **New businesses:** Pro trial, 14 days `[SPEC-DEFAULT]`, then Free.
- **Existing businesses:** seed Enterprise. Required: branches (§16.2 Enterprise feature) already shipped to everyone; downgrading anyone would break working businesses (principle: correctness first). Platform admin may change plans afterward.
- **Free** `[SPEC-DEFAULT]` (allowances where PLAN.md says only "small"): users 3, products 100, registers 1, branches 0 (null-scope head-office operation always works; *creating* branches is gated). Features: daily loop stays (POS, dashboard overview, inventory, sales history); gated: reports pages, customers, receipt customization.
- **Basic** adds: users 10 / products 2,000 / registers 3; reports, customers, receipt customization.
- **Pro** adds: users 50 / products 20,000 / registers 10; advanced reports, employee permissions, expenses, advanced analytics.
- **Enterprise:** unlimited enumerated caps; branches, central management, API, advanced permissions, integrations. (`central management` beyond branches and `dedicated support` have no product surface yet — reserved entitlement keys, no dead code.)

## Entitlement enforcement

`requireEntitlement(businessId, key)` runs server-side inside existing mutations (create user/product/register/branch; gated features). Breach → `PLAN_LIMIT` (402) with machine fields `{ limit, used, plan }`, audited. Usage counters increment in the same transaction as the gated write. UI hides/disables too, but the server gate is authoritative (§16.2). Limit checks use live counts (authoritative) with `UsageCounter` as the auditable snapshot trail, reconciled by a rebuild-style checker.

## Billing, invoices, webhooks

Invoices issue lazily on period rollover (first billing read past `currentPeriodEnd` closes the period, opens an invoice from plan prices, advances the period) plus a platform "issue now" action. Money in integer minor units, same rounding policy.

Webhooks: `POST /api/v1/billing/webhooks/:provider` (`manual`, `test-double`). HMAC-SHA256 signature over the raw body against the provider's configured secret (missing secret → 401; bad signature → 403). `eventId` unique → replay returns the original application (idempotent). Handled events: `subscription.created|updated`, `invoice.paid|void` → mutate Subscription/Invoice + audit. Unknown types ack 200 as `unhandled` (stops provider retries, stays visible).

## Payment provider settlement

`ProviderAdapter { queryStatus(providerRef) }` + `manual` (human confirms via existing reconcile) + `test-double` (scripted outcomes). GCash/Maya/card methods route settlement queries through it; every non-definitive answer stays `PAYMENT_UNKNOWN` per FR-PAY-04 and reconciles through the existing endpoint. No SDK, no card data (extends §7 rule).

## Accounting exports, printers, display

- **Exports:** `GET /api/v1/exports/ledger.csv` journals (sales, payments, expenses, inventory adjustments) from existing ledger data with a documented account map `[SPEC-DEFAULT]` (`4000` revenue, `1000` cash, `5000` COGS, `6000` expenses); export action audited; sums reconcile to report totals.
- **Printers:** `PrinterDevice` registry + `PrintJob` queue; `escposReceipt(sale, 58|80)` is a pure function (thermal layouts per FR-RECEIPT-01); paired agents poll `GET /api/v1/print-jobs/next` (device token); test-double printer fulfills in tests. Hardware pairing is documented ops follow-up.
- **Display:** `GET /api/v1/display/:registerId` (short-lived token) returns business name, shift state, and last completed sale; `/display` page polls. Live-cart mirroring needs a cart-sync protocol — explicitly follow-up, not claimed.

## Public API + platform access

`ApiToken` with scopes `[SPEC-DEFAULT]` (`sales:read`, `catalog:read`, `catalog:write`, `reports:read`, `inventory:read`); Bearer auth by prefix lookup + constant-time hash compare; stricter rate bucket (60/min `[SPEC-DEFAULT]`); every call audited with token id. Reuses versioned `/api/v1` routes.

Platform routes (`/api/v1/platform/*`: plan change, issue invoice, flag override) authenticate by `x-platform-key` bearer against env `PLATFORM_API_KEY` (rotation in runbook) + audit actor `platform`. Tenants can never change their own plan.

## Permissions

No new RBAC permission keys except through the entitlement matrix (orthogonal axis: role says *who*, entitlement says *whether the plan allows it*). Webhook ingestion is signature-gated, not session-gated. Resolve-style review actions stay owner/manager.

## API Endpoints (all `/api/v1`, envelope unchanged)

```text
GET    /api/v1/billing/subscription        (current plan, trial, usage)
GET    /api/v1/billing/invoices
POST   /api/v1/billing/webhooks/:provider  (signature-gated, idempotent)
GET    /api/v1/exports/ledger.csv
GET    /api/v1/printers  POST /api/v1/printers  POST /api/v1/print-jobs
GET    /api/v1/print-jobs/next             (device token)
GET    /api/v1/display/:registerId         (display token)
GET    /api/v1/apitokens  POST /api/v1/apitokens  POST /api/v1/apitokens/:id/revoke
GET/POST /api/v1/platform/*                (platform key)
```

New stable code: `PLAN_LIMIT` (402). Reuse `VALIDATION`, `FORBIDDEN`, `NOT_FOUND`, `IDEMPOTENCY_MISMATCH`.

## Web UI

Same appliance language: `/billing` (plan, trial countdown, usage meters, invoices), display of `PLAN_LIMIT` errors with upgrade path, `/sync`-style print queue page, `/display` customer page, platform section for plan/flag management (owner-visible? No — platform-key session flag `[SPEC-DEFAULT]`), API token management under settings.

## Audit

Append-only: `plan.change`, `subscription.*`, `invoice.*`, `webhook.*`, `export.*`, `print.*`, `apitoken.*` with snapshots, actorId (or `platform`), requestId, idempotency/event keys.

## Test Strategy

TDD. Unit (entitlement matrix incl. grandfathering + trial expiry boundaries, invoice math, webhook signature verification, ESC/POS byte snapshots, scope checks). Memory-DB integration + supertest contract (gates on every capped mutation, cross-tenant isolation, webhook replay idempotency, token scope/revoke). Playwright E2E (trial→downgrade caps enforced in UI; offline sale still syncs under Free; display shows last sale). Exit test + verify script + CI, migration proof 0001→0011 on live Postgres.

## Performance Budgets

Entitlement check p95 < 20 ms local (cached plan + counters per request, no extra round trips on hot paths); webhook ack p95 < 500 ms; exports stream (no full-table loads); display poll cheap read. Reuse existing sale/payment budgets untouched.

## Exit Criteria

- New business trials Pro, expires to Free, and creating a 2nd register / 4th user / 101st product fails server-side with `PLAN_LIMIT` + fields.
- Grandfathered Enterprise business passes all Phase 0–9b suites untouched.
- Webhook replay applies once; bad signature rejected; unknown types acked as unhandled.
- Test-double provider settles UNKNOWN→SUCCEEDED via existing reconcile; CSV sums reconcile; print bytes correct for 58/80mm; display shows last sale; scoped/revoked tokens behave.
- Migrations 0001→0011 apply cleanly; all prior suites green.

## Non-Goals

Real-money provider SDKs, cron workers (lazy resolution), invoice email delivery, live hardware pairing, multi-currency billing (PHP only, extensible model), AI.
