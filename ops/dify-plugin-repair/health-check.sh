#!/usr/bin/env bash
#
# health-check.sh — START HERE. Read-only.
#
# Answers the only question that matters before you touch anything: is the
# plugin subsystem actually broken right now, or already healthy? The original
# incident notes assumed a live corruption in the databases; when we finally
# checked, the DBs were clean and the daemon had been happily running all 19
# plugins for days. So verify before you repair.
#
# It reports:
#   1. daemon container state + uptime + how many plugins loaded OK on last boot
#   2. corrupted-identifier errors on the most recent boot (should be 0)
#   3. a codepoint-agnostic scan of each database for ANY non-ASCII byte
# then prints a verdict.
#
# Configure via environment variables (defaults match the lab NUC):
#   DB_CONTAINER      Postgres container   (default: lab-db_postgres-1)
#   DAEMON_CONTAINER  plugin_daemon        (default: lab-plugin_daemon-1)
#   PGUSER            postgres role        (default: postgres)
#   DATABASES         DB list              (default: "dify dify_plugin")
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_CONTAINER="${DB_CONTAINER:-lab-db_postgres-1}"
DAEMON_CONTAINER="${DAEMON_CONTAINER:-lab-plugin_daemon-1}"
PGUSER="${PGUSER:-postgres}"
DATABASES="${DATABASES:-dify dify_plugin}"

exists() { docker inspect "$1" >/dev/null 2>&1; }

verdict_ok=1   # flips to 0 if anything looks wrong

echo "== 1. Daemon state =="
if exists "$DAEMON_CONTAINER"; then
  docker inspect -f '  started={{.State.StartedAt}} running={{.State.Running}} restarts={{.RestartCount}}' "$DAEMON_CONTAINER"
  running="$(docker inspect -f '{{.State.Running}}' "$DAEMON_CONTAINER")"
  [ "$running" = "true" ] || verdict_ok=0
  loaded="$(docker logs "$DAEMON_CONTAINER" 2>&1 | grep -a 'local runtime ready' | grep -oaE 'plugin=[^@ ]+' | sort -u | wc -l)"
  echo "  distinct plugins loaded OK: $loaded"
else
  echo "  SKIP: daemon container '$DAEMON_CONTAINER' not found (set DAEMON_CONTAINER)."
  verdict_ok=0
fi

echo "== 2. Corrupted-identifier errors on the most recent boot =="
if exists "$DAEMON_CONTAINER"; then
  recent="$(docker logs --tail 3000 "$DAEMON_CONTAINER" 2>&1 | grep -a -c 'not valid' || true)"
  echo "  'not valid' in last 3000 log lines: $recent"
  [ "$recent" = 0 ] || verdict_ok=0
fi

echo "== 3. Database scan for corrupted plugin identifiers (codepoint-agnostic) =="
if exists "$DB_CONTAINER"; then
  for db in $DATABASES; do
    out="$(docker exec -i "$DB_CONTAINER" psql -tA -U "$PGUSER" -d "$db" < "$HERE/sql/scan.sql" 2>/dev/null || true)"
    if [ -n "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
      echo "  $db: NON-ASCII FOUND —"
      printf '%s\n' "$out" | sed 's/^/    /'
      verdict_ok=0
    else
      echo "  $db: clean"
    fi
  done
else
  echo "  SKIP: db container '$DB_CONTAINER' not found (set DB_CONTAINER)."
  verdict_ok=0
fi

echo
if [ "$verdict_ok" = 1 ]; then
  echo "VERDICT: HEALTHY — databases clean, recent boot error-free, daemon running."
  echo "         Nothing to repair. Confirm functionally by adding a model provider in the UI."
else
  echo "VERDICT: NEEDS ATTENTION — see flags above."
  echo "         If a database shows non-ASCII: run ./run.sh repair (check the hex against"
  echo "         the codepoint list in sql/repair.sql first)."
  echo "         If the DBs are clean but the daemon still errors: the stale list is in the"
  echo "         daemon's own state — recreate the container (./reset-daemon.sh explains)."
fi
