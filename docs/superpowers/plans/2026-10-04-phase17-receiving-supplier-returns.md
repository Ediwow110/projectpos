# Phase 17 Receiving + Supplier Returns Implementation Plan

- [ ] Add validation schemas for receipts, returns, and post/cancel operations.
- [ ] Add additive migration `0029_phase17_receiving_returns`, Prisma models,
      and runtime parity entries.
- [ ] Extend DbPort, memory store, and PostgreSQL family with receipt/return
      rows, sequences, and lookups.
- [ ] Implement receiving and supplier-return services with transaction,
      inventory locks, idempotency, status transitions, audit, and RBAC.
- [ ] Add controller routes and wire the Nest module.
- [ ] Add PO detail receiving/history/returns UI and client helpers.
- [ ] Add focused service/API/web/exit tests, then run lint, typecheck, tests,
      build, and scaffold checks.
- [ ] Push PR and stop after Phase 17 production acceptance. Do not start
      Phase 18.
