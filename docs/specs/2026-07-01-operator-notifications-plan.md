# Operator notification center (#215) — implementation plan

**Date**: 2026-07-01
**Spec**: `docs/specs/2026-07-01-operator-notifications-design.md` (approved, 2 review rounds)
**Worktree**: `.worktrees/issue-215-operator-notifications` — branch `feat/issue-215-operator-notifications`

Scenarios are embedded per step (SDD: scenario → code → satisfy). No test-only steps.

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `supabase/migrations/20260701120000_078_operator_notifications.sql` | Table, partial unique index, status index, RLS + 2 policies, `capture_failed_notification()` SECURITY DEFINER trigger, 7-day backfill | New |
| `lib/schemas/operator-notification.ts` | `OperatorNotification` hand-written type + Zod schemas for mutation inputs (uuid id) | New |
| `lib/queries/operator-notifications.ts` | `getUnreadCount()`, `getRecentNotifications(limit)` — server-only, throw on error, unread-first order | New |
| `lib/actions/operator-notifications.ts` | `markRead`, `markAllRead`, `resolveNotification`, `resendOperatorNotification` — `{error?}`, `revalidatePath('/', 'layout')` | New |
| `components/layout/notification-bell.tsx` | Client: bell + badge + Popover list, per-item link/resend/resolve, empty state | New |
| `app/(dashboard)/layout.tsx` | Make `async`, `Promise.all` fetch count+list, mount `<NotificationBell>` in `<header>` | Mod |
| `tests/unit/schemas/operator-notification.test.ts` | Zod parse/reject | New |
| `tests/unit/queries/operator-notifications.test.ts` | count + ordering | New |
| `tests/unit/actions/operator-notifications.test.ts` | resolve/markRead/resend-wrapper, error path | New |

Note: `operator_notifications` will not be in `lib/types/database.ts` (vestigial/untyped per project reality); use the hand-written type + `as unknown as` cast at the client boundary, consistent with existing queries.

## Steps

### Phase 1 — Foundation (capture)

**Step 1 — Migration 078: table + capture trigger** | Size: M | Deps: none
Scenario: Inserting a `notification_logs` row with `status='failed'` produces exactly one `operator_notifications` row (`status='unread'`, `type='notification_failed'`, `resource_id=reservation_id`, `action='resend'`, `action_ref=log.id`). A `status='sent'` insert produces none (SCEN-5). Re-inserting the same log id dedups (partial unique index, `on conflict do nothing`). Backfill inserts rows for failed logs in the last 7 days.
Acceptance:
- Applied to the testing branch via MCP `apply_migration` (never `db push`).
- SQL round-trip proves: failed→1 row, sent→0 rows, duplicate source_id→still 1 row, backfill count == count of `notification_logs` failed in last 7d.
- Trigger function is `SECURITY DEFINER`, `search_path=public`, owner `postgres`.
- `pnpm db:types` intentionally skipped — `lib/types/database.ts` is vestigial/untyped in this project; use the hand-written type from Step 2 + `as unknown as` cast (documented deviation from `conventions.md`).

**Step 2 — Schema + type** | Size: S | Deps: none
Scenario: A valid uuid parses; a non-uuid is rejected with a Spanish issue message.
Acceptance: `tests/unit/schemas/operator-notification.test.ts` green. `OperatorNotification` type matches the migration columns.

### Phase 2 — Read/write layer

**Step 3 — Queries** | Size: S | Deps: Step 1, 2
Scenario: Given 2 `unread` + 1 `resolved` rows, `getUnreadCount()` returns 2 and `getRecentNotifications()` returns unread rows before the resolved one (explicit `ORDER BY (status='unread') DESC, created_at DESC`).
Acceptance: unit test green; both throw on Supabase error (queries convention).

**Step 4 — Actions** | Size: M | Deps: Step 2, 3
Scenario: `resolveNotification(id)` sets `status='resolved'` + `resolved_at` and returns `{}`; `markRead(id)` sets `read_at`+`status='read'`; `markAllRead()` sets every `unread` row to `read`; `resendOperatorNotification(id)` resolves the row on `resendNotification(action_ref)` success and returns `{error}` (Spanish) on failure — never throws. Each mutation calls `revalidatePath('/', 'layout')`.
Acceptance: `tests/unit/actions/operator-notifications.test.ts` green, covering `markAllRead` and the resend-failure error path.

### Phase 3 — UI

**Step 5 — NotificationBell component** | Size: M | Deps: Step 4
Scenario (SCEN-3): the bell shows a badge with the unread count; when count is 0 no badge. Opening the Popover lists alerts with title, reason, relative time, a link to `/reservations/{resource_id}`, a **Reenviar** button (when `action='resend'`) and **Marcar resuelta**; a **Marcar todas como leídas** header action calls `markAllRead()`. Empty list → "Sin alertas". Actions call the server actions.
Acceptance: renders count/badge, renders item list + empty state, per-item and "marcar todas" buttons wired to actions; `"use client"`.

**Step 6 — Mount in dashboard layout** | Size: M | Deps: Step 3, 5
Scenario (SCEN-3): on any dashboard route the header shows the bell with the server-fetched unread count. Layout becomes `async` and fetches count+list in `Promise.all`.
Acceptance: `pnpm type-check`, `pnpm lint`, `pnpm build` green; bell present in header; no page changes needed.

### Phase 4 — Runtime satisfaction

**Step 7 — End-to-end scenario verification (QA)** | Size: M | Deps: Step 1, 6
Satisfies the observable scenarios against the running app on the testing branch:
- Seed a `notification_logs` failed row → **SCEN-1** alert appears with client/channel/reason/link + Reenviar.
- Reload → **SCEN-2** alert persists.
- **SCEN-3** badge count visible across ≥2 dashboard views.
- Mark resuelta → badge decrements, alert leaves the unread group (it may remain lower as history since `getRecentNotifications` returns all statuses unread-first).
- No failures seeded → **SCEN-5** inbox empty.
Acceptance: `/agent-browser` + `/dogfood` run — zero console errors, zero failed requests; each SCEN observed. Evidence captured for `/verification-before-completion`.

## Prerequisites
- Testing Supabase branch reachable (MCP). Env for dev server: `set -a && . ./.env.testing && set +a && pnpm dev` (Next does not autoload `.env.testing`).
- Reuse existing `resendNotification` — no new resend logic.

## Testing strategy
- Unit (vitest): schema, queries, actions (Steps 2–4).
- DB behavior: trigger + backfill verified by SQL round-trip on the branch (Step 1).
- E2E/exploratory: `/agent-browser` + `/dogfood` (Step 7).
- CI gate: type-check → lint → test → build must pass.

## Rollout
- Deploy: after merge, apply migration 078 to **prod** via MCP `apply_migration` (never `db push` — it drags unrelated drops). Code that reads the table ships gated behind the same PR, so schema precedes read-path in the same rollout.
- Rename local migration to align `schema_migrations` remote after MCP apply (project convention).
- Monitoring: the widget is itself the monitor. No cron.
- Rollback: `drop trigger trg_capture_failed_notification on public.notification_logs` + `drop function public.capture_failed_notification()` + `drop table public.operator_notifications` (isolated; no FK from other tables points in). The UI degrades to absent bell if the query fails (layout error boundary) — acceptable.

## Risk
- **Overall**: M. Isolated additive feature; the only shared touch is `app/(dashboard)/layout.tsx` (additive).
- Main risk: trigger RLS/ownership under MCP apply — mitigated by SECURITY DEFINER (spec §data model, review-confirmed).
