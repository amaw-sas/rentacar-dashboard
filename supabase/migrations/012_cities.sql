create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cities enable row level security;

create policy "Authenticated users can read cities"
  on public.cities for select to authenticated using (true);

create policy "Admins can insert cities"
  on public.cities for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can update cities"
  on public.cities for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create trigger on_cities_updated
  before update on public.cities
  for each row execute function public.handle_updated_at();

-- Add city_id FK to locations
alter table public.locations add column city_id uuid references public.cities(id);
