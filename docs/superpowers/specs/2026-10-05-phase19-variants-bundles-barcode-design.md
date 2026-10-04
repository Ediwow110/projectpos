# Phase 19 — Product Variants, Bundles/Kits, Barcode Labels, and Scanner Workflows

## Goals

- Add product families and option combinations while keeping every stock-bearing variant as an ordinary `Product` row.
- Add fixed, non-nested sellable bundles whose physical inventory is derived exclusively from component Products.
- Add safe internal barcode generation, label preview/print, and exact barcode-first scanner flows.
- Preserve tenant/branch isolation, existing Product IDs and history, offline safety, role boundaries, and memory/Postgres parity.

## Architecture decisions

### Variants

`ProductFamily`, `ProductOption`, `ProductOptionValue`, and `ProductVariantOptionValue` are additive business-scoped entities. A family is a catalog grouping, never a balance or movement owner. Creating a variant materializes a normal Product with optional `familyId`; the existing `InventoryBalance`, `InventoryMovement`, `SaleItem`, procurement, count, and replenishment paths continue to receive that Product ID.

Server limits are three option dimensions, twenty values per option, and one hundred generated variants per family. A family cannot contain duplicate option combinations. Existing business-wide SKU and barcode uniqueness remains authoritative, including leading-zero barcode strings.

Variant display names use `Family · Value / Value` in option position order. Historical sale, procurement, count, and movement snapshots are never rewritten when family or option labels change.

### Bundles

`ProductBundle` identifies a bundle Product and `BundleComponent` stores positive component quantities. Bundle Products are materialized Products with `trackInventory=false`; they never receive physical balances, receiving lines, counts, replenishment recommendations, or manual stock movements. Components must be active, tracked, same-business, non-bundle Products, unique per bundle, and cannot include the bundle itself.

Availability is branch-aware and derived as the minimum `floor(componentOnHand / requiredQty)`. Bundle checkout is online-only for Phase 19 so the server can validate the authoritative composition and balances. Component Product IDs are sorted before inventory locks. Completion decrements all components atomically; any shortage rolls back the entire sale.

`SaleItemBundleComponent` snapshots component name, quantity-per-bundle, cost, and bundle composition version at sale time. Refunds restore the snapshot quantities, including partial refunds, and use existing refund idempotency. Editing a bundle only affects future sales.

### Barcodes and labels

`Product.barcode` remains canonical. Internal generation creates a server-checked, stable, human-readable `NXP-...` Code 128-compatible string and never overwrites an existing value. Generated values are internal identifiers, not GS1/UPC registration claims. Label rendering is web-side and browser-printable; no printer SDK or persisted print mutation is required.

### Scanner behavior

Exact barcode matches resolve one active Product and may auto-add on POS submit/Enter. Fuzzy text matches never auto-add. Unknown and archived barcodes have explicit states. Receiving and count scanner helpers only select matching existing lines; they never auto-post inventory. Keyboard-wedge input is the baseline hardware contract.

### Offline behavior

Variants use the existing cached Product catalog and are safe to search offline. Bundle checkout remains blocked offline with an explicit message because authoritative component composition and availability cannot be validated safely.

## Persistence and security

- Additive Prisma migration only; no Product, inventory, sale, procurement, or count rewrite.
- New tables have business foreign keys, indexes, uniqueness constraints, and RLS enabled.
- API handlers enforce business scope, active branch scope for availability, and existing catalog/sale/inventory permissions.
- Family/variant/bundle/barcode writes emit the specified audit actions.

## API surface

- `GET/POST/PATCH /api/v1/product-families`
- `GET/POST/PATCH /api/v1/product-families/:id/options`
- `GET/POST/PATCH /api/v1/product-families/:id/variants`
- `GET/POST/PATCH /api/v1/bundles`
- `GET /api/v1/products/:id/bundle`
- `POST /api/v1/products/:id/barcode/generate`
- `GET /api/v1/products/barcode/:barcode`
- `GET /api/v1/labels`

Existing catalog search returns family/option display metadata while retaining the existing Product shape for cart and inventory consumers.

## Verification strategy

Unit and service tests cover validation, limits, uniqueness, availability, locks, snapshots, refunds, idempotency, and simple-product compatibility. PostgreSQL tests cover migrations, RLS, tenant/branch boundaries, and concurrency. Browser tests cover family/variant creation, exact barcode lookup, POS picker/cart identity, bundle availability, labels, receiving/count helpers, responsive layouts, and keyboard accessibility. Full regression remains mandatory before merge; production smoke uses isolated Phase 19 fixtures and does not force a payment or physical printer action.
