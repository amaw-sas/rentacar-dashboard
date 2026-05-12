# Auditoría de compatibilidad: rentacar-admin → rentacar-dashboard

> **Issue tracker:** [#13](https://github.com/amaw-sas/rentacar-dashboard/issues/13)
> **Alcance:** análisis + plan. Sin INSERTs/UPDATEs. Ejecutiva se abre en issues separadas según hallazgos.
> **Fecha audit inicial:** 2026-05-11
> **Fecha E1 cerrado:** 2026-05-12 (dump prod Aurora MariaDB 10.11.15)

---

## 0. Resumen ejecutivo

Lo que sabemos tras analizar el dump real (12,967 reservations, 10,824 customers únicos, span 2024-04 → 2026-05):

- **customers no existen como tabla en legacy** — están embebidos en `reservations`. Toca extraer, deduplicar por `identification` y enlazar.
- **El enum de status mapea limpio.** Solo 8 de los 13 valores destino aparecen en el dump y todos casan vía `lower(replace(value, ' ', '_'))`. **No hay filas con `Terminado` legacy** — la pregunta que más nos preocupaba quedó cerrada por evidencia.
- **Las FKs BIGINT se reescriben a UUIDs.** branches → locations, franchises → enum (1:1 directo confirmado), categories → vehicle_categories code. ⚠️ 6 códigos legacy (`GR`, `VP`, `G`, `LP`, `LY`, `GX`) no existen en destino y afectan 390 reservas (3.0%). Decisión producto pendiente.
- **search_logs es más complicado de lo que parecía.** El JSON real de `request_parameters` solo tiene 4 campos camelCase (`pickupLocation`, `returnLocation`, `pickupDateTime`, `returnDateTime`). Falta `franchise`, `referral_code`, `is_monthly` y todo el contexto del usuario. El mapping D4 hay que reescribirlo (ya lo está, en §1).
- **Customers placeholder son un problema.** 96 reservas con `identification` todo ceros, 119 con secuencias tipo `1234566`. El dedup ingenuo crea "customers Frankenstein". Política P2 se actualiza para filtrarlos primero.
- **Datos referencialmente limpios**: 0 FKs huérfanas, 100% emails con formato válido, 0 overflow de precios, 2.74% reservas con location NULL (< 5% — rechazo viable).

**Resueltas por E1 sin necesidad de producto:** Q2 (Terminado: no hay), Q3 (booking_type: regla `total_insurance` confirmada), Q4 (rental_company: 1:1 a Localiza), Q5 (umbral location NULL: rechazar viable), Q6 (emails sintéticos: no aplica, 100% válidos).

**Siguen abiertas:** Q1 (fullname 1 token), Q7 (search_logs converted retroactivo), Q8 (operador `user`), Q9 nueva (categorías legacy fuera del set destino), Q10 nueva (search_logs sin franchise).

La estrategia de ejecución que propongo: script Python (`psycopg2` + `COPY`), dry-run en branch Supabase, columna temporal `_legacy_migrated_at` para poder revertir sin tocar bookings nuevos.

---

## 1. Inventario y volumen (E1)

**Fuente:** dump MySQL del 2026-05-11 22:21 UTC (snapshot Aurora MariaDB 10.11.15) cargado en MariaDB local 10.11.14. Las queries originales (Q1–Q14) viven en `docs/audit-workspace/06-e1-queries.md`.

**Datos ingestados:** 21 tablas completas + schema de `log_veh_available_rates_queries` + muestra de 501 filas más recientes de `log_veh` (la tabla es Prunable >3 meses).

### Volumen total

| entidad | filas | notas |
|---|---|---|
| **reservations** | **12,967** | rango temporal: 2024-04-21 → 2026-05-11 (750 días) |
| **customers únicos** (derivado) | **10,824** | dedup por `(identification_type, identification)`. Avg 1.20 reservas/customer |
| log_veh_available_rates_queries | 501 (muestra) | total real desconocido; legacy hace prune >3 meses |
| branches | 31 | lookup |
| categories | 17 | lookup — ⚠️ 6 fuera del set permitido en destino |
| franchises | 3 | lookup — mapean 1:1 al enum destino |
| cities | 23 | sin equivalente directo en destino |
| users (operadores) | 3 (+3 outliers en `reservations.user`) | sin equivalente en destino |
| category_models | 38 | fuera de scope audit |
| category_month_prices | 15 | fuera de scope audit |
| city_category_visibilities | 203 | fuera de scope audit |
| city_franchise_whatsapp_links | 68 | fuera de scope audit |
| city_pages | 73 | fuera de scope audit |

### Distribución de `identification_type`

| tipo | customers únicos | reservas | % |
|---|---|---|---|
| Cedula Ciudadania | 9,335 | 11,237 | 86.7% |
| Pasaporte | 1,205 | 1,417 | 10.9% |
| Cedula Extranjeria | 284 | 313 | 2.4% |

**Solo los 3 valores esperados** (mapeo P3 directo a CC/CE/PP). No hay valores fuera del set.

### Distribución de `reservations.status` (Q5)

| status legacy | filas | % | destino mapeado |
|---|---|---|---|
| Utilizado | 3,657 | 28.20% | `utilizado` |
| No Contactado | 3,398 | 26.20% | `no_contactado` |
| Cancelado | 2,547 | 19.64% | `cancelado` |
| No recogido | 1,935 | 14.92% | `no_recogido` |
| Sin disponibilidad | 709 | 5.47% | `sin_disponibilidad` |
| Reservado | 607 | 4.68% | `reservado` |
| Baneado | 109 | 0.84% | `baneado` |
| Indeterminado | 5 | 0.04% | `indeterminado` |

**0 filas con `Terminado` legacy** (valor inicial del enum, depurado en migraciones 2024_09_24). **Q-Producto-2 RESUELTO sin necesidad de decisión.**

Solo 8 de los 13 valores del enum destino aparecen en el dump. Los 5 ausentes (`nueva`, `pendiente`, `pendiente_pago`, `pendiente_modificar`, `mensualidad`) son estados transicionales del dashboard nuevo, no se generan en el legacy.

### Distribución de `franchise` (Q7)

| franchise legacy | id | reservas | % | enum destino |
|---|---|---|---|---|
| alquilame | 2 | 7,585 | 58.5% | `alquilame` |
| alquicarros | 3 | 2,694 | 20.8% | `alquicarros` |
| alquilatucarro | 1 | 2,688 | 20.7% | `alquilatucarro` |

**Mapeo 1:1 directo** (lowercase exacto). **Q-Producto-4 RESUELTO**: opción A confirmada — todas las franchises legacy operan bajo una sola rental_company (`localiza`).

### Distribución de `category_code` (Q8) — ⚠️ HALLAZGO CRÍTICO

| code legacy | reservas | en set destino |
|---|---|---|
| C | 5,435 | ✅ |
| F | 2,975 | ✅ |
| FX | 2,195 | ✅ |
| GC | 935 | ✅ |
| G4 | 471 | ✅ |
| LE | 378 | ✅ |
| **GR** | **312** | ❌ **no existe en destino** |
| **VP** | **62** | ❌ **no existe en destino** |
| FU | 58 | ✅ |
| CX | 56 | ✅ |
| FL | 42 | ✅ |
| GL | 26 | ✅ |
| **G** | **14** | ❌ **no existe en destino** |
| GY | 6 | ✅ |
| **LP** | **2** | ❌ **no existe en destino** |
| GX, LY | 0 | n/a (sin reservas legacy) |

**390 reservas (3.0%) usan códigos legacy fuera del set permitido del destino.** Esto rompe el supuesto del mapping E2. Abre nueva pregunta para producto — ver §5 (Q9).

### FKs NULL y huérfanas (Q6)

| issue | filas | % |
|---|---|---|
| pickup_location NULL | 355 | **2.74%** |
| return_location NULL | 341 | **2.63%** |
| category NULL | 0 | 0% |
| franchise NULL | 0 | 0% |
| Huérfanas (FK apunta a id inexistente) | **0** todas las relaciones | ✅ datos referencialmente limpios |

**Q-Producto-5 RESUELTO**: pickup/return NULL son <5% → opción A (rechazar filas). Pérdida aceptable: 355 reservas (2.74%) máximo.

### Conflictos de dedup customers (Q4)

| tipo de conflicto | customers afectados | nota |
|---|---|---|
| name divergente | 849 | mismo `identification` con varios `fullname` |
| email divergente | 212 | mismo `identification` con varios `email` |
| phone divergente | 468 | mismo `identification` con varios `phone` |

**Identifications "placeholder" (datos basura):**

| patrón | unique ids | reservas | acción |
|---|---|---|---|
| Solo ceros (`0`, `00000`, `0000000`...) | 5 | 96 | revisar — son customers ficticios, NO deduplicar |
| Secuencias tipo `1234566`, `1234567`... | 85 | 119 | revisar — alto % son fakes |

Top conflicto: `identification = '0000000'` aparece en 35 reservas con **33 nombres distintos**. Política P2 (latest-wins) va a generar un "customer" basura. Recomendado: filtrar placeholders antes del dedup y crear un único customer "anónimo" para todas las reservas con id basura, o ignorarlos. Detalle en §3 P2.

### Calidad de email (Q10)

| métrica | valor |
|---|---|
| Total reservas | 12,967 |
| Email vacío o NULL | **0** |
| Email malformado (sin `@` o sin `.`) | **0** |
| Email plausiblemente válido | 12,967 (100%) |

**Q-Producto-6 NO APLICA**: no hay emails sintéticos necesarios. Política P9 (fallback `<id>@legacy.invalid`) queda como salvaguarda no usada.

### Outliers de precios (Q11)

| campo | max real | overflow numeric(12,2)? |
|---|---|---|
| total_price | 12,976,117 | no |
| total_price_to_pay | **816,999,989** ⚠️ | no |
| total_price_localiza | 13,057,300 | no |
| coverage_price | 29,000,000 | no |
| return_fee | 727,200 | no |
| tax_fee | 19,786,100 | no |
| iva_fee | 41,352,940 | no |

**Outlier ID 7721**: `total_price_to_pay = 816,999,989` (~$817M COP, status Cancelado). Probable error de captura del operador (dígito de más); el `total_price` cuadra a $8.4M. Se migra tal cual; no requiere intervención del audit.

### Distribución implícita de `booking_type` (P5)

| booking_type derivado | regla | reservas | % |
|---|---|---|---|
| `standard` | monthly_mileage IS NULL AND total_insurance = 0 | 11,624 | 89.64% |
| `standard_with_insurance` | monthly_mileage IS NULL AND total_insurance = 1 | 1,218 | 9.39% |
| `monthly` | monthly_mileage IS NOT NULL | 125 | 0.96% |

**Q-Producto-3 RESUELTO**: `total_insurance = 1` define `standard_with_insurance`, sin solapamiento con `coverage_price > 0`. Regla P5 funciona 100%.

`monthly_mileage` valores legacy: 73× `2k_kms`, 38× `1k_kms`, 14× `3k_kms`. Mapeo P1 directo a `[1000, 2000, 3000]`.

### Estructura JSON de `log_veh_available_rates_queries` (Q13)

**⚠️ HALLAZGO CRÍTICO — el mapping D4 en §2.5 está desactualizado.**

La estructura real de `request_parameters` (todas las 501 filas del sample son consistentes):

```json
{
  "pickupLocation": "ACVLL",
  "returnLocation": "ACVLL",
  "pickupDateTime": "2026-05-13T16:00:00",
  "returnDateTime": "2026-05-16T08:00:00"
}
```

Solo 4 campos en **camelCase**, datetime unido (ISO 8601). NO contiene `franchise`, `referral_code`, `is_monthly`, `pickup_branch_code`, ni paths con underscore. El mapping E2 §2.5 asumía `snake_case` y campos adicionales que **no existen**.

La estructura real de `processed_data`:
- En 391 de 501 (78%) es un **array de cotizaciones por categoría** con campos: `categoryCode`, `categoryDescription`, `totalAmount`, `estimatedTotalAmount`, `discountAmount`, `taxFeeAmount`, `IVAFeeAmount`, `coverageUnitCharge`, `extraHoursTotalAmount`, `rateQualifier`, `referenceToken`.
- En 110 (22%) es un **objeto error**: `{"error": "<code>", "message": "<msg>"}`. Errores comunes: `out_of_schedule_pickup_hour_error` (70), `inferior_pickup_date` (19), `out_of_schedule_return_hour_error` (18), `same_hour` (3).

**Mapping D4 corregido** (reescrito tras la evidencia):

| destino.search_logs | fuente real | transformación |
|---|---|---|
| `franchise` | **no disponible** en JSON; tampoco en columnas top-level | requiere inferir por otro medio o descartar |
| `pickup_location_code` | `request_parameters->>'$.pickupLocation'` | directo si valida vs `locations.code` destino |
| `return_location_code` | `request_parameters->>'$.returnLocation'` | directo |
| `pickup_date` | substring del `$.pickupDateTime` antes de `T` | parse |
| `pickup_hour` | substring del `$.pickupDateTime` después de `T` | parse |
| `return_date` / `return_hour` | idem para `$.returnDateTime` | parse |
| `is_monthly` | **no disponible** | default `false` |
| `referral_code` | **no disponible** | NULL |
| `available_categories` | `processed_data` si es array | si es error → `'[]'` |
| `total_results` | `JSON_LENGTH(processed_data)` si array | si error → `0` |
| `selected_category_code` | no disponible | NULL |
| `converted_to_reservation` | no disponible | `FALSE` (política P10b) |
| `session_id`, `user_agent` | no disponible | NULL |
| `ip_address` | columna `source_ip` directa | directo |
| `searched_at` | columna `created_at` | directo |

**Limitación crítica**: el destino exige `franchise` NOT NULL en `search_logs`, pero el legacy NO lo registra. La instalación legacy era mono-franchise (Localiza/alquilatucarro). Si producto acepta defaultear a una sola franchise para todo el histórico de search_logs, se migra. Si no, hay que abrir issue de schema para hacer `franchise` nullable. Ver §5 Q10.

### Distribución de `pickupLocation` en log_veh (validar contra destino)

Top 15 códigos del sample (501 filas): `AABOT, ACBED, ACVLL, ACBNN, ACIBG, ACMNZ, AABCR, AAVAL, AAMTR, AABAN, AACTG, AAMDL, ACBEX, AAPEI, AACUC`. Son códigos estandarizados de sucursales Localiza (formato 5 chars). Probable match directo con `locations.code` del destino — validar en pre-flight check.

### Operador `user` (Q16, política P12)

| métrica | valor |
|---|---|
| Reservas con operador asignado | 2,353 (18.15%) |
| Reservas sin operador (NULL o '') | 10,614 (81.85%) |
| Operadores distintos | 6 (3 reales + 3 outliers) |

Top operadores (nombres anonimizados): op_A (1,244), op_B (910), op_C (181), op_D (16). Probable que op_D sea typo de op_C (mismo operador, two distintos en el dump). **Q8 sigue abierto**: con 81% sin operador, preservar a `nota` (opción B) tiene bajo valor; descartar (opción A) es más limpio.

### Timezone

| | valor |
|---|---|
| TZ del dump | `+00:00` (UTC) — `SET TIME_ZONE='+00:00'` en el dump header |
| TZ del server local | `SYSTEM` (UTC en WSL) |
| TZ destino dashboard | UTC (`timestamptz`) |

Compatible 100%. No requiere conversión.

---

## 2. Mapeo schema-a-schema (E2)

### 2.1 Schemas finales

Los snapshots completos están en el workspace:
- `01-legacy-schema-snapshot.md` — 49 migraciones legacy aplicadas, modelos Eloquent, las 5 mutaciones del enum status.
- `02-destination-schema-snapshot.md` — schema destino con check constraints, FKs, invariantes Zod.

### 2.2 customers — extracción desde `legacy.reservations`

| dest.customers | legacy.reservations | transformación | riesgo |
|---|---|---|---|
| id | (generado) | `gen_random_uuid()` | B |
| first_name | `fullname` | split heurístico — P1 | A |
| last_name | `fullname` | split heurístico — P1 | A |
| identification_type | `identification_type` | mapeo `Cedula Ciudadania→CC`, `Cedula Extranjeria→CE`, `Pasaporte→PP` | B |
| identification_number | `identification` | TRIM. UNIQUE → dedup obligatorio P2 | A |
| phone | `phone` | TRIM, fallback `''` | B |
| email | `email` | TRIM lower, fallback sintético P9 | M |
| notes | (n/a) | `''` | B |
| status | (n/a) | `'active'` | B |
| created_at | `MIN(created_at)` agrupado | preserva primera aparición | M |
| updated_at | `MAX(updated_at)` agrupado | preserva último contacto | M |

### 2.3 reservations — mapeo completo

El mapeo de las 45 columnas vive en `03-mapping.md`. Lo que importa aquí son los puntos calientes:

- `customer_id` se resuelve por el lookup `(identification_type, identification) → customer.id` que se construye al migrar customers.
- `rental_company_id` no existe en legacy y el destino lo exige NOT NULL. P6 lo resuelve por mapeo desde franchise.
- `pickup_location_id` y `return_location_id` son NOT NULL en destino y NULLABLE en legacy (desde la migración del 24 de mayo de 2024). Las filas con NULL violan. P7.
- `category_code` mismo problema. P8.
- `franchise` se resuelve por lookup en cadena: `franchises.id → franchises.name → enum {alquilatucarro, alquilame, alquicarros}`.
- `booking_type` no tiene fuente. Se deriva con la regla de P5.
- `status` mapea limpio con `lower(replace(value, ' ', '_'))` para los 13 valores nuevos. El único problemático es `Terminado` (valor inicial sin migración).

### 2.4 reservations.status — mapeo 1:1

| legacy | destino |
|---|---|
| Nueva | nueva |
| Pendiente | pendiente |
| Reservado | reservado |
| Sin disponibilidad | sin_disponibilidad |
| Utilizado | utilizado |
| No Contactado | no_contactado |
| Baneado | baneado |
| No recogido | no_recogido |
| Pendiente Pago | pendiente_pago |
| Pendiente Modificar | pendiente_modificar |
| Cancelado | cancelado |
| Indeterminado | indeterminado |
| Mensualidad | mensualidad |
| **Terminado (legado)** | **decisión producto — ver P4** |

### 2.5 search_logs — parsing JSON

| dest.search_logs | legacy.log_veh_available_rates_queries | transformación | riesgo |
|---|---|---|---|
| franchise | `request_parameters->>'franchise'` | parse + validar enum | A |
| pickup_location_code | `request_parameters->>'pickup_branch_code'` | parse + validar | A |
| return_location_code | `request_parameters->>'return_branch_code'` | parse + validar | A |
| pickup_date / hour | `request_parameters->>'pickup_date/hour'` | parse a date / time | M |
| return_date / hour | `request_parameters->>'return_date/hour'` | parse | M |
| is_monthly | `request_parameters->>'is_monthly'` o derivado | boolean | M |
| referral_code | `request_parameters->>'referral_code'` | nullable | M |
| available_categories | `processed_data->'available_categories'` | jsonb directo si estructura coincide | A |
| total_results | `jsonb_array_length(available_categories)` | derivable | M |
| selected_category_code | (n/a) | NULL | B |
| converted_to_reservation | (derivar o FALSE) | política P10b | A |
| session_id | (n/a) | NULL | B |
| user_agent | (n/a) | NULL | B |
| ip_address | `source_ip` | directo | B |
| searched_at | `created_at` | directo | B |

Paths JSON exactos a verificar contra muestra Q13 del dump.

### 2.6 Lookups BIGINT → UUID

| legacy | destino | natural key |
|---|---|---|
| `branches.id` BIGINT | `locations.id` UUID | `branches.code` → `(rental_company_id, locations.code)` |
| `categories.id` BIGINT | (no FK; columna `category_code` TEXT) | `categories.identification` → `vehicle_categories.code` |
| `franchises.id` BIGINT | enum text en `reservations.franchise` | `franchises.name` → mapping manual |
| (no existe) | `rental_companies.id` UUID | lookup por franchise — P6 |

### 2.7 Campos legacy descartados

| legacy column | razón |
|---|---|
| `reservations.user` | sin equivalente destino — opcional volcar a `nota` P12 |
| `reservations.flight` (boolean) | redundante con `aeroline IS NOT NULL` — P13 |

### 2.8 Campos destino sin fuente legacy

| destino | default |
|---|---|
| `customers.notes` | `''` |
| `customers.status` | `'active'` |
| `reservations.referral_id` / `referral_raw` | NULL |
| `reservations.reference_token` / `rate_qualifier` | NULL |
| `reservations.notification_*` | `false` / NULL |
| `reservations.created_by` | NULL |

---

## 3. Plan de transformaciones (E3)

Trece políticas. La justificación de cada una está en `04-policies.md`; aquí va el resumen.

| ID | tema | recomendación | pregunta abierta |
|---|---|---|---|
| P1 | split fullname → first_name + last_name | regla 1/2/3/4+ tokens, stopwords `de/la/del` agrupados con apellido siguiente | sí — caso 1 token |
| P2 | dedup customers por `(identification_type, identification)` | latest-wins por `updated_at DESC` + log conflictos | no |
| P3 | mapeo identification_type | directo CC/CE/PP | no |
| P4 | mapeo reservations.status | snake_case automático; `Terminado` → `utilizado` (provisional) | sí — confirmar disposición Terminado |
| P5 | derivar booking_type | `monthly_mileage IS NOT NULL → monthly`; else `total_insurance ? standard_with_insurance : standard` | sí — confirmar definición |
| P6 | rental_company_id | mapeo 1:1 franchise → `'localiza'` | sí — confirmar todas franchises usan Localiza |
| P7 | location_id NULL en legacy | rechazar filas si <5%; cambio schema si ≥5% | sí — umbral aceptable de pérdida |
| P8 | category_code NULL en legacy | rechazar filas idem P7 | sí — mismo umbral |
| P9 | email faltante o inválido | sintético `<id>@legacy.invalid` raw SQL (bypass Zod) | sí — marcar en `notes` para soporte |
| P10 | search_logs JSON parsing | descarte silencioso si campos NOT NULL faltan | no |
| P10b | converted_to_reservation legacy | `FALSE` por defecto; issue separada si producto pide rastreo retroactivo | sí — ¿necesario? |
| P11 | conversión tipos numéricos | `ROUND(value, 2)` para float → numeric(12,2) | no |
| P12 | campo `user` (operador legado) | volcar a `nota` con prefijo `[OP: <user>]` | sí — ¿descartar o preservar? |
| P13 | campo `flight` boolean | descartar (redundante) | no |

### Tabla de riesgos consolidada

| riesgo | categoría | mitigación |
|---|---|---|
| Heurística fullname split | A — afecta TODAS las filas | P1 + log de casos `needs_review` |
| Dedup customers con datos divergentes | A | P2 + log de conflictos |
| `rental_company_id` ausente legacy | A | P6 (confirmar producto) |
| `pickup_location_id` NULL | A | P7 (umbral E1) |
| `category_code` NULL | A | P8 (umbral E1) |
| `status = 'Terminado'` legado | M-A | P4 (confirmar producto) |
| `booking_type` derivado | M | P5 (confirmar producto) |
| `search_logs` JSON parsing | A | P10 (descarte silencioso) |
| Email inválido viola Zod | M | P9 (bypass Zod, sintético) |
| Lookup fallido category/branch/franchise | A | pre-flight check antes de migrar (E4 paso 1) |

---

## 4. Plan de ejecución y verificación (E4)

Plan operativo completo en `05-execution-plan.md`.

### 4.1 Por qué Python y no las otras opciones

Tres caminos posibles: script Python con `pymysql` + `psycopg2` + `COPY`, comando artisan de Laravel escribiendo por REST, o `postgres_fdw` con dos Postgres puenteados.

Python gana porque las transformaciones que duelen — split de fullname, parsing del JSON de search_logs, lookup de FKs — son naturalmente procedurales. En SQL puro se hacen mal y en REST por fila el throughput se cae a 50-200 ops/seg cuando `COPY` saca miles. Además, el ETL queda desacoplado del runtime Laravel del legacy, que es lo que queremos.

### 4.2 Orden de ejecución

1. **Pre-flight checks** (read-only):
   - `rental_companies.code = 'localiza'` existe.
   - Lookup completo `franchises.name → enum destino`.
   - Lookup completo `branches.code → locations.code`.
   - Lookup completo `categories.identification → vehicle_categories.code`.
   - Abort si cualquier lookup tiene gaps no autorizados.
2. Migrar **customers** (extracción + dedup + insert) y construir mapa `identification → customer_uuid`.
3. Construir resto de mapas en memoria.
4. Migrar **reservations** con FKs resueltos.
5. Migrar **search_logs** con descarte controlado.
6. Generar reporte JSONL.

### 4.3 Dry-run en branch Supabase

- Crear branch `migration-dry-run`, aplicar migraciones, correr ETL contra muestra (100 primeras + 100 últimas + 100 random).
- Validaciones: 0 errores de constraint, ≤2% filas rechazadas, todos los lookups con cobertura 100%.
- Gap report en YAML con counts por entidad y razón de rechazo.

### 4.4 Rollback

Agregar una columna temporal `_legacy_migrated_at timestamptz` en `customers`, `reservations` y `search_logs`. El ETL la setea con `now()` en cada INSERT. Si algo sale mal, el rollback es `DELETE WHERE _legacy_migrated_at IS NOT NULL` y dropear la columna.

¿Por qué así y no un `pg_dump` previo? Porque la producción no se va a congelar durante la migración — alquilatucarro, alquilame y alquicarros siguen recibiendo bookings. El marcador deja borrar solo lo migrado, sin tocar lo nuevo.

### 4.5 Métricas de éxito

| métrica | umbral propuesto |
|---|---|
| `inserted / total` reservations | ≥ 95% |
| `inserted / total` customers | ≥ 99% — pérdida crítica |
| `inserted / total` search_logs | ≥ 60% — pérdida aceptable |
| constraint violations no anticipadas | 0 |

Reporte post-migración en `docs/migration-runs/<timestamp>.md` con IDs rechazados, conflictos resueltos, emails sintéticos, lookups fallidos.

### 4.6 Consideraciones operacionales

- **Concurrencia**: correr en ventana de bajo tráfico o read-only. Upsert con preferencia al existente para evitar colisiones con bookings nuevos.
- **Trigger `updated_at`**: verificar en branch que no sobrescribe en INSERT.
- **Timezone**: confirmar en E1 (Q14). Convertir a UTC si legacy es local.
- **Service role key**: usa `SUPABASE_SERVICE_ROLE_KEY` existente. RLS bypaseada.
- **Idempotencia**: chequear `_legacy_migrated_at` antes de insertar; omitir si ya existe.

---

## 5. Preguntas abiertas para producto

Tras E1, 5 de las 8 originales se cerraron por evidencia. Quedan 5 pendientes (incluyendo 2 nuevas que surgieron del análisis).

### Cerradas por E1

| ID | tema | resolución |
|---|---|---|
| ~~Q2~~ | `status = 'Terminado'` | **0 filas** en el dump. No requiere mapeo. |
| ~~Q3~~ | definición de `booking_type` | **regla `total_insurance = 1`** confirmada (1,218 reservas calzan). Q12b: regla derivada cubre 100% de las filas. |
| ~~Q4~~ | rental_company_id | **todas las franchises legacy son Localiza** (alquilame 58.5% + alquicarros 20.8% + alquilatucarro 20.7% = 100%). Mapeo 1:1 directo. |
| ~~Q5~~ | umbral location NULL | **2.74% < 5%** → opción A (rechazar 355 reservas). |
| ~~Q6~~ | email sintético | **100% emails válidos** — no aplica. Política P9 queda como salvaguarda no usada. |

### Q1 — Nombres con un solo token (`fullname = 'MARIA'`)

El destino exige `last_name` NOT NULL.

- A — meter `'-'` como placeholder y dejarlos marcados para revisión.
- B — rechazar la fila entera.

Recomiendo A. Perder al cliente por no tener apellido es peor que un placeholder visible. Conteo exacto requiere análisis del split heurístico — bajo riesgo, alta cobertura.

### Q7 — `converted_to_reservation` para logs históricos

E1 descubrió un blocker técnico: el JSON legacy de `request_parameters` **no incluye datos del cliente** — solo `pickupLocation`, `returnLocation`, `pickupDateTime`, `returnDateTime`. El plan original era cruzar por `(identification, pickup_date)`, pero la `identification` no está en el log.

- A — `FALSE` para todo el histórico de log_veh (decisión técnica forzada).
- B — descartar la migración de log_veh entera y empezar `search_logs` desde el día 1 del dashboard nuevo.

Recomiendo A si el sample sirve para auditar la estructura JSON (que sí cubre D4). Si producto no quiere logs históricos con dato falso, B.

### Q8 — Campo `user` (operador legado)

E1: **81.85% de reservas sin operador** (10,614 de 12,967). Solo 3 operadores reales registrados con 1,244 / 910 / 181 reservas respectivamente, más un cuarto con 16 (probable typo del tercero).

- A — descartar el dato.
- B — volcarlo a `nota` con prefijo `[OP: <user>]` para preservar los 2,353 que sí lo tienen.

Con tan baja cobertura, A es más limpio. B solo si soporte consulta auditorías legacy.

### Q9 (nueva) — Códigos de categoría legacy fuera del set destino

E1 detectó **6 códigos legacy que NO existen en `vehicle_categories.code` del destino**:

| code legacy | reservas | nombre |
|---|---|---|
| GR | 312 | Gama GR |
| VP | 62 | Gama VP |
| G | 14 | Gama G |
| LP | 2 | Gama LP |

Total: **390 reservas (3.0%) con código sin equivalente en destino.**

Opciones:

- A — agregar los 4 códigos a `vehicle_categories` del destino (migración Supabase nueva). Preserva fidelidad histórica.
- B — mapear cada uno a su equivalente más cercano. Requiere conocimiento de dominio (¿GR ≈ G4? ¿VP ≈ LE?). Pérdida de detalle.
- C — rechazar esas 390 reservas. Pérdida del 3.0%.

Recomiendo A. Las gamas posiblemente correspondan a modelos discontinuados; agregarlas con `inactive=true` mantiene la historia sin contaminar las búsquedas activas.

### Q10 (nueva) — `search_logs.franchise` ausente en legacy

El destino exige `search_logs.franchise` NOT NULL. El JSON legacy no incluye el campo — la API se llama desde un endpoint mono-franchise.

- A — defaultear el histórico a `alquilatucarro`. Preservable pero impreciso.
- B — hacer `search_logs.franchise` nullable en destino (migración schema). Semánticamente honesto.
- C — descartar el histórico de log_veh; migrar `search_logs` solo desde el día 1 del dashboard nuevo.

Recomiendo B. `search_logs` es analítica y nullable es honesto.

### Q11 (nueva) — Customers placeholder (identifications basura)

E1 detectó **96 reservas con `identification` todo ceros** (5 unique ids como `0`, `00000`, `0000000`) y **119 con secuencias tipo `1234566`** son customers ficticios. El top conflicto (`identification = '0000000'`) tiene 35 reservas con 33 nombres distintos — política P2 (latest-wins) crea un "customer Frankenstein".

- A — filtrar identifications "obvias" (regex `^0+$`, `^123\d{4,}$`) y crear customers separados por reserva, marcados como `notes = 'cliente sin identificación'`. 215 customers únicos en lugar de 5 + 85.
- B — crear UN customer canónico "anónimo" por franchise. 3 customers anónimos para 215 reservas.
- C — política latest-wins original. Acepta los Frankensteins con notes de advertencia.

Recomiendo A. Preserva la trazabilidad por reserva y permite a soporte limpiar después.

---

## 6. Issues de seguimiento sugeridas

Cuando las preguntas abiertas se resuelvan, las issues ejecutivas que conviene abrir son:

| issue | scope |
|---|---|
| #N1 — Pre-flight checks de lookup | script Python que valida `franchises.name → enum`, `branches.code → locations.code`, `categories.identification → vehicle_categories.code`. Bloquea ETL si gaps no autorizados. |
| #N2 — Migración Supabase: agregar categorías GR/VP/G/LP | nueva migración SQL en `supabase/migrations/` agregando los 4 códigos faltantes a `vehicle_categories` con flag inactive=true. Bloquea ETL si Q9 = opción A. |
| #N3 — Migración Supabase: `search_logs.franchise` nullable | nueva migración SQL para hacer la columna nullable. Bloquea ETL de log_veh si Q10 = opción B. |
| #N4 — ETL customers (extract + dedup + insert) | script Python con políticas P1–P3, P9, Q11 (placeholder handling). Log de conflictos. |
| #N5 — ETL reservations | depende de #N4. Resolución FKs + políticas P4–P8, P11–P13. Rechazar las 355 reservas con location NULL + las 390 con category fuera de set (si Q9 != A). |
| #N6 — ETL search_logs (muestra) | parser JSON con D4 corregido (camelCase). Solo migra `request_parameters` parseables. Default `converted_to_reservation = false`. |
| #N7 — Dry-run + reporte | corre #N1, #N4, #N5, #N6 contra branch Supabase. Acceptance: ≤2% rechazo en customers/reservations, 0 constraint violations. |
| #N8 — Migración productiva con marcador | corre el ETL contra prod con columna `_legacy_migrated_at`. Reporte detallado. |
| #N9 — Cleanup post-migración | drop columna marcador, archivar logs de migración. |

---

## 7. Referencias

- Repo legacy: `/home/pabloandi/proyectos/rentacar/rentacar-admin` (Laravel/PHP, 49 migraciones)
- Workspace evidencia: `docs/audit-workspace/01-06-*.md`
- Schemas destino: `supabase/migrations/007_customers.sql`, `008_reservations.sql`, `009_search_logs.sql`, y mutaciones posteriores
- Zod schemas: `lib/schemas/reservation.ts`, `lib/schemas/customer.ts`
- Memoria operacional: `critical_env_vars_dashboard.md` (claves Supabase service role)
