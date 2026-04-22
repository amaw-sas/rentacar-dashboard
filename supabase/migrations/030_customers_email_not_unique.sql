-- Email is no longer a unique identifier for customers.
-- Identification is the canonical key: one physical person = one identification_number.
-- Emails can legitimately repeat across customers (e.g. a titular reserving for a family
-- member using their own email but the family member's identification).
alter table public.customers drop constraint customers_email_key;
