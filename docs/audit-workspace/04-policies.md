# E3 — Políticas de transformación

Cada política presenta: opciones consideradas, recomendación y motivo. Cuando hay tradeoff con producto, se marca explícitamente y se replica como pregunta abierta en sección 5 del documento final.

---

## P1 — Split `fullname` → `first_name` + `last_name`

### Opciones
| # | regla | ejemplo: "Juan Carlos Pérez Gómez" | costo |
|---|---|---|---|
| A | primer token = first_name, resto = last_name | first_name="Juan", last_name="Carlos Pérez Gómez" | bajo, naïve |
| B | último token = last_name, resto = first_name | first_name="Juan Carlos Pérez", last_name="Gómez" | bajo, sesga apellidos compuestos |
| C | si 2 tokens → 1-1; si 3 → 1-2; si 4+ → 2-2 (dos nombres + dos apellidos) | first_name="Juan Carlos", last_name="Pérez Gómez" | medio, refleja convención colombiana |
| D | usar columna única `full_name` en destino — requiere migración de schema | (no aplicable) | alto, fuera de scope |

### Recomendación: **C**, con fallback explícito.

Reglas detalladas (E3.1):
- 1 token → `first_name=token`, `last_name=''` → **A revisar**: viola NOT NULL si destino requiere `last_name`. Workaround: `last_name='_'` placeholder, marcar como `needs_review`.
- 2 tokens → `first_name=t[0]`, `last_name=t[1]`.
- 3 tokens → `first_name=t[0]`, `last_name=t[1]+' '+t[2]`.
- 4+ tokens → `first_name=t[0]+' '+t[1]`, `last_name=t[2:]`.

Caso especial: tokens incluyen "de", "del", "la" → concatenar con el siguiente (apellido compuesto, ej. "de la Cruz"). Documentar en script ETL con lista canónica de stopwords.

### Pregunta abierta
- Política para fullname con 1 token (e.g. "MARIA"). ¿`last_name='-'` o rechazar fila?

---

## P2 — Dedup customers por `(identification_type, identification)`

### Conflicto base
Mismo `identification` aparece en N reservas con valores distintos de `fullname`, `email`, `phone`.

### Opciones
| # | regla | impacto |
|---|---|---|
| A | latest-wins por `updated_at DESC` | conserva el contacto más reciente; pierde historial |
| B | first-wins por `created_at ASC` | conserva el registro original; ignora actualizaciones |
| C | merge: el más reciente que NO sea NULL/empty por campo | combina, pero ordenar es subjetivo |
| D | fail-on-conflict | aborta la migración; obliga limpieza manual |

### Recomendación: **A (latest-wins)** + log de conflictos.

Razón: en CRM de rentacar el contacto del último booking es operacionalmente útil. Loggear conflictos en `migration_log` (tabla temporal o archivo) para auditoría posterior.

Implementación SQL conceptual:
```sql
WITH distinct_customers AS (
  SELECT DISTINCT ON (identification_type, identification)
    identification_type, identification, fullname, email, phone,
    created_at, updated_at
  FROM legacy.reservations
  ORDER BY identification_type, identification, updated_at DESC
)
INSERT INTO customers (...) SELECT ... FROM distinct_customers;
```

---

## P3 — Mapeo `identification_type`

| legacy | destino | confianza |
|---|---|---|
| `Cedula Ciudadania` | `CC` | alta |
| `Cedula Extranjeria` | `CE` | alta |
| `Pasaporte` | `PP` | alta |
| (no existe) | `NIT` | n/a |
| (no existe) | `TI` | n/a |

**Recomendación:** mapping directo. Validar en E1 que no hay valores fuera de los 3 esperados (e.g. minúsculas, typos).

---

## P4 — Mapeo `reservations.status`

Regla canónica: `lower(replace(legacy_status, ' ', '_'))`. Cubre 13/13 valores actuales.

### Caso `Terminado` (legado pre-2024-09-24)

Las 4 migraciones de status (Sept-Oct 2024) **no incluyen** una regla de conversión para `Terminado`. Si E1 detecta filas con este valor (filas viejas no actualizadas), hay 3 opciones:

