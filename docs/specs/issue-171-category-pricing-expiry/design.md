# Spec — #171: `category_pricing` no voltea `status` al expirar

**Fecha:** 2026-06-25
**Issue:** #171
**Estado:** diseño aprobado, pendiente plan
**Relacionado:** amaw-sas/rentacar-web#7 (concern #1, deferido en web — la parte accionable es esta)

---

## Problema

`category_pricing.status` es un flag almacenado que nunca se voltea a `inactive` cuando
pasa `valid_until`. Medido en prod (`ilhdholjrnbycyvejsub`) el 2026-06-25:

```sql
SELECT count(*) FILTER (WHERE status='active' AND valid_until < current_date) AS vencidas_pero_active,
       count(*) FILTER (WHERE status='active')                                AS total_active
FROM category_pricing;
-- 22 / 82  (idéntico a la medición del issue del 2026-06-19 → no se auto-corrige)
```

**27% de lo marcado `active` ya venció.** `status='active'` no significa "vigente".

### Causa raíz (verificada)

No existe trigger, job ni write-path que derive `status` de `valid_until`:

- Único trigger sobre la tabla (`005_category_pricing.sql:38`): `handle_updated_at`, solo toca `updated_at`.
- `pg_cron` disponible en el proyecto pero **no instalado**.
- `lib/actions/category-pricing.ts` (`insert`/`update`) nunca deriva `status` de la fecha.

### Por qué importa

El consumidor real es **externo**: rentacar-web lee `category_pricing` directo y, en su
fallback "season-low" (`pickPriceForDate`), escanea **todas** las filas `status='active'`
buscando la más barata cuando el pickup cae fuera de cualquier ventana vigente. Una fila
vencida-pero-`active` puede ganar ese escaneo y mostrar un precio viejo.

Dentro de *este* repo el único lector con filtro de estado (`lib/chat/knowledge-tools.ts:186-190`)
ya es defensivo (`status==='active' && valid_until >= today`), así que **un filtro en el
read-path del dashboard no arregla nada para el consumidor real.** El fix debe normalizar el
**dato**, no la lectura.

---

## Las 22 filas — dos cohortes

```sql
-- agrupadas por valid_until
2025-12-30 (177 días vencida) → 6 filas: G, GR, GX, LP, LY, VP
2026-04-30  (56 días vencida) → 8 filas: C, CX, F, FX, GC, G4, GY, LE
2026-05-31  (25 días vencida) → 8 filas: C, CX, F, FX, GC, G4, GY, LE
```

| Cohorte | Filas | Tienen reemplazo vigente | Efecto de inactivar |
|---|---|---|---|
| **B** — abril/mayo | 16 | Sí (1 fila vigente c/u) | Limpieza pura, invisible. **Es el bug del issue.** |
| **A** — legacy 2025-12-30 | 6 | No (única tarifa de esas gamas) | Quedarían sin precio |

**Decisión sobre cohorte A (operador, 2026-06-25):** las 6 gamas (G/GR/GX/LP/LY/VP) están
**sacadas y no se muestran**. Se pueden inactivar todos sus precios sin excepción. Esto
colapsa el fix al caso uniforme: voltear todo lo vencido, sin casos especiales.

---

## Invariante

Implicación **unidireccional** (no biconditional — el sistema solo apaga, nunca enciende):

```
status='active'  ⟹  vigente hoy
equivale a:  NOT (status='active' AND valid_until < hoy)
```

Esa negación es exactamente lo que SCEN-6 verifica (`activas_vencidas = 0`). La dirección
inversa (vigente ⟹ active) **no** se enforce: una fila vigente puede estar `inactive` a
propósito (gama apagada por ops). **Nunca auto-reactivar.** El único camino para re-abrir una
gama es que ops setee `status='active'` explícitamente en una fila vigente (ver SCEN-7); el
trigger lo respeta porque solo apaga lo vencido. `valid_until IS NULL` = abierto, nunca vence.

