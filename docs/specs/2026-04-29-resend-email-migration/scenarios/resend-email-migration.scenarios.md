---
name: resend-email-migration
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-04-29T00:00:00Z
spec: docs/specs/2026-04-29-resend-email-migration-design.md
plan: docs/specs/2026-04-29-resend-email-migration-plan.md
---

# Scenarios — alquilatucarro SMTP→Resend migration

Holdout contract for the migration. Write-once after first commit.
Mirrors Section 6 of the design spec, formatted for SDD discovery root with explicit Evidence fields.

---

## SCEN-001: Resend reemplaza completamente a nodemailer
**Given**: `ALQUILATUCARRO_RESEND_API_KEY` is set in the runtime environment.
**When**: `sendEmail({ franchise: "alquilatucarro", to, subject, html, ... })` is invoked from any caller.
**Then**: `resend.emails.send` is called exactly once with the expected payload AND the `nodemailer` package is not imported or invoked anywhere along the send path.
**Evidence**: vitest spy on `Resend.prototype.emails.send` records 1 call with payload matching the spec; `grep -rn "nodemailer" lib/email/send.ts lib/email/client.ts` returns zero matches.

---

## SCEN-002: Franquicia desconocida produce error específico
**Given**: a franchise code not registered in `FRANCHISE_ENV_PREFIX` (e.g., `"foo"`).
**When**: `getResendClient("foo")` or `sendEmail({ franchise: "foo", ... })` is invoked.
**Then**: an `Error` is thrown whose message contains literally `"Unknown franchise"`.
**Evidence**: vitest catches the thrown Error; `error.message.includes("Unknown franchise")` is true.

---

## SCEN-003: Franquicia conocida sin API key falla loud (distinto error)
**Given**: `ALQUICARROS_RESEND_API_KEY` is unset in the runtime environment (franchise is in `FRANCHISE_ENV_PREFIX` but not configured).
**When**: `sendEmail({ franchise: "alquicarros", to, subject, html, ... })` is invoked.
**Then**: an `Error` is thrown whose message contains literally `"ALQUICARROS_RESEND_API_KEY"` AND does NOT contain `"Unknown franchise"` (must be distinguishable from SCEN-002).
**Evidence**: vitest catches the thrown Error; `error.message.includes("ALQUICARROS_RESEND_API_KEY")` is true AND `error.message.includes("Unknown franchise")` is false.

---

## SCEN-004: From subdominio, Reply-To apex
**Given**: `franchises.sender_email = "info@mail.alquilatucarro.com"` and `franchises.sender_name = "Alquila tu Carro"` in the Supabase mock.
**When**: `sendEmail({ franchise: "alquilatucarro", to: "customer@example.com", subject, html, ... })` is invoked.
**Then**: the payload passed to `resend.emails.send` has `from === '"Alquila tu Carro" <info@mail.alquilatucarro.com>'` AND `replyTo === "info@alquilatucarro.com"`.
**Evidence**: vitest mock argument inspection — `mockSend.mock.calls[0][0].from` and `.replyTo` strict-equal the expected strings.

---

## SCEN-005: Reintento exitoso en rate limit
**Given**: `resend.emails.send` mock returns `{ data: null, error: { name: "rate_limit_exceeded", message: "..." } }` on first call and `{ data: { id: "abc-123" }, error: null }` on second call.
**When**: `sendEmail({ franchise: "alquilatucarro", reservationId: "r1", notificationType: "reservado_cliente", ... })` is invoked.
**Then**: `resend.emails.send` is called exactly 2 times, the call resolves successfully, AND `notification_logs` receives an INSERT with `status='sent'` for that reservation+notification_type.
**Evidence**: vitest spy `mockSend` has `mock.calls.length === 2`; mocked `logNotification` was invoked with `{ status: "sent", reservation_id: "r1", ... }`.

---

## SCEN-006: Validation error: sin retry, throw, log de fallo
**Given**: `resend.emails.send` mock returns `{ data: null, error: { name: "validation_error", message: "Invalid \`from\` field" } }`.
**When**: `sendEmail({ franchise: "alquilatucarro", reservationId: "r2", notificationType: "reservado_cliente", ... })` is invoked.
**Then**: `resend.emails.send` is called exactly 1 time (no retry), `sendEmail` throws an Error, AND `notification_logs` receives an INSERT with `status='failed'` and `error_message` containing the original message string.
**Evidence**: `mockSend.mock.calls.length === 1`; `await expect(sendEmail(...)).rejects.toThrow()`; mocked `logNotification` invoked with `{ status: "failed", error_message: <string containing "Invalid `from` field">, ... }`.

