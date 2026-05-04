-- Optional override for the Reply-To header in outgoing emails per franchise.
--
-- When NULL (default), sendEmail derives Reply-To from sender_email by stripping
-- the leading "mail." subdomain (e.g. info@mail.alquilatucarro.com → info@alquilatucarro.com).
-- This is correct when the apex domain has its own inbox (Google Workspace etc.).
--
-- When the franchise has no apex inbox and uses an external mailbox (e.g. a Gmail
-- account), set this column explicitly so customer replies route to the real inbox.
--
-- Already applied to remote via MCP apply_migration (registered as timestamp 2026-04-30).
-- This file lives in the repo for traceability and so any fresh DB clone gets the column.
ALTER TABLE franchises ADD COLUMN IF NOT EXISTS reply_to_email TEXT;

COMMENT ON COLUMN franchises.reply_to_email IS 'Optional override for the Reply-To header in outgoing emails. When NULL, sendEmail derives Reply-To from sender_email by stripping the leading "mail." subdomain (default behavior). Set explicitly when the franchise apex domain has no inbox (e.g., the franchise uses an external Gmail).';
