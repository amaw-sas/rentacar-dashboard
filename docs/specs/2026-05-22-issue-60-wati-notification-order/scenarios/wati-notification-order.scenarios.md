---
name: wati-notification-order
created_by: claude
created_at: 2026-05-22T00:00:00Z
issue: 60
---

# Issue #60 — WATI new-reservation notifications delivered in correct order

Context: on a new reservation (`status = reservado`) the dashboard fires three WhatsApp
templates through WATI. The code already calls them in the right sequence, but they are
queued back-to-back with no spacing, so WhatsApp delivers them out of order — the heavy
info template (`nueva_reserva_5`) arrives last. The fix spaces consecutive sends so the
recipient receives them in order.

## SCEN-001: reservado sends the three templates in correct order, spaced
**Given**: a confirmed reservation with `status = reservado`, a customer with a phone number,
and `ADDITIONAL_TEMPLATES["reservado"] = [nueva_reserva_instrucciones_2, nueva_reserva_instrucciones_adicionales]`
**When**: `sendStatusWhatsApp(reservationId, "reservado")` runs
**Then**: `sendTemplateMessage` is invoked exactly three times, in this exact order:
1. `nueva_reserva_5` (reservation info)
2. `nueva_reserva_instrucciones_2`
3. `nueva_reserva_instrucciones_adicionales`
and a non-zero delay is awaited between each consecutive send (so WhatsApp delivers them in order).
**Evidence**: ordered list of `template_name` from the `sendTemplateMessage` mock call args;
assertion that a timer/delay of `MESSAGE_SPACING_MS` is awaited before each of the two extra sends
(observed via fake timers — number of scheduled timeouts equals the number of extras).

## SCEN-002: statuses without extras send a single message with no added delay
**Given**: a reservation with `status = pendiente` (no entry in `ADDITIONAL_TEMPLATES`)
**When**: `sendStatusWhatsApp(reservationId, "pendiente")` runs
**Then**: `sendTemplateMessage` is invoked exactly once (`reserva_pendiente`) and **no** spacing
delay is introduced — the spacing fix must not add latency to flows that send a single message.
**Evidence**: `sendTemplateMessage` mock called once; zero spacing timers scheduled (fake timers).

## SCEN-003: real delivery arrives in correct order (manual, end-to-end)
**Given**: a real test reservation set to `reservado` with a real WhatsApp recipient number
**When**: the notification dispatch runs in a deployed/dev environment hitting the real WATI API
**Then**: the recipient's WhatsApp chat shows the three messages with ascending delivery
timestamps in order `nueva_reserva_5` → `nueva_reserva_instrucciones_2` → `nueva_reserva_instrucciones_adicionales`
**Evidence**: WhatsApp chat / WATI panel message timestamps (external observable). This is the
true acceptance criterion — unit tests prove send order + spacing intent, not external delivery.
