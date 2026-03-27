create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id),
  import_batch_id uuid not null references public.commission_imports(id) on delete cascade,
  -- Raw data from Excel
  customer_name_raw text not null,
  reservation_code_raw text not null,
  reservation_value numeric(12,2) not null,
  commission_amount numeric(12,2) not null,
  commission_rate numeric(5,2),
  contract_type text,
  real_value numeric(12,2),
  commission_month date,
  -- Status
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'manual')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'invoiced', 'paid')),
  invoice_number text,
  invoice_date date,
  payment_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_commissions_import_batch on public.commissions(import_batch_id);
create index idx_commissions_reservation on public.commissions(reservation_id);
create index idx_commissions_match_status on public.commissions(match_status);
create index idx_commissions_payment_status on public.commissions(payment_status);
create index idx_commissions_reservation_code on public.commissions(reservation_code_raw);

alter table public.commissions enable row level security;

create policy "Authenticated users can read commissions"
  on public.commissions for select
  to authenticated
  using (true);

create policy "Admins can insert commissions"
  on public.commissions for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update commissions"
  on public.commissions for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_commissions_updated
  before update on public.commissions
  for each row execute function public.handle_updated_at();
