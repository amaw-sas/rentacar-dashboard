---
name: localiza-bcc-per-franchise
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-06T14:00:00Z
---

# Scenarios — per-franchise BCC for Localiza notifications

Holdout contract for the BCC routing fix. Write-once after first commit.

**Bug**: `LOCALIZA_NOTIFICATION_BCC_EMAIL` is a global env var; all four Localiza notification types (`pendiente_localiza`, `seguro_total_localiza`, `extras_localiza`, `mensualidad_localiza`) BCC the same address regardless of which franchise originated the reservation. Production value points to `alquilameco@gmail.com`, so reservations from `alquilatucarro` or `alquicarros` leak into alquilame's ops mailbox, and replies originate from alquilame.

**Fix**: introduce a per-franchise column `franchises.localiza_bcc_email` (mirroring the existing `reply_to_email` pattern from migration 036). The notification dispatcher prefers the per-franchise column; when the column is NULL, it falls back to `LOCALIZA_NOTIFICATION_BCC_EMAIL` for safety during transition. When both are absent, no BCC is set.

---

## SCEN-001: alquilatucarro reservation with extras → BCC routes to alquilatucarro's ops mailbox
**Given**: `franchises.localiza_bcc_email` is set to `'opsalquilatucarro@example.com'` for `code = 'alquilatucarro'`, and a reservation exists with `franchise = 'alquilatucarro'`, `extra_driver = false`, `baby_seat = true`, `wash = false`, `total_insurance = false`.
**When**: `sendReservationNotifications(reservationId, "pendiente", "alquilatucarro")` is invoked, which dispatches the `extras_localiza` email.
**Then**: `resend.emails.send` is called once with `bcc: ["opsalquilatucarro@example.com"]` AND the BCC value is NOT `alquilameco@gmail.com` AND is NOT derived from `LOCALIZA_NOTIFICATION_BCC_EMAIL`.
**Evidence**: vitest spy on `Resend.prototype.emails.send` records the call payload; `payload.bcc[0] === "opsalquilatucarro@example.com"`; `process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL` set to a sentinel value during the test is observably ignored.

---

## SCEN-002: alquilame reservation → BCC routes to alquilame's ops mailbox
**Given**: `franchises.localiza_bcc_email = 'alquilameco@gmail.com'` for `code = 'alquilame'`, and a reservation exists with `franchise = 'alquilame'`, `total_insurance = true`.
**When**: `sendReservationNotifications(reservationId, "reservado", "alquilame")` triggers the `seguro_total_localiza` email.
**Then**: `resend.emails.send` payload has `bcc: ["alquilameco@gmail.com"]`.
**Evidence**: vitest spy payload assertion; `payload.bcc[0] === "alquilameco@gmail.com"`.

---

## SCEN-003: Franchise with NULL `localiza_bcc_email` → falls back to global env var
**Given**: `franchises.localiza_bcc_email IS NULL` for the franchise, the reservation has `total_insurance = true`, and `process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL = 'fallback@example.com'`.
**When**: `sendReservationNotifications(...)` triggers the `seguro_total_localiza` email.
**Then**: the `resend.emails.send` payload has `bcc: ["fallback@example.com"]`.
**Evidence**: vitest spy payload; `payload.bcc[0] === "fallback@example.com"`.

---

## SCEN-003b: NULL column AND unset env var → email sent without BCC field
**Given**: `franchises.localiza_bcc_email IS NULL` for the franchise AND `process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL` is unset/empty.
**When**: `sendReservationNotifications(...)` triggers any Localiza notification.
**Then**: the `resend.emails.send` payload omits the `bcc` key (or sets `bcc: undefined`); no `bcc: [""]` empty-string artifacts.
**Evidence**: vitest spy payload; `payload.bcc === undefined` OR `"bcc" not in payload`.

---

## SCEN-004: All four Localiza notification types use the franchise-specific BCC consistently
**Given**: `franchises.localiza_bcc_email = 'ops@example.com'` for the active franchise.
**When**: each of the four Localiza notification dispatchers runs in isolation: `pendiente_localiza` (status=`pendiente`), `seguro_total_localiza` (`total_insurance=true`), `extras_localiza` (`baby_seat=true`, `total_insurance=false`), `mensualidad_localiza` (status=`mensualidad`).
**Then**: every one of the four `resend.emails.send` calls has `bcc: ["ops@example.com"]`.
**Evidence**: vitest spy collects all four calls; for each call, `payload.bcc[0] === "ops@example.com"`. No call missing the BCC, no call with a different BCC.

---

## SCEN-005: Non-Localiza notifications (e.g., client confirmation) carry no BCC
**Given**: `franchises.localiza_bcc_email = 'ops@example.com'` for `code = 'alquilatucarro'`, and a reservation exists.
**When**: `sendReservationNotifications(reservationId, "reservado", "alquilatucarro")` triggers the `reservado_cliente` email to the customer.
**Then**: that specific `resend.emails.send` call (the one with subject `"Reserva Aprobada"`) does NOT include any `bcc` field.
**Evidence**: vitest spy payload for the client-facing call; `payload.bcc === undefined`. The franchise-level BCC must not leak into customer-facing emails.

---

## SCEN-006: Production data state — three franchises have explicit BCC values aligned with their ops mailboxes
**Given**: the migration has been applied to production.
**When**: `SELECT code, localiza_bcc_email FROM franchises ORDER BY code` runs against production.
**Then**: the three rows are exactly:
- `alquicarros` → `alquicarroscolombia@gmail.com`
- `alquilame` → `alquilamecol@gmail.com` (note trailing **L**, correcting the prior typo `alquilameco@gmail.com`)
- `alquilatucarro` → `info@alquilatucarro.com`
**Evidence**: SQL result snapshot from `mcp__supabase__execute_sql` matches the three pairs above byte-for-byte.

---

## Notes
- `LOCALIZA_NOTIFICATION_EMAIL` (the recipient, not the BCC) stays a global env var for now — Localiza's commercial address is a single mailbox shared across franchises. A future SCEN can promote it to per-franchise if Localiza splits operations.
- `LOCALIZA_NOTIFICATION_BCC_EMAIL` env var is RETAINED as a fallback when `franchises.localiza_bcc_email IS NULL` for safety during transition. Once all franchises are seeded and operations confirm stable routing, a follow-up scenario+PR can remove it.
- The new column is plain `text NULL` — no DB-level default, no NOT NULL constraint. NULL means "use the env-var fallback", which is a valid configuration.
- The `sendEmail` signature in `lib/email/send.ts` is unchanged; the per-franchise resolution happens at the `notifications.ts` call site by reading `franchises.localiza_bcc_email`.
- The seed values in SCEN-006 are written into the same migration that adds the column, as `INSERT ... ON CONFLICT (code) DO UPDATE`-style upserts (or simple `UPDATE` since the rows already exist), making the fix atomic with the schema change.
