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

Why a trigger over app-level insertion: it captures every failed notification regardless of which code path logged it, so no future call site can forget to emit an alert. It is the "capture once" the epic asks for. Idempotent via `unique(source, source_id)`.

## Data model (migration 078)

```sql
create table public.operator_notifications (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,                    -- 'notification_failed'
  severity      text not null default 'error'
                  check (severity in ('error','warning','info')),
  source        text not null,                    -- 'notification_logs'
  source_id     uuid,                             -- notification_logs.id
  title         text not null,                    -- "No salió el WhatsApp a Juan Pérez"
  body          text,                             -- reason (error_message) + type/channel
  resource_type text,                             -- 'reservation'
  resource_id   uuid,                             -- reservations.id → /reservations/{id}
  action        text,                             -- 'resend' | null
  action_ref    uuid,                             -- notification_logs.id → resendNotification()
  status        text not null default 'unread'
                  check (status in ('unread','read','resolved')),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  resolved_at   timestamptz,
  unique (source, source_id)
);

create index idx_operator_notifications_status
  on public.operator_notifications (status, created_at desc);
```

- **RLS**: `authenticated` may select and update (mirrors `notification_logs` policies). Inserts happen via the trigger, which runs with the definer's rights.
- **Backfill**: on migration apply, insert `operator_notifications` rows for `notification_logs` failures from the last 7 days, so the widget does not start empty. Same idempotent `on conflict (source, source_id) do nothing`.
- **Title/body composition**: the trigger derives human Spanish copy from the log row (`channel`, `notification_type`, `recipient`, `error_message`). The reservation link comes from `reservation_id`. `action = 'resend'`, `action_ref = notification_logs.id`.

## Components

- **`NotificationBell`** (`components/layout/notification-bell.tsx`, client): bell icon with an unread-count badge, mounted in the `<header>` of `app/(dashboard)/layout.tsx` next to `SidebarTrigger` — visible in every dashboard view (SCEN-3).
- **Popover contents**: each alert shows title, reason, relative time, a link to `/reservations/{resource_id}`, a **Reenviar** button when `action='resend'`, and a **Marcar resuelta** action. Empty state = "Sin alertas".
- The dashboard layout (server component) fetches the initial unread count and recent list and passes them as props.

## Data access and actions

- `lib/queries/operator-notifications.ts` (server-only, throw on Supabase error):
  - `getUnreadCount(): Promise<number>`
  - `getRecentNotifications(limit?): Promise<OperatorNotification[]>` — most recent first, unread prioritized.
- `lib/actions/operator-notifications.ts` (`"use server"`, return `{ error?: string }`, never throw to client, `revalidatePath`):
  - `markRead(id)`, `markAllRead()`, `resolveNotification(id)`.
  - **Resend reuses the existing `resendNotification(action_ref)`** from `lib/actions/notification-logs.ts`; on success it calls `resolveNotification(id)`.
- Zod schema for the mutation inputs in `lib/schemas/operator-notification.ts`.

## Data flow

Notification fails → `logNotification({status:'failed'})` inserts into `notification_logs` → **trigger** creates an `unread` `operator_notifications` row → on the next navigation the server layout reads the count → badge renders. Operator opens the popover → resends (`resendNotification`) or marks resolved → `revalidatePath` refreshes the badge. No realtime in the MVP (YAGNI); refresh is driven by navigation and by the actions.

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