### Definición de "hoy" (timezone)

La operación es colombiana; la web define su "today" en `America/Bogota` (UTC−5). Para no
inactivar una fila que aún es vigente en Colombia durante las últimas 5h del día (cuando UTC ya
cruzó medianoche), **toda comparación de fecha usa el día en Bogotá**, no `current_date` (UTC):

```sql
(now() AT TIME ZONE 'America/Bogota')::date   -- "hoy-Colombia", canónico en backfill, job y trigger
```

---

## Solución — tres piezas, una migración (`071`)

Ninguna pieza sola cubre los dos ejes (escritura vs. paso del tiempo). Por eso van las tres.

### Pieza 1 — Backfill (UPDATE única vez)
```sql
UPDATE public.category_pricing
   SET status = 'inactive'
 WHERE status = 'active'
   AND valid_until IS NOT NULL
   AND valid_until < (now() AT TIME ZONE 'America/Bogota')::date;
```
Arregla las 22 ya rotas hoy (las 6 legacy incluidas). `total_active` baja de 82 a ~60 (valor
informativo, no gate — otros writers pueden alterar el conteo entre redacción y aplicación; el
gate real es `vencidas_pero_active = 0`, SCEN-1/SCEN-6).

### Pieza 2 — Job diario `pg_cron`
Cubre el **paso del tiempo**: una fila vigente ayer que vence hoy sin que nadie la escriba.
Un trigger **no puede** cubrir esto (no hay escritura el día que vence).

- Corre **una vez al día, 06:00 UTC** (01:00 Colombia; ya pasó la medianoche en Bogotá del día previo).
- Ejecuta el mismo UPDATE del backfill (comparando contra `hoy-Colombia`).
- Idempotente: tras la primera pasada, la fila ya es `inactive` y no vuelve a matchear; cada
  día solo toca las que cruzan vencimiento ese día.
- La granularidad de `valid_until` es `date`; diario es suficiente (ventanas mensuales).

> **A confirmar en implementación contra docs de Supabase (no de memoria):** API exacta de
> `cron.schedule(jobname, schedule, command)`, esquema donde Supabase instala `pg_cron`, y si
> `create extension if not exists pg_cron;` basta vía `apply_migration`.

**Plan B si `pg_cron` no instala vía `apply_migration`** (puede requerir privilegios de rol que
la migración no tenga): el backfill (Pieza 1) y el trigger (Pieza 3) **no dependen de pg_cron**
y se aplican igual. Solo la Pieza 2 (job) queda pendiente y se agenda manualmente desde el
dashboard de Supabase como paso post-migración documentado. Las tres piezas **no** son atómicas
en una sola migración: si el job falla en instalarse, el invariante se mantiene en escritura
(trigger) pero deja de mantenerse por paso del tiempo hasta agendar el job. La verificación de
agendamiento es obligatoria (ver SCEN-8); por eso, **tanto el job de la migración como el manual
de Plan B deben llevar un command que contenga la cadena `category_pricing`** (o un `jobname`
fijo conocido), para que la query de SCEN-8 lo encuentre.

### Pieza 3 — Trigger `BEFORE INSERT OR UPDATE`
Cubre la **escritura con fecha pasada**: si un admin edita `valid_until` a una fecha vieja,
fuerza `status='inactive'` al instante en vez de esperar ≤24h al job. Hace la invariante
DB-enforced para *cualquier* writer (server action del dashboard y SQL directo).

```sql
-- pseudo
IF NEW.valid_until IS NOT NULL
   AND NEW.valid_until < (now() AT TIME ZONE 'America/Bogota')::date THEN
  NEW.status := 'inactive';
END IF;
```
No reactiva: solo apaga. Una fila futura (las que insertan migraciones 042/063) no matchea.
Una fila vigente que el admin guarda con `status='active'` explícito **se respeta** (no entra al
IF) — ese es el único camino de reactivación (SCEN-7).

