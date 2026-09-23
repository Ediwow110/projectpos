#!/bin/sh
# Online POS database backup (custom format, timestamped).
# Usage: DATABASE_URL=postgres://pos:pos@localhost:5432/pos ./scripts/backup.sh
#        BACKUP_DIR=/var/backups/pos DATABASE_URL=... ./scripts/backup.sh
set -eu
: "${DATABASE_URL:?DATABASE_URL must be set}"
TS=$(date +%Y%m%dT%H%M%S)
OUT=${BACKUP_DIR:-./backups}/pos-$TS.dump
mkdir -p "$(dirname "$OUT")"
pg_dump --format=custom --file="$OUT" "$DATABASE_URL"
echo "wrote $OUT"
