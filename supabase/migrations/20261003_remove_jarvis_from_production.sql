-- Remove misplaced Jarvis objects from the ClearRoute PRODUCTION project
--
-- RUN THIS AGAINST PRODUCTION ONLY: project mskdxzknzblvmflsydjs
-- (Supabase Dashboard → SQL Editor). It was not applied automatically because
-- destructive DDL could not be issued through the MCP tooling in the session
-- that performed the migration.
--
-- Context: Jarvis's queue, task list and reminder digest were temporarily
-- created on the production ClearRoute database. They now live on the isolated
-- jarvis-control-plane project (see 20261003_jarvis_control_plane.sql), so the
-- production copies must go to restore the Sep-3 separation.
--
-- Already done from the migration session:
--   * the `notify-tasks-due` cron job on production has been unscheduled.
--
-- NOT removed (deliberately): the production `ai-assistant` edge function.
-- It is a long-lived function the live ClearRoute product depends on; Jarvis
-- now runs its own business-data-free copy on jarvis-control-plane.
--
-- KEPT on production (real product fixes, not Jarvis): the three nullable
-- notifications columns (entity_type/entity_id/action_url), the repaired
-- generate_overdue_notifications / generate_route_not_started_notifications,
-- and the company-scoping of the report functions.

-- Safety: unschedule the cron again in case it was re-created.
select cron.unschedule(jobid) from cron.job where jobname = 'notify-tasks-due';

-- The reminder digest (production version wrote into the shared notifications table).
drop function if exists public.generate_task_reminders();

-- Jarvis's personal tables (not referenced by the live product).
drop table if exists public.jarvis_tasks cascade;
drop table if exists public.jarvis_agent_jobs cascade;
