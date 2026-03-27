create table public.locations (
  id uuid primary key default gen_random_uuid(),
  rental_company_id uuid not null references public.rental_companies(id) on delete cascade,
  code text not null,
  name text not null,
  city text not null default '',
  address text not null default '',
  schedule jsonb not null default '{}',
  slug text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_company_id, code)
);

alter table public.locations enable row level security;

create policy "Authenticated users can read locations"
  on public.locations for select
  to authenticated
  using (true);

create policy "Admins can insert locations"
  on public.locations for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update locations"
  on public.locations for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_locations_updated
  before update on public.locations
  for each row execute function public.handle_updated_at();
