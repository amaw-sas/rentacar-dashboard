-- Issue #138 — DB-backed idempotency for reservation creation.
--
-- After #99, the proxy dedupes the Localiza SOAP call so a resubmit returns the
-- SAME reserve_code. But the dashboard runs multi-instance (Vercel Fluid Compute)
-- and inserts the reservation row + fires notifications unconditionally, so a
-- resubmit / two concurrent instances still produce two rows with the same
-- reservation_code and two notification fan-outs. Postgres is the only authority
-- shared across instances; this partial unique index is the cross-instance guard.
--
-- Predicate, three clauses:
--   reservation_code IS NOT NULL  — monthly reservations (null code) are out of scope.
--   reservation_code <> ''        — an empty code never dedupes (mirrors #99's
--                                   "don't cache empty reserveCode"); two real
--                                   bookings that both got '' must both insert.
--   created_at >= '2026-01-01'    — grandfathers 49 legacy duplicate-code pairs
--                                   imported by the #20 ETL (all created_at
--                                   <= 2025-12-06). The 2026+ partition is verified
--                                   to contain zero duplicates, so the index builds
--                                   cleanly and governs only real dashboard bookings,
--                                   where reservation_code is Localiza's unique ConfID.
--
-- No data is deleted or modified. Application-side recovery: on a 23505 from this
-- index, createReservation returns the existing result without re-inserting or
-- re-notifying (lib/api/reservation-service.ts).

create unique index if not exists reservations_reservation_code_unique
  on public.reservations (reservation_code)
  where reservation_code is not null
    and reservation_code <> ''
    and created_at >= '2026-01-01';
