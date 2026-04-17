-- Locations address/map refactor (non-destructive ADD-only).
-- Adds pickup_address, pickup_map, return_address, return_map.
-- Keeps legacy `address` column untouched so old and new code coexist during deploy.
-- Populates from legacy branches CSV (2024_10_23_112145) + 2025 overrides for ACMNN and AAMDL.
-- Enforces non-empty pickup_address and pickup_map via CHECK constraints.
-- Deletes ACBOT (closed location, no reservations reference it).
-- A follow-up migration should drop the legacy `address` column once all readers are migrated.

begin;

delete from public.locations where code = 'ACBOT';

alter table public.locations
  add column pickup_address text not null default '',
  add column pickup_map text,
  add column return_address text,
  add column return_map text;

update public.locations set
  pickup_address = 'Aeropuerto el Edén – Local # 18, Km 14 Vía a la Tebaida',
  pickup_map = 'https://maps.app.goo.gl/yxKpFsswp4DKd6BL7'
where code = 'AARME';

update public.locations set
  pickup_address = 'Aeropuerto Ernesto Cortissoz Piso 1 Local 015',
  pickup_map = 'https://maps.app.goo.gl/CJUF2P141zYKoomMA',
  return_address = 'Calle 30, #1-368, a 200 metros del Aeropuerto Ernesto Cortissoz',
  return_map = 'https://maps.app.goo.gl/Bh9eKGNzzswc7BfQ9'
where code = 'AABAN';

update public.locations set
  pickup_address = 'Vía 40, #76-63, al lado de Kia',
  pickup_map = 'https://maps.app.goo.gl/QGCKdzPTqYpmKZBw8'
where code = 'ACBAN';

update public.locations set
  pickup_address = 'Cll. 30, #1-368, a 200 metros del Aeropuerto Ernesto Cortissoz',
  pickup_map = 'https://maps.app.goo.gl/Bh9eKGNzzswc7BfQ9'
where code = 'ACBSD';

update public.locations set
  pickup_address = 'Aeropuerto El Dorado, Piso 1 Puerta 7, Punto de atención para traslado hasta la rentadora de 6:00 am a 10:00 pm, en otro horario llamar al 350-280-6370',
  pickup_map = 'https://maps.app.goo.gl/U3Sct9jNM8BrLFR78',
  return_address = 'Diagonal 24C, 99-45 - a 5 minutos del Aeropuerto',
  return_map = 'https://maps.app.goo.gl/JjpsSCHkCrgGYa9P7'
where code = 'AABOT';

update public.locations set
  pickup_address = 'Cll. 170 #64-47',
  pickup_map = 'https://maps.app.goo.gl/Lgr33gpxFDgM2VS5A'
where code = 'ACBOJ';

update public.locations set
  pickup_address = 'Cll. 134 #9-51, Parqueadero Nivel 2, Entrada por la Cra 10',
  pickup_map = 'https://maps.app.goo.gl/j4e6U88jwdxZ7Fos7'
where code = 'ACBEX';

update public.locations set
  pickup_address = 'Av. Cra 86 # 55A -75 Sótano 1, Engativá',
  pickup_map = 'https://maps.app.goo.gl/8zvNGCa9wdjMzb9g9'
where code = 'ACBNN';

update public.locations set
  pickup_address = 'Aeropuerto Palonegro, Km 25 Vía Lebrija, frente a las Salidas Internacionales',
  pickup_map = 'https://maps.app.goo.gl/86UCaYUUFro5tMBu9'
where code = 'AABCR';

update public.locations set
  pickup_address = 'Cll. 114 # 27-42, Puente de Provenza',
  pickup_map = 'https://maps.app.goo.gl/QYQje7sN8Y12tt8t6'
where code = 'ACBCR';

update public.locations set
  pickup_address = 'Supermercado Jumbo Cll. 40 Norte # 6A-45',
  pickup_map = 'https://maps.app.goo.gl/8gWfkeRRLoD4cbng6'
where code = 'ACKJC';

update public.locations set
  pickup_address = 'Cll. 10 # 52-50 al lado de la estación Primax',
  pickup_map = 'https://maps.app.goo.gl/zR5XaSGHcmNp8JdE9'
where code = 'ACKAL';

update public.locations set
  pickup_address = 'Aeropuerto Alfonso Bonilla Aragón – Local 4, al lado de llegadas nacionales',
  pickup_map = 'https://maps.app.goo.gl/dSiGwEPhLiL6bq7z8',
  return_address = 'C.Cial. Plaza Madero Local 02-A2 - A 5 minutos del Aeropuerto Estación de Servicio ESSO',
  return_map = 'https://maps.app.goo.gl/QCogJToARfMqpXhA6'
where code = 'AAKAL';

update public.locations set
  pickup_address = 'C.Cial. Plaza Madero Local 02-A2 - A 5 minutos del Aeropuerto Estación de Servicio ESSO',
  pickup_map = 'https://maps.app.goo.gl/QCogJToARfMqpXhA6'
where code = 'ACKPA';

update public.locations set
  pickup_address = 'Cra. 3 #70-122 Barrio Crespo, Diagonal al Aeropuerto Rafael Núñez - Entrando por Kokoriko, a mitad de cuadra',
  pickup_map = 'https://maps.app.goo.gl/xbFboT6RDE7kpZsG8'
