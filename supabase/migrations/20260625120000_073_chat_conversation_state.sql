-- 073: per-conversation orchestrator state (Rediseño híbrido · Etapa 1).
--
-- Adds the deterministic conversation state the hybrid orchestrator owns server-
-- side: a `state` jsonb (slots + flags + phase) and a mirrored `phase` text column
-- for dashboard filtering. Additive and nullable — the existing `chat_messages`
-- history stays the audit/replay log, and these columns are only written when the
-- orchestrator is enabled (CHAT_ORCHESTRATOR). No backfill, no behavior change for
-- the current all-LLM path.

alter table public.chat_conversations
  add column if not exists state jsonb,
  add column if not exists phase text;

comment on column public.chat_conversations.state is
  'Hybrid orchestrator conversation state (slots + flags + phase). Null until the orchestrator writes it.';
comment on column public.chat_conversations.phase is
  'Mirror of state->>phase for dashboard filtering.';
