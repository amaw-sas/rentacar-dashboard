-- Suzuki Jimny (G4) is now available; align description with the rest of the
-- catalog ("o similar") instead of the temporary "Disponible a partir de abril 2026".
UPDATE public.category_models cm
SET description = 'o similar'
FROM public.vehicle_categories vc
WHERE vc.id = cm.category_id
  AND vc.code = 'G4'
  AND cm.name = 'Suzuki Jimny';
