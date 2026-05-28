# Implementation Plan — Issue #20 ETL reservations

- **Fecha:** 2026-05-28
- **Diseño (aprobado + commiteado):** `../../2026-05-28-issue-20-etl-reservations-design.md`
- **Contrato de escenarios:** `../scenarios/etl-reservations.scenarios.md` (SCEN-001..011)
- **Referencia (~60% reuso):** `scripts/migration/etl-customers.py` (#19)
- **Aislamiento:** worktree `.worktrees/issue-20-etl-reservations` (toda la implementación)

> Nota: sop-planning ejecutado parcialmente — las fases de clarificación / research / diseño (Steps 1-6) ya están cubiertas por el spec aprobado y revisado. Este artefacto cubre Step 6.5 (file structure) + Step 7 (plan) + Step 7.5 (review loop).

## Chunk 1: File structure + ordered steps

### File-structure map

| Archivo | Acción | Responsabilidad única |
|---|---|---|
| `scripts/migration/etl-reservations.py` | NEW | Orquestación ETL: extract legacy → resolve FKs → transform → insert idempotente → reconcile. Reusa scaffolding de #19; sin dedup. |
| `scripts/migration/test_etl_reservations.py` | NEW | Tests unit de funciones pure-transform / lookup (stdlib `unittest`, sin DB). Codifica SCEN-003/004/005/006/010/011 a nivel unit. |
| `supabase/migrations/<ts>_050_reservations_legacy_migrated_marker.sql` | NEW | DDL: `_legacy_id bigint` + `_legacy_migrated_at timestamptz` + unique index en `_legacy_id`. |
| `supabase/migrations/<ts>_051_drop_reservations_legacy_migrated_marker.sql` | NEW | DDL inverso (drop columnas + índice). Apply diferido a sign-off post-validación (#24). |
| `docs/data-ops/2026-05-XX-issue-20-etl-reservations/rollback.sql` | NEW | Borrado scoped (`_legacy_migrated_at IS NOT NULL`) con guard FK ejecutable (commissions/notification_logs). |
| `docs/data-ops/2026-05-XX-issue-20-etl-reservations/run-summary.md` | NEW (post-run) | Evidencia agregada no-PII del run (counts, reconciliación, gate). |
| `docs/migration-runs/etl-reservations-verification-<date>.md` | NEW (post-run) | Evidencia SQL de los escenarios DB-interaction en el branch. |
| `scripts/migration/README.md` | MODIFY | Añadir sección "ETL: reservations (#20)". |
| `lib/types/database.ts` | REGEN (`pnpm db:types`) | Añade `_legacy_id`/`_legacy_migrated_at` al Row de `reservations`. Nunca hand-edit. |

Boundary: cero cambios en `lib/actions/`, `lib/queries/`, UI, `proxy/`. Solo migración (data/DDL marker) + script + tests + docs.

### Prerequisites

- Worktree `.worktrees/issue-20-etl-reservations` creado desde `main`.
- Branch Supabase desechable con migraciones ≤050 + #19 customers + #17 categories ya migrados (targets de FK existen).
- Legacy MariaDB `rentacar_audit` cargado localmente (dump E1) para SCEN-001 + lecturas read-only.
- Env: `LEGACY_DB_{HOST,USER,PASSWORD,NAME}` + `SUPABASE_DB_URL` → branch session pooler.
- Python con `pymysql` + `psycopg2` (lazy imports → tests corren sin ellos).

### Implementation steps (SDD: scenario → code → satisfy → refactor)

**Fase 1 — Foundation (schema + skeleton)**

1. **Migración marker 050** — `add column _legacy_id bigint`, `add column _legacy_migrated_at timestamptz`, `create unique index reservations_legacy_id_key on reservations(_legacy_id)`. Par 051 drop. | Size: S | Dep: none
   - Acceptance: `apply_migration` 050 sin violación de constraints; `_legacy_id` UNIQUE permite múltiples NULL (filas dashboard); re-apply (`if not exists`) no-op. Precondición de SCEN-007.
   - Evidence: SQL `information_schema.columns` muestra ambas columnas; `pg_indexes` muestra el unique index; `apply_migration` exit ok.

2. **Skeleton del script** — copiar scaffolding reusable de `etl-customers.py` (exit codes, `validate_env`+`REQUIRED_ENV`, `mask_db_url`, JSONL atómico, `connect_legacy`/`connect_destination_tx` lazy, conexión tardía, `--dry-run`/`ETL_DRY_RUN`, CLI). **Eliminar** el motor de dedup. | Size: M | Dep: none
   - Acceptance (SCEN-009): env faltante → exit 4 nombrando la var, sin abrir DB; `SUPABASE_DB_URL` inalcanzable → exit 2 con URL enmascarada (sin byte del password), sin commit parcial.
   - Evidence: `echo $?` → 4 / 2; stderr capturado; substring del password ausente de todo output.

**Fase 2 — Transforms puros (unit-test first)**

3. **`STATUS_MAP` cerrado** — dict de los 13 valores canónicos → snake_case; reject `status_unmapped` para cualquier otro (incl. `Terminado`). | Size: S | Dep: Step 2
   - Acceptance (SCEN-004): los 13 mapean; `'Terminado'` y desconocidos → reject (no pasa en silencio, no llega al CHECK como error SQL).
   - Evidence: `python -m unittest test_etl_reservations.TestStatusMap` verde, escrito antes del código.

4. **Derivación `booking_type`** — función total: `monthly_mileage NOT NULL → monthly`; `total_insurance=true → standard_with_insurance`; else `standard`. | Size: S | Dep: Step 2
   - Acceptance (SCEN-005): 3 casos correctos; `monthly` gana sobre la rama de seguro; ninguna fila se rechaza por booking_type.
   - Evidence: `unittest test_booking_type` verde.

5. **Coerciones numéricas / mileage** — `monthly_mileage` enum→int (1000/2000/3000, NULL→NULL); `ROUND(v,2)` + guard overflow `numeric_overflow` (>9.999.999.999,99) en los 7 numéricos **incl. `total_price_to_pay`**; smallint guards (≤32767); `return_fee` NULL→0. | Size: S | Dep: Step 2
   - Acceptance (SCEN-011 parte overflow): valor sobre el techo → reject `numeric_overflow`, no trunca; outlier ID 7721 (816.999.989) pasa as-is.
   - Evidence: `unittest test_numeric_overflow`, `test_monthly_mileage` verdes.

6. **Resolución de FKs** — funciones contra mapas in-memory: `customer_id` por `normalize_identification` (reusar de #19); `pickup/return_location_id` por branch code → `locations.code`; `category_code` validar contra `vehicle_categories.code`; `franchise` enum; `referral_id` por `LOWER(TRIM(user))` + `referral_raw` siempre. Reject reasons: `customer_not_migrated`, `*_location_null`, `*_location_unmapped`, `category_unmapped`, `franchise_unmapped`. | Size: M (paso más denso — vigilar) | Dep: Steps 3-5
   - Acceptance (SCEN-002/003/006/010/011): id ausente del mapa → `customer_not_migrated`; location NULL → `*_location_null`; location code sin destino → `*_location_unmapped` (distinto del NULL); category/franchise fuera de set → `*_unmapped`; referral no-match → `referral_id=None` pero `referral_raw` preservado.
   - Evidence: `unittest` para cada reject path + happy path, todos verdes (red-green), escritos antes del código. Los tests son independientes y se autoran incrementalmente: `test_resolve_customer_missing`, `test_resolve_location_null`, `test_resolve_location_unmapped`, `test_resolve_referral_match`/`_unmatched`, `test_resolve_category_unmapped`, `test_resolve_franchise_unmapped` — el paso es atómico en entregable pero amplio en superficie; el de mayor riesgo a vigilar.

**Fase 3 — Integration (assemble + insert)**

7. **Build de mapas + transform de fila** — queries al destino para construir 6 lookups (customers, locations, vehicle_categories, franchises, referrals, rental_company localiza). Ensamblar fila legacy → record destino. | Size: M | Dep: Step 6
   - Acceptance (SCEN-001 dry-run): `--dry-run` lee+computa+ROLLBACK; reconciliación cierra (`inserted+skipped+rejected==12967`); cada reject con razón de la taxonomía.
   - Evidence: dry-run report JSON suma 12967; 0 razones fuera de la taxonomía.

8. **Insert engine + commit gate** — reusar `insert_records` + SAVEPOINT-por-batch + retry fila-a-fila + `ON CONFLICT (_legacy_id) DO NOTHING`; gate de commit que hace ROLLBACK de la tx si falla; bloque de reconciliación. | Size: M | Dep: Step 7
   - Acceptance (SCEN-001 commit, SCEN-007): commit en branch **desechable** (nunca prod — eso es #23) inserta la banda esperada con marker; re-run inserta 0 (`already_migrated`), 0 dupes (`count==count(distinct _legacy_id)`), sin churn de `updated_at`.
   - Evidence: SQL en branch: `count(*) where _legacy_migrated_at not null == inserted`; segundo run report `inserted==0`; counts idénticos pre/post re-run; `SELECT max(updated_at) FROM reservations WHERE _legacy_migrated_at IS NOT NULL` idéntico entre los dos runs.

**Fase 4 — Rollback + docs**

9. **rollback.sql** — borra solo `_legacy_migrated_at IS NOT NULL`; guard FK ejecutable (DO block + RAISE EXCEPTION si hay dependientes en commissions/notification_logs). | Size: S | Dep: Step 8
   - Acceptance (SCEN-008): borra N filas marker, deja intactas las marker-NULL (dashboard); fila dependiente sembrada dispara el guard.
   - Evidence: SQL counts pre/post; `RAISE EXCEPTION` observado con dependiente sembrado.

10. **README + run-summary + db:types** — sección README "ETL: reservations (#20)"; template run-summary no-PII; `pnpm db:types`. | Size: S | Dep: Step 8
    - Acceptance: `pnpm db:types` diff acotado a las 2 columnas marker; `pnpm type-check && pnpm lint && pnpm test && pnpm build` verdes (CI gate).
    - Evidence: `git diff lib/types/database.ts` solo añade los 2 campos; CI local verde.

### Testing Strategy

- **Unit (sin DB, red-green antes del código):** SCEN-003/004/005/006/010/011 vía `python -m unittest`. Mapas FK fake in-memory.
- **DB-interaction (branch desechable + evidencia SQL):** SCEN-001/002/007/008/009. Documentado en `docs/migration-runs/etl-reservations-verification-<date>.md`. Branch borrado tras el run (costo contenido, precedente #16/#19).
- **CI gate:** type-check → lint → test → build (el script Python no entra a CI Node, pero db:types regen + tipos sí).

### Rollout Plan

- Este plan produce **script + migración + tests** (no ejecución productiva).
- **Dry-run (#22):** ejercer el script contra branch desechable; reporte de gaps; pin del count exacto de inserción.
- **Productivo (#23):** apply 050 a prod → run commit-mode → verificación SQL → marker queda para rollback.
- **Cleanup (#24):** apply 051 (drop marker) tras sign-off.
- **Rollback:** `rollback.sql` (scoped, FK-guarded) en cualquier punto antes del cleanup.

## Key decisions (heredadas del spec aprobado)

1. customer map desde destino, llave `normalize_identification` sola (no compuesto).
2. `_legacy_id bigint UNIQUE` para idempotencia (`reservations` sin llave natural).
3. INSERT-batch + `ON CONFLICT`, no COPY (COPY no soporta upsert).
4. `STATUS_MAP` cerrado, reject-never-guess.
5. Aceptación = reconciliación cerrada, no `≥12,212` hardcodeado.
6. Cero decisiones de producto abiertas (todas cerradas por evidencia E1 + verificación prod).
