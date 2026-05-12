# E4 — Plan de ejecución y verificación

## Comparativa de estrategias ETL

### Opción A — Script Python + `psycopg2` + `pymysql`

```
mysqldump → .sql file → mysql local
                       ↓
                  Python script
                  · lee MySQL via pymysql
                  · transforma en memoria con políticas E3
                  · escribe Postgres via psycopg2.execute_batch / COPY
```

**Pros:**
- Pleno control sobre lógica de transformación, idempotencia, batching.
- Logs estructurados de filas rechazadas + razón.
- Reusable para staging y producción.
- Aislamiento total del runtime del dashboard.

**Contras:**
- Requiere ambiente Python dedicado.
- Bypassa Zod (esto es ventaja por P9, pero hay que respetar manualmente otras invariants).

### Opción B — Laravel artisan command escribiendo a Supabase REST

```
artisan migrate:supabase
  · Eloquent lee legacy
  · POSTgres con Supabase REST/PostgREST
```

**Pros:**
- Reutiliza modelos legacy existentes.
- Familiar para equipo Laravel.

**Contras:**
- REST por fila → throughput bajo (50-200 ops/seg vs miles con COPY).
- Acopla la migración al runtime Laravel del legacy.
- Bypassa RLS solo con service_role key → hay que cuidar la concurrencia.

### Opción C — `postgres_fdw` + import directo

```
Restaurar dump en MySQL local → migración intermedia a Postgres temporal
                              → postgres_fdw bridge a Supabase
                              → INSERT INTO dest SELECT FROM remote_legacy
```

**Pros:**
- SQL puro, transformaciones declarativas, fácil rollback.
- Sin scripts externos.

**Contras:**
- Setup pesado (FDW, dual Postgres).
- Transformaciones complejas (P1 split fullname, P10 JSON parsing) son incómodas en SQL.

### Recomendación: **A (Python script)**

Razón: las transformaciones D1 (split fullname), D2 (status mapping), D4 (JSON parsing) son procedurales por naturaleza. Python + biblioteca de logging produce evidencia auditable; COPY mantiene throughput.

Stack sugerido:
- `pymysql` para leer legacy.
- `psycopg2-binary` + `COPY` para escribir destino.
- `pandas` opcional para transformaciones tabulares.
- Logs JSONL: `{row_id, table, action: inserted/rejected, reason}`.

---

## Dry-run sobre branch de Supabase

### Setup

1. Crear branch de Supabase (`supabase branches create migration-dry-run`).
2. Aplicar todas las migraciones existentes al branch.
3. Ejecutar el script ETL apuntando al branch.

### Scope del dry-run

- **Muestra:** primeras 100 filas de `legacy.reservations` ordenadas por `created_at ASC` + 100 últimas ordenadas `DESC` + 100 random (300 total).
- **Validaciones ejecutadas:**
  - Todos los lookups (categories.identification → vehicle_categories.code, branches.code → locations.code, franchises.name → franchise enum) resuelven.
  - Ningún CHECK constraint falla.
  - Customers dedup produce el count esperado.
  - 0 errores en `psycopg2`.
- **Gap report** (formato YAML/JSON):
  ```
  legacy_total: 300
  customers_inserted: 247
  customers_conflicts_resolved: 53
  reservations_inserted: 281
  reservations_rejected:
    null_location: 12
    null_category: 5
    status_terminado: 2
  ```

### Criterio de éxito

- 0 errores de constraint.
- ≤2% de filas rechazadas (umbral negociable con producto).
- Todas las lookups con cobertura 100% o gap documentado.

Si el dry-run pasa, repetir contra el 10% de los datos, luego 100%.

---

## Rollback

### Estrategia 1 — Marcador de migración

Agregar columna temporal `_legacy_migrated_at timestamptz` (default NULL) a `customers`, `reservations`, `search_logs`. El script ETL la setea con `now()` en cada INSERT.

Rollback:
```sql
BEGIN;
DELETE FROM reservations WHERE _legacy_migrated_at IS NOT NULL;
DELETE FROM customers WHERE _legacy_migrated_at IS NOT NULL
  AND id NOT IN (SELECT customer_id FROM reservations);
DELETE FROM search_logs WHERE _legacy_migrated_at IS NOT NULL;
COMMIT;

ALTER TABLE customers DROP COLUMN _legacy_migrated_at;
ALTER TABLE reservations DROP COLUMN _legacy_migrated_at;
ALTER TABLE search_logs DROP COLUMN _legacy_migrated_at;
```

