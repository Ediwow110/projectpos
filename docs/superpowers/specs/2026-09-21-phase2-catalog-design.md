# Phase 2 Catalog Design - Online POS

**Date:** 2026-09-21
**Source spec:** `G:\Vscode\PLAN.md` sections 4.2 (FR-CATALOG-01, FR-CATALOG-02), 5.3, 5.4, 6.1, 6.2, 6.7, 7, 17 (Phase 2)
**Status:** Implementation-ready, derived strictly from PLAN.md. Where PLAN.md is silent on a numeric default, this spec chooses one and marks it `[SPEC-DEFAULT]`.
**Predecessor:** `docs/superpowers/specs/2026-09-21-phase1-auth-design.md` (all Phase 1 primitives reused unchanged)

## Goal

Implement PLAN.md 17 Phase 2: products, categories, prices/costs, SKU/barcode, tax fields, search, active state, import guardrails, and permissions.

**Exit (PLAN.md 17 verbatim):** a cashier can search a bounded catalog quickly and a manager can safely change catalog data with audit entries.

## Architecture

One new NestJS module following Phase 1 conventions exactly:

```text
Browser (Next.js) -> NestJS (/api/v1) -> PostgreSQL (Prisma)
  CatalogModule    categories + products + import (new in Phase 2)
  AuthModule       unchanged (rolePermissions() reused for gating)
  TenantModule     unchanged (tenant derivation reused)
  BusinessModule   unchanged (tax defaults read from settings)
```

Cross-module calls use NestJS services only, never direct table access (PLAN.md 5.3). Pure domain logic lives in framework-free functions under `apps/api/src/catalog/` and is unit-tested directly; the controller is a thin adapter tested via `supertest`. `DbPort` is extended with catalog methods; `createMemoryDb` implements them in-memory for contract tests. No Redis, workers, storage, or offline in Phase 2.

## Data Model

All Phase 0/1 models reused as-is. Two additions, both tenant-scoped per FR-TENANT-01:

```text
Category
  id, businessId, name, description?, isActive (default true),
  createdAt, updatedAt
  @@unique([businessId, name])   // category names unique per tenant

Product
  id, businessId, categoryId?, name,
  sku? (normalized uppercase, trimmed), barcode? (trimmed),
  brand?, unit (default "pc" [SPEC-DEFAULT]),
  costMinor (int >= 0), priceMinor (int >= 0),
  taxRateBps? (int 0..10000, null = inherit business default),
  reorderLevel (int >= 0, default 0),
  trackInventory (bool, default true),
  isActive (bool, default true),
  imageUrl? (URL string, no upload in Phase 2),
  createdAt, updatedAt
  @@index([businessId, isActive])
  @@index([businessId, categoryId])
```

Uniqueness (enforced in service + unique indexes where the database allows; SQLite/Postgres partial indexes in migration):
- `(businessId, sku)` unique when sku is non-null.
- `(businessId, barcode)` unique when barcode is non-null.

Money follows PLAN.md 6.2: integer minor units (centavos), no float. `taxRateBps` is basis points (e.g. 1200 = 12%) matching the existing `businessSettingsSchema.taxRateBps` convention.

## Validation

Zod schemas in `packages/validation/src/catalog.schema.ts`, reusing `moneyMinorSchema` / `priceSchema` from `money.schema.ts`:

- `categoryCreateSchema`: name 1..80 chars, description max 500 optional, isActive boolean optional.
- `categoryUpdateSchema`: all fields optional, at least one present.
- `productCreateSchema`: name 1..160, sku max 64 optional (empty string treated as absent), barcode max 64 optional, brand max 80 optional, unit max 16 default "pc", costMinor int >= 0, priceMinor int >= 0, taxRateBps int 0..10000 optional, reorderLevel int >= 0 default 0, trackInventory boolean default true, isActive boolean default true, imageUrl URL max 500 optional, categoryId string optional.
- `productUpdateSchema`: all fields optional; sku/barcode may be explicitly nulled to clear them.
- `productSearchSchema`: q max 120 optional, categoryId optional, active boolean optional (default true for cashier-facing search), page int >= 1 default 1 `[SPEC-DEFAULT]`, pageSize int 1..100 default 20 `[SPEC-DEFAULT]`.
- Rejections with stable codes: negative cost/price (`MONEY_NEGATIVE`), non-integer money (`MONEY_NOT_INTEGER`), oversize pageSize (`VALIDATION`).

Normalization (domain function `normalizeProductInput`): trim name/brand/unit; sku uppercased + trimmed, empty to null; barcode trimmed, empty to null; imageUrl trimmed.

## Search Semantics (FR-CATALOG-02)

`GET /api/v1/products` supports name, SKU, barcode, and category with bounded page pagination:

- `q` matches case-insensitive substring on name, substring on sku, or exact match on barcode. Empty `q` lists the bounded page.
- `categoryId` filters to one category (must belong to the same business, else `VALIDATION`).
- `active`: `true` (default) returns only `isActive` products; `false` returns only archived; `all` returns both (manager/inventory use).
- Pagination: `{ page, pageSize, total, items }`. `pageSize` capped at 100, default 20 `[SPEC-DEFAULT]`. Sort is `name ASC, id ASC` (deterministic for bounded pages).
- Every read is scoped via `withScope(businessId)` — cross-tenant IDs return `NOT_FOUND`, never another tenant's row.

