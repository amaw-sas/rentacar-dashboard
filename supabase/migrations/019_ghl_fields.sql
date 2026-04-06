-- Add GoHighLevel sync fields to reservations
alter table public.reservations
  add column ghl_contact_id text,
  add column ghl_opportunity_id text,
  add column ghl_last_sync timestamptz;
