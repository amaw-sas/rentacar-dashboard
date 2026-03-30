create table public.franchises (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  website text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  logo_url text not null default '',
  sender_email text not null,
  sender_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.franchises enable row level security;

create policy "Authenticated users can read franchises"
  on public.franchises for select to authenticated using (true);

create policy "Admins can insert franchises"
  on public.franchises for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can update franchises"
  on public.franchises for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create trigger on_franchises_updated
  before update on public.franchises
  for each row execute function public.handle_updated_at();