## Permissions (FR-RBAC-01, FR-RBAC-02)

Reuse Phase 1 `SENSITIVE_ACTIONS` keys and `ROLE_SEED`; no new permission keys in Phase 2:

| Operation | Required | Owner | Manager | Cashier | Inventory |
|---|---|---|---|---|---|
| Search/list categories + products | session + membership | yes | yes | yes | yes |
| Get product detail | session + membership | yes | yes | yes (cost redacted) | yes |
| Create/update/archive category + product | `price.edit` | yes | yes | no (`FORBIDDEN`) | yes |
| Import products | `price.edit` | yes | yes | no | yes |
| See `costMinor` in responses | `cost.view` | yes | yes | no (omitted) | yes |

- Price/cost edits are permission-sensitive per FR-RBAC-02, hence the `price.edit` gate on all writes.
- Cost redaction helper `redactForRole(product, permissions)` omits `costMinor` unless `cost.view` is granted. Cost remains in audit snapshots (audit is append-only and read-gated elsewhere).
- Settings write re-auth is NOT required for catalog writes (re-auth gates role assignment and business settings only, per Phase 1 spec).

## Import Guardrails

`POST /api/v1/products/import` accepts `{ items: ProductCreate[] }` (JSON, not CSV in Phase 2):

- Max 200 rows per request `[SPEC-DEFAULT]`; larger returns `CATALOG_IMPORT_TOO_LARGE`.
- Each row validated by `productCreateSchema`; row failures return `400 VALIDATION` with `fields` mapping `items.<index>.<field>` to error codes. Nothing is created when any row fails (all-or-nothing).
- Duplicate sku/barcode inside the file or against existing tenant rows returns `CATALOG_DUPLICATE_SKU` / `CATALOG_DUPLICATE_BARCODE` with row indexes. Nothing is created.
- Rate limit `[SPEC-DEFAULT]`: 5 imports per minute per business (reuse `createRateLimiter`).
- Requires `price.edit`; writes one `product.import` audit entry summarizing count (not one entry per row).

## Audit (PLAN.md 6.7)

Append-only `AuditLog` rows (existing table) for every mutation:

- `category.create`, `category.update`, `product.create`, `product.update`, `product.archive`, `product.import`.
- Snapshots: `beforeSnapshot`/`afterSnapshot` store the full row (cost included); password-like redaction does not apply (no secrets in catalog rows).
- `requestId` from correlation, `actorId` from session. No app-level updates/deletes.

## API Endpoints

All under `/api/v1`, `SessionGuard` on every route, `CsrfGuard` on mutations, error envelope `{ code, message, correlationId, fields? }`:

```text
GET    /api/v1/categories
POST   /api/v1/categories            (price.edit)
PATCH  /api/v1/categories/:id        (price.edit)
GET    /api/v1/products              (search, bounded page)
POST   /api/v1/products              (price.edit)
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id          (price.edit)
POST   /api/v1/products/:id/archive  (price.edit)
POST   /api/v1/products/:id/restore  (price.edit)
POST   /api/v1/products/import       (price.edit, rate-limited)
```

New stable error codes (added to `CODE_STATUS`): `CATALOG_DUPLICATE_SKU` (409), `CATALOG_DUPLICATE_BARCODE` (409), `CATALOG_IMPORT_TOO_LARGE` (400). Cross-tenant or missing rows return `NOT_FOUND` (404). All timestamps ISO 8601 UTC.

## Web UI

Minimal catalog surfaces reusing Phase 1 web patterns (TanStack Query + `apiFetch`, no new dependencies):

- `/products`: search input (name/SKU/barcode), category filter, active/inactive toggle, bounded list with pagination; links to detail. Cashier-usable (read-only when lacking `price.edit`).
- `/products/:id`: detail + edit form (price/cost/tax/stock flags); cost field hidden without `cost.view`; archive/restore buttons with `price.edit`.
- `/categories`: list + create/rename/archive form.
- Role comes from `GET /api/v1/me`; the UI hides write affordances without `price.edit` but the server is authoritative.

## Test Strategy

TDD red-green-refactor throughout. Vitest unit (schemas, domain helpers, redaction), memory-DB integration (tenant scoping, duplicate guards, pagination bounds), supertest contract (auth, validation codes, permission gates, audit writes, cross-tenant `NOT_FOUND`), Phase 2 exit test (`tests/phase2-exit.test.ts`), script check (`scripts/verify-phase2.test.mjs`), CI extended.

## Exit Criteria

- Cashier-role search over a seeded catalog returns bounded pages filtered by name/SKU/barcode/category without seeing cost.
- Manager-role create/update/archive/import round-trip succeeds with audit entries per mutation.
- Cross-tenant product/category read or write returns `NOT_FOUND`/`FORBIDDEN` safely.
- Duplicate SKU/barcode rejected; oversize import rejected; nothing partially created.

## Non-Goals (deferred)

Inventory ledger and balances (Phase 3), POS cart UI (Phase 4), product variants, image upload/storage, CSV parsing, bulk delete, exports (`export.run`), branches, offline, billing, integrations, AI. Image is a URL string only.
