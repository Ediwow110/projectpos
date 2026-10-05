#!/bin/sh
# Online POS database restore from a backup.sh dump.
# Usage: DATABASE_URL=postgres://pos:pos@localhost:5432/pos BACKUP_FILE=./backups/pos-<ts>.dump ./scripts/restore.sh
# WARNING: replaces the target database contents (clean restore).
set -eu
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${BACKUP_FILE:?BACKUP_FILE must be set}"
test -f "$BACKUP_FILE"
pg_restore --clean --if-exists --dbname="$DATABASE_URL" "$BACKUP_FILE"
echo "restored $BACKUP_FILE"
