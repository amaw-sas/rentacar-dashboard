# Operator notification center (#215) — design

Part of epic #214. Operator-facing front. Sibling: #216 (backend error capture + Telegram).

## Problem

When an operation fails — a client notification that never went out, a reservation that bounced off Localiza, a cron that returned 500 — the operator has no way to find out. Nothing in the dashboard says "this broke, go look." The recent incident that stayed live a whole day and was only caught at closing is exactly this gap.

The only thing close to this today is `chat-health-banner.tsx`: a red banner in the conversations view when the chat tool failure rate crosses 30% over 24h. It works, but it is scoped to chat and is not a notification center.

## Goal

Give operators a persistent notification center (bell + badge) in the dashboard layout that surfaces errors requiring their attention and links each one to the affected resource with the action to take. Ship the quick win first: failed client notifications, which already live in `notification_logs`.

## Decisions (resolved with product)

- **Source of truth**: a dedicated `operator_notifications` table — the unified inbox. SCEN-2 (persist until attended) and SCEN-3 (unread badge) require per-alert read/resolved state, so a read-only view of the sources cannot satisfy them. The epic asks to design the capture point once; #216 will write into this same table later.
- **MVP scope**: `notification_logs` rows with `status='failed'` only. Chat turn errors, crons, and integrations are out of scope for this delivery — they hang off the same table later via a different `type`.
- **SCEN-4**: the MVP covers the actionable half (direct link to the affected reservation + resend action). The "reconcile after a Localiza 504" task (#170) depends on a producer that emits that task type, which is #216/#170 territory. It is a natural extension on the same table, not part of this MVP. Approved by product.

## Capture point — database trigger

The producer is a **database trigger**, not application code. An `AFTER INSERT` on `notification_logs` that, when `NEW.status = 'failed'`, inserts one row into `operator_notifications`.

Why a trigger over app-level insertion: it captures every failed notification regardless of which code path logged it, so no future call site can forget to emit an alert. It is the "capture once" the epic asks for. Idempotent via a partial unique index on `(source, source_id) where source_id is not null` (see data model).

## Data model (migration 078)

```sql
create table public.operator_notifications (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,                    -- 'notification_failed'
  severity      text not null default 'error'
                  check (severity in ('error','warning','info')),
  source        text not null,                    -- 'notification_logs'
  source_id     uuid,                             -- notification_logs.id
  title         text not null,                    -- "No salió el WhatsApp a +57 300…"
  body          text,                             -- reason (error_message) + type/channel
  resource_type text,                             -- 'reservation'
  resource_id   uuid,                             -- reservations.id → /reservations/{id}
  action        text,                             -- 'resend' | null
  action_ref    uuid,                             -- notification_logs.id → resendNotification()
  status        text not null default 'unread'
                  check (status in ('unread','read','resolved')),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  resolved_at   timestamptz
);

-- Idempotency: NULLs are distinct in a UNIQUE constraint, so a partial unique
-- index on non-null source_id gives real dedup for the MVP (source_id always set)
-- without accidentally collapsing future null-source_id alert types (#216).
create unique index uq_operator_notifications_source
  on public.operator_notifications (source, source_id)
  where source_id is not null;

create index idx_operator_notifications_status
  on public.operator_notifications (status, created_at desc);
```

**RLS.** `authenticated` may `select` and `update` (mirrors `notification_logs`). There is deliberately **no** insert policy — operator rows are produced only by the trigger below.

**Capture trigger.** The trigger function is `SECURITY DEFINER` with a pinned `search_path`, owned by `postgres`, so its insert bypasses RLS regardless of which client wrote the `notification_logs` row (the current callers use the service-role admin client, but `notification_logs` also has an authenticated insert policy — `DEFINER` makes the capture correct under either path, closing the fragility the review flagged).

```sql
alter table public.operator_notifications enable row level security;
create policy "auth read operator_notifications"
  on public.operator_notifications for select to authenticated using (true);
create policy "auth update operator_notifications"
  on public.operator_notifications for update to authenticated using (true);

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
      'notification_failed', 'error', 'notification_logs', new.id,
      'No salió ' ||
        case new.channel when 'email' then 'el email' else 'el WhatsApp' end ||
        ' a ' || new.recipient,
      coalesce(new.error_message, 'Sin detalle') ||
        ' · tipo: ' || new.notification_type,
      'reservation', new.reservation_id,
      'resend', new.id
    )
    on conflict (source, source_id) where source_id is not null do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_capture_failed_notification
  after insert on public.notification_logs
  for each row execute function public.capture_failed_notification();
```

**Backfill** (idempotent, same conflict target) for the last 7 days so the widget does not start empty:

```sql
insert into public.operator_notifications
  (type, severity, source, source_id, title, body,
   resource_type, resource_id, action, action_ref)
select 'notification_failed', 'error', 'notification_logs', nl.id,
       'No salió ' || case nl.channel when 'email' then 'el email' else 'el WhatsApp' end
         || ' a ' || nl.recipient,
       coalesce(nl.error_message, 'Sin detalle') || ' · tipo: ' || nl.notification_type,
       'reservation', nl.reservation_id, 'resend', nl.id
from public.notification_logs nl
where nl.status = 'failed' and nl.sent_at >= now() - interval '7 days'
on conflict (source, source_id) where source_id is not null do nothing;
```

**Copy note.** Title/body are composed from the log row alone (`channel`, `notification_type`, `recipient`, `error_message`) — no customer name, because `notification_logs.recipient` is an email/phone and the table has no name column. Joining `reservations → customers` in the trigger was rejected as unnecessary coupling; the reservation link carries the human context. The popover can render the customer name later by resolving `resource_id` at read time if desired.

## Components

- **`NotificationBell`** (`components/layout/notification-bell.tsx`, client): bell icon with an unread-count badge, mounted in the `<header>` of `app/(dashboard)/layout.tsx` next to `SidebarTrigger` — visible in every dashboard view (SCEN-3).
- **Popover contents**: each alert shows title, reason, relative time, a link to `/reservations/{resource_id}`, a **Reenviar** button when `action='resend'`, and a **Marcar resuelta** action. Empty state = "Sin alertas".
- The dashboard layout (server component) fetches the initial unread count and recent list and passes them as props.

**Blast radius.** `app/(dashboard)/layout.tsx` is currently a synchronous, non-fetching server component. This change makes it `async` and adds two Supabase reads (count + recent list) on every hard render of every dashboard route. Both are indexed and cheap; they run in a `Promise.all`. Affected file: the layout only — no page or existing component changes. Consumers of the layout are all dashboard routes, but none read the new props, so the change is additive.

## Data access and actions

- `lib/queries/operator-notifications.ts` (server-only, throw on Supabase error):
  - `getUnreadCount(): Promise<number>` — `head: true, count: 'exact'` filtered `status='unread'` (indexed, cheap).
  - `getRecentNotifications(limit = 20): Promise<OperatorNotification[]>` — explicit `ORDER BY (status='unread') DESC, created_at DESC` so unread sorts first (the index alone can't: `status` sorts `read < resolved < unread` alphabetically).
- `lib/actions/operator-notifications.ts` (`"use server"`, return `{ error?: string }`, never throw to client):
  - `markRead(id)`, `markAllRead()`, `resolveNotification(id)`.
  - Each mutation ends with **`revalidatePath('/', 'layout')`** — the count/list are fetched in the dashboard layout, so a page-scoped revalidate would not refresh them; the layout scope is required.
  - **Resend reuses the existing `resendNotification(action_ref)`** from `lib/actions/notification-logs.ts`; on success it calls `resolveNotification(id)`.
- Zod schema for the mutation inputs in `lib/schemas/operator-notification.ts`.

## Data flow and refresh mechanism

Notification fails → `logNotification({status:'failed'})` inserts into `notification_logs` → **trigger** creates an `unread` `operator_notifications` row.

Refresh, stated precisely for the App Router: the dashboard layout is a server component, but Next.js does **not** re-execute a shared layout on soft (`<Link>`) navigation between its child routes — it renders once per hard load and is served from the client router cache thereafter. So the badge refreshes on: (a) a hard load / full reload, and (b) any operator action, because `markRead`/`resolveNotification`/resend call `revalidatePath('/', 'layout')`, which re-runs the layout fetch. A newly arrived failure therefore surfaces on the next hard load or the next operator action — acceptable for the MVP, which explicitly has no realtime (YAGNI). SCEN-3's requirement (bell + badge visible in every view) is met because the bell is mounted in the layout; the badge value is a point-in-time count, not a live push.

## Error handling and SCEN-5 (zero noise)

The trigger fires only on `status='failed'`, so a day with no failures produces no new rows and the badge stays at 0 — fails open to all-OK, same principle as the chat banner. Actions return `{ error }` in Spanish and never throw to the client. Queries throw so the layout's error boundary renders.

## Observable scenarios

- **SCEN-1 — Failed client notification is visible**: Given a `notification_logs` row with `status='failed'`, when the operator opens the dashboard, then the notification center shows an entry with client, channel (email/WhatsApp), reason, and a link to the reservation, and can resend from there.
- **SCEN-2 — The alert persists until attended**: Given an unattended error, when the operator reloads or returns later, then the alert is still there (not an ephemeral toast) until marked resolved/read.
- **SCEN-3 — Count visible without opening detail**: Given N unread alerts, when the operator is in any dashboard view, then a bell with a count badge is visible without navigating to a specific screen.
- **SCEN-4 — Actionable link to the affected resource (MVP scope)**: Given a failed notification tied to a reservation, when the operator opens the alert, then it links directly to the affected reservation and offers the resend action. (The reconcile-after-504 task from #170 is a same-table extension owned by #216, out of this MVP.)
- **SCEN-5 — Zero noise in normal operation**: Given a day with no errors, when the operator works, then the notification center shows no false positives.

## Out of scope (MVP)

- Runtime error capture and dev-team alerts (Telegram) → #216.
- Chat turn errors, cron failures, integration outages as sources.
- Realtime push (Supabase Realtime).
- Client-facing notifications (already delivered via email/WhatsApp).

## Testing

- Unit (vitest): trigger behavior via SQL round-trip on a branch, queries, actions, title/body composition.
- QA: `/agent-browser` + `/dogfood` — the alert appears, persists across reload, marks read/resolved; zero console errors, zero failed requests.
- Deploy: migration 078 applied to prod via MCP `apply_migration` (never `db push`), gated behind the code that reads the table.
