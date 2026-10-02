-- Repair the in-app notification generators
--
-- generate_overdue_notifications() and generate_route_not_started_notifications()
-- (run nightly by pg_cron) INSERT into notifications columns entity_type,
-- entity_id and action_url, and dedupe on entity_id. Those columns did not exist
-- on the notifications table, so both jobs errored every night and no
-- overdue-invoice / route-not-started alerts were being produced.
--
-- Adding the columns (nullable) restores the generators to their intended
-- behaviour and makes notifications linkable (action_url) and de-duplicable
-- (entity_type + entity_id) as the functions already assumed.
alter table notifications
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists action_url text;
