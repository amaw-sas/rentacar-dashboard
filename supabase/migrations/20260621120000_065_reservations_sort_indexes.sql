-- Re-enable server-side sorting for the Franquicia and Origen columns.
--
-- Issue #144 disabled sorting on these low-cardinality columns because the
-- query always emits `ORDER BY is_priority DESC, <col>, id` and the existing
-- single-column indexes (idx_reservations_franchise,
-- idx_reservations_attribution_channel) do NOT carry the is_priority leading
-- key — so Postgres fell back to a full-table top-N heapsort (franchise
-- measured 230ms @ 13k rows, scaling linearly).
--
-- These composite indexes lead with is_priority DESC and include the id
-- tiebreaker, so the full ORDER BY key is index-served (≈3ms) for the ascending
-- direction and the planner can satisfy the is_priority prefix from the index
-- for the descending direction. Mirrors SORTABLE_COLUMNS in
-- lib/reservations/list-params.ts.
CREATE INDEX IF NOT EXISTS idx_reservations_priority_franchise
  ON reservations (is_priority DESC, franchise, id);

CREATE INDEX IF NOT EXISTS idx_reservations_priority_attribution
  ON reservations (is_priority DESC, attribution_channel, id);
