# Design — Issue #20: ETL reservations (legacy → `public.reservations`)

- **Fecha:** 2026-05-28
- **Issue:** #20 (sigue al audit #13; depende de #19 customers, #17 categories, #46/#47 referrals)
- **Bloquea:** #22 (dry-run), #23 (migración productiva), #24 (cleanup)
- **Estado:** diseño aprobado → SDD
- **Referencia de implementación:** `scripts/migration/etl-customers.py` (#19, ~60% reusable)

## Contexto

Última y más compleja extracción de la cadena de migración. Migra las **12,967 reservas** de `rentacar_audit.reservations` (MariaDB legacy) a `public.reservations` (Supabase), reescribiendo cada FK BIGINT del legacy a su UUID destino. A diferencia de #19 (insert hoja sin FKs), el núcleo de #20 es la **resolución de FKs**.

## Reframe — el body de #20 quedó desactualizado por correcciones posteriores

El body del issue (updated 2026-05-19) arrastra premisas que la evidencia ya corrigió. El diseño las fija:

1. **`customer_id` NO se resuelve por `(identification_type, identification)`.** El destino `customers` tiene `UNIQUE(identification_number)` de **una sola columna**, y #19 dedupó por `normalize_identification(identification)` sola. El mapa de #20 debe llavear por esa misma función, no por el compuesto. (Gap 1.)
2. **El piso `≥12,212` omite cascade rejects.** Las 121 reservas cuyo customer era placeholder (descartado por #19) no tienen fila en `customers` → cascade reject `customer_not_migrated`. La aceptación es **reconciliación cerrada**, no un número hardcodeado. (Gap 2.)
3. **`reservations` no tiene llave natural** (`reservation_code` no es UNIQUE). La idempotencia exige añadir `_legacy_id bigint UNIQUE`. #19 la obtuvo gratis de `identification_number UNIQUE`. (Gap 3.)
4. **`status` no es `lower(replace())` ciego.** Debe ser un `STATUS_MAP` cerrado con reject-fuera-del-set (filosofía reject-never-guess de #19). (Gap 4.)
5. **Mecanismo de inserción: INSERT-batch, no COPY.** El body sugiere COPY, pero COPY no soporta `ON CONFLICT` → sin idempotencia. Se reusa el motor INSERT + SAVEPOINT del #19.
6. **Q8 (operador `user`) DISUELTA.** Corrección 2026-05-19 (P12): `legacy.reservations.user` es la columna de **referidos**, no operador. Mapea a `referral_id` + `referral_raw`. No hay decisión A/B.

## Decisiones de producto — cerradas por evidencia E1 (2026-05-12) + verificación prod en vivo (2026-05-28)

Ninguna requiere decisión humana abierta:

| Tema | Resolución | Fuente |
|---|---|---|
| P4 status `Terminado` | **0 filas** (8 valores presentes suman 12,967) | audit §1 Q5 |
| P5 `booking_type` discriminador | **`total_insurance=true`** (boolean final, migr. 032) | audit Q3 |
| P6 `rental_company_id` | **todas → `localiza`** (1:1) | audit Q4 |
| P7 location NULL | **rechazar** (355 pickup 2.74% + 341 return 2.63%, <5%) | audit Q6 |
| P8 category NULL | **0 filas** | audit Q6 |
| Q9 category_code fuera de set | **0 rechazos** — los 17 codes legacy resuelven en `vehicle_categories` (verificado prod `ilhdholjrnbycyvejsub`: GR/VP/G/LP/GX/LY existen `inactive`, #17) | live SQL 2026-05-28 |
| franchise NULL / fuera de enum | **0 filas** (3 franchises → enum 1:1) | audit Q7 |

## Arquitectura

`scripts/migration/etl-reservations.py` — single-file, mismo esqueleto que `etl-customers.py`:

- **Reuso verbatim (rename only):** contrato de exit codes (0/2/3/4/5/6/7), `validate_env` + `REQUIRED_ENV` (5 vars), `mask_db_url` (frontera de seguridad — nunca emite un byte del password), escritura JSONL atómica con fallback `/tmp`, `connect_legacy` (pymysql lazy) / `connect_destination_tx` (psycopg2 lazy, keepalives, `autocommit=False`), **conexión tardía al destino** (lee legacy primero, conecta destino justo antes de insertar — evita idle-reap del pooler), `insert_records` + `_insert_rows_individually` + `_rollback_to_savepoint` (SAVEPOINT por batch + retry fila-a-fila; una fila mala nunca tumba 500 buenas; re-raise en tx envenenada 25P02), gate de commit que hace ROLLBACK de toda la tx si no pasa, bloque de reconciliación, `--dry-run` + `ETL_DRY_RUN`, split pure-transform / lazy-driver para tests en Python pelado.
- **Se elimina:** todo el motor de dedup de #19 (`~:394-486`). Reservas son 1:1, no se deduplican.
- **Nuevo (el 40%):** 4 mapas de resolución de FK en memoria, construidos desde el **destino** antes de insertar.

## Resolución de FKs (núcleo nuevo)

Cuatro lookups, construidos con una query al destino cada uno (no al legacy):

| FK destino | mapa | llave | no-match |
|---|---|---|---|
| `customer_id` | `customers.identification_number → id` | `normalize_identification(legacy.identification)` | reject `customer_not_migrated` |
| `pickup_location_id` | `locations.code → id` vía `legacy.branches.id → branches.code` | branch code | reject `pickup_location_null` si legacy NULL; `pickup_location_unmapped` si code sin destino |
| `return_location_id` | igual que pickup | branch code | `return_location_null` / `return_location_unmapped` |
| `category_code` (texto, no FK) | validar contra `vehicle_categories.code` vía `legacy.categories.id → categories.identification` | category code | reject `category_unmapped` (esperado 0) |

Constantes / derivados sin lookup:
- `rental_company_id` ← UUID de `localiza` (resuelto 1 vez por `code='localiza'`).
- `franchise` ← `legacy.franchises.id → name → enum`; fuera de enum → reject `franchise_unmapped`.
- `referral_id` ← `referrals.code → id` con llave `LOWER(TRIM(legacy.user))`; NULL/''/no-match → `NULL` (NO reject — referral es opcional).
- `referral_raw` ← `TRIM(legacy.user)`; NULL/'' → `NULL`. Se preserva **siempre**, aun cuando `referral_id` resuelva.

## Reglas de transformación

- **status** → `STATUS_MAP` cerrado (los 13 valores canónicos → snake_case destino). Cualquier valor fuera (incl. `Terminado`) → reject `status_unmapped`. No se deja que el CHECK de la DB explote como error SQL.
- **booking_type** → función total (sin reject): `monthly_mileage IS NOT NULL → monthly`; `total_insurance=true → standard_with_insurance`; else `standard`.
- **monthly_mileage** → enum→int: `1k_kms/2k_kms/3k_kms → 1000/2000/3000`; NULL→NULL.
- **total_insurance** → boolean directo (legacy boolean, destino boolean tras migr. 032).
- **numéricos** (`total_price`, `total_price_to_pay`, `total_price_localiza`, `tax_fee`, `iva_fee`, `coverage_price`, `extra_hours_price`) → `ROUND(v, 2)` a `numeric(12,2)`; validar ≤ 9.999.999.999,99 (overflow → reject `numeric_overflow`, esperado 0 per audit P11). `total_price_to_pay` (legacy `unsigned int`) se enruta por el mismo path para uniformar el guard de overflow — incluye el outlier conocido ID 7721 = 816.999.989 (~$817M COP, bajo el techo, se migra as-is).
- **smallint** (`selected_days`, `coverage_days`, `extra_hours`) → validar ≤ 32767.
- **return_fee** NULL → 0.
- **Mapa de campos completo:** `docs/audit-workspace/03-mapping.md` §D2 es la fuente de verdad (corregido por este spec en status/booking_type/customer-key/referral). Campos directos sin transformar: fechas/horas, `reserve_code→reservation_code` (preservar NULL), `note→nota`, `ghl_*`, `aeroline`, `flight_number`, `extra_driver`, `baby_seat`, `wash`, `created_at`, `updated_at`.
- **Defaults destino sin fuente:** `reference_token`, `rate_qualifier`, `created_by`, `notification_sent_at`, `notification_sent_by` → NULL; `notification_required`, `notification_sent` → false; `flight` legacy descartado (redundante con `aeroline`/`flight_number`, P13).

## Taxonomía de rechazos + aceptación

Razones logueadas (cada fila legacy → exactamente una disposición: `inserted` | `skipped` | `rejected`):

| reason | esperado |
|---|---|
| `customer_not_migrated` (cascade de placeholder #19) | ≈121 |
| `pickup_location_null` | ≤355 |
| `return_location_null` | ≤341 |
| `category_unmapped` / `franchise_unmapped` / `status_unmapped` / `numeric_overflow` (defensivos) | 0 |

- **Aceptación = reconciliación cerrada** (`inserted + skipped + rejected == legacy_total == 12967`) + razón por cada reject + **0 constraint violations**.
- Banda esperada de insertados: **~12,150–12,271** (según solape entre customer-rejects y location-rejects; los conjuntos pueden intersecar). El número exacto lo fija el **dry-run #22**, no este spec. No se hardcodea `≥12,212`.
- Gate de commit (espeja #19): 0 rechazos inesperados (solo razones de la tabla), reconciliación cierra, y placeholders dentro de rango. Si el gate falla → ROLLBACK de toda la tx.

## Idempotencia + migración marker

- Migración nueva `0NN_reservations_legacy_migrated_marker.sql`:
  ```sql
  alter table public.reservations
    add column if not exists _legacy_id bigint,
    add column if not exists _legacy_migrated_at timestamptz;
  create unique index if not exists reservations_legacy_id_key
    on public.reservations(_legacy_id);
  ```
  `_legacy_id` = `legacy.reservations.id` (bigint). UNIQUE como índice parcial-libre (permite NULL en filas creadas por el dashboard).
- INSERT con `on conflict (_legacy_id) do nothing` → re-run inserta 0 (idempotente). Toda fila ETL lleva `_legacy_migrated_at = <run timestamp>`; filas del dashboard quedan con marker NULL.
- Migración par `0NN+1_drop_reservations_legacy_migrated_marker.sql` (drop columnas + índice), diferida a sign-off post-validación (igual que #19 difirió 049).
- `docs/data-ops/2026-05-XX-issue-20-etl-reservations/rollback.sql`: borra solo `_legacy_migrated_at IS NOT NULL`, con guard FK ejecutable (DO block, RAISE EXCEPTION si hay dependientes en `commissions`/`notification_logs`).

## Boundaries / blast radius

- **Archivos nuevos:** `scripts/migration/etl-reservations.py`, `scripts/migration/test_etl_reservations.py`, par de migraciones marker/drop, `docs/data-ops/2026-05-XX-issue-20-etl-reservations/{rollback.sql, run-summary.md}`, sección README "ETL: reservations (#20)".
- **Schema destino:** solo 2 columnas marker + 1 índice UNIQUE (no toca columnas de negocio). `pnpm db:types` regenera `lib/types/database.ts` (añade `_legacy_id`/`_legacy_migrated_at` a `reservations` Row) — diff esperado y acotado.
- **NO toca:** `lib/actions/`, `lib/queries/`, server actions, UI, `proxy/`. Cero código de aplicación.
- **Consumidores:** ningún consumer lee `_legacy_*`; las columnas son nullable e invisibles a la app.

## Supuestos explícitos

- **S1 — El mapa de customers se construye desde el destino post-#19.** Toda identificación no-placeholder está en `customers` (10.744 migradas + 30 conflict_existing + 260 pre-existentes). Solo las 121 placeholder no resuelven. Si #19 fuera revertido, #20 cascade-rechazaría en masa (dependencia dura, verificada en SCEN-002).
- **S2 — `branches.code` del legacy casa con `locations.code` del destino.** Si no, fallback a `branches.name` (riesgo A del mapping D3). Validado por pre-flight #16.
- **S3 — Localiza es dueña única de los codes y locations legacy.** Resolución de category/location por `(localiza_id, code)`. Sostenido por #17 S1/S2.
- **S4 — `_legacy_id` (legacy `reservations.id`) es estable y único en el dump.** PK AUTO_INCREMENT del legacy → garantizado.

## Error handling

- Contrato de env/conexión heredado de #19/preflight: env faltante → exit 4 (nombra la var, no abre DB); destino inalcanzable → exit 2 (URL enmascarada, sin commit parcial).
- Fila individual que viola constraint → SAVEPOINT rollback de esa fila + log `rejected` con `_sql_reason` (no-PII), las demás del batch commitean.
- Tx envenenada (25P02) → re-raise (no se puede continuar la tx).
- Re-aplicación de migración: `if not exists` / `create unique index if not exists` → sin error.

## Naming

Convención `<timestamp>_NNN_<name>.sql` (043–049). Aplicar vía MCP `apply_migration`, luego renombrar el archivo local al prefijo de `schema_migrations` remoto para que `supabase db push` lo trate como aplicado (memoria `feedback_supabase_migration_naming`).

## Testing

- **Pure-transform (unittest, sin DB):** `STATUS_MAP`, `booking_type` derivación, `monthly_mileage` map, `normalize_identification` (reusada), ROUND numérico, FK-lookup contra mapas in-memory fake. Codifica SCEN-003/004/005/006 a nivel unit antes de implementar.
- **DB-interaction (ejecución contra branch Supabase desechable):** extract+resolve+insert, idempotencia, rollback, contrato de conexión. Evidencia SQL en `docs/migration-runs/etl-reservations-verification-<date>.md`. Branch borrado tras el run (costo contenido, precedente #16/#19).
- **Worktree:** la implementación se aísla en `.worktrees/issue-20-etl-reservations` (memoria `feedback_worktree_before_coding`).

## Observable scenarios

Contrato canónico (write-once): **`docs/specs/2026-05-28-issue-20-etl-reservations/scenarios/etl-reservations.scenarios.md`**. Resumen:

- **SCEN-001** happy-path: extract + resolve FKs + insert; reconciliación cierra; cada insertado con marker.
- **SCEN-002** cascade reject: reserva con customer placeholder → `customer_not_migrated`, no insertada.
- **SCEN-003** location NULL → reject `pickup/return_location_null`.
- **SCEN-004** status fuera del mapa (incl. `Terminado`) → reject `status_unmapped`, nunca guess.
- **SCEN-005** `booking_type` derivado correcto en los 3 casos (monthly / with_insurance / standard).
- **SCEN-006** FK resolution: customer/location/category/franchise/referral resuelven a UUID/enum correcto; `referral_raw` preservado aun con `referral_id` NULL.
- **SCEN-007** idempotencia: re-run inserta 0 vía `ON CONFLICT (_legacy_id)`.
- **SCEN-008** rollback borra solo filas marker, nunca reservas del dashboard.
- **SCEN-009** env/conexión: exit 4 (env faltante) / exit 2 (destino inalcanzable, URL enmascarada), sin commit parcial.
- **SCEN-010** location con code presente pero sin destino → reject `pickup/return_location_unmapped` (señal de que falla el supuesto S2 `branches.code↔locations.code`), distinto del path NULL de SCEN-003.
- **SCEN-011** guards defensivos: `category_unmapped` / `franchise_unmapped` / `numeric_overflow` rechazan (no pasan en silencio ni dejan explotar el constraint), esperados 0 en data real.

## Criterios de satisfacción

- [ ] SCEN-003/004/005/006 (unit) verdes con `python -m unittest`, escritos antes del ETL.
- [ ] SCEN-001/002/007/008/009 verificados en branch desechable con evidencia SQL.
- [ ] Reconciliación cierra (`inserted + skipped + rejected == 12967`) en el dry-run.
- [ ] `pnpm db:types` ejecutado; diff acotado a las 2 columnas marker.
- [ ] CI verde (type-check + lint + test + build).
- [ ] PR linkeando #20 con sección Verificación.

## Fuera de alcance

- Ejecución productiva (#23) y dry-run (#22) — issues separadas. Este spec produce el script + migración + tests; el dry-run los ejerce contra branch.
- FK constraint real en `reservations.category_code` (sigue siendo texto libre; issue independiente).
- `search_logs` (#21) — extracción distinta (JSON parsing).
- Drop de columnas marker (#24).

## Referencias

- Audit #13: `docs/migration-data-legacy-audit.md` §0/§1 (counts E1), §2 (mapping), §3 (P4/P5/P6/P7/P11).
- Mapping detallado: `docs/audit-workspace/03-mapping.md` §D2/D3, `04-policies.md` P4-P13.
- Reference impl: `scripts/migration/etl-customers.py` (#19) + `docs/data-ops/2026-05-22-issue-19-etl-customers/{run-summary.md, rollback.sql}`.
- Schema destino: `supabase/migrations/008_reservations.sql` (+ 019/027/032 ALTERs).
- Handoff pre-work: `docs/data-ops/2026-05-27-issue-20-etl-reservations/handoff.md`.
