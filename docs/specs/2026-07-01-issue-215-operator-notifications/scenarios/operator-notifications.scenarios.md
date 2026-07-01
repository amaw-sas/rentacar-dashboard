---
name: operator-notifications
created_by: brainstorming
created_at: 2026-07-01T12:00:00Z
---

# Operator notification center (#215) — holdout scenarios

Source of truth: `docs/specs/2026-07-01-operator-notifications-design.md`.
These are the observable contract; code converges toward them, never the reverse.

## SCEN-001: failed client notification becomes an operator alert
**Given**: a `notification_logs` row is inserted with `status='failed'`, `channel='whatsapp'`, a `recipient`, an `error_message`, and a `reservation_id`
**When**: the capture trigger runs
**Then**: exactly one `operator_notifications` row exists with `status='unread'`, `type='notification_failed'`, `source='notification_logs'`, `source_id` = the log id, `resource_id` = the reservation id, `action='resend'`, `action_ref` = the log id, and a Spanish title naming the channel and recipient
**Evidence**: DB row in `operator_notifications` (SQL SELECT on the testing branch)

## SCEN-002: a sent notification produces no alert (zero noise)
**Given**: a `notification_logs` row is inserted with `status='sent'`
**When**: the capture trigger runs
**Then**: no `operator_notifications` row is created for that log id
**Evidence**: `count(*) = 0` in `operator_notifications` for that `source_id`

## SCEN-003: capture is idempotent
**Given**: a failed `notification_logs` row that already produced an `operator_notifications` row
**When**: an alert insert for the same `(source, source_id)` is attempted again (re-run backfill)
**Then**: still exactly one `operator_notifications` row exists for that `source_id`
**Evidence**: `count(*) = 1` in `operator_notifications` for that `source_id`

## SCEN-004: alert is visible with a link and resend action in the UI
**Given**: an `unread` `operator_notifications` row linked to reservation R
**When**: the operator opens the dashboard and opens the notification bell
**Then**: the popover shows an entry with the channel, recipient/reason, a link to `/reservations/{R}`, a "Reenviar" button, and a "Marcar resuelta" action
**Evidence**: DOM state in the running app (agent-browser snapshot), link href, buttons present

## SCEN-005: the alert persists across reload until resolved
**Given**: an `unread` alert visible in the bell
**When**: the operator reloads the page without acting on it
**Then**: the alert is still present (not an ephemeral toast) and the unread badge count is unchanged
**Evidence**: DOM state after reload (agent-browser snapshot), badge count

## SCEN-006: unread badge visible in every dashboard view
**Given**: N unread alerts (N > 0)
**When**: the operator navigates to any dashboard route (e.g. /reservations, /customers)
**Then**: the header shows a bell with a badge displaying N, without opening any specific screen; N = 0 shows no badge
**Evidence**: DOM state (agent-browser snapshot) of the bell badge on ≥2 routes

## SCEN-007: resolving an alert clears it from the unread group and decrements the badge
**Given**: an `unread` alert visible in the bell
**When**: the operator clicks "Marcar resuelta"
**Then**: the row's `status` becomes `resolved`, the unread badge decrements by one, and the row leaves the unread group (it may remain lower as history)
**Evidence**: DB row `status='resolved'` + DOM badge count decremented (agent-browser snapshot)

## SCEN-008: resend from the alert reuses the existing resend and resolves on success
**Given**: an `unread` alert with `action='resend'` and `action_ref` = a resendable notification log id
**When**: the operator clicks "Reenviar" and the resend succeeds
**Then**: the alert is marked `resolved` and the badge decrements; on resend failure a Spanish error is surfaced and the alert stays `unread`
**Evidence**: DB row `status` transition + toast/error text (agent-browser snapshot)
