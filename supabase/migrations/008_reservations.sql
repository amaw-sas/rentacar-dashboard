create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  -- Relations
  customer_id uuid not null references public.customers(id),
  rental_company_id uuid not null references public.rental_companies(id),
  referral_id uuid references public.referrals(id),
  referral_raw text,
  pickup_location_id uuid not null references public.locations(id),
  return_location_id uuid not null references public.locations(id),
  -- Identity
  franchise text not null check (franchise in ('alquilatucarro', 'alquilame', 'alquicarros')),
  booking_type text not null check (booking_type in ('standard', 'standard_with_insurance', 'monthly')),
  reservation_code text,
  reference_token text,
  rate_qualifier text,
  -- Booking
  category_code text not null,
  pickup_date date not null,
  pickup_hour time not null,
  return_date date not null,
  return_hour time not null,
  selected_days smallint not null,
  -- Pricing
  total_price numeric(12,2) not null default 0,
  total_price_to_pay numeric(12,2) not null default 0,
  total_price_localiza numeric(12,2) not null default 0,
  tax_fee numeric(12,2) not null default 0,
  iva_fee numeric(12,2) not null default 0,
  -- Coverage
  coverage_days smallint not null default 0,
  coverage_price numeric(12,2) not null default 0,
  -- Extras
  return_fee numeric(12,2) not null default 0,
  extra_hours smallint not null default 0,
  extra_hours_price numeric(12,2) not null default 0,
  total_insurance numeric(12,2) not null default 0,
  extra_driver boolean not null default false,
  baby_seat boolean not null default false,
  wash boolean not null default false,
  -- Flight
  aeroline text,
  flight_number text,
  -- Monthly
  monthly_mileage integer,
  -- Notification
  notification_required boolean not null default false,
  notification_sent boolean not null default false,
  notification_sent_at timestamptz,
  notification_sent_by uuid references public.profiles(id),
  -- Status
  status text not null default 'nueva' check (status in (
    'nueva', 'pendiente', 'reservado', 'sin_disponibilidad',
    'utilizado', 'no_contactado', 'baneado', 'no_recogido',
    'pendiente_pago', 'pendiente_modificar', 'cancelado',
    'indeterminado', 'mensualidad'
  )),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common queries
create index idx_reservations_status on public.reservations(status);
create index idx_reservations_franchise on public.reservations(franchise);
create index idx_reservations_customer on public.reservations(customer_id);
create index idx_reservations_pickup_date on public.reservations(pickup_date);
create index idx_reservations_reservation_code on public.reservations(reservation_code);

alter table public.reservations enable row level security;

create policy "Authenticated users can read reservations"
  on public.reservations for select
  to authenticated
  using (true);

create policy "Authenticated users can insert reservations"
  on public.reservations for insert
  to authenticated
  with check (true);

create policy "Admins can update reservations"
  on public.reservations for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create trigger on_reservations_updated
  before update on public.reservations
  for each row execute function public.handle_updated_at();
