-- Add visibility_mode to vehicle_categories
alter table public.vehicle_categories
  add column visibility_mode text not null default 'all'
  check (visibility_mode in ('all', 'restricted'));

-- Pivot table: only stores entries for 'restricted' categories
create table public.category_city_visibility (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.vehicle_categories(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  unique (category_id, city_id)
);

alter table public.category_city_visibility enable row level security;

create policy "Authenticated users can read category_city_visibility"
  on public.category_city_visibility for select to authenticated using (true);

create policy "Admins can insert category_city_visibility"
  on public.category_city_visibility for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can delete category_city_visibility"
  on public.category_city_visibility for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
