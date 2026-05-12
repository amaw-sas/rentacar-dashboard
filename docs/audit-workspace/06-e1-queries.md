# E1 — Inventario de volumen (queries listas para el dump MySQL)

**Estado:** BLOQUEANTE — pendiente del dump SQL del legacy.

Cuando el dump esté disponible, cargar en MySQL/MariaDB local y ejecutar las queries siguientes. Pegar los resultados en la sección 1 del documento `migration-data-legacy-audit.md`.

---

## Setup

```bash
# generar dump (a ejecutar por el operador con acceso prod)
mysqldump -h <host> -u <user> -p \
  --single-transaction \
  --quick \
  --no-tablespaces \
  --databases rentacar_admin \
  > rentacar-admin-prod-$(date +%Y%m%d).sql

# cargar local
mysql -u root -p rentacar_admin_audit < rentacar-admin-prod-*.sql

# conectar
mysql -u root -p rentacar_admin_audit
```

---

## Q1 — Volumen total por entidad

```sql
SELECT 'reservations' AS entity, COUNT(*) AS rows FROM reservations
UNION ALL
SELECT 'log_veh_available_rates_queries', COUNT(*) FROM log_veh_available_rates_queries
UNION ALL
SELECT 'branches', COUNT(*) FROM branches
UNION ALL
SELECT 'categories', COUNT(*) FROM categories
UNION ALL
SELECT 'franchises', COUNT(*) FROM franchises;
```

## Q2 — Rango temporal

```sql
SELECT
  MIN(created_at) AS first_reservation,
  MAX(created_at) AS last_reservation,
  TIMESTAMPDIFF(DAY, MIN(created_at), MAX(created_at)) AS span_days
FROM reservations;

SELECT
  MIN(created_at) AS first_log,
  MAX(created_at) AS last_log,
  TIMESTAMPDIFF(DAY, MIN(created_at), MAX(created_at)) AS span_days
FROM log_veh_available_rates_queries;
```

## Q3 — Customers únicos estimados

```sql
-- Por (identification_type, identification)
SELECT COUNT(DISTINCT identification_type, identification) AS unique_customers
FROM reservations;

-- Distribución por identification_type
SELECT identification_type, COUNT(*) AS rows, COUNT(DISTINCT identification) AS unique_ids
FROM reservations
GROUP BY identification_type;
```

## Q4 — Conflictos potenciales de dedup

```sql
-- Identifications con múltiples fullname/email/phone distintos (latest-wins resolverá)
SELECT identification,
       COUNT(DISTINCT fullname) AS distinct_names,
       COUNT(DISTINCT email) AS distinct_emails,
       COUNT(DISTINCT phone) AS distinct_phones,
       COUNT(*) AS total_reservations
FROM reservations
GROUP BY identification
HAVING distinct_names > 1 OR distinct_emails > 1 OR distinct_phones > 1
ORDER BY total_reservations DESC
LIMIT 50;
```

## Q5 — Distribución de status (incluyendo posibles `Terminado` huérfanos)

```sql
SELECT status, COUNT(*) AS rows,
       MIN(created_at) AS first_seen,
       MAX(updated_at) AS last_updated
FROM reservations
GROUP BY status
ORDER BY rows DESC;
```

⚠ Buscar específicamente `'Terminado'` — si aparece, **P4 requiere decisión producto**.

## Q6 — FKs huérfanas o NULL

```sql
-- Reservations con location NULL (P7)
SELECT
  COUNT(*) AS rows_total,
  SUM(pickup_location IS NULL) AS null_pickup,
  SUM(return_location IS NULL) AS null_return,
  SUM(category IS NULL) AS null_category,
  SUM(franchise IS NULL) AS null_franchise
FROM reservations;

-- Reservations con FK a fila inexistente (orfanas)
SELECT 'orphan_pickup' AS issue, COUNT(*) AS n
FROM reservations r LEFT JOIN branches b ON r.pickup_location = b.id
WHERE r.pickup_location IS NOT NULL AND b.id IS NULL
UNION ALL
SELECT 'orphan_return', COUNT(*)
FROM reservations r LEFT JOIN branches b ON r.return_location = b.id
WHERE r.return_location IS NOT NULL AND b.id IS NULL
UNION ALL
SELECT 'orphan_category', COUNT(*)
FROM reservations r LEFT JOIN categories c ON r.category = c.id
WHERE r.category IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'orphan_franchise', COUNT(*)
FROM reservations r LEFT JOIN franchises f ON r.franchise = f.id
WHERE r.franchise IS NOT NULL AND f.id IS NULL;
```

