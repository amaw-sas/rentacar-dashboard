-- Issue #147: split TikTok into paid vs organic.
-- Adds 'tiktok_organic' (organic bio/profile traffic, rendered "TikTok") next
-- to the existing 'tiktok_ads' (paid, auto-tagged with ttclid). The derivation
-- (`lib/attribution/derive-channel.ts`) now emits this value, so the CHECK
-- constraint must allow it. The constraint from migration 057 is anonymous, so
-- Postgres named it `reservations_attribution_channel_check`; drop + recreate it
-- with the new value. Existing rows are unaffected (no value change, no backfill).
alter table public.reservations
  drop constraint if exists reservations_attribution_channel_check,
  add constraint reservations_attribution_channel_check
    check (attribution_channel in (
      'google_ads','google_display','meta_ads','tiktok_ads','tiktok_organic',
      'bing_ads','organic','referral','direct','other'
    ));
