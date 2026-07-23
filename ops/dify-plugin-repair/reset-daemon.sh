#!/usr/bin/env bash
#
# reset-daemon.sh — clear the plugin_daemon's regenerable stores and restart,
# so it re-reads the (now clean) plugin list the api hands it on boot.
#
# ORDER MATTERS. Run ./run.sh repair FIRST. The databases are the api's source
# of truth; if they still contain U+F03A, clearing the daemon here changes
# nothing — the api just replays the poisoned list on the next boot (which is
# exactly why earlier volume/redis/TRUNCATE wipes "didn't stick").
#
# This script only touches regenerable caches and does a restart. It does NOT
# TRUNCATE application data — once the source DBs are clean a restart is enough.
# See the commented block at the bottom for the optional hard wipe.
#
# Usage:
#   ./reset-daemon.sh            # dry run: prints what it would do
#   ./reset-daemon.sh --yes      # actually flush caches + restart
#
# Configure via environment variables (defaults are best-guess for the lab NUC;
# override to match `docker ps`):
#   DAEMON_CONTAINER  plugin_daemon container  (default: lab-plugin_daemon-1)
#   API_CONTAINER     api container            (default: lab-api-1)
#   REDIS_CONTAINER   daemon's redis container (default: lab-redis-1)
#
set -euo pipefail

DAEMON_CONTAINER="${DAEMON_CONTAINER:-lab-plugin_daemon-1}"
API_CONTAINER="${API_CONTAINER:-lab-api-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-lab-redis-1}"

DRY=1; [ "${1:-}" = "--yes" ] && DRY=0

run() {
  if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else echo "  + $*"; eval "$*"; fi
}

exists() { docker inspect "$1" >/dev/null 2>&1; }

echo "== Step 1: sanity-check the api has no filesystem manifest still carrying U+F03A =="
if exists "$API_CONTAINER"; then
  # printf '\357\200\272' emits the UTF-8 bytes EF 80 BA to grep for.
  hits="$(docker exec "$API_CONTAINER" sh -c \
    'grep -rlF "$(printf "\357\200\272")" /app 2>/dev/null' || true)"
  if [ -n "$hits" ]; then
    echo "  WARNING: U+F03A still present in api files:"; printf '    %s\n' $hits
    echo "  Fix these before restarting (edit/replace the byte), or the list re-poisons."
  else
    echo "  OK: no U+F03A found in $API_CONTAINER:/app"
  fi
else
  echo "  SKIP: api container '$API_CONTAINER' not found (set API_CONTAINER)."
fi

echo "== Step 2: flush the daemon's redis cache (regenerable) =="
if exists "$REDIS_CONTAINER"; then
  run "docker exec $REDIS_CONTAINER redis-cli FLUSHDB"
else
  echo "  SKIP: redis container '$REDIS_CONTAINER' not found (set REDIS_CONTAINER)."
fi

echo "== Step 3: restart daemon + api so the clean list is re-read =="
exists "$DAEMON_CONTAINER" && run "docker restart $DAEMON_CONTAINER" \
  || echo "  SKIP: daemon container '$DAEMON_CONTAINER' not found (set DAEMON_CONTAINER)."
exists "$API_CONTAINER" && run "docker restart $API_CONTAINER" \
  || echo "  SKIP: api container '$API_CONTAINER' not found."
echo "  NOTE: a plain restart reuses the container's existing state. In the"
echo "  2026-07 lab incident the errors only cleared after the daemon container"
echo "  was RECREATED (fresh container, state rebuilt from the clean DBs):"
echo "      docker compose up -d --force-recreate plugin_daemon"
echo "  If a restart leaves the errors, recreate instead (Step 3b)."

echo "== Step 4: verify boot is silent =="
if [ "$DRY" = 0 ] && exists "$DAEMON_CONTAINER"; then
  echo "  Tailing daemon logs for the parser error (Ctrl-C to stop):"
  run "docker logs --since 60s -f $DAEMON_CONTAINER 2>&1 | grep -i 'PluginUniqueIdentifier\\|not valid\\|installed_bucket' || true"
else
  echo "  (dry run) After --yes, check:  docker logs --since 2m $DAEMON_CONTAINER | grep -i 'not valid'"
  echo "  A clean boot emits NO 'plugin_unique_identifier is not valid' lines."
fi

# ---------------------------------------------------------------------------
# OPTIONAL HARD WIPE (only if a restart alone is not enough).
# The dify_plugin.* tables are regenerable daemon state. Truncating them forces
# a full rebuild from the (clean) `dify` source. This is destructive to install
# records; the source DBs must be clean FIRST. Uncomment and adjust table names
# to match your schema, then re-run reset:
#
#   docker exec -i "$DB_CONTAINER" psql -U postgres -d dify_plugin \
#     -c 'TRUNCATE plugin_installations, plugin_declarations RESTART IDENTITY CASCADE;'
# ---------------------------------------------------------------------------
