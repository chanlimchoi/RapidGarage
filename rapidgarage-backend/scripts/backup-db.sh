#!/bin/sh
# RapidGarage database (and optionally uploads) backup. POSIX sh; needs pg_dump
# of the SAME major version as the server (the compose "backup" service uses
# postgres:17-alpine for that reason).
#
#   backup-db.sh            one backup now
#   backup-db.sh --loop     backup now, then every BACKUP_INTERVAL_HOURS (24)
#
# Environment:
#   DATABASE_URL           postgres://user:pass@host:5432/db  (or PGHOST/PGUSER/
#                          PGPASSWORD/PGDATABASE). Never printed.
#   BACKUP_DIR             where dumps go (default ./backups)
#   BACKUP_KEEP_DAYS       delete dumps older than this (default 14; 0 = keep all)
#   BACKUP_UPLOADS_DIR     if set, also tar this directory (post photos)
#   BACKUP_INTERVAL_HOURS  for --loop (default 24)
#
# Output: rapidgarage-YYYYmmdd-HHMMSSZ.dump (pg_dump custom format; restore with
# pg_restore, see DEPLOY.md "Backups and restore") and uploads-*.tar.gz. Files
# are written as *.partial and renamed only after they are complete and, for
# dumps, readable by pg_restore. Mode 600.
#
# A backup on the same disk as the database is not a backup: copy BACKUP_DIR
# off the machine (rclone/restic/rsync to object storage or another host).
set -eu
umask 077

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_H="${BACKUP_INTERVAL_HOURS:-24}"

log() { echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

backup_once() {
  # Explicit "|| return 1": set -e does not apply inside a function called
  # from "backup_once || ..." (the --loop case).
  mkdir -p "$BACKUP_DIR" || return 1
  ts="$(date -u +%Y%m%d-%H%M%SZ)"
  out="$BACKUP_DIR/rapidgarage-$ts.dump"
  if [ -n "${DATABASE_URL:-}" ]; then
    pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$out.partial" || { rm -f "$out.partial"; return 1; }
  else
    pg_dump --format=custom --no-owner --no-privileges --file="$out.partial" || { rm -f "$out.partial"; return 1; }
  fi
  # Prove the archive is readable before keeping it.
  pg_restore --list "$out.partial" > /dev/null || { rm -f "$out.partial"; log "dump unreadable, discarded"; return 1; }
  mv "$out.partial" "$out" || return 1
  log "database -> $out ($(wc -c < "$out" | tr -d ' ') bytes)"

  if [ -n "${BACKUP_UPLOADS_DIR:-}" ] && [ -d "$BACKUP_UPLOADS_DIR" ]; then
    up="$BACKUP_DIR/uploads-$ts.tar.gz"
    tar -czf "$up.partial" -C "$BACKUP_UPLOADS_DIR" . || { rm -f "$up.partial"; return 1; }
    mv "$up.partial" "$up" || return 1
    log "uploads  -> $up ($(wc -c < "$up" | tr -d ' ') bytes)"
  fi

  if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
    find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'rapidgarage-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -print -exec rm -f {} \; | sed 's/^/[backup] removed old /'
  fi
}

if [ "${1:-}" = "--loop" ]; then
  log "every ${INTERVAL_H}h into $BACKUP_DIR, keeping ${KEEP_DAYS} days"
  while :; do
    backup_once || log "FAILED (will retry next interval)"
    sleep "$((INTERVAL_H * 3600))"
  done
else
  backup_once
fi
