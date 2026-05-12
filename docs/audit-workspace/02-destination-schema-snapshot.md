# Dashboard (Supabase) — destination schema snapshot

Generated via Explore subagent reading `supabase/migrations/007_customers.sql`, `008_reservations.sql`, `009_search_logs.sql` and all later migrations that mutate them, plus `lib/schemas/reservation.ts` and `lib/schemas/customer.ts`.

## customers (final)

| column | type | nullable | default | constraints | source migration |
|---|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK | 007 |
| first_name | text | NO | — | — | 007 |
| last_name | text | NO | — | — | 007 |
| identification_type | text | NO | — | CHECK IN (`'CC','CE','NIT','PP','TI'`) | 007 |
| identification_number | text | NO | — | UNIQUE — canonical key | 007 |
| phone | text | NO | `''` | — | 007 |
| email | text | NO | — | unique CONSTRAINT DROPPED in 030 | 007, 030 |
| notes | text | NO | `''` | — | 007 |
| status | text | NO | `'active'` | CHECK IN (`'active','inactive'`) | 007 |
| created_at | timestamptz | NO | now() | — | 007 |
| updated_at | timestamptz | NO | now() | — | 007 |

**030_customers_email_not_unique.sql** dropped `customers_email_key` UNIQUE — `identification_number` is the canonical key.

## reservations (final, 45+ columns)

| column | type | nullable | default | constraints | source |
|---|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK | 008 |
| customer_id | uuid | NO | — | FK→customers(id) | 008 |
| rental_company_id | uuid | NO | — | FK→rental_companies(id) | 008 |
| referral_id | uuid | YES | — | FK→referrals(id) | 008 |
| referral_raw | text | YES | — | — | 008 |
| pickup_location_id | uuid | NO | — | FK→locations(id) | 008 |
| return_location_id | uuid | NO | — | FK→locations(id) | 008 |
| franchise | text | NO | — | CHECK IN (`'alquilatucarro','alquilame','alquicarros'`) | 008 |
| booking_type | text | NO | — | CHECK IN (`'standard','standard_with_insurance','monthly'`) | 008 |
| reservation_code | text | YES | — | — | 008 |
| reference_token | text | YES | — | — | 008 |
| rate_qualifier | text | YES | — | — | 008 |
| category_code | text | NO | — | not FK; matches vehicle_categories.code | 008 |
| pickup_date | date | NO | — | — | 008 |
| pickup_hour | time | NO | — | — | 008 |
| return_date | date | NO | — | — | 008 |
| return_hour | time | NO | — | — | 008 |
| selected_days | smallint | NO | — | — | 008 |
| total_price | numeric(12,2) | NO | 0 | — | 008 |
| total_price_to_pay | numeric(12,2) | NO | 0 | — | 008 |
| total_price_localiza | numeric(12,2) | NO | 0 | — | 008 |
| tax_fee | numeric(12,2) | NO | 0 | — | 008 |
| iva_fee | numeric(12,2) | NO | 0 | — | 008 |
| coverage_days | smallint | NO | 0 | — | 008 |
| coverage_price | numeric(12,2) | NO | 0 | — | 008 |
| return_fee | numeric(12,2) | NO | 0 | — | 008 |
| extra_hours | smallint | NO | 0 | — | 008 |
| extra_hours_price | numeric(12,2) | NO | 0 | — | 008 |
| total_insurance | boolean | NO | false | **type changed** numeric→boolean | 008, 032 |
| extra_driver | boolean | NO | false | — | 008 |
| baby_seat | boolean | NO | false | — | 008 |
| wash | boolean | NO | false | — | 008 |
| aeroline | text | YES | — | — | 008 |
| flight_number | text | YES | — | — | 008 |
| monthly_mileage | integer | YES | — | values normalized to [1000,2000,3000] in 028 | 008, 028 |
| notification_required | boolean | NO | false | — | 008 |
| notification_sent | boolean | NO | false | — | 008 |
| notification_sent_at | timestamptz | YES | — | — | 008 |
| notification_sent_by | uuid | YES | — | FK→profiles(id) | 008 |
| ghl_contact_id | text | YES | — | — | 019 |
| ghl_opportunity_id | text | YES | — | — | 019 |
| ghl_last_sync | timestamptz | YES | — | — | 019 |
| status | text | NO | `'nueva'` | CHECK IN 13 values (see below) | 008 |
| created_by | uuid | YES | — | FK→profiles(id) | 008 |
| nota | text | YES | — | — | 027 |
| created_at | timestamptz | NO | now() | — | 008 |
| updated_at | timestamptz | NO | now() | — | 008 |

**status CHECK constraint** (13 values, snake_case):
```
'nueva', 'pendiente', 'reservado', 'sin_disponibilidad', 'utilizado',
'no_contactado', 'baneado', 'no_recogido', 'pendiente_pago',
'pendiente_modificar', 'cancelado', 'indeterminado', 'mensualidad'
```

