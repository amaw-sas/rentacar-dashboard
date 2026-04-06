-- Fix location names to match production (legacy) naming
UPDATE public.locations SET name = 'Cúcuta Aeropuerto' WHERE code = 'AACUC';
UPDATE public.locations SET name = 'Medellín Aeropuerto José María Córdoba' WHERE code = 'AAMDL';
UPDATE public.locations SET name = 'Bogotá Almacén Éxito del Country' WHERE code = 'ACBEX';
UPDATE public.locations SET name = 'Bogotá Centro Nuestro' WHERE code = 'ACBNN';
UPDATE public.locations SET name = 'Soledad Aeropuerto' WHERE code = 'ACBSD';
UPDATE public.locations SET name = 'Ibagué' WHERE code = 'ACIBG';
UPDATE public.locations SET name = 'Palmira' WHERE code = 'ACKPA';
UPDATE public.locations SET name = 'Medellín Poblado' WHERE code = 'ACMDL';
UPDATE public.locations SET name = 'Manizales' WHERE code = 'ACMNZ';
UPDATE public.locations SET name = 'Montería Ciudad' WHERE code = 'ACMTR';
UPDATE public.locations SET name = 'Villavicencio' WHERE code = 'ACVLL';
