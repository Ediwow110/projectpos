# Phase 18 implementation plan

Spec: `docs/superpowers/specs/2026-10-05-phase18-stock-counts-replenishment-design.md`

## Tasks

1. Extend validation and the memory/Postgres database ports with count entities, line storage, count counters, and count idempotency primitives.
2. Add the additive Prisma schema/migration and PostgreSQL implementation with RLS and transaction-safe uniqueness constraints.
3. Implement the count domain service and controller: lifecycle, snapshots, stale detection, approval fingerprinting, atomic post, cancellation, audit, and exact-once replay.
4. Implement replenishment calculation and reviewed draft-PO creation using existing procurement primitives.
5. Add web clients/pages/navigation for counts and replenishment, preserving NexPOS design tokens and responsive/accessibility conventions.
6. Add regression tests for domain/API/Postgres/web behavior, run verification, and document evidence.

## Global constraints

- Use only the existing `InventoryMovement` ledger; create `stock_count` rows only for non-zero variances.
- All reads and writes remain tenant- and branch-scoped.
- Do not start Phase 19 or touch the known `voidReason` issue.
- Preserve all unrelated working-tree changes.
