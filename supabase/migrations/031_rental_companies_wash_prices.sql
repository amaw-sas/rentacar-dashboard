-- =============================================================================
-- Add onsite / deep / deep+upholstery wash prices to rental_companies.
-- Existing wash_price remains the prepaid (recogida) price.
-- These flow to:
--   - rentacar-admin reservation-confirmation email (pickup/wash instructions)
--   - rentacar-main "servicios adicionales" modal in CategoryCard.vue
-- Source of truth replaces hardcoded literals in both repos.
-- =============================================================================

alter table public.rental_companies
  add column if not exists wash_onsite_price numeric(12,2) not null default 0,
  add column if not exists wash_deep_price numeric(12,2) not null default 0,
  add column if not exists wash_deep_upholstery_price numeric(12,2) not null default 0;

update public.rental_companies
set
  wash_onsite_price = 30000,
  wash_deep_price = 150000,
  wash_deep_upholstery_price = 225000
where code = 'localiza'
  and wash_onsite_price = 0
  and wash_deep_price = 0
  and wash_deep_upholstery_price = 0;
