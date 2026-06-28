-- Generic fixed-window rate limiter (synthetic-reservations wave, 27→28 jun 2026).
--
-- `createReservation` (the shared service behind the public POST /api/reservations
-- route AND the in-process MCP/chat funnel) had NO rate limiting or dedup: the
-- chat self-play eval created 165 synthetic reservations across 33 fake
-- identities in ~14h. This adds a GENERIC counter so the service can throttle
-- per-IP and per-identification_number.
--
-- Reuses the existing `rate_limit_counters` table (migration 023). The PK column
-- `ip` is plain text and namespaced by caller-supplied keys
-- (e.g. 'resv:ip:1.2.3.4', 'resv:doc:1018456723'), so the blog limiter
-- (check_blog_rate_limit, raw IP keys) and this one never collide.
--
-- Identical fixed-window algorithm as check_blog_rate_limit: window aligned to
-- wall-clock buckets so stateless serverless instances share a bucket without
-- coordination; the upsert is atomic under concurrency.

create or replace function check_rate_limit(
  p_key text,
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
  values (p_key, v_window_start, 1)
  on conflict (ip, window_start)
  do update set count = rate_limit_counters.count + 1
  returning rate_limit_counters.count into v_count;

  return query select
    (v_count <= p_limit) as allowed,
    greatest(0, p_limit - v_count)::integer as remaining,
    v_reset_at;
end;
$$;

grant execute on function check_rate_limit(text, integer, integer) to anon;
grant execute on function check_rate_limit(text, integer, integer) to authenticated;
grant execute on function check_rate_limit(text, integer, integer) to service_role;
