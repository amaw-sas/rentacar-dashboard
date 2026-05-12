# Legacy rentacar-admin — final schema snapshot

Generated via Explore subagent reading all 49 migrations in `/home/pabloandi/proyectos/rentacar/rentacar-admin/database/migrations/` and Eloquent models in `app/Models/`. This is the working evidence backing the audit document.

## reservations (final)

| column | type | nullable | default | notes (migration) |
|---|---|---|---|---|
| id | bigint unsigned | NO | AUTO_INCREMENT | PK — 2024_04_06_212736 |
| fullname | string | NO | — | 2024_04_06_212736 |
| identification_type | enum | NO | — | `'Cedula Ciudadania', 'Cedula Extranjeria', 'Pasaporte'` — 2024_04_06_212736 |
| identification | string | NO | — | 2024_04_06_212736 |
| phone | string | NO | — | 2024_04_06_212736 |
| email | string | NO | — | 2024_04_06_212736 |
| category | bigint unsigned | YES | NULL | FK→categories.id, NullOnDelete — made nullable in 2024_05_24_171027 |
| pickup_location | bigint unsigned | YES | NULL | FK→branches.id, NullOnDelete — made nullable in 2024_05_24_171027 |
| return_location | bigint unsigned | YES | NULL | FK→branches.id, NullOnDelete — made nullable in 2024_05_24_171027 |
| pickup_date | date | NO | — | |
| pickup_hour | time | NO | — | |
| return_date | date | NO | — | |
| return_hour | time | NO | — | |
| selected_days | integer | NO | — | |
| extra_hours | integer | NO | 0 | |
| extra_hours_price | float | NO | 0 | |
| coverage_days | integer | NO | 0 | |
| coverage_price | float | NO | 0 | |
| return_fee | unsigned integer | YES | 0 | 2024_08_09_171339, repositioned 2024_08_22_154908 |
| tax_fee | float | NO | 0 | |
| iva_fee | float | NO | 0 | |
| total_price | float | NO | — | |
| total_price_localiza | float | NO | 0 | |
| total_price_to_pay | unsigned integer | NO | 0 | 2024_08_22_152639 |
| franchise | bigint unsigned | YES | NULL | FK→franchises.id, NullOnDelete |
| ghl_contact_id | string | YES | NULL | 2026_01_15_000000, indexed |
| ghl_opportunity_id | string | YES | NULL | 2026_01_15_000000, indexed |
| ghl_last_sync | timestamp | YES | NULL | 2026_01_15_000000 |
| user | string | YES | NULL | operator name field |
| reserve_code | string | YES | NULL | |
| status | enum | NO | 'Pendiente' | see "status enum evolution" below — final 13 values |
| monthly_mileage | enum | YES | NULL | `'1k_kms', '2k_kms', '3k_kms'` — 2024_07_26_154649 |
| total_insurance | boolean | NO | false | 2024_07_30_104334 |
| extra_driver | boolean | NO | false | 2025_06_03_105920 |
| baby_seat | boolean | NO | false | 2025_06_03_105920 |
| wash | boolean | NO | false | 2025_06_03_105920 |
| note | tinyText | YES | NULL | 2024_11_29_155631 |
| flight | boolean | YES | NULL | removed in 2024_04_17_145416, re-added nullable in 2025_06_20_105948 |
| aeroline | string | YES | NULL | removed and re-added (same migration pair) |
| flight_number | string | YES | NULL | removed and re-added (same migration pair) |
| created_at | timestamp | NO | — | |
| updated_at | timestamp | NO | — | |

**Indexes:** FULLTEXT on (fullname, identification, phone, email, reserve_code) — 2024_04_30_101848. Indexes on ghl_contact_id, ghl_opportunity_id.

## reservations.status — enum evolution

### Initial (2024_04_06_212736)
`'Pendiente', 'Cancelado', 'Terminado'`

### Migration 2 — 2024_09_24_103839 (expands enum, no data change)
Adds: `'Confirmado', 'Sin confirmar', 'Sin disponibilidad', 'Con código', 'Con código En revisión', 'Nueva', 'No recogido', 'Confirmado Pendiente Pago', 'Reservado', 'SinDisponibilidad', 'Utilizado', 'NoContactado', 'Baneado', 'PendientePago', 'PendienteModificar', 'Indeterminado'`