where code = 'AACTG';

update public.locations set
  pickup_address = 'Aeropuerto Camilo Daza Local L1 - 039 Al lado de la entrada 1',
  pickup_map = 'https://maps.app.goo.gl/QiozK3kECcm7K3wy8'
where code = 'AACUC';

update public.locations set
  pickup_address = 'Av. Ambalá con Cll. 69, Local 113',
  pickup_map = 'https://maps.app.goo.gl/coEMasjzVjkmsY3W9'
where code = 'ACIBG';

update public.locations set
  pickup_address = 'Cra 14, #55 D-251, Entrada 1, Av. Kevin Ángel',
  pickup_map = 'https://maps.app.goo.gl/oMftWbumYhK6HjCe8'
where code = 'ACMNZ';

update public.locations set
  pickup_address = 'Cra. 48B #4Sur-15, Av. Las Vegas Bajo del Puente de la 4 Sur',
  pickup_map = 'https://maps.app.goo.gl/GNZkrRvXvJb7c85w6'
where code = 'ACMDL';

update public.locations set
  pickup_address = 'Cll. 49 B #66-01 Piso 3 Parqueadero',
  pickup_map = 'https://maps.app.goo.gl/Kf7cNZnaNEVmDbcx5'
where code = 'ACMCL';

-- ACMNN overridden by 2025_04_21_154442
update public.locations set
  pickup_address = 'Carrera 48 # 17 - 49, El Poblado - Agencia LOCALIZA RENT A CAR (LETRERO VERDE CON BLANCO)',
  pickup_map = 'https://maps.app.goo.gl/Qp9QxkEGTaPn8GLk7'
where code = 'ACMNN';

-- AAMDL overridden by 2025_04_22_154442
update public.locations set
  pickup_address = 'Aeropuerto Jose Maria Córdoba Llegadas Internacionales 1 Piso, Local 10 Rionegro (Punto de atención, los clientes los trasladan en vans hasta Rionegro, y no se reciben devoluciones de vehículos) (AGENCIA LOCALIZA RENT A CAR LETRERO VERDE CON BLANCO)',
  pickup_map = 'https://maps.app.goo.gl/oDW78mD25Xt6b7jf6',
  return_address = 'Glorieta José María Córdova - Vía Guarne al lado de asados exquisitos (AEROPUERTO RIONEGRO) (AGENCIA LOCALIZA RENT A CAR LETRERO VERDE CON BLANCO)',
  return_map = 'https://maps.app.goo.gl/9EhLZ8dYprerfM6R6'
where code = 'AAMDL';

update public.locations set
  pickup_address = 'Glorieta José María Córdova - Vía Guarne al lado de asados exquisitos',
  pickup_map = 'https://maps.app.goo.gl/9EhLZ8dYprerfM6R6'
where code = 'ACMJM';

update public.locations set
  pickup_address = 'Aeropuerto Los Garzones Local 111 al lado de la salida de pasajeros',
  pickup_map = 'https://maps.app.goo.gl/7j6W95iaCmd28cDd9'
where code = 'AAMTR';

update public.locations set
  pickup_address = 'Cra 6 #68- 72 Sótano B',
  pickup_map = 'https://maps.app.goo.gl/NY75KeZ4SrRCrmTY8'
where code = 'ACMTR';

update public.locations set
  pickup_address = 'Aeropuerto Benito Salas Local 12',
  pickup_map = 'https://maps.app.goo.gl/JXwBRfXwrDDNREKQ8'
where code = 'AANVA';

update public.locations set
  pickup_address = 'Aeropuerto Matecaña, Hall Público Piso 1 Local 50',
  pickup_map = 'https://maps.app.goo.gl/Rqtxu5UzfuoojMA96',
  return_address = 'Km 4 Vía Cerritos, Parqueadero Sociedad De Mejoras',
  return_map = 'https://maps.app.goo.gl/xQnAN6rV3RTToxn78'
where code = 'AAPEI';

update public.locations set
  pickup_address = 'Aeropuerto Simón Bolívar Local 11, 012A Salidas Nacionales',
  pickup_map = 'https://maps.app.goo.gl/Rq1uHdpYyzQfRJbo6'
where code = 'AASMR';

update public.locations set
  pickup_address = 'Cll. 24 # 03-04',
  pickup_map = 'https://maps.app.goo.gl/H1jYo4xCmTMbG9Vn6'
where code = 'ACSMR';

update public.locations set
  pickup_address = 'Aeropuerto Alfonso López local 111',
  pickup_map = 'https://maps.app.goo.gl/B92NBR7nLuEe7yN56'
where code = 'AAVAL';

update public.locations set
  pickup_address = 'Cll. 15 #38-40 Sotano 1 Local 5',
  pickup_map = 'https://maps.app.goo.gl/RS36zckMhDUn79BL8'
where code = 'ACVLL';

-- Verify all locations have pickup_address and pickup_map populated.
-- If any row still has blank pickup data, the CHECK constraints below will fail and rollback the transaction.
alter table public.locations alter column pickup_map set not null;
alter table public.locations add constraint locations_pickup_address_not_blank check (length(trim(pickup_address)) > 0);
alter table public.locations add constraint locations_pickup_map_not_blank check (length(trim(pickup_map)) > 0);

commit;
