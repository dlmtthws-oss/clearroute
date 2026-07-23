# Dify plugin identifier repair (U+F03A → `:`)

Toolkit to diagnose and fix corrupted Dify plugin identifiers on the **lab** NUC,
where every plugin shows *"no available node"* and adding a model provider fails
with `PluginDaemonInternalServerError: no available node, plugin runtime not found`.

## The bug in one paragraph

Plugin identifiers use the format `vendor/name:version@hash`. During a
Windows → FAT32 → tar → restore migration, the ASCII colon `:` (byte `0x3A`)
between name and version was transliterated to **U+F03A**, a private-use-area
look-alike (the daemon prints it as ``; in UTF-8 it is the three bytes
`EF 80 BA`). FAT32 forbids `:` in filenames, so the copy tool substituted it.
The `plugin_daemon` parser rejects the identifier:

```
ERROR installed_bucket.go:81 failed to create PluginUniqueIdentifier from path
  error="plugin_unique_identifier is not valid: langgenius/ollama：0.1.5@..."
```

## Why the daemon-only wipes didn't stick

The plugin folder on disk and `dify_plugin.plugin_installations` were already
clean. Yet wiping the daemon's own stores (volume + `redis FLUSHDB` + `TRUNCATE
dify_plugin.*`) and rebooting still replayed all 19 corrupted names, because the
**api feeds the plugin list back to the daemon on every boot** from the main
`dify` database. The daemon is a puppet; the poisoned list lives upstream. So the
fix has to clean the api's source-of-truth databases (`dify` **and**
`dify_plugin`), *then* reset the daemon.

The corruption also hides in non-obvious places — including inside `jsonb`
columns — so this toolkit does **not** hard-code the four suspect tables. It
enumerates *every* text-like column (`text`, `varchar`, `char`, `json`, `jsonb`)
from `information_schema` and finds the bad byte wherever it is.

## The character, for reference

| | codepoint | UTF-8 bytes |
|---|---|---|
| Correct separator | `:` U+003A | `3A` |
| Corruption | U+F03A | `EF 80 BA` |
| Earlier wrong guess (matched 0 rows) | U+FF1A | `EF BC 9A` |

In SQL the corruption is named unambiguously as `chr(x'F03A'::int)` — no
byte-literal casting to get wrong.

## Procedure

Run on the lab NUC (needs `docker`). Container/DB names default to the lab setup
and are overridable by env var. **Do steps in order** — cleaning the daemon
before the databases does nothing.

### 1. Scan (read-only)

```bash
./run.sh scan
```

Lists every corrupted column across `dify` and `dify_plugin`, or reports clean.
Point it at the right Postgres container if the name differs:

```bash
DB_CONTAINER=lab-db_postgres-1 ./run.sh scan
```

### 2. Repair (writes; auto-backs-up first)

```bash
./run.sh repair
```

This `pg_dump`s each database to `./backups/` (gzip), then replaces every U+F03A
with `:` inside one transaction per database, and re-scans to confirm clean. Only
rows that actually contain U+F03A are touched, so a real colon is never doubled.

### 3. Reset the daemon so it re-reads the clean list

```bash
./reset-daemon.sh          # dry run — prints what it will do
./reset-daemon.sh --yes    # flush daemon redis + restart daemon & api, tail logs
```

It first greps the api container's `/app` for any lingering U+F03A manifest, then
flushes the daemon's regenerable redis cache and restarts. A clean boot emits
**no** `plugin_unique_identifier is not valid` lines. (A hard `TRUNCATE` of the
regenerable `dify_plugin.*` tables is documented but commented out at the bottom
of the script — a restart against clean source DBs is normally enough.)

## Files

| file | what it does |
|---|---|
| `run.sh` | orchestrator: `scan` (default, read-only) / `repair` (backup + fix + verify) |
| `reset-daemon.sh` | clears daemon caches + restart; checks api for a lingering manifest |
| `sql/scan.sql` | dynamic read-only diagnostic over all text-like columns |
| `sql/repair.sql` | dynamic transactional replace `U+F03A` → `:` |

### Configuration (env vars)

| var | default | used by |
|---|---|---|
| `DB_CONTAINER` | `lab-db_postgres-1` | `run.sh` |
| `PGUSER` | `postgres` | `run.sh` |
| `DATABASES` | `dify dify_plugin` | `run.sh` |
| `BACKUP_DIR` | `./backups` | `run.sh` |
| `DAEMON_CONTAINER` | `lab-plugin_daemon-1` | `reset-daemon.sh` |
| `API_CONTAINER` | `lab-api-1` | `reset-daemon.sh` |
| `REDIS_CONTAINER` | `lab-redis-1` | `reset-daemon.sh` |

Confirm names with `docker ps` first; the defaults are best-guesses from the
incident notes.

## After repair: reinstalling plugins

Repair stops the errors but does **not** bring back plugin *files* — the 19
plugins' files are gone (only ClearRoute has intact copies), so the daemon boots
clean and quiet but empty. Reinstall only what you need from local `.difypkg`
files copied off ClearRoute. The lab NUC can't reach `marketplace.dify.ai`
(likely a WSL2/container DNS-egress issue — worth fixing separately if you want
marketplace installs), so installs must be local. Ollama's package, on ClearRoute:

```bash
docker exec clearroute-minipc-dify-plugin-daemon-1 \
  find /app/storage/plugin_packages -iname '*ollama*'
```

## Not affected (don't touch)

Lab's six apps (DeepResearch, File Translation, two AWS Study workflows, Code
Converter, Personalized Memory Assistant) run fine and don't need the plugin
subsystem. Only adding model providers / tools was broken.

## Validation

The scan and repair SQL were validated against a local Postgres 16 seeded with
the exact `EF 80 BA` corruption (including inside `jsonb` and non-obvious tables):
the scan located every corrupted column and skipped clean rows; the repair
restored the byte to `3A`, preserved `jsonb` structure, and left already-clean
identifiers untouched.
