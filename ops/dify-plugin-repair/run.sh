#!/usr/bin/env bash
#
# run.sh — scan for, or repair, corrupted Dify plugin identifiers in Postgres.
#
# The corruption: the ASCII colon ':' (0x3A) between plugin name and version in
# `vendor/name:version@hash` was transliterated to U+F03A (UTF-8 EF 80 BA), a
# private-use-area look-alike, during a Windows -> FAT32 -> tar -> restore
# migration. The plugin_daemon parser rejects the identifier and every plugin
# shows "no available node".
#
# The api feeds the poisoned list back to the daemon on every boot, so the fix
# has to land in the databases the api reads (default: `dify` AND `dify_plugin`),
# not just the daemon's own regenerable stores. This script scans/repairs every
# text-like column in those databases, wherever the bad byte is hiding.
#
# Usage:
#   ./run.sh scan               # read-only; default. Lists corrupted columns.
#   ./run.sh repair             # takes a backup, then fixes every DB.
#   ./run.sh repair --no-backup # skip the pg_dump (not recommended)
#
# Configure via environment variables (defaults match the lab NUC):
#   DB_CONTAINER   docker container running Postgres (default: lab-db_postgres-1)
#   PGUSER         postgres role                     (default: postgres)
#   DATABASES      space-separated DB list           (default: "dify dify_plugin")
#   BACKUP_DIR     where pg_dump files are written   (default: ./backups)
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_CONTAINER="${DB_CONTAINER:-lab-db_postgres-1}"
PGUSER="${PGUSER:-postgres}"
DATABASES="${DATABASES:-dify dify_plugin}"
BACKUP_DIR="${BACKUP_DIR:-$HERE/backups}"

MODE="${1:-scan}"
NO_BACKUP=0
[ "${2:-}" = "--no-backup" ] && NO_BACKUP=1

psql_in() { # $1=db  (SQL on stdin)
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$1"
}

require_container() {
  if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
    echo "ERROR: container '$DB_CONTAINER' not found." >&2
    echo "       Set DB_CONTAINER to the Postgres container name. Candidates:" >&2
    docker ps --format '  {{.Names}}' 2>/dev/null | grep -Ei 'postgres|db' >&2 || true
    exit 1
  fi
}

do_scan() {
  local found=0
  for db in $DATABASES; do
    echo "=== scan: $db ==="
    local out
    out="$(psql_in "$db" < "$HERE/sql/scan.sql")"
    printf '%s\n' "$out"
    # A real hit prints a long UTF-8 hex string in the last column; table/column
    # names never produce 20+ consecutive hex chars.
    printf '%s' "$out" | grep -Eiq '[0-9a-f]{20,}' && found=1 || true
  done
  if [ "$found" = 0 ]; then
    echo
    echo "All scanned databases are clean (no corrupted plugin identifiers found)."
  fi
}

do_backup() {
  mkdir -p "$BACKUP_DIR"
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  for db in $DATABASES; do
    local f="$BACKUP_DIR/${db}-${stamp}.sql.gz"
    echo "Backing up '$db' -> $f"
    docker exec "$DB_CONTAINER" pg_dump -U "$PGUSER" -d "$db" | gzip > "$f"
  done
}

do_repair() {
  [ "$NO_BACKUP" = 1 ] && echo "WARNING: --no-backup set, skipping pg_dump." || do_backup
  for db in $DATABASES; do
    echo "=== repair: $db ==="
    psql_in "$db" < "$HERE/sql/repair.sql"
  done
  echo
  echo "Repair committed. Re-scanning to confirm:"
  do_scan
  echo
  echo "Databases are the api's source of truth. Now get the daemon to re-read"
  echo "the clean list:  ./reset-daemon.sh --yes  (a plain restart may not be"
  echo "enough — if errors persist, recreate the daemon container; see that script)."
}

require_container
case "$MODE" in
  scan)   do_scan ;;
  repair) do_repair ;;
  *) echo "Usage: $0 {scan|repair} [--no-backup]" >&2; exit 2 ;;
esac
