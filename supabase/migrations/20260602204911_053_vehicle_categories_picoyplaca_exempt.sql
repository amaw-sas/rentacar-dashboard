-- Issue #28 Ola B2: structured pico y placa exemption flag.
-- Until now the web hardcoded the exempt gamas (FU/FL/GL/LY/LP/LU) and the
-- dashboard only described it as free text in `description` ("Sin pico y placa").
-- This column makes the exemption a queryable source of truth that operations
-- can toggle without a code release. `true` = the gama is EXEMPT from pico y
-- placa (the web renders the "sin pico y placa" badge). Mirrors migration 035.
alter table public.vehicle_categories
  add column picoyplaca_exempt boolean not null default false;

-- Backfill reproduces the web's current hardcoded whitelist exactly.
update public.vehicle_categories set picoyplaca_exempt = true
  where code in ('FU', 'FL', 'GL', 'LY', 'LP', 'LU');
