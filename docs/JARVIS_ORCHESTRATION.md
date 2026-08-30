# Jarvis as a coordinator (data · programs · AI agents)

Jarvis is the **brain**; your self-hosted **n8n** is the **hands**. Jarvis reads
your business data, decides which of your programs or AI agents to use, and
**proposes** an action. You confirm it in the HUD, and it fires a signed webhook
to an n8n workflow — which can do anything n8n can reach (email, accounting,
routing, other LLM agents, etc.).

New capabilities are **data, not code**: add a row to `jarvis_automations` and
build the matching n8n workflow. No redeploy needed.

```
You ──ask──▶ Jarvis (Claude, ai-assistant edge fn)
                │  reads data · picks a program/agent · proposes action
                ▼
        [ you confirm in the HUD ]
                │  jarvis-dispatch edge fn (verifies you, HMAC-signs)
                ▼
        self-hosted n8n webhook ──▶ programs / AI agents
```

## Components added

| Piece | What it does |
|---|---|
| `jarvis_automations` table | Registry of programs/agents Jarvis may use |
| `jarvis_action_runs` table | Audit log of every dispatched action (realtime) |
| `ai-assistant` (edge fn) | Gains `list_automations` + `run_automation` (propose-only) tools |
| `jarvis-dispatch` (edge fn) | Verifies caller, signs payload, calls your n8n webhook, logs the run |
| Jarvis HUD | Renders proposed actions as **Run / Dismiss** cards |

## Go-live checklist

### 1. Expose your self-hosted n8n to Supabase
Supabase Edge Functions run in the cloud, so they must reach your n8n over
HTTPS. Options for a Docker-hosted n8n:
- A public domain + reverse proxy (Caddy/Traefik/Nginx) with TLS, or
- A tunnel (Cloudflare Tunnel / Tailscale Funnel / ngrok).

Note the base URL, e.g. `https://n8n.yourdomain.com`.

### 2. Set Supabase secrets
In the Supabase dashboard → Edge Functions → Secrets (or `supabase secrets set`):

```
N8N_WEBHOOK_BASE_URL = https://n8n.yourdomain.com
N8N_WEBHOOK_SECRET   = <a long random string>
ANTHROPIC_API_KEY    = <your rotated Claude key>   # used by ai-assistant
```

### 3. Deploy the edge functions
```
supabase functions deploy ai-assistant
supabase functions deploy jarvis-dispatch
```

### 4. Build an n8n workflow with a Webhook trigger
- Add a **Webhook** node; set its path (e.g. `chase-overdue`). The full URL will
  be `N8N_WEBHOOK_BASE_URL` + `/webhook/chase-overdue`.
- **Verify the signature.** Each request carries:
  - `x-jarvis-timestamp`: milliseconds
  - `x-jarvis-signature`: `HMAC-SHA256( timestamp + "." + rawBody , N8N_WEBHOOK_SECRET )` in hex
  In a Function node, recompute the HMAC and reject if it doesn't match (and
  reject timestamps older than a few minutes).
- The body is `{ automation, params, user_id, run_id, requested_at }`.
- Return JSON — it's stored on the action run and shown back in the HUD.

### 5. Register the automation
Insert a row (replace `user_id` with your profile id):

```sql
insert into jarvis_automations (user_id, name, description, category, webhook_path, input_schema, requires_confirmation)
values (
  '<your-profile-id>',
  'Chase overdue invoices',
  'Emails a polite payment reminder to every customer with an invoice overdue by N days.',
  'program',
  'webhook/chase-overdue',
  '{"type":"object","properties":{"min_days_overdue":{"type":"number","description":"Only chase invoices at least this many days overdue"}}}',
  true
);
```

Now ask Jarvis: *"chase everyone more than 14 days overdue"* → it proposes the
action with `min_days_overdue: 14` → you press **Run** → n8n executes it.

## Categories
- `program` ⚡ — an automation/workflow (send emails, sync accounting, build a route)
- `agent` 🤖 — hands the task to an AI agent workflow in n8n (which can itself call an LLM)
- `data` 📊 — a read/report workflow

## Security model
- **Propose-then-confirm by default.** `run_automation` only *stages* an action;
  nothing fires until you press Run. Set `requires_confirmation = false` per
  automation only for safe, read-only workflows.
- **Caller is verified** from their Supabase JWT in `jarvis-dispatch` — a user id
  in the request body is never trusted.
- **Requests are HMAC-signed**; n8n must verify the signature so only Jarvis can
  trigger your workflows.
- **RLS** scopes automations and run history to their owner.
- Every dispatch is recorded in `jarvis_action_runs`.

