# Phase 21 recovery drill

Date: 2026-10-06

## Procedure and result

- Created disposable database `pos_phase21_drill` on the local `pos-db` PostgreSQL container.
- Applied all 35 migrations through `0034_phase21_variant_dimension_archive`.
- Created a custom-format dump with the container's `pg_dump`.
- Dropped and recreated the disposable database schema (`DROP SCHEMA public CASCADE; CREATE SCHEMA public`).
- Restored with `pg_restore --clean --if-exists`.
- Readiness check: `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename != '_migrations'` returned `80` restored application tables.
- Dropped `pos_phase21_drill` and removed the local drill dump after verification.

The host Windows shell does not have `pg_dump`/`pg_restore` on PATH, so the drill used the already-running PostgreSQL container binaries. The checked-in scripts remain the production entry points and were syntax-checked with Git Bash; they fail closed when required environment variables are absent.

## Operating policy

Backups use owner-only file permissions, provider-managed encryption at rest, encrypted offsite storage, and owner-only database access. Retention is 7 daily, 4 weekly, and 6 monthly copies, with the latest successful backup protected from pruning. Production restore is never an in-place first action: restore to an isolated database, validate schema/readiness and row counts, then choose provider recovery or a reviewed migrate-forward plan.

No production credentials, connection strings, customer records, bearer codes, or dump contents are included in this audit.
