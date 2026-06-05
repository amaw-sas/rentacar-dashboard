-- Issue #100: server-side pagination for the reservations list.
--
-- The default list order floats priority-status reservations to the top, then
-- created_at desc. PostgREST cannot ORDER BY an arbitrary expression, so the
-- priority predicate is materialized as a STORED generated column that the
-- query orders by directly.
--
-- COUPLING: the status set below duplicates PRIORITY_STATUSES in
-- lib/schemas/reservation.ts. If that constant changes, this expression must be
-- updated in a new migration. Low-churn (the priority set rarely changes); the
-- behavioral guard is SCEN-010 (priority floats to page 1).
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS is_priority boolean
  GENERATED ALWAYS AS (
    status = ANY (ARRAY[
      'pendiente',
      'pendiente_modificar',
      'mensualidad',
      'pendiente_pago'
    ])
  ) STORED;

-- Composite index serves the default ordering (is_priority DESC, created_at
-- DESC). Also fixes the previously-missing created_at index that forced an
-- external-merge sort to disk on every list render.
CREATE INDEX IF NOT EXISTS idx_reservations_priority_created
  ON reservations (is_priority DESC, created_at DESC);