Indexes: `status`, `franchise`, `customer_id`, `pickup_date`, `reservation_code`.

## search_logs (final)

| column | type | nullable | default | notes | source |
|---|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK | 009 |
| franchise | text | NO | — | matches franchise enum, no FK | 009 |
| pickup_location_code | text | NO | — | denormalized; references locations.code | 009 |
| return_location_code | text | NO | — | denormalized | 009 |
| pickup_date | date | NO | — | — | 009 |
| pickup_hour | time | NO | — | — | 009 |
| return_date | date | NO | — | — | 009 |
| return_hour | time | NO | — | — | 009 |
| is_monthly | boolean | NO | false | — | 009 |
| referral_code | text | YES | — | denormalized | 009 |
| available_categories | jsonb | NO | `'[]'` | search snapshot | 009 |
| total_results | smallint | NO | 0 | — | 009 |
| selected_category_code | text | YES | — | — | 009 |
| converted_to_reservation | boolean | NO | false | — | 009 |
| session_id | text | YES | — | — | 009 |
| user_agent | text | YES | — | — | 009 |
| ip_address | text | YES | — | — | 009 |
| searched_at | timestamptz | NO | now() | — | 009 |

**No FK constraints** — by design, tolerates location/referral deletion. Append-only.

## Lookup tables relevant for FK resolution

| destination column | references | natural key for legacy lookup |
|---|---|---|
| reservations.customer_id | customers(id) UUID | customers.identification_number TEXT UNIQUE |
| reservations.rental_company_id | rental_companies(id) UUID | rental_companies.code TEXT UNIQUE |
| reservations.referral_id | referrals(id) UUID nullable | referrals.code TEXT UNIQUE |
| reservations.pickup_location_id | locations(id) UUID | (rental_company_id, locations.code) composite UNIQUE |
| reservations.return_location_id | locations(id) UUID | same composite |
| reservations.category_code | text (no FK) | vehicle_categories.code TEXT |

## Zod invariants beyond DB

From `lib/schemas/reservation.ts`:
- `VALID_TRANSITIONS` is a free graph — any status → any other status allowed (operator can reverse).
- `MONTHLY_MILEAGE_OPTIONS = [1000, 2000, 3000]` enforced at UI/Zod, NOT at DB.
- Numeric pricing fields coerced from string `.min(0)`.
- `category_code` `.min(1)` non-empty.
- `total_insurance` boolean (since 032).

From `lib/schemas/customer.ts`:
- `email` `.email()` format — empty string and malformed emails would fail Zod even though DB only requires NOT NULL.
- `identification_number` `.min(1)`.
- `identification_type` strict enum matching DB check.

## Legacy-violation risk table

| destination constraint | legacy violation risk | mitigation surface |
|---|---|---|
| `customers.identification_number` UNIQUE | HIGH — same identification appears in many reservations | dedup before insert (E3 D1) |
| `customers.email` NOT NULL | MED — legacy `email` was required at insert but quality varies | imputation policy |
| `customers.email` `.email()` Zod | MED — Zod fails on bad emails; choose: skip via Zod, or bypass Zod with raw SQL | E3 policy |
| `customers.identification_type` CHECK 5 values | LOW — legacy only has 3, all map; no foreign types expected | exact mapping table |
| `reservations.status` CHECK 13 values | MED — legacy "Terminado" pre-2024-09-24 has no mapping; need policy | E3 policy |
| `reservations.franchise` CHECK 3 values | LOW-MED — legacy franchises are 3 known names; verify exact strings | lookup table |
| `reservations.booking_type` CHECK 3 values | MED — legacy has no equivalent column; derive from `monthly_mileage` + `total_insurance` | E3 policy |
| `reservations.customer_id` NOT NULL | MED — depends on whether all legacy reservations have full customer info | reject or impute |
| `reservations.pickup_location_id` / `return_location_id` NOT NULL | HIGH — legacy made these nullable in 2024_05_24_171027; legacy rows with NULL location violate | reject or impute |
| `reservations.rental_company_id` NOT NULL | HIGH — legacy has no equivalent column; need lookup-by-franchise or default | E3 policy |
| `reservations.category_code` NOT NULL | MED — legacy `category` FK is nullable; rows with NULL would fail | reject or default |
| `reservations.total_insurance` boolean | LOW — legacy is already boolean since 2024_07_30 | direct |
| `reservations.monthly_mileage` integer in [1000,2000,3000] | LOW — legacy enum `1k_kms/2k_kms/3k_kms` maps 1:1 | direct |
| `customers.email` NOT NULL but ZOD `.email()` | MED — if Zod is in the path, empty/invalid emails are rejected; bypass via raw SQL recommended | E4 decision |
