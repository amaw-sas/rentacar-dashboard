-- Fixed-window rate limiting for blog API
  -- Consumed by packages/logic/server/utils/rate-limit.ts via RPC

  create table rate_limit_counters (
    ip text not null,
    window_start timestamptz not null,
    count integer not null default 1,
    primary key (ip, window_start)
  );

  create index on rate_limit_counters (window_start);

  -- Enable RLS but add no policies → anon cannot access the table directly.
  -- The RPC below uses security definer to encapsulate access.
  alter table rate_limit_counters enable row level security;

  -- RPC: increments the counter for (ip, current_window) and returns state.
  -- Window is aligned to wall-clock buckets (e.g., :00:00 for 1h windows) so
  -- serverless instances share the same bucket without coordination.
  create or replace function check_blog_rate_limit(
    p_ip text,
    p_limit integer default 100,
    p_window_seconds integer default 3600
  )
  returns table (allowed boolean, remaining integer, reset_at timestamptz)
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_window_start timestamptz;
    v_reset_at timestamptz;
    v_count integer;
  begin
    v_window_start := to_timestamp(
      floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
    );
    v_reset_at := v_window_start + (p_window_seconds || ' seconds')::interval;

    insert into rate_limit_counters (ip, window_start, count)
    values (p_ip, v_window_start, 1)
    on conflict (ip, window_start)
    do update set count = rate_limit_counters.count + 1
    returning rate_limit_counters.count into v_count;

  return query select
      (v_count <= p_limit) as allowed,
      greatest(0, p_limit - v_count)::integer as remaining,
      v_reset_at;
  end;
  $$;

  grant execute on function check_blog_rate_limit(text, integer, integer) to anon;

  -- Cleanup function (run periodically via pg_cron or manually)
  create or replace function cleanup_rate_limit_counters(p_older_than_seconds integer default 7200)
  returns integer
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_deleted integer;
  begin
    delete from rate_limit_counters
    where window_start < now() - (p_older_than_seconds || ' seconds')::interval;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end;
  $$;

  grant execute on function cleanup_rate_limit_counters(integer) to anon;
