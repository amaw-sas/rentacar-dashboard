create table public.vehicle_categories (
  id uuid primary key default gen_random_uuid(),
  rental_company_id uuid not null references public.rental_companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  image_url text not null default '',
  passenger_count smallint not null default 0,
  luggage_count smallint not null default 0,
  has_ac boolean not null default true,
  transmission text not null default 'manual' check (transmission in ('automatic', 'manual')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_company_id, code)
);

alter table public.vehicle_categories enable row level security;

create policy "Authenticated users can read vehicle_categories"
  on public.vehicle_categories for select
  to authenticated
  using (true);

create policy "Admins can insert vehicle_categories"
  on public.vehicle_categories for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update vehicle_categories"
  on public.vehicle_categories for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_vehicle_categories_updated
  before update on public.vehicle_categories
  for each row execute function public.handle_updated_at();
