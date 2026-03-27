create table public.category_pricing (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.vehicle_categories(id) on delete cascade,
  total_coverage_unit_charge numeric(12,2) not null default 0,
  monthly_1k_price numeric(12,2),
  monthly_2k_price numeric(12,2),
  monthly_3k_price numeric(12,2),
  monthly_insurance_price numeric(12,2),
  monthly_one_day_price numeric(12,2),
  valid_from date not null default current_date,
  valid_until date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.category_pricing enable row level security;

create policy "Authenticated users can read category_pricing"
  on public.category_pricing for select
  to authenticated
  using (true);

create policy "Admins can insert category_pricing"
  on public.category_pricing for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update category_pricing"
  on public.category_pricing for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_category_pricing_updated
  before update on public.category_pricing
  for each row execute function public.handle_updated_at();
