# E2 — Mapeo schema-a-schema (legacy → destino)

## Convenciones del mapping

- `legacy.reservations.X` = columna `X` en MySQL `reservations`.
- `dest.customers.Y` = columna `Y` en Supabase `public.customers`.
- **Riesgo**: A (alto, requiere decisión humana o pre-validación), M (medio, mitigable), B (bajo, mapeo directo).

> **⚠️ Corrección 2026-05-19 (post-cierre #13).** El mapeo original asumió que `legacy.reservations.user` era nombre de operador descartable y que el legacy no rastreaba referidos. Ambas asunciones eran falsas — confirmadas erróneas por el dueño del dato (Pablo). `legacy.reservations.user` ES la columna de referidos del legacy. Las celdas afectadas están corregidas in-line con la marca `[corregido 2026-05-19]`. Ver comentario de corrección en #13 y issues derivadas: #46 (seed referrals reales), #47 (backfill `public.reservations` actuales), #48 (UX anti-fraude), #20 (scope ETL corregido).

---

## D1 — customers (no existe tabla en legacy)

**Estrategia:** extraer set distinct por `(legacy.reservations.identification_type, legacy.reservations.identification)`, deduplicar, generar UUID, luego enlazar `reservations.customer_id`.

### Mapeo de columnas

| dest.customers | fuente legacy | transformación | riesgo |
|---|---|---|---|
| id | (generado) | `gen_random_uuid()` o pre-calcular en ETL para idempotencia | B |
| first_name | `reservations.fullname` | heurística split (ver E3) | A |
| last_name | `reservations.fullname` | heurística split (ver E3) | A |
| identification_type | `reservations.identification_type` | tabla mapping: `'Cedula Ciudadania'→'CC'`, `'Cedula Extranjeria'→'CE'`, `'Pasaporte'→'PP'` | B |
| identification_number | `reservations.identification` | TRIM. UNIQUE en destino — requiere dedup | A |
| phone | `reservations.phone` | TRIM. Si NULL/empty → `''` (default destino) | B |
| email | `reservations.email` | TRIM lower. Si NULL/empty → ver E3 (política) | M |
| notes | (n/a) | `''` (default destino) | B |
| status | (n/a) | `'active'` (default destino) | B |
| created_at | min(`reservations.created_at`) por identification | preserva la primera vez que apareció | M |
| updated_at | max(`reservations.updated_at`) por identification | preserva el último contacto | M |

### Conflictos esperados al deduplicar

Al agrupar por `(identification_type, identification)`, las filas legacy pueden tener fullname/email/phone distintos. Política recomendada (ver E3): **latest-wins** ordenado por `updated_at DESC` para campos no-clave; reportar conflictos en log de migración.

---

## D2 — reservations (cliente embebido + status enum + FK BIGINT→UUID)

### Mapeo de columnas

| dest.reservations | fuente legacy | transformación | riesgo |
|---|---|---|---|
| id | (generado) | `gen_random_uuid()` | B |
| customer_id | (resuelto) | lookup en customers por `(identification_type→CC/CE/PP, identification)` | M |
| rental_company_id | (n/a en legacy) | lookup en rental_companies por franchise (`alquilatucarro` → Localiza, etc.) — política E3 | A |
| referral_id | `reservations.user` | lookup canónico `LOWER(TRIM(user)) = referrals.code → referrals.id`; NULL/'' → NULL **[corregido 2026-05-19]** | A |
| referral_raw | `reservations.user` | TRIM del string original; preservar siempre, aun cuando `referral_id` resuelva; NULL/'' → NULL **[corregido 2026-05-19]** | B |
| pickup_location_id | `reservations.pickup_location` | lookup branches.id → locations vía `branches.code` o `branches.name` → `locations.code` | A |
| return_location_id | `reservations.return_location` | mismo lookup | A |
| franchise | `reservations.franchise` (BIGINT FK) | lookup franchises.id → franchises.name → mapeo a enum `alquilatucarro\|alquilame\|alquicarros` | M |
| booking_type | (n/a) | DERIVAR: `monthly_mileage IS NOT NULL → 'monthly'`; else `total_insurance → 'standard_with_insurance'` / `'standard'` — política E3 | A |
| reservation_code | `reservations.reserve_code` | rename directo; preservar NULL | B |
| reference_token | (n/a) | NULL | B |
| rate_qualifier | (n/a) | NULL | B |
| category_code | `reservations.category` (BIGINT FK) | lookup categories.id → categories.identification (mapea a vehicle_categories.code); rows con NULL → política E3 | A |
| pickup_date | `reservations.pickup_date` | directo | B |
| pickup_hour | `reservations.pickup_hour` | directo (MySQL `time` = Postgres `time`) | B |
| return_date | `reservations.return_date` | directo | B |
| return_hour | `reservations.return_hour` | directo | B |
| selected_days | `reservations.selected_days` | int → smallint; validar rango (≤32767) | M |
| total_price | `reservations.total_price` | float → numeric(12,2), ROUND a 2 decimales | M |
| total_price_to_pay | `reservations.total_price_to_pay` | uint → numeric(12,2) | B |
| total_price_localiza | `reservations.total_price_localiza` | float → numeric(12,2), ROUND | M |
| tax_fee | `reservations.tax_fee` | float → numeric(12,2) | B |
| iva_fee | `reservations.iva_fee` | float → numeric(12,2) | B |
| coverage_days | `reservations.coverage_days` | int → smallint | B |
| coverage_price | `reservations.coverage_price` | float → numeric(12,2) | B |
| return_fee | `reservations.return_fee` | uint → numeric(12,2). Si NULL → 0 | B |
| extra_hours | `reservations.extra_hours` | int → smallint | B |
| extra_hours_price | `reservations.extra_hours_price` | float → numeric(12,2) | B |
| total_insurance | `reservations.total_insurance` | boolean → boolean (legacy ya boolean desde 2024_07_30) | B |
| extra_driver | `reservations.extra_driver` | boolean directo (existe desde 2025_06_03; rows previas no tienen columna pero MySQL default 0) | B |
| baby_seat | `reservations.baby_seat` | directo | B |
| wash | `reservations.wash` | directo | B |
| aeroline | `reservations.aeroline` | directo (NULL pre-2025-06-20) | B |
| flight_number | `reservations.flight_number` | directo | B |
| monthly_mileage | `reservations.monthly_mileage` | enum→int: `'1k_kms'→1000`, `'2k_kms'→2000`, `'3k_kms'→3000`, NULL→NULL | B |
| notification_required | (n/a) | `false` (default) | B |
| notification_sent | (n/a) | `false` (default) | B |
| notification_sent_at | (n/a) | NULL | B |
| notification_sent_by | (n/a) | NULL | B |
| ghl_contact_id | `reservations.ghl_contact_id` | directo | B |
| ghl_opportunity_id | `reservations.ghl_opportunity_id` | directo | B |
| ghl_last_sync | `reservations.ghl_last_sync` | directo | B |
| status | `reservations.status` | tabla mapping 1:1 lowercase+snake_case (ver D2 abajo); `'Terminado'` legacy histórico → política E3 | M |
| created_by | (n/a) | NULL | B |
| nota | `reservations.note` | rename directo (tinyText → text) | B |
| created_at | `reservations.created_at` | preservar timestamp original | B |
| updated_at | `reservations.updated_at` | preservar timestamp original | B |

### D2-status — mapeo de enum

Tras aplicar las 5 migraciones legacy, el enum final tiene 13 valores. Mapeo a destino:

| legacy | destino | nota |
|---|---|---|
| `Nueva` | `nueva` | |
| `Pendiente` | `pendiente` | |
| `Reservado` | `reservado` | |
| `Sin disponibilidad` | `sin_disponibilidad` | espacio → `_` |
| `Utilizado` | `utilizado` | |
| `No Contactado` | `no_contactado` | |
| `Baneado` | `baneado` | |
| `No recogido` | `no_recogido` | |
| `Pendiente Pago` | `pendiente_pago` | |
| `Pendiente Modificar` | `pendiente_modificar` | |
| `Cancelado` | `cancelado` | |
| `Indeterminado` | `indeterminado` | |
| `Mensualidad` | `mensualidad` | |
| **`Terminado` (legado pre-2024-09-24)** | **decisión producto** | candidatos: `utilizado` (semánticamente cerrado) o `indeterminado` (catch-all). Recomendado: `utilizado`. |

Regla SQL canónica: `lower(replace(status, ' ', '_'))` resuelve los 13 valores nuevos. Solo `Terminado` queda fuera.

### Campos legacy descartados

| legacy.reservations.X | razón |
|---|---|
| ~~`user` (operador)~~ | **[CORREGIDO 2026-05-19]** NO se descarta — es la columna de referidos del legacy. Mapeo real en D2 (`referral_id` + `referral_raw`). |
| `flight` (boolean) | destino no tiene; si TRUE, opcional volcar a `nota` |

---

## D3 — Lookup BIGINT → UUID

### branches → locations

Estrategia: usar `branches.code` (UNIQUE en legacy) como natural key contra `locations.code` (composite UNIQUE con `rental_company_id`). Reportar mismatches.

```sql
-- SQL conceptual del ETL (no se ejecuta aquí)
SELECT l.id AS location_uuid, b.id AS legacy_branch_id
FROM legacy_branches b
JOIN locations l
  ON l.code = b.code
  AND l.rental_company_id = (
    SELECT id FROM rental_companies WHERE ... -- depende de política E3 rental_company
  );
```

Riesgo: si `branches.code` ≠ `locations.code`, fallback a `branches.name` match fuzzy.

### categories → vehicle_categories

`categories.identification` (legacy: `'C', 'CX', 'F', 'FX', 'GC', 'G4', 'LE', 'GY', 'FU', 'FL', 'GL'`) corresponde a `vehicle_categories.code`. Match exacto.

Riesgo: categorías legacy soft-deleted (con `deleted_at`) — deben incluirse en el lookup, no excluirse (para que reservations históricas con esa categoría no queden huérfanas).

### franchises → enum text

Tabla legacy `franchises` con BIGINT id y `name` libre. Necesita mapeo manual: `name` → enum `{alquilatucarro, alquilame, alquicarros}`. Validar contra el listado E1 de franquicias legacy existentes.

---

## D4 — search_logs (cambio radical de estructura)

Legacy `log_veh_available_rates_queries` guarda request raw + processed_data en JSON. Destino `search_logs` espera campos estructurados.

### Mapeo de columnas

| dest.search_logs | fuente legacy | transformación | riesgo |
|---|---|---|---|
| id | (generado) | gen_random_uuid() | B |
| franchise | `request_parameters->>'franchise'` o similar | parsear JSON; validar contra enum 3 valores | A |
| pickup_location_code | `request_parameters->>'pickup_branch_code'` o derivado | parsear JSON; validar contra locations.code | A |
| return_location_code | mismo, return | A | |
| pickup_date | `request_parameters->>'pickup_date'` | parse a `date` | M |
| pickup_hour | `request_parameters->>'pickup_hour'` | parse a `time` | M |
| return_date | `request_parameters->>'return_date'` | parse a `date` | M |
| return_hour | `request_parameters->>'return_hour'` | parse a `time` | M |
| is_monthly | `request_parameters->>'is_monthly'` o `monthly_mileage IS NOT NULL` | boolean | M |
| referral_code | `request_parameters->>'referral_code'` | nullable | M |
| available_categories | `processed_data->'available_categories'` o equivalente | jsonb directo si estructura coincide | A |
| total_results | `jsonb_array_length(available_categories)` | derivable | M |
| selected_category_code | (n/a) | NULL (legacy no rastreaba selección) | B |
| converted_to_reservation | (derivar) | join con `reservations` por `(identification, pickup_date, +/- 30min)` ó FALSE para todas | A |
| session_id | (n/a) | NULL | B |
| user_agent | (n/a) | NULL | B |
| ip_address | `source_ip` | directo | B |
| searched_at | `created_at` | preservar timestamp | B |

### Política recomendada (resumen)

Solo migrar registros donde el JSON `request_parameters` contenga **todos los campos NOT NULL del destino**. Loggear y descartar los demás. La pérdida es aceptable porque `search_logs` es append-only para analítica futura, no estado de negocio.

`converted_to_reservation`: derivable por join post-hoc, pero costoso y propenso a falsos positivos. Recomendado en E3: `FALSE` por defecto; abrir issue separada si producto necesita el rastreo retroactivo.

`Prunable` legacy borra >3 meses → solo se migrarán logs recientes (último cuatrimestre aproximado).

---

## D5 — Campos destino sin fuente legacy (defaults)

| dest column | default propuesto | justificación |
|---|---|---|
| `customers.notes` | `''` | sin equivalente legacy |
| `customers.status` | `'active'` | sin equivalente |
| `reservations.rental_company_id` | lookup por franchise (decisión E3) | hipótesis: 1 franchise → 1 rental_company; validar con producto |
| `reservations.referral_id` | resolución vía lookup desde `legacy.user` | **[corregido 2026-05-19]** ver D2; legacy SÍ rastreaba referidos en columna `user` |
| `reservations.referral_raw` | string original desde `legacy.user` | **[corregido 2026-05-19]** ver D2 |
| `reservations.reference_token` | NULL | |
| `reservations.rate_qualifier` | NULL | |
| `reservations.booking_type` | derivado por reglas | ver D2 |
| `reservations.notification_required` | `false` | conservador |
| `reservations.notification_sent` | `false` | conservador |
| `reservations.notification_sent_at` | NULL | |
| `reservations.notification_sent_by` | NULL | |
| `reservations.created_by` | NULL | filas históricas no tienen `profiles.id` asociable; el operador legacy se preserva en `referral_id`/`referral_raw` (D2), no en `created_by` **[corregido 2026-05-19]** |

---

## Resumen de riesgos altos (A)

1. **Heurística split fullname** — afecta TODOS los registros legacy. Requiere política E3.
2. **Dedup customers por identification** — conflictos esperados; requiere política E3.
3. **rental_company_id** — campo NOT NULL en destino, ausente en legacy. Necesita lookup por franchise + decisión producto.
4. **pickup_location_id / return_location_id** — NOT NULL destino, NULLABLE legacy. Rows con NULL violan; necesita política (rechazar / imputar / agregar valor "Indeterminado" en locations).
5. **category_code** — NOT NULL destino, NULLABLE legacy. Misma política.
6. **status "Terminado"** legado — sin mapping definido.
7. **booking_type** derivado — confirmar reglas con producto.
8. **search_logs JSON parsing** — depende de la estructura real del JSON legacy; verificar con dump.

Todos los riesgos A se materializan como preguntas abiertas en sección 5 del documento final.
