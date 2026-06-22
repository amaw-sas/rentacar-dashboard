-- Chat Fase 2 · Incremento 1 ("ver conversaciones"). Adds the review surface the
-- dashboard needs to read and grade the anonymous web-chat conversations stored
-- by 064_chat_tables.sql, plus the metrics RPC the list header uses.
--
-- 1. Review columns on chat_conversations (one review per conversation, latest
--    wins — a mutable row, not an audit log). Nullable review_label = not yet
--    reviewed. These feed the eval set of the next increment.
-- 2. An RLS UPDATE policy so authenticated dashboard operators can write the
--    review (064 only granted SELECT; writes there go via the service-role admin
--    client, which the public chat route uses because it has no session). The
--    reviewer HAS a session, so the mark is written by the authenticated client
--    through a server action; RLS can't restrict columns, so the action writes
--    only the four review fields.
-- 3. chat_conversation_metrics(): one round-trip for the header KPIs (volume,
--    handoff rate, quote rate, avg messages), respecting the active list filters.
--    "Reached quote" = a message whose parts contains a successful `cotizar` tool
--    part (AI SDK v6 UIMessage shape: { type: 'tool-cotizar', state:
--    'output-available' }). A GIN index on parts backs the containment probe.

alter table public.chat_conversations
  add column review_label text check (review_label in ('good', 'bad')),
  add column review_note text,
  add column reviewed_by uuid references auth.users (id),
  add column reviewed_at timestamptz;

create policy "Authenticated users can update chat_conversations reviews"
  on public.chat_conversations for update to authenticated
  using (true) with check (true);

-- Backs the `parts @> '[{...}]'` containment probe in the metrics RPC and the
-- thread renderer's tool detection. jsonb_path_ops is the smaller/faster operator
-- class for the `@>` we use; null parts simply aren't indexed.
create index idx_chat_messages_parts_gin
  on public.chat_messages using gin (parts jsonb_path_ops);

-- Header metrics for the conversations list, computed server-side in one call so
-- the page never ships every message's parts to the client (which would defeat
-- pagination). security invoker + pinned search_path, same stance as the sibling
-- analytics RPCs (066/067/068). Filters mirror the list's structural filters; a
-- null arg means "no filter on this dimension".
create or replace function public.chat_conversation_metrics(
  p_brand text default null,
  p_status text default null,
  p_city text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null
)
returns table (
  total bigint,
  handoff_count bigint,
  quoted_count bigint,
  avg_messages numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select c.id, c.status
    from public.chat_conversations c
    where (p_brand is null or c.brand = p_brand)
      and (p_status is null or c.status = p_status)
      and (p_city is null or c.city_detected = p_city)
      and (p_created_from is null or c.created_at >= p_created_from)
      and (p_created_to is null or c.created_at <= p_created_to)
  )
  select
    count(*)::bigint as total,
    (count(*) filter (where f.status = 'handoff'))::bigint as handoff_count,
    (count(*) filter (where exists (
      select 1 from public.chat_messages m
      where m.conversation_id = f.id
        and m.parts @> '[{"type":"tool-cotizar","state":"output-available"}]'::jsonb
    )))::bigint as quoted_count,
    coalesce(avg((
      select count(*) from public.chat_messages m2 where m2.conversation_id = f.id
    )), 0)::numeric as avg_messages
  from filtered f
$$;
