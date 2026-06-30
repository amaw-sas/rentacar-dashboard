-- Seed the chat bot's per-brand referido advisors.
--
-- The bot is an ADVISOR, not a marketing channel: its bookings belong in the
-- "Referido" column (next to Diana/Daniela), one virtual advisor per brand, while
-- "Origen" keeps the real marketing channel derived from the customer's utm/click-ids.
-- Codes are lowercase (045 check) and MUST match lib/chat/bot-referral.ts so
-- resolveReferral() renders the pretty name instead of falling back to referral_raw.
-- Distinct from the legacy 'valeria' row (ex-salesperson, inactive). Idempotent.
insert into public.referrals (code, name, type, status) values
  ('valeria-bot', 'Valeria Bot', 'salesperson', 'active'),
  ('vanesa-bot',  'Vanesa Bot',  'salesperson', 'active'),
  ('elisa-bot',   'Elisa Bot',   'salesperson', 'active')
on conflict (code) do nothing;
