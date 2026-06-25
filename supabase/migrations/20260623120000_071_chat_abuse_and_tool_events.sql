-- Chat Fase 2 · Incremento 4 ("Escudo"). The public, anonymous chat endpoint now
-- creates REAL reservations, so this migration adds the storage two guardrails
-- need:
--
-- 1. ip_hash on chat_conversations — a SALTED SHA-256 of the client IP (NEVER the
--    raw IP, to minimize PII). Powers the per-IP rate limits that close the
--    "open a fresh conversation to bypass the per-conversation cap" hole. The
--    public route writes it via the service-role admin client (no session).
-- 2. chat_tool_events — one row per `cotizar`/`crear_reserva` execution (ok/fail
--    + error_code + latency). Two jobs: (a) observability, so the dashboard can
--    surface a health alert when the tool failure rate spikes; (b) the booking
--    rate caps (count prior successful `crear_reserva` per conversation and per
--    IP). Writes via the service-role admin client; authenticated dashboard users
--    get RLS SELECT, mirroring 064/069.

alter table public.chat_conversations
  add column ip_hash text;

-- Backs the per-IP new-conversation rate check (count by ip_hash within a window).
create index idx_chat_conversations_ip
  on public.chat_conversations (ip_hash, created_at);

create table public.chat_tool_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.chat_conversations (id) on delete set null,
  ip_hash text,
  tool text not null check (tool in ('cotizar', 'crear_reserva')),
  ok boolean not null,
  error_code text,
  brand text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- Health query: failure rate per tool over a trailing window.
create index idx_chat_tool_events_tool_created
  on public.chat_tool_events (tool, created_at);

-- Per-IP booking cap (and per-IP abuse forensics): successful crear_reserva by ip.
create index idx_chat_tool_events_ip_tool_created
  on public.chat_tool_events (ip_hash, tool, created_at);

-- Per-conversation booking cap: successful crear_reserva within one conversation.
create index idx_chat_tool_events_conversation_tool
  on public.chat_tool_events (conversation_id, tool);

alter table public.chat_tool_events enable row level security;

-- Reads are reserved for authenticated dashboard users (the health alert). Writes
-- go through the service-role admin client, which bypasses RLS — the public chat
-- route has no session, same pattern as chat_conversations/chat_messages in 064.
create policy "Authenticated users can read chat_tool_events"
  on public.chat_tool_events for select to authenticated using (true);
