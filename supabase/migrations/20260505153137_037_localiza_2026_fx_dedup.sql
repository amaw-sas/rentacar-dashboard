-- Follow-up to 036: deduplicate FX models that overlapped with prior catalog
-- entries. The PDF lists "Renault Logan AT" and "Suzuki Swift Dzire GL"; the
-- legacy "Logan Dynamique 1.6 AT" and "Suzuki Dzire 1.2 AT" rows describe the
-- same vehicles. Per "crea nuevo, desactiva viejo" policy: keep the new rows
-- and inactivate the legacy ones. Adds Swift Dzire GL with the local image.

DO $$
DECLARE
  v_company_id uuid;
  v_cat_fx uuid;
BEGIN
  SELECT id INTO v_company_id FROM public.rental_companies WHERE name='Localiza';
  SELECT id INTO v_cat_fx FROM public.vehicle_categories
    WHERE rental_company_id=v_company_id AND code='FX';

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_fx
      AND name IN ('Logan Dynamique 1.6 AT','Suzuki Dzire 1.2 AT');

  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_fx, 'Suzuki Swift Dzire GL', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFX-swift-dzire-cAat8ekHU7CoUtYBLbhdKRS4jKW02y.jpeg',
      false, 'active');

END $$;
