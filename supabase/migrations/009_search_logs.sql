create table public.search_logs (
  id uuid primary key default gen_random_uuid(),
  -- Search params
  franchise text not null,
  pickup_location_code text not null,
  return_location_code text not null,
  pickup_date date not null,
  pickup_hour time not null,
  return_date date not null,
  return_hour time not null,
  is_monthly boolean not null default false,
  referral_code text,
  -- Results
  available_categories jsonb not null default '[]',
  total_results smallint not null default 0,
  -- Selection
  selected_category_code text,
  converted_to_reservation boolean not null default false,
  -- Metadata
  session_id text,
  user_agent text,
  ip_address text,
  searched_at timestamptz not null default now()
);

create index idx_search_logs_searched_at on public.search_logs(searched_at);
create index idx_search_logs_franchise on public.search_logs(franchise);
create index idx_search_logs_referral on public.search_logs(referral_code);
create index idx_search_logs_pickup_location on public.search_logs(pickup_location_code);
create index idx_search_logs_converted on public.search_logs(converted_to_reservation);

alter table public.search_logs enable row level security;

-- Read-only for authenticated users (append-only from rentacar-main via service role)
create policy "Authenticated users can read search_logs"
  on public.search_logs for select
  to authenticated
  using (true);
