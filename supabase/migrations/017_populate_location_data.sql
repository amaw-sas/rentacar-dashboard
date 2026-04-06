-- Populate schedule and city text for locations
-- schedule: jsonb with {"display": "..."} for human-readable schedule
-- city: text slug matching the city slug for frontend compatibility

-- Armenia
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 06:00-19:00 | Sáb, Dom y fest 08:00-16:00"}'::jsonb,
  city = 'armenia',
  slug = 'armenia-aeropuerto'
WHERE code = 'AARME';

-- Barranquilla Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 07:00-20:00"}'::jsonb,
  city = 'barranquilla',
  slug = 'barranquilla-aeropuerto'
WHERE code = 'AABAN';

-- Barranquilla Norte
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00"}'::jsonb,
  city = 'barranquilla',
  slug = 'barranquilla-norte'
WHERE code = 'ACBAN';

-- Soledad
UPDATE public.locations SET
  schedule = '{"display": "Lun-Dom 06:30-20:00"}'::jsonb,
  city = 'soledad',
  slug = 'soledad-aeropuerto'
WHERE code = 'ACBSD';

-- Bogotá Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Dom 24 horas | Festivos 06:00-21:00"}'::jsonb,
  city = 'bogota',
  slug = 'bogota-aeropuerto'
WHERE code = 'AABOT';

-- Bogotá Av. Caracas con 72 (no schedule in legacy — new location)
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00"}'::jsonb,
  city = 'bogota',
  slug = 'bogota-av-caracas'
WHERE code = 'ACBOT';

-- Bogotá Almacén Éxito del Country
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 06:30-20:00"}'::jsonb,
  city = 'bogota',
  slug = 'bogota-almacen-exito-del-country'
WHERE code = 'ACBEX';

-- Bogotá C.Cial Nuestro Centro
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 06:30-18:00"}'::jsonb,
  city = 'bogota',
  slug = 'bogota-centro-nuestro'
WHERE code = 'ACBNN';

-- Bogotá Almacen Yumbo Calle 170 (no schedule in legacy — new location)
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00"}'::jsonb,
  city = 'bogota',
  slug = 'bogota-almacen-yumbo-calle-170'
WHERE code = 'ACBOJ';

-- Bucaramanga Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 06:30-18:30"}'::jsonb,
  city = 'bucaramanga',
  slug = 'bucaramanga-aeropuerto'
WHERE code = 'AABCR';

-- Floridablanca
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-15:00 | Sáb, Dom y fest 08:00-13:00"}'::jsonb,
  city = 'floridablanca',
  slug = 'floridablanca'
WHERE code = 'ACBCR';

-- Cali Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Sáb 06:00-21:00 | Dom y fest 08:00-16:00"}'::jsonb,
  city = 'cali',
  slug = 'cali-aeropuerto'
WHERE code = 'AAKAL';

-- Cali Sur Camino Real
UPDATE public.locations SET
  schedule = '{"display": "Lun-Sáb 08:00-16:00 | Dom y fest Cerrado"}'::jsonb,
  city = 'cali',
  slug = 'cali-sur-camino-real'
WHERE code = 'ACKAL';

-- Cali Norte Chipichape
UPDATE public.locations SET
  schedule = '{"display": "Lun-Sáb 08:00-16:00 | Dom y fest 08:00-13:00"}'::jsonb,
  city = 'cali',
  slug = 'cali-norte-chipichape'
WHERE code = 'ACKJC';

-- Palmira
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 06:00-20:00 | Sáb, Dom y fest 08:00-15:00"}'::jsonb,
  city = 'palmira',
  slug = 'palmira'
WHERE code = 'ACKPA';

-- Cartagena Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 06:30-20:00"}'::jsonb,
  city = 'cartagena',
  slug = 'cartagena-aeropuerto'
WHERE code = 'AACTG';

-- Cúcuta Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 07:00-18:00 | Sáb, Dom y fest 08:00-15:00"}'::jsonb,
  city = 'cucuta',
  slug = 'cucuta-aeropuerto'
WHERE code = 'AACUC';

-- Ibagué
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00"}'::jsonb,
  city = 'ibague',
  slug = 'ibague'
WHERE code = 'ACIBG';

-- Manizales
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00"}'::jsonb,
  city = 'manizales',
  slug = 'manizales'
WHERE code = 'ACMNZ';

-- Medellín Poblado
UPDATE public.locations SET
  schedule = '{"display": "Lun-Sáb 07:00-18:00 | Dom y fest 08:00-15:00"}'::jsonb,
  city = 'medellin',
  slug = 'medellin-poblado'
WHERE code = 'ACMDL';

-- Medellín Centro Éxito Colombia
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-15:00 | Sáb 08:00-13:00 | Dom y fest Cerrado"}'::jsonb,
  city = 'medellin',
  slug = 'medellin-centro-exito-colombia'
WHERE code = 'ACMCL';

-- Medellín Ciudad del Rio (no schedule in legacy — new location)
UPDATE public.locations SET
  schedule = '{"display": "Lun-Sáb 07:00-18:00 | Dom y fest 08:00-15:00"}'::jsonb,
  city = 'medellin',
  slug = 'medellin-ciudad-del-rio'
WHERE code = 'ACMNN';

-- Medellín Aeropuerto José María Córdoba
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 06:00-23:00"}'::jsonb,
  city = 'medellin',
  slug = 'medellin-aeropuerto-jose-maria-cordoba'
WHERE code = 'AAMDL';

-- Rionegro
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 06:00-23:00"}'::jsonb,
  city = 'medellin',
  slug = 'rionegro'
WHERE code = 'ACMJM';

-- Montería Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 07:00-19:00 | Sáb, Dom y fest 08:00-16:00"}'::jsonb,
  city = 'monteria',
  slug = 'monteria-aeropuerto'
WHERE code = 'AAMTR';

-- Montería Ciudad
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-15:00 | Sáb, Dom y fest 08:00-13:00"}'::jsonb,
  city = 'monteria',
  slug = 'monteria-ciudad'
WHERE code = 'ACMTR';

-- Neiva Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 06:30-20:00 | Sáb, Dom y fest 08:00-15:00"}'::jsonb,
  city = 'neiva',
  slug = 'neiva-aeropuerto'
WHERE code = 'AANVA';

-- Pereira Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 06:30-19:30 | Sáb, Dom y fest 08:00-15:00"}'::jsonb,
  city = 'pereira',
  slug = 'pereira-aeropuerto'
WHERE code = 'AAPEI';

-- Santa Marta Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Todos los días 07:00-18:00"}'::jsonb,
  city = 'santa-marta',
  slug = 'santa-marta-aeropuerto'
WHERE code = 'AASMR';

-- Santa Marta Barrio El Prado (no schedule in legacy — new location)
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00"}'::jsonb,
  city = 'santa-marta',
  slug = 'santa-marta-barrio-el-prado'
WHERE code = 'ACSMR';

-- Valledupar Aeropuerto
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 07:00-18:00 | Sáb, Dom y fest 08:00-15:00"}'::jsonb,
  city = 'valledupar',
  slug = 'valledupar-aeropuerto'
WHERE code = 'AAVAL';

-- Villavicencio
UPDATE public.locations SET
  schedule = '{"display": "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00"}'::jsonb,
  city = 'villavicencio',
  slug = 'villavicencio'
WHERE code = 'ACVLL';
