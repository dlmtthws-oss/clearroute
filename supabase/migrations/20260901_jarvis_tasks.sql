-- Jarvis task list
--
-- Backs the task-management tools in the ai-assistant edge function (add_task /
-- list_tasks / complete_task / update_task / delete_task). Jarvis uses these so
-- the user can keep a to-do list in plain language ("remind me to invoice the
-- Johnsons", "what's on my list?", "mark the van service done").
--
-- The edge function reads/writes with the service role, but owner RLS policies
-- are included so the app UI can read/manage tasks directly with the user's JWT.
create table if not exists jarvis_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open','done')),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jarvis_tasks_user_status on jarvis_tasks(user_id, status, due_at);

alter table jarvis_tasks enable row level security;

drop policy if exists "own tasks select" on jarvis_tasks;
create policy "own tasks select" on jarvis_tasks
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own tasks insert" on jarvis_tasks;
create policy "own tasks insert" on jarvis_tasks
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "own tasks update" on jarvis_tasks;
create policy "own tasks update" on jarvis_tasks
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own tasks delete" on jarvis_tasks;
create policy "own tasks delete" on jarvis_tasks
  for delete using ((select auth.uid()) = user_id);

create or replace function set_jarvis_tasks_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  -- stamp completed_at the moment a task flips to done, clear it if reopened
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at = now();
  elsif new.status = 'open' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jarvis_tasks_updated_at on jarvis_tasks;
create trigger trg_jarvis_tasks_updated_at
  before update on jarvis_tasks
  for each row execute function set_jarvis_tasks_updated_at();
