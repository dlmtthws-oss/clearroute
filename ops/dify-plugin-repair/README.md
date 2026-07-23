# Dify plugin identifier repair

Diagnose and (if needed) fix corrupted Dify plugin identifiers on the **lab**
NUC — the failure mode where plugins show *"no available node"* and adding a
model provider fails with
`PluginDaemonInternalServerError: no available node, plugin runtime not found`.

> **Start with the health check.** When this was first investigated the
> assumption was a live corruption sitting in the databases. It wasn't: by the
> time we looked, both databases were clean and the `plugin_daemon` had been
> running all 19 plugins fine for days. Verify the actual current state before
> changing anything — you may have nothing to fix.

## The bug

Plugin identifiers use the format `vendor/name:version@hash`. A Windows →
FAT32 → tar → restore migration can transliterate the ASCII colon `:` (byte
`0x3A`) between name and version into a **non-ASCII colon look-alike**, because
FAT32 forbids `:` in filenames. The `plugin_daemon` parser then rejects the
identifier:

```
ERROR installed_bucket.go:81 failed to create PluginUniqueIdentifier from path
  error="plugin_unique_identifier is not valid: langgenius/ollama：0.1.5@..."
```

Which look-alike? **Don't guess** — the original notes guessed twice and were
wrong both times (U+FF1A, then U+F03A). The scan is codepoint-agnostic and
prints the real UTF-8 hex; the repair handles the known candidates:

| codepoint | name | UTF-8 |
|---|---|---|
| `U+003A` | correct ASCII colon | `3A` |
| `U+F03A` | private-use look-alike | `EF 80 BA` |
| `U+FF1A` | fullwidth colon | `EF BC 9A` |
| `U+2236` | ratio | `E2 88 B6` |
| `U+A789` | modifier letter colon | `EA 9E 89` |

## Procedure

Run on the NUC (needs `docker`). All container/DB names default to the lab
setup and are overridable by env var (`docker ps` to confirm them first).

### 1. Health check — START HERE (read-only)

```bash
./health-check.sh
```

Reports daemon state + plugins loaded, corrupted-identifier errors on the most
recent boot, and a database scan, then prints **HEALTHY** or **NEEDS
ATTENTION**. If HEALTHY, stop — confirm functionally by adding a model provider
in the UI. Only continue if it flags something.

### 2. Scan (read-only)

```bash
./run.sh scan
```

Lists any corrupted plugin identifier across `dify` and `dify_plugin`, with the
value and its UTF-8 hex. If the hex shows a codepoint not in the table above,
add it to `badset` in `sql/repair.sql` before repairing.

### 3. Repair (writes; auto-backs-up first)

```bash
./run.sh repair
```

`pg_dump`s each database to `./backups/` (gzip), then maps the look-alike
codepoints back to `:` — but only inside values shaped like a plugin identifier
(they contain both `/` and `@`), so legitimate non-ASCII text elsewhere
(descriptions, user data, emoji) is never touched. Re-scans to confirm clean.
Idempotent and transactional.

### 4. Get the daemon to re-read the clean list

```bash
./reset-daemon.sh          # dry run — prints what it will do
./reset-daemon.sh --yes    # checks api for a stale manifest, flushes daemon redis, restarts
```

**A plain restart may not be enough.** In the 2026-07 lab incident the errors
only cleared once the daemon container was **recreated** (fresh container, state
rebuilt from the clean DBs):

```bash
docker compose up -d --force-recreate plugin_daemon
```

A clean boot emits **no** `plugin_unique_identifier is not valid` lines.

## Why clearing the daemon alone didn't stick (the original mystery)

The daemon is a puppet: on boot the **api** hands it the plugin list from the
`dify`/`dify_plugin` databases. Earlier attempts wiped the daemon's own stores
(volume + `redis FLUSHDB` + `TRUNCATE dify_plugin.*`) but left the source DBs
untouched, so the api replayed the same list on the next boot. The fix has to
land in the source DBs first (steps 2–3), *then* the daemon re-read (step 4).
When the DBs are already clean but the daemon still errors, the stale list is
in the daemon's own container state — recreate the container.

## Files

| file | what it does |
|---|---|
| `health-check.sh` | **start here** — is it actually broken? read-only verdict |
| `run.sh` | `scan` (read-only) / `repair` (backup + guarded fix + verify) |
| `reset-daemon.sh` | api manifest check, flush daemon redis, restart/recreate |
| `sql/scan.sql` | codepoint-agnostic scan of plugin identifiers, prints hex |
| `sql/repair.sql` | guarded translate of look-alike colons → `:` |

### Configuration (env vars)

| var | default | used by |
|---|---|---|
| `DB_CONTAINER` | `lab-db_postgres-1` | `run.sh`, `health-check.sh` |
| `DAEMON_CONTAINER` | `lab-plugin_daemon-1` | `reset-daemon.sh`, `health-check.sh` |
| `API_CONTAINER` | `lab-api-1` | `reset-daemon.sh` |
| `REDIS_CONTAINER` | `lab-redis-1` | `reset-daemon.sh` |
| `PGUSER` | `postgres` | `run.sh`, `health-check.sh` |
| `DATABASES` | `dify dify_plugin` | `run.sh`, `health-check.sh` |
| `BACKUP_DIR` | `./backups` | `run.sh` |

## What we found on 2026-07-23

Ran the health check against the live lab NUC:

- Only two app databases (`dify`, `dify_plugin`); **both scanned 100% clean** of
  any non-ASCII byte.
- Daemon **running**, most recent boot **error-free** (0 "not valid" in the
  recent log), with **all 19 plugins** `local runtime ready`.
- The ~67k historical "not valid" errors all predated the daemon's last restart;
  a container recreate around that time cleared the poisoned state.

Conclusion: already resolved — no repair needed. Two assumptions in the original
notes were stale: the corruption was **not** in the databases, and the 19
plugins' files were **not** gone. This toolkit is kept as a safety net and as
the fast first check if it ever recurs.

## Notes

- If plugin *files* are ever genuinely missing, repair stops the errors but
  can't restore them; reinstall from local `.difypkg` files (the lab NUC can't
  reach `marketplace.dify.ai`). Ollama's package on ClearRoute:
  `docker exec clearroute-minipc-dify-plugin-daemon-1 find /app/storage/plugin_packages -iname '*ollama*'`.
- SQL validated against a local Postgres 16 seeded with mixed corruption
  (U+F03A and U+FF1A, in `text` and `jsonb`) plus a legitimate non-ASCII value:
  the scan reported the corrupted identifiers with correct hex, the repair fixed
  both codepoints and preserved `jsonb` structure, and the legitimate value was
  left untouched.
