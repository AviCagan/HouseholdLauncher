-- Things — notification plumbing
--
-- Run this AFTER deploying the `notify` Edge Function with JWT verification
-- turned OFF. Replace <PROJECT_REF> below with your project ref (the string in
-- your Supabase dashboard URL) — it appears twice.
--
-- Note on the missing Authorization header: the function is deployed with
-- "Verify JWT" off, so it needs no key here. The tradeoff is that the endpoint
-- is publicly callable, meaning someone who found the URL could send you a
-- junk notification. They still cannot read or change any data — the function
-- only ever sends pushes to your own two devices — so for a household app that
-- is an acceptable trade for not having a service-role key pasted into SQL.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Notify on changes
--
-- Fires server-side on purpose: notifying from the app would send nothing
-- whenever the acting person's phone is closed mid-write.
-- ---------------------------------------------------------------------------

create or replace function notify_change() returns trigger
language plpgsql security definer as $$
begin
  -- Fire-and-forget; pg_net does not block the transaction.
  perform net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
                 'type',       tg_op,
                 'table',      tg_table_name,
                 'record',     case when tg_op = 'DELETE' then null else to_jsonb(new) end,
                 'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
               )
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['todos','chores','shopping_items','wishlist_items'] loop
    execute format('drop trigger if exists %I_notify on %I', t, t);
    execute format(
      'create trigger %I_notify after insert or update on %I
         for each row execute function notify_change()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cooldown sweep
--
-- Recurring chores need a scheduled job rather than a trigger, because when a
-- cooldown expires NOTHING is written — there is no row change to hook into.
-- The function's cooldown_notified_at bookkeeping makes repeat runs safe.
--
-- Avi's phone also schedules its own local reminder at completion time, which
-- needs no server and works offline; this sweep is what covers Jackie, since
-- an iOS web app cannot schedule anything locally.
-- ---------------------------------------------------------------------------

select cron.unschedule('things-cooldown-sweep')
where exists (select 1 from cron.job where jobname = 'things-cooldown-sweep');

select cron.schedule(
  'things-cooldown-sweep',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{"mode":"sweep_cooldowns"}'::jsonb
  );
  $$
);
