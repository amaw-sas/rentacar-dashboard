create table public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  identification_type text not null check (identification_type in ('CC', 'CE', 'NIT', 'PP', 'TI')),
  identification_number text not null unique,
  phone text not null default '',
  email text not null unique,
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;

create policy "Authenticated users can read customers"
  on public.customers for select
  to authenticated
  using (true);

create policy "Authenticated users can insert customers"
  on public.customers for insert
  to authenticated
  with check (true);

create policy "Admins can update customers"
  on public.customers for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_customers_updated
  before update on public.customers
  for each row execute function public.handle_updated_at();