| # | mapeo | razón |
|---|---|---|
| A | `Terminado → utilizado` | semánticamente "terminado" ≈ "utilizado" (reserva completada) |
| B | `Terminado → indeterminado` | catch-all sin asumir |
| C | rechazar fila | aborta migración, requiere intervención |

### Recomendación: **A (utilizado)** si E1 confirma volumen bajo (<1% de reservations). Pasar a B si el volumen es alto y producto no quiere asunciones.

### Pregunta abierta
- ¿Cuál es la disposición de `Terminado` legado? (depende del count en E1)

---

## P5 — Derivar `booking_type`

Legacy no tiene este campo. Las 3 opciones destino se derivan:

| destino | regla derivación |
|---|---|
| `monthly` | `monthly_mileage IS NOT NULL` |
| `standard_with_insurance` | `monthly_mileage IS NULL AND total_insurance = true` |
| `standard` | `monthly_mileage IS NULL AND total_insurance = false` |

### Recomendación
Aplicar la regla anterior. Validar contra producto que **"standard_with_insurance" se determina por `total_insurance=true`** y no por otro indicador (ej. monto >0 de cobertura).

### Pregunta abierta
- ¿La distinción entre `standard` y `standard_with_insurance` es por el boolean `total_insurance`, o por `coverage_price > 0`?

---

## P6 — Resolución `rental_company_id` (campo NOT NULL ausente en legacy)

### Opciones
| # | regla | impacto |
|---|---|---|
| A | 1 franchise → 1 rental_company por mapeo manual (lookup table) | requiere decisión producto; cierra el gap definitivamente |
| B | usar el `rental_companies.code` "Localiza" para todo el legacy | asume que toda la historia es Localiza |
| C | crear una nueva `rental_company` "Legacy" y vincular todo ahí | preserva la procedencia explícita pero pollutes lookup |

### Recomendación: **A**, con tabla manual:
```
alquilatucarro → localiza
alquilame → localiza
alquicarros → localiza
```
(Sujeto a verificación: ¿existen registros legacy de otra rental_company?)

### Pregunta abierta
- Confirmar que **todas** las franquicias legacy operan con `rental_companies.code = 'localiza'`. Si no, requiere lookup adicional.

---

## P7 — `pickup_location_id` / `return_location_id` NULL en legacy

Migration `2024_05_24_171027` hizo nullable estos FKs en legacy. Destino los exige NOT NULL.

### Opciones
| # | regla | impacto |
|---|---|---|
| A | rechazar filas con NULL location | pérdida de filas; reportar count |
| B | imputar `location_id` por inferencia (ej. la ciudad de la categoría o reservation_code prefix) | costoso, error-prone |
| C | crear `locations.code = 'unknown'` para cada rental_company y asignar | preserva fila, semántica pobre |
| D | hacer location nullable en destino (cambio schema) | fuera de scope; requiere nueva issue |

### Recomendación: **A (rechazar)** si el count en E1 es <5%; **D (cambio schema)** si es ≥5%. Decisión final requiere E1.

### Pregunta abierta
- ¿Pérdida aceptable de N% de reservaciones con location NULL?

---

## P8 — `category_code` NULL en legacy

Similar a P7. Migration `2024_05_24_171027` lo hizo nullable. Destino requiere NOT NULL.

### Opciones
| # | regla |
|---|---|
| A | rechazar filas con NULL category |
| B | imputar `category_code = 'X'` (categoría placeholder) |
| C | hacer nullable en destino |

### Recomendación: **A (rechazar)** pendiente de validación E1. Misma lógica que P7.

---

## P9 — Política de `customers.email` faltante o inválido

Legacy `email` es NOT NULL en MySQL, pero quality varies (strings vacíos, "no@email.com", etc.). Destino:
- DB: NOT NULL, sin default explícito (rechaza '').
- Zod (`lib/schemas/customer.ts`): `.email()` format → rechaza vacíos y malformados.

### Opciones
| # | regla |
|---|---|
| A | bypassar Zod y escribir `email = COALESCE(email, identification || '@legacy.invalid')` raw SQL | preserva todas las filas; emails sintéticos auditables |
| B | rechazar customer con email inválido | pérdida de customers + cascadeo a sus reservations |
| C | importar como `email = ''` | viola Zod pero no DB; quedará invisible al UI |

### Recomendación: **A**, bypass Zod via SQL directo (la migración no pasa por server actions, ver E4). Email sintético `<identification>@legacy.invalid` permite distinguir y limpiar después.

