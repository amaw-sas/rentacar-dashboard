-- Issue #199 (Fase 0): mark reservations created by the chat bot.
-- Adds 'chat-bot' to the attribution_channel enum so a chat-created reservation is
-- distinguishable in the dashboard (list filter + Analytics → Origen). This
-- OVERLOADS the marketing-attribution column on purpose (product decision): the
-- chat never carries utm/click-ids, so its rows were NULL ("Desconocido"); the
-- bot now stamps 'chat-bot' explicitly (lib/api/reservation-service.ts via an
-- explicit override, NOT derive-channel.ts). The constraint from migration 057,
-- last recreated in 060, is named `reservations_attribution_channel_check`; drop +
-- recreate it with the new value. Existing rows are unaffected (no backfill).
alter table public.reservations
  drop constraint if exists reservations_attribution_channel_check,
  add constraint reservations_attribution_channel_check
    check (attribution_channel in (
      'google_ads','google_display','meta_ads','tiktok_ads','tiktok_organic',
      'bing_ads','organic','referral','direct','other','chat-bot'
    ));
