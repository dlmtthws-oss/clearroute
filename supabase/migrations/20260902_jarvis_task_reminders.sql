-- Active task reminders
--
-- A daily digest that turns the user's own Jarvis task list into proactive
-- in-app notifications. Runs each morning via pg_cron and, for every user who
-- has open tasks that are overdue or due today, drops a single notification
-- into the existing notifications centre (the same table the app already uses
-- for overdue-invoice / route alerts).
--
-- Design notes:
--   * One reminder per user per day (deduped on type + created date), so the
--     notifications centre never floods.
--   * Only the real notifications columns are used (user_id, type, title,
--     message); some older generator functions in this DB reference
--     entity_type/entity_id/action_url columns that do not exist on this table.
--   * Honours an optional company_settings.notification_prefs->>'task_reminders'
--     = 'false' opt-out, mirroring the other generators.

create or replace function generate_task_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  u     record;
  prefs jsonb;
begin
  select notification_prefs into prefs from company_settings limit 1;
  if prefs is not null and (prefs->>'task_reminders') = 'false' then
    return;
  end if;

  for u in
    select
      t.user_id,
      count(*) filter (where t.due_at <  date_trunc('day', now()))                              as overdue,
      count(*) filter (where t.due_at >= date_trunc('day', now())
                         and t.due_at <  date_trunc('day', now()) + interval '1 day')            as due_today,
      (array_agg(t.title order by t.due_at asc))[1:3]                                            as sample_titles
    from jarvis_tasks t
    where t.status = 'open'
      and t.due_at is not null
      and t.due_at < date_trunc('day', now()) + interval '1 day'   -- overdue or due today
    group by t.user_id
  loop
    -- Only one task reminder per user per day.
    if not exists (
      select 1 from notifications
      where user_id = u.user_id
        and type = 'task_reminder'
        and created_at::date = current_date
    ) then
      insert into notifications (user_id, type, title, message)
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

-- Run every morning at 07:00 UTC (keeps the app's existing minute-0 convention).
select cron.schedule('notify-tasks-due', '0 7 * * *', $$select generate_task_reminders();$$);