### Migration 3 — 2024_09_24_164442 (DATA conversion)
| from | to |
|---|---|
| Confirmado | Utilizado |
| Sin confirmar | No Contactado |
| Con código | Reservado |
| Con código En revisión | Pendiente |
| Confirmado Pendiente Pago | Pendiente Pago |

### Migration 4 — 2024_09_24_170048 (redefine to final-shape enum)
`'Nueva', 'Pendiente', 'Reservado', 'Sin disponibilidad', 'Utilizado', 'No Contactado', 'Baneado', 'No recogido', 'Pendiente Pago', 'Pendiente Modificar', 'Cancelado', 'Indeterminado'`

### Migration 5 — 2024_10_30_100824 (add Mensualidad)
Final: `'Nueva', 'Pendiente', 'Reservado', 'Sin disponibilidad', 'Utilizado', 'No Contactado', 'Baneado', 'No recogido', 'Pendiente Pago', 'Pendiente Modificar', 'Cancelado', 'Indeterminado', 'Mensualidad'`

**⚠ "Terminado" (initial value) has NO explicit mapping** — any pre-2024-09-24 reservation still set to `Terminado` would need rule. Subagent flagged this; verify against actual dump.

## log_veh_available_rates_queries (final)

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | bigint unsigned | NO | AUTO_INCREMENT | PK |
| request_parameters | json | NO | — | |
| response_status | integer | NO | — | HTTP code |
| response_raw | longText | YES | NULL | |
| processed_data | json | YES | NULL | |
| source_ip | ipAddress | YES | NULL | |
| created_at | timestamp | NO | — | |
| updated_at | timestamp | NO | — | |

Model is `Prunable` (deletes rows >3 months old).

## branches (final)

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | bigint unsigned | NO | AUTO_INCREMENT | PK |
| code | string | NO | UNIQUE | |
| name | string | NO | — | |
| city_id | bigint unsigned | YES | NULL | FK→cities.id |
| pickup_address | string | YES | NULL | added as `address` in 2024_10_21_111153, renamed 2024_10_23_110000 |
| return_address | string | YES | NULL | 2024_10_23_110550 |
| pickup_map | string | YES | NULL | 2024_10_23_110550 |
| return_map | string | YES | NULL | 2024_10_23_110550 |

**No timestamps** (`$timestamps = false`).

## categories (final)

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | bigint unsigned | NO | AUTO_INCREMENT | PK |
| identification | string | NO | — | category code (C, CX, F, FX, GC, G4, LE, GY, FU, FL, GL, etc.) |
| name | string | NO | — | |
| category | string | NO | — | |
| description | string | YES | NULL | |
| image | string | NO | — | |
| ad | string | YES | NULL | |
| order | unsigned integer | NO | 0 | |
| created_at | timestamp | NO | — | |
| updated_at | timestamp | NO | — | |
| deleted_at | timestamp | YES | NULL | SoftDeletes |

`allowed()` scope filters to: `['C','CX','F','FX','GC','G4','LE','GY','FU','FL','GL']`.

## franchises (final)

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | bigint unsigned | NO | AUTO_INCREMENT | PK |
| name | string | NO | — | |
| reserva_button | string | NO | — | |
| masinfo_button | string | NO | — | |
| masprecios_button | string | NO | — | |
| url_mail_system | string | NO | — | |
| ad | json | NO | — | cast AsArrayObject |
| carousel | json | NO | — | cast AsArrayObject |
| created_at | timestamp | NO | — | |
| updated_at | timestamp | NO | — | |

## Eloquent notes

- `Reservation` model: Guarded=[], date/time casts on pickup/return columns, defaults for numeric fields set to "0" string at attribute level.
- `Reservation::with()` eagerly loads `categoryObject`, `pickupLocation`, `returnLocation`, `franchiseObject`.
- All FK relations use NullOnDelete (deleting a branch/category/franchise sets FK to NULL, does NOT cascade-delete the reservation).
- `Reservation` uses Laravel Scout (`Searchable` trait) for full-text search.
- `Category` uses SoftDeletes (`deleted_at`) — soft-deleted rows still readable by ID.
- `Branch` has no timestamps.