### Pregunta abierta
- ¿Marcar customers con email sintético en `customers.notes` para que el equipo de soporte los identifique?

---

## P10 — search_logs JSON parsing

### Estrategia
Para cada fila legacy:
1. Parsear `request_parameters` (JSON).
2. Si todos los campos NOT NULL del destino existen y son válidos → insertar.
3. Si falta alguno → loggear y descartar.

Campos NOT NULL destino: `franchise`, `pickup_location_code`, `return_location_code`, `pickup_date`, `pickup_hour`, `return_date`, `return_hour`, `is_monthly`, `available_categories`, `total_results`, `converted_to_reservation`, `searched_at`.

### Recomendación: descarte silencioso con métricas.

Pérdida aceptable. `search_logs` es analítica futura, no estado operativo. Loggear: count migrados / descartados con razón (e.g. "missing pickup_date").

### `converted_to_reservation`: política

| # | regla |
|---|---|
| A | `FALSE` para todos los legacy | conservador; conversion histórica perdida |
| B | derivar por join con `reservations` por `(identification, pickup_date)` ± 24h | preciso pero costoso y propenso a falsos positivos |
| C | `NULL` (requiere cambio schema) | fuera de scope |

### Recomendación: **A**. Abrir issue separada para B si producto necesita la métrica retroactiva.

---

## P11 — Conversión de tipos numéricos

- Legacy `float` → destino `numeric(12,2)`. Usar `ROUND(value, 2)` para evitar errores de coma flotante.
- Legacy `unsigned int` → destino `numeric(12,2)`. Cast directo + ROUND.
- Validar que ningún valor supera el rango `numeric(12,2)` (máx 9,999,999,999.99). Loggear los que sí.

### Recomendación
Si E1 reporta valores > 9.999.999,99 (raro en COP para reservas), abrir issue para ampliar precisión destino. De lo contrario, ROUND y proceder.

---

## P12 — Campo `user` (operador legado)

Legacy guarda nombre del operador como string libre en `reservations.user`. Destino tiene `created_by uuid → profiles(id)` que requiere un profile real con auth.

### Opciones
| # | regla |
|---|---|
| A | descartar el dato | información histórica perdida |
| B | volcar a `nota` con prefijo `[OP: <user>]` | preserva auditoría sin requerir profile real |
| C | crear profile sintético "legacy-operator" y enlazarlo en `created_by` | preserva enlace, requiere user auth dummy |

### Recomendación: **B** si producto valora la auditoría; **A** si no se usa.

---

## P13 — Campo `flight` (boolean legacy)

Destino no tiene columna `flight`. Si `flight = true`, indica que el cliente viajó en avión.

### Opciones
| # | regla |
|---|---|
| A | descartar | el dato ya queda implícito en `aeroline IS NOT NULL` |
| B | volcar a `nota` |
| C | agregar columna `flight boolean` al destino |

### Recomendación: **A**. La presencia de `aeroline` o `flight_number` ya implica vuelo; redundante.

---

## Tabla resumen de políticas

| ID | tema | recomendación | pregunta abierta? |
|---|---|---|---|
| P1 | split fullname | regla 1/2/3/4+ tokens | sí (1 token) |
| P2 | dedup customers | latest-wins | no |
| P3 | mapeo identification_type | directo (CC/CE/PP) | no |
| P4 | mapeo status | snake_case + Terminado→utilizado | sí (Terminado) |
| P5 | derivar booking_type | regla monthly_mileage + total_insurance | sí (definición) |
| P6 | rental_company_id | lookup por franchise → 'localiza' | sí (confirmar) |
| P7 | pickup/return_location NULL | rechazar filas (pendiente E1) | sí (umbral) |
| P8 | category_code NULL | rechazar filas (pendiente E1) | sí (umbral) |
| P9 | email faltante | sintético `<id>@legacy.invalid` raw SQL | sí (marca soporte) |
| P10 | search_logs JSON | descartar incompleto | no |
| P10b | converted_to_reservation | FALSE | sí (si producto pide) |
| P11 | tipos numéricos | ROUND(value, 2) | no |
| P12 | `user` operador | volcar a nota o descartar | sí |
| P13 | `flight` boolean | descartar | no |