---

## SCEN-007: Falla de email no bloquea creación de reserva
**Given**: Resend mock rejects all calls (`{ data: null, error: { name: "validation_error", ... } }`) for the test request, and a valid reservation payload for franchise alquilatucarro.
**When**: `POST /api/reservations` with valid `x-api-key` and the test payload.
**Then**: HTTP response status is in {200, 201}, the reservation is persisted in the Supabase mock (`reservations` row exists), AND `notification_logs` has at least one row with `status='failed'` for that reservation.
**Evidence**: HTTP response status code from the route handler; mocked Supabase `from("reservations").insert()` was invoked with the payload; mocked `logNotification` invoked with `status: "failed"`.

---

## SCEN-008: DB migration aplica el subdominio
**Given**: a Supabase test instance (or migration runner) with `franchises.sender_email = 'info@alquilatucarro.com'` for the alquilatucarro row pre-migration.
**When**: the migration `supabase/migrations/NNN_alquilatucarro_resend_sender.sql` is applied.
**Then**: a query `SELECT sender_email FROM franchises WHERE code = 'alquilatucarro'` returns the literal string `'info@mail.alquilatucarro.com'`.
**Evidence**: SQL query result row, captured before and after migration application.

---

## SCEN-009: DKIM/SPF/DMARC pasan en entrega real (smoke check, manual)
**Given**: production deploy is live with the migration applied (code + SQL).
**When**: a real reservation is dispatched against alquilatucarro with the customer email pointing to a Gmail test inbox.
**Then**: the email arrives in Inbox (not Spam), AND its `Authentication-Results` header shows `dkim=pass`, `spf=pass`, `dmarc=pass` (all three).
**Evidence**: copy-paste of the raw `Authentication-Results` header from Gmail's "Show original" view, captured into the runbook checklist post-deploy.

---

## SCEN-010: notification_logs schema sin cambios estructurales
**Given**: the existing `notification_logs` table schema (columns: `reservation_id, channel, notification_type, recipient, subject, html_content, status, error_message, created_at, ...`).
**When**: Resend completes an email send and `logNotification(...)` is invoked from `sendEmail`.
**Then**: the row inserted uses ONLY the existing columns; no `ALTER TABLE` is required by this PR.
**Evidence**: review of the `lib/actions/notification-logs.ts` insert payload + `git diff supabase/migrations/` shows only the sender_email UPDATE migration (no schema DDL).

---

## SCEN-011: Reply-To preserva plus addressing
**Given**: `sender_email = "info+marketing@mail.alquilatucarro.com"` (edge case).
**When**: `deriveReplyTo("info+marketing@mail.alquilatucarro.com")` is invoked.
**Then**: it returns the literal string `"info+marketing@alquilatucarro.com"` (the `+marketing` segment is preserved).
**Evidence**: vitest assertion `expect(deriveReplyTo("info+marketing@mail.alquilatucarro.com")).toBe("info+marketing@alquilatucarro.com")`.

---

## SCEN-012: deriveReplyTo cubre boundary cases
**Given**: the following inputs to `deriveReplyTo`:
- `null`
- `undefined`
- `"info@alquilatucarro.com"` (no `mail.` prefix)
- `"info@MAIL.alquilatucarro.com"` (uppercase MAIL)
- `"info@email.com"` (contains `mail` substring but not as leading subdomain)
- `"info@mail.example.co.uk"` (multi-TLD)
- `"info"` (no `@`, defensive)

**When**: `deriveReplyTo(input)` is invoked for each case.
**Then**:
- `null` → returns `null` (input unchanged)
- `undefined` → returns `undefined` (input unchanged)
- `"info@alquilatucarro.com"` → returns `"info@alquilatucarro.com"` (no-op, idempotent)
- `"info@MAIL.alquilatucarro.com"` → returns `"info@alquilatucarro.com"` (case-insensitive strip)
- `"info@email.com"` → returns `"info@email.com"` (no corruption — `mail` is not a leading subdomain)
- `"info@mail.example.co.uk"` → returns `"info@example.co.uk"` (only leading `mail.` stripped)
- `"info"` → returns `"info"` (no `@`, return unchanged)

