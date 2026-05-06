---
name: pickup-reminders-rls-fix
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-06T00:00:00Z
spec: inline (bug fix — no design doc)
---

# Scenarios — Pickup reminder + check-pending crons must bypass RLS

Bug: Vercel Cron invokes the pickup-reminder endpoints with no user session. The
queries in `lib/reminders/*` use `createClient()` from `lib/supabase/server.ts`,
which authenticates as `anon` when no auth cookie is present. The RLS policies
on `public.reservations` (migration 008) and `public.customers` (migration 007)
only grant SELECT to `authenticated`. Result: queries silently return `[]`, the
cron logs `found 0 reservations`, returns HTTP 200, and zero WhatsApp messages
are sent. Fix: switch the three reminder modules to `createAdminClient()` from
`lib/supabase/admin.ts`, which uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS
— consistent with `lib/wati/notifications.ts` already does.

Holdout contract for this change. Write-once after first commit.

---

## SCEN-001: pickup-queries fetches reservations through the admin (RLS-bypassing) client

**Given**: any of the six pickup-reminder query functions (`getWeekPickupReservations`, `getThreeDaysPickupReservations`, `getSameDayMorningReservations`, `getSameDayLateReservations`, `getPostMorningReservations`, `getPostLateReservations`) is invoked from a server context with no authenticated user (the cron context).
**When**: the function constructs its Supabase client to run the query.
**Then**: the client is constructed via `createAdminClient` from `@/lib/supabase/admin` (which uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS), NOT via `createClient` from `@/lib/supabase/server` (which authenticates as `anon` in a cron context and is silently filtered by the `authenticated`-only SELECT policy on `public.reservations`).
**Evidence**: vitest test in `tests/unit/reminders/pickup-sender.test.ts` mocks `@/lib/supabase/admin` (NOT `@/lib/supabase/server`) and observes the sender's franchise-branding fetch hitting that mock. Static check: `grep -n "from \"@/lib/supabase/server\"" lib/reminders/` returns no results after the fix.

---

## SCEN-002: getReservationForReminder (manual single-send path) also uses admin client

**Given**: an operator triggers a manual reminder send from the dashboard via `sendSinglePickupReminder(reservationId, type)`, which internally calls `getReservationForReminder(reservationId)`.
**When**: that helper queries Supabase for the reservation by id.
**Then**: the query is executed through `createAdminClient` — same source as SCEN-001 — so the behavior is consistent regardless of whether the entry point is cron (no auth) or a server action (admin user). The pre-fix path worked from the dashboard because operator cookies authenticated the request; switching to admin is strictly more permissive and does not regress the manual flow.
**Evidence**: vitest test `sendSinglePickupReminder fetches reservation by id and delegates to the helper` in `tests/unit/reminders/pickup-sender.test.ts` continues to pass with the admin-client mock.

---

## SCEN-003: check-pending cron fetches pending reservations through the admin client

**Given**: there exists ≥1 row in `reservations` with `status='pendiente'` and `reservation_code IS NOT NULL`, and Vercel Cron invokes `GET /api/cron/check-pending` with `Authorization: Bearer ${CRON_SECRET}`.
**When**: `checkPendingReservationStatuses()` runs its initial SELECT.
**Then**: the SELECT is issued through `createAdminClient`, returns the matching rows (count > 0), and the function logs `[check-pending] Done: checked=N, ...` with N>0. Pre-fix the SELECT silently returned `[]` because the `anon` role cannot read `reservations`; the function logged `checked=0` and never updated any status.
**Evidence**: runtime — Vercel logs after the next cron firing show `checked > 0` when pending reservations exist in the DB. Static — `grep -n "createClient" lib/reminders/check-pending-status.ts` returns no result; `grep -n "createAdminClient" lib/reminders/check-pending-status.ts` returns 2 results (import + call site).

---

## SCEN-004: post-deploy live verification — cron actually sends WhatsApp messages

**Given**: production deployed with the fix; `SUPABASE_SERVICE_ROLE_KEY`, `WATI_API_URL`, `WATI_API_TOKEN`, and `CRON_SECRET` are configured in Vercel env; at least one `reservations` row exists with `status='reservado'` and `pickup_date`/`pickup_hour` falling inside the post-morning window ("yesterday 17:01-23:59 COL OR today 00:00-05:00 COL").
**When**: an operator manually invokes `curl -H "Authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/pickup-reminders/post-morning` (or waits for the 13:00 UTC cron firing).
**Then**: the response JSON contains `total === N` (matching the count of in-window reservations) and `sent + errors === total`. A new row appears in `notification_logs` with `notification_type='whatsapp_post_pickup_am'` and `status='sent'` (or `status='failed'` with a populated `error_message` if WATI rejects). The customer's WhatsApp shows the `post_reserva` template message.
**Evidence**: this is the only end-to-end satisfaction signal — unit tests with mocked Supabase clients cannot exercise RLS, so they cannot detect the regression that motivated this fix. Verification artifact: screenshot/log capture from the operator showing (a) cron response body with `total > 0`, (b) Supabase row in `notification_logs`, (c) WhatsApp message received on a test phone. Without this evidence, the fix is unverified.

---
