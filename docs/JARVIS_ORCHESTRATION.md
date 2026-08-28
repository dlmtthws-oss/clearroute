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
