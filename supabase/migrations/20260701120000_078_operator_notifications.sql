-- Operator notification center (#215). A unified inbox of errors that need an
-- operator's attention. MVP source: failed client notifications, captured from
-- notification_logs by the trigger below. Sibling issue #216 will write into the
-- SAME table (different `type`) — this is the single source of truth the epic
-- (#214) asks to design once.

create table public.operator_notifications (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,                          -- 'notification_failed'
  severity      text not null default 'error'
                  check (severity in ('error', 'warning', 'info')),
  source        text not null,                          -- 'notification_logs'
  source_id     uuid,                                   -- notification_logs.id
  title         text not null,                          -- "No salió el WhatsApp a +57 300…"
  body          text,                                   -- reason (error_message) + type
  resource_type text,                                   -- 'reservation'
  resource_id   uuid,                                   -- reservations.id → /reservations/{id}
  action        text,                                   -- 'resend' | null
  action_ref    uuid,                                   -- notification_logs.id → resendNotification()
  status        text not null default 'unread'
                  check (status in ('unread', 'read', 'resolved')),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  resolved_at   timestamptz
);

-- Idempotency: NULLs are distinct in a UNIQUE constraint, so a PARTIAL unique
-- index on non-null source_id gives real dedup for the MVP (source_id always set)
-- without collapsing future null-source_id alert types (#216).
create unique index uq_operator_notifications_source
  on public.operator_notifications (source, source_id)
  where source_id is not null;

create index idx_operator_notifications_status
  on public.operator_notifications (status, created_at desc);

alter table public.operator_notifications enable row level security;

-- Reads/updates for authenticated operators (mirrors notification_logs). No insert
-- policy on purpose: rows are produced only by the SECURITY DEFINER trigger below.
create policy "Authenticated users can read operator_notifications"
  on public.operator_notifications for select to authenticated using (true);

create policy "Authenticated users can update operator_notifications"
  on public.operator_notifications for update to authenticated using (true);

-- Capture point. AFTER INSERT on notification_logs: every failed client
-- notification becomes an operator alert, regardless of which code path logged it
-- (no producer can forget). SECURITY DEFINER + pinned search_path so the insert
-- runs as the owner (postgres) and bypasses RLS on operator_notifications — this
-- holds whether the log was written by the service-role admin client or, in the
-- future, by an RLS-bound authenticated client (notification_logs allows both).
create function public.capture_failed_notification()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.status = 'failed' then
    insert into public.operator_notifications
      (type, severity, source, source_id, title, body,
       resource_type, resource_id, action, action_ref)
    values (
      'notification_failed',
      'error',
      'notification_logs',
      new.id,
      'No salió '
        || case new.channel when 'email' then 'el email' else 'el WhatsApp' end
        || ' a ' || new.recipient,
      coalesce(new.error_message, 'Sin detalle')
        || ' · tipo: ' || new.notification_type,
      'reservation',
      new.reservation_id,
      'resend',
      new.id
    )
    on conflict (source, source_id) where source_id is not null do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_capture_failed_notification
  after insert on public.notification_logs
  for each row execute function public.capture_failed_notification();

-- Backfill: surface the last 7 days of failures so the widget does not start
-- empty. Idempotent via the same partial-unique conflict target.
insert into public.operator_notifications
  (type, severity, source, source_id, title, body,
   resource_type, resource_id, action, action_ref)
select
  'notification_failed',
  'error',
  'notification_logs',
  nl.id,
  'No salió '
    || case nl.channel when 'email' then 'el email' else 'el WhatsApp' end
    || ' a ' || nl.recipient,
  coalesce(nl.error_message, 'Sin detalle') || ' · tipo: ' || nl.notification_type,
  'reservation',
  nl.reservation_id,
  'resend',
  nl.id
from public.notification_logs nl
where nl.status = 'failed'
  and nl.sent_at >= now() - interval '7 days'
on conflict (source, source_id) where source_id is not null do nothing;
