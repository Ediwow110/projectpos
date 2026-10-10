# Implementation Plan: Team Multi-Role and Temporary Delegation

## Scope

Evolve NexPOS memberships from one role per business membership to auditable role assignments while preserving the existing user identity, tenant isolation, owner safety, and session invalidation rules. This change is separate from Phase 22 production closure and will not mutate production configuration.

## Ordered slices

1. **Assignment foundation** — add the normalized role-assignment model and migration; backfill each current membership role as a permanent assignment; define active/expired/revoked semantics and uniqueness/idempotency constraints.
2. **Effective authorization** — make session authorization resolve the union of active assignments, preserve branch scope, and invalidate sessions when a membership is deactivated or assignments are revoked.
3. **Management API** — add permission-gated, CSRF/origin-protected endpoints for listing history, assigning/revoking roles, temporary expiration, reactivation, and deactivation with audit records and last-owner protection.
4. **Team UI** — show active/deactivated members and assignment history; add role-management and temporary-delegation flows that reflect server permissions.
5. **Verification** — focused unit/service tests, PostgreSQL migration/integration tests, API security tests, scoped web tests, typecheck/lint/build, then review before any staging or production action.

## Invariants

- Generic assignment endpoints cannot grant or revoke `owner`; ownership transfer is a separate future workflow.
- A member keeps one identity and can have multiple compatible assignments.
- Effective permissions are computed server-side from active assignments only.
- Deactivation revokes active sessions and preserves all historical records.
- Repeated role-management commands are idempotent and cannot create duplicate active assignments.
- Cross-tenant and cross-branch access remains denied.