## Hardening ideas (later)
- Add a timestamp-freshness + replay check in n8n (reject stale signatures).
- Per-automation rate limits.
- Scope automations to a company/team rather than a single user if you add staff.

---

# Wiring Jarvis to your own AI agent service

Beyond n8n workflows, Jarvis can drive a **self-hosted multi-agent service** (a
FastAPI app exposing `/process`, `/coordinate`, `/agents`, `/tools`, etc.). It
does this through a single n8n bridge workflow — so Jarvis can ask an agent a
question, coordinate several agents, list them, and even build new ones, all
from the HUD.

```
Jarvis brain (ai-assistant, Supabase cloud)
      │  ask_agent / coordinate_agents / list_agents / create_agent / execute_agent_tool
      │  HMAC-signed HTTPS
      ▼
  n8n webhook  /webhook/jarvis-agent   ← public via a free tunnel
      │  switch on `op`
      ▼
  your agent API  http://host.docker.internal:8001   (inside your Docker)
   /process   /coordinate   /agents   /tools/execute
```

These five tools run **immediately** and return the agent's answer inline
(unlike `run_automation`, which stages for confirmation). Use `run_automation`
for anything with irreversible side effects; use the agent tools for
ask/coordinate/build.

## This can be 100% free

| Piece | Free option |
|---|---|
| Public URL for n8n | **Cloudflare Tunnel** (`cloudflared`) — free, no domain required |
| Orchestrator | **n8n** community edition (self-hosted) — free |
| Agent runtime | your own Docker container |
| Jarvis brain | Supabase Edge Functions free tier |

The only per-use cost is the Anthropic tokens the Jarvis brain already spends to
think — typically pennies per conversation.

## Setup

### 1. Give n8n a free public URL (Cloudflare Tunnel)
On the machine running Docker:
```
# one-off quick tunnel (prints an https URL, no account needed):
cloudflared tunnel --url http://localhost:5678
```
That prints something like `https://random-words.trycloudflare.com`. For a
stable URL, create a **named tunnel** (still free) with a Cloudflare account and
point it at `http://localhost:5678` (or your n8n container). Use that HTTPS
origin as `N8N_WEBHOOK_BASE_URL`.

> Quick tunnels get a new URL each restart — fine for testing. Use a named
> tunnel once you want it to stay put.

### 2. Import the bridge workflow
Import [`docs/n8n/jarvis-agent-bridge.workflow.json`](./n8n/jarvis-agent-bridge.workflow.json)
into n8n (Workflows → Import from File). It creates:
`Webhook (/webhook/jarvis-agent)` → `Verify & Route` (checks the HMAC, maps the
`op` to your agent endpoint) → `Call Agent API` → `Respond to Jarvis`.

- If your agent isn't reachable at `http://host.docker.internal:8001`, set an
  `AGENT_BASE_URL` env var on n8n (e.g. the agent's container name:
  `http://agent:8001`).
- To enforce signature verification, start n8n with
  `NODE_FUNCTION_ALLOW_BUILTIN=crypto` and set `N8N_WEBHOOK_SECRET` (below).
  Leave the secret unset only for throwaway local testing — never for a public
  tunnel.
- **Activate** the workflow (toggle top-right).

### 3. Set the Supabase secrets
Supabase → Project Settings → Edge Functions → Secrets:
```
N8N_WEBHOOK_BASE_URL       = https://<your-tunnel-host>
N8N_WEBHOOK_SECRET         = <a long random string, same one n8n verifies>
JARVIS_AGENT_WEBHOOK_PATH  = webhook/jarvis-agent      # optional; this is the default
```
No redeploy needed — Edge Functions read secrets on the next call. Until these
are set, the agent tools reply "Agent bridge not configured" and Jarvis says so.

### 4. Try it
Ask Jarvis:
- *"ask my agent: what is Docker?"* → runs `/process`, relays the answer.
- *"what agents do I have?"* → `/agents`.
- *"build me an agent called Scheduler that plans my week"* → confirms, then
  `POST /agents`.
- *"coordinate my agents to draft next week's route plan"* → `/coordinate`.

## Security notes for the agent bridge
- Exposing n8n publicly means the **HMAC secret is the lock** — use a long random
  `N8N_WEBHOOK_SECRET` and keep signature verification **on**. The `op` switch
  only reaches your agent's known endpoints; it never proxies arbitrary URLs.
- The Jarvis brain verifies the ClearRoute user's JWT before it ever signs a
  bridge call, so only your authenticated session can reach your agent.
- Prefer a **named** Cloudflare tunnel with Cloudflare Access in front for an
  extra auth layer once you're past testing.
- `create_agent` / `execute_agent_tool` can change your agent system — keep them
  pointed only at an agent service you control.
