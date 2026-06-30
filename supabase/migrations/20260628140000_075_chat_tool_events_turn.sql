-- Chat observability gap (issue surfaced 2026-06-28): turn-level failures were not
-- recorded anywhere queryable — only ephemeral Vercel console logs. A turn that
-- crashes/timeouts (e.g. "TypeError: Failed to fetch" client-side) left no trace in
-- the dashboard. We now record those failures into chat_tool_events with a new
-- `tool = 'turn'` value (ok = false), so the conversations health surface can count
-- chat outages and the operator can find them without the Vercel logs.
--
-- The CHECK from migration 071 is anonymous, so Postgres named it
-- `chat_tool_events_tool_check`; drop + recreate it with the new value. Existing
-- rows are unaffected (no value change, no backfill).
alter table public.chat_tool_events
  drop constraint if exists chat_tool_events_tool_check,
  add constraint chat_tool_events_tool_check
    check (tool in ('cotizar', 'crear_reserva', 'turn'));
