#!/usr/bin/env bash
# Nightly Postgres dump for the prod stack. Prunes backups older than 14 days.
# Keep this local copy; add an offsite copy (rclone/scp) if you want DR.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/hexallm/backups}"
mkdir -p "$BACKUP_DIR"
TS="$(date +%F-%H%M)"

echo ">> Backing up hexallm-prod database"
docker compose -p hexallm-prod exec -T db \
  pg_dump -U hexallm -d hexallm \
  | gzip > "$BACKUP_DIR/hexallm-prod-$TS.sql.gz"

find "$BACKUP_DIR" -name 'hexallm-prod-*.sql.gz' -mtime +14 -delete
echo ">> Backup written: $BACKUP_DIR/hexallm-prod-$TS.sql.gz"
