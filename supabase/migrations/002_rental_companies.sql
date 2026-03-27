create table public.rental_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  commission_rate_min numeric(5,2),
  commission_rate_max numeric(5,2),
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  api_base_url text not null default '',
  extra_driver_day_price numeric(12,2) not null default 0,
  baby_seat_day_price numeric(12,2) not null default 0,
  wash_price numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rental_companies enable row level security;

create policy "Authenticated users can read rental_companies"
  on public.rental_companies for select
  to authenticated
  using (true);

create policy "Admins can insert rental_companies"
  on public.rental_companies for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update rental_companies"
  on public.rental_companies for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_rental_companies_updated
  before update on public.rental_companies
  for each row execute function public.handle_updated_at();
