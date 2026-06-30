-- Per-brand chat on/off switch (launch gate). The dashboard (/chat-knowledge) toggles
-- each brand; the public chat route reads this via the service-role admin client to
-- decide whether to serve. Enforcement is gated behind CHAT_BRAND_SWITCH (default off)
-- so preview/testing stays unaffected until launch day. A missing row or missing table
-- is treated as OFF (safe default: a paused bot beats one serving a brand meant to be off).
--
-- RLS mirrors chat_knowledge: authenticated dashboard staff read + write; the public
-- chat route reads via the admin client (the route is anonymous).

create table public.chat_brand_settings (
  brand text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.chat_brand_settings enable row level security;

create policy "Authenticated users can read chat_brand_settings"
  on public.chat_brand_settings for select to authenticated using (true);

create policy "Authenticated users can insert chat_brand_settings"
  on public.chat_brand_settings for insert to authenticated with check (true);

create policy "Authenticated users can update chat_brand_settings"
  on public.chat_brand_settings for update to authenticated
  using (true) with check (true);

-- Seed the three brands OFF. Launch = flip CHAT_BRAND_SWITCH on in Production, then the
-- operator enables each brand from the dashboard ("published but paused").
insert into public.chat_brand_settings (brand, enabled) values
  ('alquilatucarro', false),
  ('alquilame', false),
  ('alquicarros', false)
on conflict (brand) do nothing;
