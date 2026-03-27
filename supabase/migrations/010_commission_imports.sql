create table public.commission_imports (
  id uuid primary key default gen_random_uuid(),
  rental_company_id uuid not null references public.rental_companies(id),
  file_name text not null,
  period_label text,
  total_rows smallint not null default 0,
  matched_rows smallint not null default 0,
  unmatched_rows smallint not null default 0,
  total_commission numeric(12,2) not null default 0,
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now()
);

alter table public.commission_imports enable row level security;

create policy "Authenticated users can read commission_imports"
  on public.commission_imports for select
  to authenticated
  using (true);

create policy "Admins can insert commission_imports"
  on public.commission_imports for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
