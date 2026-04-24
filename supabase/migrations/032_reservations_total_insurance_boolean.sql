-- Convert reservations.total_insurance to boolean
--
-- The column was created as numeric(12,2) in 008_reservations.sql but has
-- always been used semantically as a boolean flag ("did the customer select
-- total insurance?"). The frontend sends 1/0, the admin API coerced with
-- toNumber() and stored 1.00/0.00, and the confirmation email then rendered
-- formatCOP(total_insurance) → "$1" as if it were a money amount.
--
-- Sibling columns extra_driver, baby_seat, and wash are already boolean;
-- this aligns total_insurance with that pattern.
--
-- USING (total_insurance > 0) preserves historical semantics: any row that
-- had 1.00 (or any positive amount) becomes true; 0.00 becomes false.
--
-- The per-row coverage amount for customers who selected Seguro Total lives
-- in coverage_price (separate, deferred issue — currently stores the basic
-- coverage amount even when total was selected; requires operator input
-- before resolving).

alter table public.reservations
  alter column total_insurance drop default,
  alter column total_insurance type boolean using (total_insurance > 0),
  alter column total_insurance set default false;
