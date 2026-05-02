alter table public.vehicle_categories
  add column extra_km_charge numeric not null default 0;

update public.vehicle_categories set extra_km_charge = 700
  where code in ('C', 'CX', 'F', 'FX', 'FL', 'FU');

update public.vehicle_categories set extra_km_charge = 900
  where code in ('GC', 'G4', 'GL');

update public.vehicle_categories set extra_km_charge = 1100
  where code in ('LE', 'GY');
