# Backup and Restore

**Date:** 2026-09-23
**Tools:** `scripts/backup.sh`, `scripts/restore.sh` (`pg_dump`/`pg_restore` custom format).

**Phase 21 safety:** both scripts fail closed when required environment variables are absent; backup files are created with owner-only permissions (`umask 077`), the dump must be non-empty, and restore refuses a missing `BACKUP_FILE`. Neither script echoes `DATABASE_URL` or sources a secrets file.

## Policy

- **Retention [SPEC-DEFAULT]:** daily backups kept 7 days, weekly (Sunday) kept 4 weeks, monthly (1st) kept 6 months. Prune by filename timestamp; never prune the latest successful backup.
- **Encryption:** production volumes use provider-managed encryption at rest; offsite copies use an encrypted bucket (SSE-S3 minimum, kms key documented in the deploy repo, never here).
- **Access:** database credentials live in environment configuration only (see `.env.example` — never commit real values). Only the business owner role holds production credentials.
- **Windows local dev:** no `sh` required — pipe through the running container exactly like the migration proofs:
  `Get-Content file.sql -Raw | docker exec -i <container> psql -U pos -d pos`. For dumps, prefer `docker exec <container> pg_dump -U pos -d pos -Fc -f /tmp/x.dump` then `docker cp`.

## Restore drill procedure

1. Start a throwaway Postgres (`pos-db-drill`, host port 5433 — never touch another project's database).
2. Apply migrations 0001→latest in order with `ON_ERROR_STOP=1`.
3. `pg_dump -Fc` to a timestamped file (this is the "backup").
4. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (simulated loss).
5. `pg_restore --clean --if-exists` from the file.
6. Verify: `\dt` lists all tables; row counts match the pre-drop counts.

For a real drill, export `DATABASE_URL` only in the shell environment and use an explicit throwaway database name. Never run `restore.sh` against production as a rollback mechanism; restore to an isolated database, validate migrations/readiness and row counts, then use the documented migrate-forward or provider recovery procedure.

## Drill transcript (2026-09-23, local Docker, postgres:16-alpine)

> Container `pos-db-phase8` started on host port 5433 (`docker run -d --name pos-db-phase8 -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos -e POSTGRES_DB=pos -p 5433:5432 postgres:16-alpine`); `pg_isready` accepted connections.
> Applied `0001_phase0_foundation` → `0008_phase8_indexes` in order, each `psql -v ON_ERROR_STOP=1 -q` exit 0 (this also proves migration 0008).
> Backup: `docker exec pos-db-phase8 pg_dump -U pos -d pos -Fc -f /tmp/pos-drill.dump` exit 0.
> Simulated loss: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` — `\dt` showed "Did not find any relations" (26 objects dropped).
> Restore: `docker exec pos-db-phase8 pg_restore -U pos -d pos --clean --if-exists /tmp/pos-drill.dump` exit 0 (dump file created inside the container at /tmp; restore reads the same path).
> Verify: `\dt` lists all 26 tables; `SELECT indexname FROM pg_indexes WHERE tablename = 'Sale'` shows `Sale_businessId_customerId_idx` (note: psql `\di <MixedCase>` does not match quoted mixed-case names — query the catalog instead).
> Container stopped and removed (`docker stop pos-db-phase8; docker rm pos-db-phase8`).

(The drill database held schema only, so absolute row counts are N/A. The next drill with production-like seed data must record pre/post row counts.)

## H5 encrypted backup: isolated Windows PostgreSQL 17 verification

**Scope:** Verify an already-created H5 Windows DPAPI CurrentUser archive
*offline*. This does **not** fetch, create, or replace a current H5 backup.
Do not mistake a passing old-archive restore for a current-schema recovery gate.

Use `scripts/h5-verify-encrypted-restore.ps1` with the encrypted archive and
its matching `.manifest.json` saved outside the repository:

```powershell
$archive = Join-Path $env:USERPROFILE 'Documents\NexPOS\H5-Backups\<timestamped-file>.pgdump.dpapi'
./scripts/h5-verify-encrypted-restore.ps1 -EncryptedArchivePath $archive -ExpectedProjectId '<H5-project-id>'
```

Safety contract:

- Requires the **same Windows user** that encrypted the dump, an unchanged
  archive and matching SHA-256 manifest, plus an existing local
  `postgres:17-alpine` Docker image. It fails closed on mismatch.
- Decrypts only locally and temporarily under the signed-in user's TEMP
  directory. That plaintext file is removed in a `finally` block. Do not
  share, sync, attach, or commit any plaintext dump. Never leave an interrupted
  drill's plaintext file in TEMP; inspect and securely handle temporary files.
- Creates a uniquely named **throwaway container with `--network none`**,
  publishes **no ports**, and mounts **no host business data**. Only that
  container's fresh `public` schema is dropped before restoring.
- Imports with `pg_restore --no-owner --no-privileges --exit-on-error`. Dummy
  Supabase compatibility roles exist *only in the network-disabled container*.
  The restore is of the dump's `public` scope, **not** Supabase managed
  schemas, Storage object bytes, or provider-managed identities/settings.
- Verifies PostgreSQL **major version 17** and compares actual restored
  migration/business/sale/public-table counts with the manifest. Logs
  counts and archive hash, never data rows or credentials. The container
  is stopped and removed by the `finally` block.
- Rejected tampered archives must **never** reach the decryption/restore step.
  Before using this against any other backup, review its provenance and
  source project. Never run a restore against H5 or production remotely.

**Current-schema release gate:** After obtaining a newly authorized
`pg_dump -Fc` of the actual H5 staging `public` schema through an approved,
secret-safe access channel, encrypt and hash it into a new archive + manifest.
Run the offline verification against that new archive. Confirm the number and
names of applied migrations, public tables, constraints, row counts, source
timestamps and offsite encrypted-copy restore. A successful restore of an
older snapshot proves **only that older snapshot**.

If the H5 connection secret is unavailable to the authorized execution
environment, **stop**. Do not fake a fresh backup using local migrations,
Supabase metadata APIs or a schema-only export. Do not paste a database URL
into a chat or commit it to the repository.
