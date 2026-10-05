# Phase 21 Baseline Audit — 2026-10-06

## Scope and provenance

- Baseline commit: `78f0a9cdba7e496f06df22ebd262113854db81a8`
- Worktree: dedicated `codex/phase21-production-hardening`
- Production changes: none during baseline collection
- Source roadmap: `docs/superpowers/specs/2026-10-06-phase21-production-hardening-design.md`

The original checkout contains unrelated modified/untracked files. This audit was collected from the clean Phase 21 worktree and does not include those files.

## Baseline commands

| Command | Result |
| --- | --- |
| `pnpm verify` | `SCAFFOLD_OK` |
| `pnpm typecheck` | Pass, 7/7 workspace packages |
| `pnpm lint` | Pass, zero diagnostics |
| `pnpm test` | Pass, 107 API files / 520 API tests and 61 web files / 226 web tests, plus shared packages |
| `pnpm audit --prod --audit-level critical` | `No known vulnerabilities found` |

The first typecheck attempt before dependency installation stopped because the fresh worktree had no `node_modules`; `pnpm install --frozen-lockfile` restored the locked toolchain. No source change was required for that environmental condition.

## Architecture inventory

- API: NestJS modular monolith under `apps/api/src`, with memory and PostgreSQL `DbPort` implementations.
- Web: Next.js application under `apps/web/src`, same-origin `/api` proxy in production.
- Persistence: Prisma schema/migrations plus hand-written PostgreSQL family adapters; RLS deny-all posture is migration-owned and access is mediated by the application port.
- Security primitives: session guard, CSRF guard, permission guard, tenant guard, request IDs, rate limits, manager approvals, audit log, security headers, and signed payment callbacks.
- Offline: explicit POS cash queue/replay in the web app; stored value, provider payments, approvals, and other sensitive mutations remain online-only.
- CI: lint, typecheck, tests, build, audit, verify scripts, PostgreSQL suite, and Playwright suite are defined in `.github/workflows/ci.yml`.

## Initial findings

### Correctness

1. `Sale` does not define `voidedAt` or `voidReason` in Prisma or `DbSale`.
2. `SalesLifecycleService.voidSale()` transitions status and writes audit metadata but only patches `status`; the supplied reason is not stored on the sale projection.
3. Product-family management supports family metadata, option creation, and variant creation, but no safe option/dimension edit contract exists.

### Existing strengths to preserve

- Gift-card bearer codes are masked outside one-time issuance UI.
- Critical payment, refund, inventory, stored-value, and manager-approval paths already use idempotency/locking patterns.
- Sales, inventory, procurement, branch, device, and stored-value queries generally receive business scope from authenticated context rather than client body fields.
- Existing observability has request IDs, correlation IDs, process metrics, and audit request IDs; Phase 21 will test their boundaries before changing them.

## Phase boundary

This audit does not claim Phase 21 complete. It is the evidence baseline for Tasks 2–9. Omnichannel, accounting, workforce, and new hardware features remain deferred to Phases 22–25.

