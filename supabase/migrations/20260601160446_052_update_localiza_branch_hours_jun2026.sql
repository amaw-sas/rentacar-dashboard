-- Update locations.schedule display text for 3 Localiza branches.
-- Source: official Localiza communiqué — extended hours effective 2026-06-02.
-- schedule.display is informational only (rendered on the public site); Localiza's
-- SOAP API owns the authoritative schedule used for availability validation.
--
-- Previous values (for rollback reference):
--   AASMR -> '{"display": "Todos los días 07:00-18:00"}'
--   ACKAL -> '{"display": "Lun-Sáb 08:00-16:00 | Dom y fest Cerrado"}'
--   ACKJC -> '{"display": "Lun-Sáb 08:00-16:00 | Dom y fest 08:00-13:00"}'
-- Note: the previous strings lumped Saturday into "Lun-Sáb"; the new strings split
-- Lun-Vie / Sáb / Dom to reflect the real per-segment hours from the communiqué.

-- Santa Marta Aeropuerto (AASMR): Lun-Dom 07:00-19:00 -> 07:00-21:00
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 07:00-21:00"}'::jsonb
WHERE code = 'AASMR';

-- Cali Sur Camino Real (ACKAL): Lun-Vie 08:00-16:00 -> 08:00-17:00; Sáb 08:00-14:00 (igual); Dom y fest Cerrado
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-17:00 | Sáb 08:00-14:00 | Dom y fest Cerrado"}'::jsonb
WHERE code = 'ACKAL';

-- Cali Norte Chipichape (ACKJC): Lun-Vie 08:00-16:00 -> 08:00-17:00; Sáb 08:00-14:00 (igual); Dom y fest -> 08:00-14:00
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-17:00 | Sáb 08:00-14:00 | Dom y fest 08:00-14:00"}'::jsonb
WHERE code = 'ACKJC';