---

## Escenarios observables (holdout para SDD)

| ID | Given | When | Then |
|---|---|---|---|
| SCEN-1 | 22 filas `active` con `valid_until < hoy` | corre el backfill | `vencidas_pero_active = 0`; `total_active` baja en exactamente el nº de filas que matchearon el WHERE (vía `RETURNING`); **ninguna** fila vigente o `valid_until NULL` se toca |
| SCEN-2 | una `active` con `valid_until = ayer` | corre el UPDATE del job (a mano, no se espera al cron) | pasa a `inactive` |
| SCEN-3 | todas las `active` vigentes (`valid_until >= hoy` o NULL) | corre el job | **0** filas cambian |
| SCEN-4 | admin guarda una fila con `valid_until` en el pasado | la escritura persiste | se almacena `status='inactive'`, no `active` |
| SCEN-5 | una `inactive` cuya ventana es vigente | corre el job | sigue `inactive` (el job nunca reactiva solo) |
| SCEN-6 | la web filtra `status='active'` para el fallback season-low | escanea | ninguna fila con `valid_until` pasado puede ganar (no existen activas vencidas) |
| SCEN-7 | una `inactive` con `valid_until` futuro (gama re-abierta por ops) | admin guarda con `status='active'` explícito | persiste `active` (el trigger no la apaga porque está vigente) — único camino de reactivación |
| SCEN-8 | la migración aplicó la Pieza 2 | se consulta `cron.job` | hay 1 fila activa con `schedule='0 6 * * *'` y command que toca `category_pricing` |

### Estrategia de verificación
`pg_cron` y el trigger no son testeables en vitest. Verificación = aplicar la migración a la
**branch de testing de Supabase** y correr las aserciones SQL de SCEN-1…8 ahí antes de prod.
SCEN-2 se simula insertando una fila `valid_until = (now() AT TIME ZONE 'America/Bogota')::date - 1`
y ejecutando el UPDATE del job a mano (no se espera al cron real).

---

## Blast radius

- **Crea:** `supabase/migrations/<ts>_071_category_pricing_expiry.sql` — extensión `pg_cron`
  + función trigger + trigger + `cron.schedule` + backfill, en una migración.
- **Aplicar vía MCP `apply_migration`** — **nunca `db push`** (arrastra drift de drops 049/051; ver memoria).
- **Datos:** rentacar-web (lee `status='active'` directo) es la única consumidora con efecto;
  invisible salvo las 6 gamas ya ocultas. `lib/chat/knowledge-tools.ts` ya defensivo, sin cambio.
- **`updated_at` se moverá** en las filas que expiran por **UPDATE** (backfill y job disparan el
  trigger `handle_updated_at` existente, que es `BEFORE UPDATE` — no INSERT). Hay que confirmar
  (grep en este repo + chequeo con la web) que **ningún consumidor usa `updated_at` como
  watermark** de sync incremental/cache. Si lo usa, el job debe escribir `status` sin tocar
  `updated_at`. En el path **INSERT** (un admin crea una fila ya vencida, SCEN-4) el nuevo
  trigger fuerza `status='inactive'` pero `updated_at` queda con su default de columna (`now()`),
  no vía `handle_updated_at`. Verificación pendiente en el plan.
- **Sin cambio de código TS.** `lib/types/database.ts` es vestigial, no se regenera.
- **Docs:** este spec; comentario de cierre en #171.

---

## YAGNI — descartado a propósito

- ❌ Filtro en read-path del dashboard — no arregla al consumidor real (la web lee el dato, no mi query).
- ❌ Tabla de log propia para el job — `cron.job_run_details` basta como audit.
- ❌ Tocar `vehicle_categories` de las 6 gamas — ya no se muestran; fuera de alcance.
- ❌ Auto-reactivación de filas que vuelven a entrar en ventana — semánticamente peligroso (resucitaría filas apagadas a mano).
