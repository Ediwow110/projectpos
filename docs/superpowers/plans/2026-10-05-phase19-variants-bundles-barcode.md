# Phase 19 implementation plan

Spec: `docs/superpowers/specs/2026-10-05-phase19-variants-bundles-barcode-design.md`

## Dependency-ordered tasks

### Foundation

1. Add additive Prisma schema/migration for families, options, variant links, bundles, components, and sale-time component snapshots; enable RLS and indexes.
2. Extend validation, `DbPort`, memory storage, PostgreSQL storage, and `PgDbPort` with family/variant/bundle/snapshot primitives. Add unit tests first for limits and uniqueness.

### Variant vertical slice

3. Implement family/option/variant services and controllers with catalog permission checks, audit events, materialized Product creation, archive/edit behavior, and enriched search.
4. Add product-family/variant management UI and responsive accessibility coverage. Verify independent inventory, procurement, counts, and replenishment using ordinary Product IDs.

### Bundle vertical slice

5. Implement bundle validation, derived branch availability, and API/UI management. Reject nested bundles, duplicate/self/untracked/cross-tenant components.
6. Integrate bundle composition into sale completion, deterministic component locks, sale snapshots, component-only movements, exact-once replay, and offline blocking.
7. Integrate snapshot-based partial refunds and historical-composition tests; exclude bundles from receiving, counts, transfers, supplier returns, and replenishment.

### Barcode/printing/scanners

8. Add internal barcode generation and exact lookup APIs, preserving external strings and uniqueness.
9. Add labels route with selectable products/variants/bundles, quantity bounds, Code 128 rendering, print CSS, preview, and browser print workflow.
10. Add POS exact-scan behavior plus receiving/count line helpers and unknown/duplicate/archived states.

### Verification and delivery

11. Add API/PG/web/E2E/regression tests, run typecheck/lint/build/parity and the complete CI matrix.
12. Open the dedicated PR, merge only after green checks, verify Render deployment/migration/RLS, then run isolated production variant/bundle/label/scanner smoke. Do not begin Phase 20.

## Checkpoints

- After Tasks 1–2: schema, adapters, and focused unit/PG tests pass.
- After Tasks 3–4: variant catalog and ordinary Product inventory flows pass.
- After Tasks 5–7: bundle sale/refund/concurrency/idempotency tests pass.
- After Tasks 8–10: label/scanner browser tests pass at desktop, tablet, and mobile widths.
- Before merge: full regression, CI, and security checks are green.
- Before closure: Render live on merge SHA and isolated production smoke is complete.

## Global constraints

- `Product` remains the only stock-bearing SKU model.
- Bundle Products never receive independent physical stock.
- No nested/configurable bundles, manufacturing, GS1 registration, or Phase 20 work.
- Preserve unrelated working-tree changes and the known `voidReason` issue.