**Evidence**: 7 vitest assertions, one per input, each `expect(deriveReplyTo(input)).toBe(expected)`.

---

## SCEN-013: SDK devuelve null/null se trata como fallo defensivo
**Given**: `resend.emails.send` mock returns `{ data: null, error: null }` (defensive case — should never happen, but blindamos).
**When**: `sendEmail({ franchise: "alquilatucarro", reservationId: "r3", notificationType: "reservado_cliente", ... })` is invoked.
**Then**: `sendEmail` throws an Error, AND `notification_logs` receives an INSERT with `status='failed'` and `error_message` indicating "no data, no error from Resend SDK" (or similar non-empty descriptive message).
**Evidence**: `await expect(sendEmail(...)).rejects.toThrow()`; mocked `logNotification` invoked with `{ status: "failed", error_message: <non-empty string> }`.

---

## SCEN-014: Network timeout dispara retry
**Given**: `resend.emails.send` mock hangs (returns a Promise that never resolves) and `AbortSignal.timeout(10000)` is wrapping each attempt.
**When**: `sendEmail({ franchise: "alquilatucarro", reservationId: "r4", ... })` is invoked with vitest fake timers.
**Then**: after `MAX_RETRIES` (3) attempts each timing out, `sendEmail` throws, AND `notification_logs` has an INSERT with `status='failed'`.
**Evidence**: `mockSend.mock.calls.length === 3`; thrown error captured by `expect(...).rejects.toThrow()`; mocked `logNotification` invoked with `status: "failed"`.

---

## SCEN-015: Module load no crashea sin env vars
**Given**: no `*_RESEND_API_KEY` is set in `process.env` (clean test environment, e.g., during vitest collection phase).
**When**: `lib/email/client.ts` is imported (e.g., `await import("@/lib/email/client")`).
**Then**: the import resolves without throwing. The throw happens lazily — only on `getResendClient(franchise)` invocation when the franchise's API key is missing.
**Evidence**: vitest `await expect(import("@/lib/email/client")).resolves.toBeDefined()` AND a second assertion `expect(() => getResendClient("alquilatucarro")).toThrow(/Missing Resend API key/)` after the import.

---

## SCEN-016: Vercel function timeout headroom (smoke, post-deploy)
**Given**: a `mensualidad` reservation with `total_insurance: true` plus extras (4 emails fan out: cliente + Localiza × 3).
**When**: `sendReservationNotifications(reservationId, "mensualidad", "alquilatucarro")` is invoked inline via `app/api/reservations/route.ts:312` AND one of the Localiza emails hits a single rate-limit retry (8s delay).
**Then**: total inline elapsed time is ≤ ~10s (4 × ~200ms HTTP + 1 × 8s retry ≈ 8.8s), well under the Vercel function 300s timeout. No `EMAIL_DELAY_MS` artificial delay between emails.
**Evidence**: production Vercel logs timestamps for the reservation: difference between `[reservations] reserved` and the last `[email] Sent` log line is < 15s. Smoke check, not asserted in CI.

---

## Mapping to plan steps

| SCEN | Plan step satisfying it |
|---|---|
| SCEN-001 | Step 4 (sendEmail body migration) + Step 5 (send.test.ts) |
| SCEN-002 | Step 2 (client.ts) + Step 5 |
| SCEN-003 | Step 2 + Step 5 |
| SCEN-004 | Step 4 + Step 5 |
| SCEN-005 | Step 4 + Step 5 |
| SCEN-006 | Step 4 + Step 5 |
| SCEN-007 | Existing notifications.test.ts patterns (orchestrator catch) |
| SCEN-008 | Step 8 (SQL migration) + Step 13 (apply) |
| SCEN-009 | Step 14 (post-deploy manual smoke) |
| SCEN-010 | Step 8 (no DDL added — passive verification via review) |
| SCEN-011 | Step 3 (deriveReplyTo) + Step 5 |
| SCEN-012 | Step 3 + Step 5 |
| SCEN-013 | Step 4 + Step 5 |
| SCEN-014 | Step 4 + Step 5 |
| SCEN-015 | Step 2 + Step 5 |
| SCEN-016 | Step 14 (post-deploy smoke; not asserted in CI) |
