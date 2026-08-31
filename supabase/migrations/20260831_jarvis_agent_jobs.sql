-- Pull-model job queue for the self-hosted Jarvis agent.
-- Jarvis (ai-assistant edge fn) inserts a queued job; the always-on agent worker
-- on the user's minipc polls this table over outbound HTTPS, runs the task
-- locally (Ollama, file access, tasks), and writes the result back. No inbound
-- tunnel or public exposure is required.
create table if not exists jarvis_agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  conversation_id uuid,
  op text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','error')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jarvis_agent_jobs_claim on jarvis_agent_jobs(status, created_at);
create index if not exists idx_jarvis_agent_jobs_user on jarvis_agent_jobs(user_id);

alter table jarvis_agent_jobs enable row level security;

-- Owners may read their own jobs (for the UI / history). Inserts and updates are
-- performed with the service role (the edge function and the minipc worker),
-- which bypasses RLS, so no write policies are needed for anon/auth users.
drop policy if exists "own agent jobs select" on jarvis_agent_jobs;
create policy "own agent jobs select" on jarvis_agent_jobs
  for select using (auth.uid() = user_id);

create or replace function set_jarvis_agent_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jarvis_agent_jobs_updated_at on jarvis_agent_jobs;
create trigger trg_jarvis_agent_jobs_updated_at
  before update on jarvis_agent_jobs
  for each row execute function set_jarvis_agent_jobs_updated_at();
