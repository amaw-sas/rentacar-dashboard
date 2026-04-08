create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  notification_type text not null,
  recipient text not null,
  subject text,
  html_content text,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text,
  sent_at timestamptz not null default now()
);

create index idx_notification_logs_reservation on public.notification_logs(reservation_id);

alter table public.notification_logs enable row level security;

create policy "Authenticated users can read notification_logs"
  on public.notification_logs for select to authenticated using (true);

create policy "Authenticated users can insert notification_logs"
  on public.notification_logs for insert to authenticated with check (true);
