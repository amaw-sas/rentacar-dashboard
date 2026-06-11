-- Issue #113: marketing-attribution columns for reservations.
-- Stores the raw attribution signals (utm/click ids/referrer) for audit and
-- future re-derivation, plus a denormalized `attribution_channel` for fast SQL
-- filtering and aggregation. `attribution_channel` is nullable on purpose:
-- NULL = the reservation never carried attribution (old rows / web not yet
-- updated) → rendered "Desconocido"; 'direct' = the attribution object arrived
-- but was empty (real direct traffic). Never conflate the two. No backfill
-- possible — historical reservations stay NULL.
alter table public.reservations
  add column utm_source            text,
  add column utm_medium            text,
  add column gclid                 text,
  add column gad_source            text,
  add column fbclid                text,
  add column ttclid                text,
  add column msclkid               text,
  add column landing_referrer      text,
  add column attribution_channel   text
    check (attribution_channel in (
      'google_ads','google_display','meta_ads','tiktok_ads',
      'bing_ads','organic','referral','direct','other'
    ));

create index idx_reservations_attribution_channel
  on public.reservations(attribution_channel);
