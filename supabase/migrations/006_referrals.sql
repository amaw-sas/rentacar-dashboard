create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('company', 'hotel', 'salesperson', 'other')),
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  commission_notes text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referrals enable row level security;

create policy "Authenticated users can read referrals"
  on public.referrals for select
  to authenticated
  using (true);

create policy "Admins can insert referrals"
  on public.referrals for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update referrals"
  on public.referrals for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_referrals_updated
  before update on public.referrals
  for each row execute function public.handle_updated_at();
