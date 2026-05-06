-- Per-franchise BCC for Localiza notifications.
--
-- Replaces the global LOCALIZA_NOTIFICATION_BCC_EMAIL env var as the source of truth
-- for which mailbox receives a BCC of every Localiza-bound notification (pendiente,
-- seguro_total, extras, mensualidad). The env var is retained as a transitional
-- fallback when this column is NULL — once all franchises are seeded the env var
-- can be removed in a follow-up.
--
-- Bug it fixes: the env var pointed to alquilame's mailbox, so reservations from
-- alquilatucarro and alquicarros leaked into alquilame's inbox; replies from
-- alquilame's ops team to Localiza confused thread ownership.
--
-- Already applied to remote via MCP apply_migration (registered as timestamp 20260506161145).
-- This file lives in the repo for traceability and so any fresh DB clone gets the column.

ALTER TABLE franchises ADD COLUMN IF NOT EXISTS localiza_bcc_email TEXT;

COMMENT ON COLUMN franchises.localiza_bcc_email IS 'Per-franchise BCC address for Localiza notifications (pendiente, seguro_total, extras, mensualidad). When NULL the dispatcher falls back to LOCALIZA_NOTIFICATION_BCC_EMAIL. Set explicitly to route ops replies through the brand-correct inbox.';

-- Seed the three known franchises. The alquilame value corrects the prior typo
-- in the env var (alquilameco@gmail.com → alquilamecol@gmail.com, trailing L).
UPDATE franchises SET localiza_bcc_email = 'info@alquilatucarro.com'      WHERE code = 'alquilatucarro';
UPDATE franchises SET localiza_bcc_email = 'alquilamecol@gmail.com'       WHERE code = 'alquilame';
UPDATE franchises SET localiza_bcc_email = 'alquicarroscolombia@gmail.com' WHERE code = 'alquicarros';
