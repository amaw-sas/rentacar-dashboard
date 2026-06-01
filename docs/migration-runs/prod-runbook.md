# Runbook — migración productiva del ETL legacy (issue #23)

Cómo correr el ETL legacy→destino contra **producción** (`ilhdholjrnbycyvejsub`) en la
ventana. El gate de validación (#22 dry-run) está cerrado y el script (#20) está en main;
falta ejecutarlo de verdad.

## Qué migra #23 (y qué ya está hecho)

**Customers ya está en producción.** Se migró el 2026-05-25 como parte de #19: 10,744
filas insertadas, gate pasado, re-run idempotente verificado (ver
`docs/data-ops/2026-05-22-issue-19-etl-customers/run-summary.md`). Hoy prod tiene 10,744
customers marcados con `_legacy_migrated_at` + ~372 nativos del dashboard.

**Reservations es el trabajo nuevo de #23.** Prod tiene 0 reservations migradas. La
corrida inserta las reservas resolviendo su `customer_id` contra los customers que #19
ya dejó en prod.

El launcher corre **customers + reservations** en la ventana, en ese orden. El pase de
customers es una **reconciliación idempotente**: si legacy no creció desde 2026-05-25 no
inserta nada (no-op); si aparecieron clientes nuevos en legacy, los migra para que la
resolución de FK de reservations quede completa. No reescribe los customers existentes
(`ON CONFLICT DO NOTHING`).

## Estado del esquema de prod (precondición — YA APLICADA)

Las dos migraciones que faltaban se aplicaron el 2026-06-01 vía MCP `apply_migration`:

| Migración | Versión registrada en prod | Efecto |
|---|---|---|
| `047_legacy_categories_ensure_inactive` | `20260601153820` | **No-op** — las 4 gamas GR/VP/G/LP ya estaban `inactive`; reconcilia historia. |
| `050_reservations_legacy_migrated_marker` | `20260601153831` | Añade `_legacy_id` (bigint, UNIQUE) + `_legacy_migrated_at` a `reservations`. **Requisito duro del ETL.** |

⚠️ **NUNCA correr `supabase db push` sobre prod en este estado.** La secuencia 047–051 se
aplica **solo quirúrgicamente vía MCP `apply_migration`**. `db push` arrastraría 049 y 051,
que son los DROP de los markers (cleanup #24) — borraría `_legacy_id` y
`_legacy_migrated_at` justo lo que el ETL y el rollback necesitan. Los archivos locales 050/051
conservan su prefijo sintético a propósito para mantener el orden 049 < 050 < 051; sus versiones
locales difieren de las registradas en prod, lo cual es inocuo porque 050 es idempotente y la
secuencia no pasa por `db push`.

## Checklist previo a la ventana (no técnico — responsabilidad de producto)

- [ ] **Firma de producto** del 4.03 % de reservas que no migran. Solicitud lista para enviar en
  `docs/migration-runs/sign-off-request.md`; evidencia completa en `docs/migration-runs/dry-run-2026-05-29.md`
  (97 % histórico 2024–2025, 15 de prueba de 2026 verificadas una a una, cero clientes reales perdidos).
- [ ] **Ventana de bajo tráfico** — ver "Elegir la ventana" abajo. La operación dura ~30 s y
  el tráfico es bajísimo (~5 reservas/día), así que la ventana es flexible; basta con un momento
  de actividad suave. **Gate: no disparar el commit hasta tener la firma de producto + el snapshot.**
- [ ] **Snapshot tomado** justo antes de empezar — ver "1 · Snapshot" (pg_dump dirigido, prod no tiene PITR).

## Elegir la ventana

El riesgo de la corrida es la escritura concurrente, no la carga operativa. El escritor que no
se puede pausar es la **API pública de reservas**, y su tráfico (90 días, hora Colombia) lo dice
claro: las franjas **01:00–05:00 COT están muertas** (0–1 reserva en 90 días) y el pico arranca
a las 08:00. Por día, domingo (2.6/día) y lunes (3.7) son los más bajos; sábado/viernes los más
altos. La anécdota de "miércoles/jueves" venía de la carga operativa (recogidas, llamadas), no de
la escritura — por eso medimos.

Dicho eso, con ~5 reservas/día y una operación de ~30 s, la probabilidad de una reserva
concurrente es ~4 %, y aun así sería una fila distinta sin conflicto. **La ventana es flexible:**
óptimo es día bajo + temprano (~06:00–07:00 COT, antes del surge), pero cualquier momento de
actividad suave sirve. Lo que NO es flexible: la firma de producto y el snapshot van primero.

## Pasos de la ventana

### 0 · Configurar el entorno

Apuntar `scripts/migration/.env` a **prod**, con el **transaction pooler (puerto 6543)** —
el session pooler (5432) rechazó auth de forma intermitente en el dry-run de #22. Confirmar
las 5 variables: `LEGACY_DB_HOST`, `LEGACY_DB_USER`, `LEGACY_DB_PASSWORD`, `LEGACY_DB_NAME`,
`SUPABASE_DB_URL`.

### 1 · Snapshot

Prod **no tiene PITR**, así que el "snapshot" no es un botón del dashboard: es un `pg_dump`
dirigido de la única tabla que #23 muta con filas nuevas (`reservations`). El pase de customers
es idempotente (`ON CONFLICT DO NOTHING`, solo agrega) y no se revierte, así que no necesita dump.

```bash
pg_dump "$SUPABASE_DB_URL" -t public.reservations --data-only \
  -f docs/migration-runs/prod-reservations-pre23-$(date -u +%Y%m%dT%H%M%SZ).sql
# NO commitear este archivo — puede contener PII. Guardarlo fuera del repo o borrarlo tras la firma.
```

El dump es la red de seguridad de respaldo; el **rollback por marcador** (paso de rollback) es el
bisturí real, y borra solo lo que esta corrida insertó. `--snapshot-confirmed` en el launcher es
tu atestación de que este `pg_dump` corrió.

### 2 · Verificar el esquema (ya aplicado)

El launcher verifica solo que exista `reservations._legacy_id` antes de tocar nada. Para
confirmar a mano:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='reservations'
  and column_name in ('_legacy_id','_legacy_migrated_at');
-- esperado: ambas filas
```

### 3 · Ensayo final — dry-run contra prod

El dry-run lee, computa y hace ROLLBACK; no escribe nada. Es seguro contra prod y es la última
verificación de que preflight pasa y la reconciliación cierra con los datos de hoy.

```bash
cd scripts/migration
set -a && . ./.env && set +a
bash run-prod-migration.sh --expect-ref ilhdholjrnbycyvejsub --dry-run
```

Esperado: preflight exit 0 → customers dry-run exit 0 → reservations dry-run exit 0. Revisar la
reconciliación de cada etapa en stdout. Si el conteo de reservations difiere mucho del dry-run de
#22 (12,445), investigar antes de seguir — puede indicar crecimiento de legacy.

### 4 · Commit — la corrida real

```bash
bash run-prod-migration.sh --expect-ref ilhdholjrnbycyvejsub --commit --snapshot-confirmed
```

`--snapshot-confirmed` es tu atestación de que el paso 1 está hecho; el launcher se niega a
commitear sin él. El ref-guard aborta si `SUPABASE_DB_URL` no apunta exactamente a
`ilhdholjrnbycyvejsub`. Secuencia: preflight → customers commit → reservations commit →
verify-prod-run.sql. Un exit ≠ 0 en cualquier etapa corta la cadena.

### 5 · Verificación post-run

El launcher corre `verify-prod-run.sql` automáticamente al cerrar el commit y falla la corrida
si alguna fila da `FAIL`. Revisar la tabla de salida: sin duplicados de `_legacy_id`, todas las
reservas migradas con marcador, sin ubicaciones nulas, sin FK huérfano, distribuciones de
`booking_type`/`franchise`/`status` en dominio. Reconciliar los conteos `customers_migrated_count`
y `reservations_migrated_count` contra el stdout de cada ETL.

### 6 · Reporte final

Escribir `docs/migration-runs/prod-<timestamp>.md` con las métricas por entidad, la
reconciliación, la taxonomía de rechazos y la tabla de integridad. Solo conteos agregados; los
JSONL por fila (con PII) quedan gitignored. Pasar la prosa por /humanizer.

## Rollback (si algo sale mal)

**El rollback de #23 es de reservations SOLAMENTE.** Los customers son el entregable de #19,
ya verificado, y hay reservas vivas del dashboard que dependen de ellos — no se tocan.

```bash
psql "$SUPABASE_DB_URL" -f docs/data-ops/2026-05-28-issue-20-etl-reservations/rollback.sql
```

Ese script borra solo `reservations WHERE _legacy_migrated_at IS NOT NULL`, con un guard que
aborta si alguna commission (financiera, NO ACTION) referencia una reserva migrada;
`notification_logs` cae por CASCADE. **NO correr** el rollback de customers
(`docs/data-ops/2026-05-22-issue-19-etl-customers/rollback.sql`) en #23: su guard de FK abortaría
de todos modos si hay reservas que referencian customers migrados, pero el punto es que esos
customers no son de esta corrida.

Si el snapshot manual es necesario (corrupción más allá de los marcadores), restaurarlo desde el
dashboard de Supabase es la opción de último recurso.

## Después de la ventana

- Validar que los conteos de prod cuadran con el dry-run de #22 (ajustado por crecimiento de legacy).
- Confirmar con producto la aceptación del resultado.
- #24 (cleanup) dropea los markers (049/051) y archiva los logs — solo tras la firma de aceptación.