### Estrategia 2 — Snapshot pre-migración

`pg_dump` del destino antes de migrar. Rollback = restore del dump. Más simple, pero pierde cualquier escritura que ocurra en paralelo.

### Recomendación: **Estrategia 1 (marcador)**.

Razón: producción no se puede congelar durante la migración (alquilatucarro/alquilame/alquicarros siguen recibiendo bookings). El marcador permite rollback quirúrgico sin afectar datos nuevos.

Variante: si producto exige migración en ventana de mantenimiento (zero traffic), Estrategia 2 es más limpia.

---

## Métricas de éxito y reporting

### Métricas por entidad

```
{
  "entity": "reservations",
  "legacy_total_rows": N,
  "inserted": X,
  "rejected": {
    "null_location": L,
    "null_category": C,
    "status_terminado_unresolved": S,
    "constraint_violation_other": O
  },
  "warnings": {
    "fullname_one_token": F1,
    "email_synthetic": E,
    "type_overflow_numeric": T,
    "fullname_split_review_needed": FR
  },
  "elapsed_seconds": E
}
```

### Umbrales de aceptación (sujeto a confirmación producto)

| métrica | umbral |
|---|---|
| `inserted / legacy_total_rows` (reservations) | ≥ 95% |
| `inserted / legacy_total_rows` (customers) | ≥ 99% — pérdida de cliente es crítica |
| `inserted / legacy_total_rows` (search_logs) | ≥ 60% — pérdida aceptable por naturaleza analítica |
| constraint violations no anticipadas | 0 |

### Reporte post-migración

Documento auto-generado (`docs/migration-runs/<timestamp>.md`) con:
- Métricas anteriores.
- Lista de IDs legacy rechazados con razón.
- Lista de customers con conflicto resuelto (latest-wins) — para revisión soporte.
- Lista de customers con email sintético.
- Lookups fallidos (e.g. category code 'XX' sin match en vehicle_categories).

---

## Order de ejecución del script

1. **Validaciones pre-flight** (read-only):
   - Verificar que `rental_companies.code = 'localiza'` existe.
   - Verificar lookup completo de franchises legacy → enum destino.
   - Verificar lookup completo de branches.code → locations.code.
   - Verificar lookup completo de categories.identification → vehicle_categories.code.
   - Abort si algún lookup tiene gaps no autorizados.

2. **Migrar customers** (extracción + dedup + insert).
3. **Construir mapas en memoria**: `legacy_identification → customer_uuid`, `legacy_branch_id → location_uuid`, `legacy_category_id → category_code`, `legacy_franchise_id → franchise enum`, `legacy_franchise_id → rental_company_uuid`.
4. **Migrar reservations** (con FKs resueltos).
5. **Migrar search_logs** (parsing JSON + descarte controlado).
6. **Generar reporte**.

Cada paso en transacción aislada con savepoints; rollback selectivo si falla un batch.

---

## Notas operacionales

- **Concurrency:** el script ETL debe correrse con producción en read-only o ventana baja. Customers nuevos creados durante la migración pueden colisionar con identifications legacy → política upsert con preferencia al existente.
- **Trigger `updated_at`:** el destino tiene trigger `on_*_updated`. Insertar con `created_at` y `updated_at` explícitos preserva los timestamps legacy si y solo si el trigger NO sobrescribe en INSERT (verificar con `\d+ customers` en branch).
- **Timezone:** legacy MySQL probablemente usa server timezone (UTC?). Destino usa `timestamptz`. Confirmar TZ legacy en E1 — si es local, convertir a UTC.
- **Service role key:** el ETL usa `SUPABASE_SERVICE_ROLE_KEY` (variable ya existente, ver `critical_env_vars_dashboard.md` en memoria). RLS se bypassa.
- **Idempotencia:** segunda corrida no debe duplicar. Estrategia: chequear `_legacy_migrated_at` antes de insert; si existe registro con misma `identification` y `_legacy_migrated_at IS NOT NULL`, omitir.
