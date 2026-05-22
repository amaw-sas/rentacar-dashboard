---
name: dispatch-completion
created_by: claude
created_at: 2026-05-22T00:00:00Z
issue: 60
---

# Issue #60 — spaced WhatsApp dispatches must complete before the function returns

Context (surfaced in review): spacing the `reservado` WhatsApp sends adds ~3s of
in-function delay. Two callers fired `sendStatusWhatsApp` detached without keeping the
serverless function alive (cron loop, dashboard status action). On Vercel the instance
can be reclaimed once the handler returns, silently dropping the still-in-flight
instruction messages — the very messages the ordering fix delivers. These scenarios pin
that the dispatch is awaited / kept alive.

## SCEN-004: check-pending cron awaits its notification dispatches
**Given**: one `pendiente` reservation whose Localiza status resolves to `reservado`,
and `sendStatusWhatsApp` returns a promise that has not yet settled
**When**: `checkPendingReservationStatuses()` runs
**Then**: the function does **not** resolve until the in-flight `sendStatusWhatsApp`
dispatch settles — the spaced sends are awaited before the cron handler returns, so the
serverless instance cannot be reclaimed mid-sequence.
**Evidence**: the `checkPendingReservationStatuses()` promise stays pending while the
`sendStatusWhatsApp` mock promise is unresolved, and only resolves after it settles
(observed via a deferred/controlled promise in the unit test).

## SCEN-005: dashboard status action dispatches notifications via after()
**Given**: a reservation transitioning to `reservado` through `updateReservationStatus`
(a valid transition) with a franchise set
**When**: the server action runs
**Then**: the outbound notifications (`sendStatusWhatsApp`, email, GHL) are scheduled via
Next.js `after()` so they run within the kept-alive function rather than as a detached
promise that races teardown; `sendStatusWhatsApp` is invoked for the reservation.
**Evidence**: `after` (mocked) is called with a callback; invoking that callback triggers
the `sendStatusWhatsApp` mock for the reservation id.
