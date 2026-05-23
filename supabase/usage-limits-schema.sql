-- ============================================================
-- Per-user daily usage limits — run after schema.sql
-- Caps the number of times a user can hit a billed endpoint per day.
-- Provides a soft ceiling so a runaway client/UI bug can't drain the
-- Gemini billing account. The hard ceiling lives in GCP budget caps.
-- ============================================================

create table if not exists usage_counters (
  user_id  uuid references auth.users not null,
  day      date not null,
  kind     text not null check (kind in ('generate','add_sample')),
  count    int  not null default 0,
  primary key (user_id, day, kind)
);

alter table usage_counters enable row level security;

create policy "users read their usage_counters"
  on usage_counters for select
  using (auth.uid() = user_id);

-- No insert/update policy: writes go through increment_usage (security definer).

-- Atomic upsert + increment. Returns the new count and whether the caller
-- has now exceeded p_limit. Counting failed attempts is intentional — a
-- client looping on errors should still hit the cap.
create or replace function increment_usage(p_kind text, p_limit int)
returns table (new_count int, exceeded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into usage_counters as uc (user_id, day, kind, count)
    values (auth.uid(), current_date, p_kind, 1)
    on conflict (user_id, day, kind)
    do update set count = uc.count + 1
    returning uc.count into v_count;

  return query select v_count, v_count > p_limit;
end;
$$;

grant execute on function increment_usage(text, int) to authenticated;
