-- Chatbot V1 persistence (cerebro in rentacar-dashboard). Two tables store the
-- anonymous web-chat conversations so the dashboard can later read them
-- ("ver conversaciones", handoff). Writes go through the service-role admin
-- client (bypasses RLS); authenticated dashboard users get read-only access,
-- mirroring the RLS pattern of 020_notification_logs.sql.

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  city_detected text,
  status text not null default 'open' check (status in ('open', 'closed', 'handoff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text,
  parts jsonb,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_conversation on public.chat_messages(conversation_id);
create index idx_chat_conversations_created on public.chat_conversations(created_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy "Authenticated users can read chat_conversations"
  on public.chat_conversations for select to authenticated using (true);

create policy "Authenticated users can read chat_messages"
  on public.chat_messages for select to authenticated using (true);
