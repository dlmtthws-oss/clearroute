# Jarvis agent worker (minipc)

The always-on half of Jarvis's agent. It runs on your private machine and gives
Jarvis a local AI agent it can command — backed by your **Ollama** model and
with **read access to a folder of your files** — without exposing anything to the
internet.

## How it works (pull model)

```
Jarvis (Supabase cloud)  --insert job-->  jarvis_agent_jobs table
                                                 ^   |
                              poll + write result |   | (result)
                                                 (outbound HTTPS only)
                                                 |   v
                        jarvis-agent worker  (this container, on your minipc)
                                                 |
                                  Ollama (local LLM)  +  your files (read-only)
```

Jarvis never connects *into* your machine. The worker reaches *out* to Supabase,
so it works behind any home router — no tunnel, no open ports, no changing URLs.
With `restart: unless-stopped` it comes back on every reboot.

## One-time setup

1. **Create a files folder** for Jarvis to read (adjust the path to taste):
   ```bash
   mkdir -p /home/daleoss/jarvis-files
   ```
   Put any text files, notes, CSVs, etc. in there. (Mounted read-only.)

2. **Add your Supabase service_role key:**
   ```bash
   cd minipc
   cp .env.example .env
   # edit .env and paste the service_role key from
   # Supabase -> Project Settings -> API -> service_role (secret)
   ```
   The key stays on your minipc; `.env` is git-ignored.

3. **Check the network + Ollama names.** The compose file joins
   `clearroute-minipc_minipc-net` and calls Ollama at `http://ollama:11434`.
   Confirm both:
   ```bash
   docker network ls | grep minipc
   docker ps --format '{{.Names}}' | grep -i ollama
   ```
   If the network or Ollama service name differs, edit
   `compose.jarvis-agent.yml` accordingly.

4. **Make sure you have an Ollama model** (once):
   ```bash
   docker exec -it <ollama-container> ollama pull llama3.2
   ```

5. **Start it:**
   ```bash
   docker compose -f compose.jarvis-agent.yml up -d --build
   docker logs -f jarvis-agent
   ```
   You should see `worker started ... model=llama3.2`.

## Try it

In Jarvis (the ClearRoute app), ask:

- **"ask my agent: what is Docker?"** — runs on your local model.
- **"list my files"** / **"read my file notes.txt"** / **"search my files for invoice"** — reads the folder you mounted.

Jarvis waits up to ~40s for a reply; if the minipc is off, it says the request is
queued and will run when the agent is back.

## What it can do (ops)

| Jarvis tool | op | what the worker does |
|---|---|---|
| ask_agent | `process` | ask your Ollama model |
| coordinate_agents | `coordinate` | ask your model to work a larger task |
| list_files | `file_list` | list files under the mounted folder |
| read_file | `file_read` | read one text file (first 20k chars) |
| search_files | `file_search` | grep text across the folder |

New capabilities (task scheduling, more tools) are added by extending
`worker.py` with new ops and adding matching tools in the `ai-assistant` edge
function — no plumbing changes needed.

## Security notes

- The worker holds the **service_role key** (full DB access). Keep it only on
  this trusted machine; never commit the real `.env`.
- File access is **read-only** and constrained to `FILES_ROOT`; path traversal
  outside it is rejected.
- Only outbound HTTPS to Supabase and local calls to Ollama — nothing inbound.
