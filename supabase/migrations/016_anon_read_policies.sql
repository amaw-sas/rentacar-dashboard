-- Public read access for rentacar-main (anon role)
-- These tables contain reference data that the public frontend needs

-- Vehicle categories (filtered by status + visibility in app logic)
create policy "Anon can read vehicle_categories"
  on public.vehicle_categories for select
  to anon
  using (true);

-- Category pricing
create policy "Anon can read category_pricing"
  on public.category_pricing for select
  to anon
  using (true);

-- Category models
create policy "Anon can read category_models"
  on public.category_models for select
  to anon
  using (true);

-- Locations (branches)
create policy "Anon can read locations"
  on public.locations for select
  to anon
  using (true);

-- Cities
create policy "Anon can read cities"
  on public.cities for select
  to anon
  using (true);

-- Category city visibility
create policy "Anon can read category_city_visibility"
  on public.category_city_visibility for select
  to anon
  using (true);

-- Referrals (needed to resolve referral codes in URLs)
create policy "Anon can read referrals"
  on public.referrals for select
  to anon
  using (true);

-- Rental companies (needed for extras pricing)
create policy "Anon can read rental_companies"
  on public.rental_companies for select
  to anon
  using (true);

-- Franchises (needed for brand data)
create policy "Anon can read franchises"
  on public.franchises for select
  to anon
  using (true);