## Q7 — Distribución de franchises (validar mapeo a enum destino)

```sql
SELECT f.name, COUNT(r.id) AS reservations
FROM franchises f
LEFT JOIN reservations r ON r.franchise = f.id
GROUP BY f.id, f.name
ORDER BY reservations DESC;
```

Esperado: 3 valores exactamente. Si aparecen más o nombres distintos a `alquilatucarro|alquilame|alquicarros`, **P6 requiere atención**.

## Q8 — Distribución de categories codes (validar mapping a vehicle_categories)

```sql
SELECT identification, name, COUNT(r.id) AS reservations
FROM categories c
LEFT JOIN reservations r ON r.category = c.id
GROUP BY c.id, c.identification, c.name
ORDER BY reservations DESC;
```

Esperado: códigos en el set permitido `['C','CX','F','FX','GC','G4','LE','GY','FU','FL','GL']`. Cualquier código fuera del set → abrir issue para agregar al destino o decidir descarte.

## Q9 — Distribución de identification_type (validar mapeo P3)

```sql
SELECT identification_type, COUNT(*) AS rows
FROM reservations
GROUP BY identification_type;
```

Esperado: exactamente 3 valores (`Cedula Ciudadania`, `Cedula Extranjeria`, `Pasaporte`). Cualquier otro valor → política producto.

## Q10 — Calidad de email

```sql
SELECT
  COUNT(*) AS total,
  SUM(email = '' OR email IS NULL) AS empty,
  SUM(email NOT LIKE '%@%.%') AS malformed,
  SUM(email LIKE '%@%.%') AS plausibly_valid
FROM reservations;
```

## Q11 — Overflow en precios

```sql
SELECT
  'total_price' AS field,
  MAX(total_price) AS max,
  SUM(total_price > 9999999.99) AS overflow_numeric_12_2
FROM reservations
UNION ALL
SELECT 'total_price_to_pay', MAX(total_price_to_pay), SUM(total_price_to_pay > 9999999.99) FROM reservations
UNION ALL
SELECT 'total_price_localiza', MAX(total_price_localiza), SUM(total_price_localiza > 9999999.99) FROM reservations;
```

## Q12 — search_logs: cobertura de campos NOT NULL destino

```sql
-- ¿Cuántos logs tienen los campos críticos parseables?
SELECT
  COUNT(*) AS total,
  SUM(JSON_EXTRACT(request_parameters, '$.pickup_date') IS NOT NULL) AS has_pickup_date,
  SUM(JSON_EXTRACT(request_parameters, '$.return_date') IS NOT NULL) AS has_return_date,
  SUM(JSON_EXTRACT(request_parameters, '$.pickup_location') IS NOT NULL) AS has_pickup_loc,
  SUM(JSON_EXTRACT(request_parameters, '$.franchise') IS NOT NULL) AS has_franchise,
  SUM(processed_data IS NOT NULL) AS has_processed
FROM log_veh_available_rates_queries;
```

Nota: los paths JSON exactos dependen de la estructura del legacy — ajustar tras ver muestra.

## Q13 — Muestra de JSON `request_parameters` (5 filas)

```sql
SELECT id, JSON_PRETTY(request_parameters) AS req, JSON_PRETTY(processed_data) AS proc
FROM log_veh_available_rates_queries
ORDER BY created_at DESC
LIMIT 5;
```

Pegar el resultado en la sección de evidencia del documento.

## Q14 — Timezone del servidor MySQL

```sql
SELECT @@global.time_zone, @@session.time_zone, NOW();
```

Confirma si los timestamps están en UTC o local. Afecta P11/E4.

---

## Resultado esperado en el documento final

Sección 1 (Inventario y volumen) — pegar tablas con:

| métrica | valor |
|---|---|
| reservations total | (Q1) |
| log_veh total | (Q1) |
| customers únicos | (Q3) |
| dedup conflicts | (Q4) |
| rows con location NULL | (Q6) |
| rows con category NULL | (Q6) |
| status `Terminado` legacy | (Q5) |
| franchises distintos | (Q7) |
| categories fuera de set | (Q8) |
| identification_types distintos | (Q9) |
| emails vacíos / malformados | (Q10) |
| precios con overflow | (Q11) |
| logs con JSON completo | (Q12) |
| TZ servidor legacy | (Q14) |
