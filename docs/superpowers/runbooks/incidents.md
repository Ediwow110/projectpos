# Incident Playbooks

**Date:** 2026-09-23
**Scope:** the five PLAN.md §14.3 scenarios. Each playbook: symptoms → first 3 commands → escalation → audit entries to inspect.

## 1. Payment reconciliation (`PAYMENT_UNKNOWN` triage)

Symptoms: attention panel shows unknown payments; cashier reports a completed-looking sale with no receipt; `pos_payments_unknown_total` alert fires.
1. `GET /api/v1/sales?status=PAYMENT_UNKNOWN` — list affected sales (note ids + providers).
2. For each: query the provider dashboard/settlement report for the `providerRef`; then `POST /api/v1/payments/:id/reconcile` with the SAME `Idempotency-Key` per attempt and the confirmed outcome.
3. Re-run the unknown-payments attention check; confirm zero unknown.
Escalation: provider confirms charge but reconcile fails → freezefurther completes on that register, page the on-call engineer. Never tell a cashier to retry with a new key.
Audit: `payment.reconcile` rows (actor, requestId, idempotency key); `sale.complete` rows with 202 responses in API logs via correlation IDs.

## 2. Inventory drift (ledger vs balance)

Symptoms: `POST /api/v1/inventory/rebuild` returns non-empty `drifts`.
1. Re-run rebuild; export the drift list (productId, balanceOnHand, ledgerSum).
2. Pull `GET /api/v1/inventory/products/:id/movements` for each drifted product; look for movements without matching sale/refund references or duplicate requestIds.
3. If a code defect is suspected, stop writes on affected products (deactivate in catalog) and page engineering. Balances are a projection — the ledger is authoritative; correct by audited `adjustment` movements with reason referencing this incident, never direct edits.
Audit: `inventory.adjust` rows with incident reason; `AuditLog` entries around the drift window.

## 3. Failed deploy (migration or boot failure)

Symptoms: CI red on migration-check; staging/prod fails to boot after deploy.
1. Read the migration error; identify the failing migration file.
2. Roll forward preferred: fix the migration, open a new PR, re-run CI. Database restores are the last resort (data loss window).
3. If the app boots but serves 500s: roll back the deploy to the previous image/commit, then investigate with correlation IDs from error envelopes.
Audit: CI logs; `migrate deploy` output; error envelopes' correlation IDs.

## 4. Database restore

Symptoms: data loss, corruption, or a failed destructive migration.
1. Stop all writers (take the API offline) to freeze the damage window.
2. Pick the newest verified backup (see backup-restore runbook retention rules); restore to a THROWAWAY database first and verify table + spot-check row counts.
3. Only then restore production; re-run migrations to HEAD; smoke-test login → POS sale → shift close.
Escalation: any doubt about backup freshness → page the owner before overwriting production.
Audit: backup job logs (`pos_backup_last_success_timestamp`), restore command transcript, post-restore smoke results.

## 5. Credential compromise / support-access misuse

Symptoms: unknown sessions, off-hours admin actions, customer report, or failed-login spike that turns into successes.
1. Force-expire sessions: revoke all sessions for affected users (logout-everywhere path), rotate `DATABASE_URL`/session secrets, force password resets.
2. Pull `AuditLog` for the affected business across the window: filter `actorId`, `ip`, privileged actions (`user.manage`, `settings.write`, `export.run`, `shift.close.override`).
3. Export the relevant audit slice (CSV) before any remediation writes; preserve it for review.
Escalation: confirmed data exfiltration (bulk exports by unknown actor) → notify affected business owners; rotate everything.
Audit: the `AuditLog` rows themselves, plus `auth.*` actions (logins, password changes, session revocations).
