# @pos/database - Phase 0

Prisma schema Phase 0 subset per PLAN.md 6.1 and 6.7. Every business-owned model includes businessId. No catalog, sales, or inventory models in Phase 0.

## Migrations (PLAN.md 14.1)

- Forward-applied only: `prisma migrate deploy`.
- Reviewed before apply.
- Rollback is restore from backup. No down-migration of audit data (AuditLog is append-only).
