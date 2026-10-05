-- Migrate Jarvis onto its isolated control-plane project
--
-- Jarvis was split off from the ClearRoute production database on 2026-09-03 so
-- that assistant experiments can never touch live customer data. This migration
-- stands Jarvis's backend up in the isolated `jarvis-control-plane` project
-- (ref yoffekacztmvpfnzymgq) — the home it should have had all along — instead
-- of the production ClearRoute project (ref mskdxzknzblvmflsydjs).
--
-- What lives here now:
--   * jarvis_tasks        — the owner's personal task list (also used by the
--                           ai-assistant add_task / list_tasks / … tools).
--   * jarvis_notifications — a self-contained reminders surface. The production
--                           copy wrote into ClearRoute's shared `notifications`
--                           table; the isolated project has no such table (and
--                           Jarvis must not borrow one), so reminders land here.
--   * generate_task_reminders() + the notify-tasks-due cron — the daily digest,
--                           rewritten to target jarvis_notifications and without
--                           the company_settings opt-out (there is no company
--                           here — Jarvis is a single-owner personal tool).
--   * jarvis_agent_jobs   — already present in this project; it is the queue the
--                           mini-PC worker polls. Left as-is.
--   * ai_conversations / ai_messages / ai_query_log — the chat the Jarvis
--                           frontend reads directly (created earlier this
--                           session); RLS policies ensure a signed-in owner only
--                           ever sees their own rows.
--
-- The matching objects on the ClearRoute production project are being removed
-- separately. The production `ai-assistant` edge function is NOT removed: it is
-- a long-lived function the live ClearRoute product depends on. Jarvis now runs
-- its own, business-data-free copy of ai-assistant on this project.

-- --- Personal task list ----------------------------------------------------
create table if not exists public.jarvis_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  title        text not null,
  notes        text,
  status       text not null default 'open' check (status in ('open', 'done')),
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists jarvis_tasks_user_status_due_idx
  on public.jarvis_tasks (user_id, status, due_at);

alter table public.jarvis_tasks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jarvis_tasks' and policyname='jarvis_tasks_select_own') then
    create policy jarvis_tasks_select_own on public.jarvis_tasks
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jarvis_tasks' and policyname='jarvis_tasks_insert_own') then
    create policy jarvis_tasks_insert_own on public.jarvis_tasks
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jarvis_tasks' and policyname='jarvis_tasks_update_own') then
    create policy jarvis_tasks_update_own on public.jarvis_tasks
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jarvis_tasks' and policyname='jarvis_tasks_delete_own') then
    create policy jarvis_tasks_delete_own on public.jarvis_tasks
      for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end$$;

-- Keep updated_at fresh and stamp completed_at when a task is closed/reopened.
create or replace function public.set_jarvis_tasks_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status = 'open' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jarvis_tasks_updated_at on public.jarvis_tasks;
create trigger trg_jarvis_tasks_updated_at
  before update on public.jarvis_tasks
  for each row execute function public.set_jarvis_tasks_updated_at();

-- --- Reminders surface -----------------------------------------------------
create table if not exists public.jarvis_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  type       text not null default 'task_reminder',
  title      text not null,
  message    text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists jarvis_notifications_user_created_idx
  on public.jarvis_notifications (user_id, created_at desc);

alter table public.jarvis_notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jarvis_notifications' and policyname='jarvis_notifications_select_own') then
    create policy jarvis_notifications_select_own on public.jarvis_notifications
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jarvis_notifications' and policyname='jarvis_notifications_update_own') then
    create policy jarvis_notifications_update_own on public.jarvis_notifications
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end$$;

-- --- Daily task-reminder digest --------------------------------------------
create or replace function public.generate_task_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  u record;
begin
  for u in
    select
      t.user_id,
      count(*) filter (where t.due_at <  date_trunc('day', now()))                               as overdue,
      count(*) filter (where t.due_at >= date_trunc('day', now())
                         and t.due_at <  date_trunc('day', now()) + interval '1 day')             as due_today,
      (array_agg(t.title order by t.due_at asc))[1:3]                                             as sample_titles
    from jarvis_tasks t
    where t.status = 'open'
      and t.due_at is not null
      and t.due_at < date_trunc('day', now()) + interval '1 day'   -- overdue or due today
    group by t.user_id
  loop
    -- Only one task reminder per user per day.
    if not exists (
      select 1 from jarvis_notifications
      where user_id = u.user_id
        and type = 'task_reminder'
        and created_at::date = current_date
    ) then
      insert into jarvis_notifications (user_id, type, title, message)
      values (
        u.user_id,
        'task_reminder',
        'Tasks need attention',
        case
          when u.overdue > 0 and u.due_today > 0 then
            u.due_today || ' task(s) due today and ' || u.overdue || ' overdue — '
              || array_to_string(u.sample_titles, '; ')
          when u.overdue > 0 then
            u.overdue || ' overdue task(s) — ' || array_to_string(u.sample_titles, '; ')
          else
            u.due_today || ' task(s) due today — ' || array_to_string(u.sample_titles, '; ')
        end
      );
    end if;
  end loop;
end;
$$;

revoke execute on function public.generate_task_reminders() from public, anon, authenticated;

-- Run every morning at 07:00 UTC (matches the production schedule it replaces).
select cron.unschedule(jobid) from cron.job where jobname = 'notify-tasks-due';
select cron.schedule('notify-tasks-due', '0 7 * * *', $$select public.generate_task_reminders();$$);
