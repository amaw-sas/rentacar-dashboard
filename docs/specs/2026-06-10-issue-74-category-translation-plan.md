# Plan de implementación — Issue #74 (traducción PT→ES de categorías)

> Spec: `docs/specs/2026-06-10-issue-74-category-translation-design.md` (aprobado, 2 pasadas reviewer)
> Branch: `task/issue-74-category-translation` (base `1e836bd`) · worktree `.worktrees/issue-74-category-translation`
> Método: SDD (escenario → código → satisfacer → refactor). Cada paso embebe su escenario; no hay pasos solo-de-tests.

## File structure (decisión de descomposición)

| Archivo | Responsabilidad única | Acción |
|---|---|---|
| `lib/api/availability-enrichment.ts` | Función **pura** `enrichCategoryDescriptions(items, nameMap)` + `logUnmappedCategory`. Sin red, sin Supabase. El corazón testeable. | nuevo |
| `lib/api/category-names.ts` | I/O: `getCategoryNameMap()` — resuelve empresa Localiza + lee `vehicle_categories` vía cliente admin. Aísla el acceso a datos del enriquecimiento puro. | nuevo |
| `app/api/reservations/availability/route.ts` | Compone: tras el proxy, enriquece con degradación segura. 1 bloque editado en `:80`. | editar |
| `docs/apidog-rentacar-api.json` | Doc: `description` en `categoryDescription`. | editar |
| `tests/unit/api/availability-enrichment.test.ts` | Holdout SCEN-001/002/004/006 (puro). | nuevo |
| `tests/unit/api/category-names.test.ts` | Holdout SCEN-007 (call-chain del lookup por spies). | nuevo |
| `tests/unit/api/availability-route.test.ts` | Holdout SCEN-003/005/008 (handler, mocks). | nuevo |

**Por qué este corte:** la lógica pura (enrichment) se separa del I/O (category-names) para que los 4 escenarios centrales se prueben sin red ni mocks de Supabase — rápido y determinista. El handler solo compone. Sigue el precedente #73 (`location-directory.ts` I/O + ruta que compone).

## Prerequisitos

- Worktree ya creado en `1e836bd`. Sin dependencias nuevas, sin migraciones, sin `db:types`.
- Vitest ya configurado; `tests/unit/api/` ya existe (de #73).

## Pasos

### Step 1 — Enrichment puro: traduce por código, conserva crudo si falta (S)

**Dependencias:** ninguna.

Crear `lib/api/availability-enrichment.ts`:
- `AvailabilityItem` interface (`categoryCode`, `categoryDescription`, `[k]: unknown`).
- `enrichCategoryDescriptions(items, nameMap)`: por item, si `nameMap.has(categoryCode)` → `{...item, categoryDescription: nameES}`; si no → `logUnmappedCategory(code)` + devuelve item intacto.
- `logUnmappedCategory(code)`: `console.warn(JSON.stringify({level:"WARN", event:"localiza_category_unmapped", categoryCode, timestamp: new Date().toISOString()}))`.

**Escenarios (red→green) en `tests/unit/api/availability-enrichment.test.ts`:**
- **SCEN-001**: item con código en el mapa → `categoryDescription` = nombre ES (no el PT de entrada).
- **SCEN-002**: item con código ausente → `categoryDescription` sin cambiar (crudo, nunca blanco) + `console.warn` spy recibe `event: "localiza_category_unmapped"` con ese `categoryCode`.
- **SCEN-004**: array de N items con todos los campos (precio, token, IVA…) → tras enrich, cada item conserva todos los campos; solo `categoryDescription` cambia (igualdad campo-a-campo del resto).
- **SCEN-006**: dado un mapa inyectado `{C: "X"}` y otro `{C: "Y"}` para el mismo input → la salida refleja el mapa (la fuente es el mapa, no un literal hardcodeado).

**Acceptance:** 4 escenarios verdes; cada uno falla si se revierte la lógica correspondiente (red-green verificado). `pnpm test tests/unit/api/availability-enrichment.test.ts` verde.

### Step 2 — Lookup de nombres ES: empresa Localiza + vehicle_categories (admin) (S)

**Dependencias:** Step 1 (consume la forma que enrichment espera: `Map<code,name>`).

Crear `lib/api/category-names.ts`:
- `CATEGORY_NAME_COLUMNS = ["code","name"] as const`.
- `getCategoryNameMap()`: admin client → resolver `rental_companies.id` por `eq("code","localiza").single()` (cast `as unknown as {id:string}`) → `vehicle_categories.select(COLUMNS.join(", ")).eq("rental_company_id", id)` → cast `as unknown as {code,name}[]` con el comentario load-bearing (precedente `location-directory.ts`) → `new Map(rows.map(...))`.

**Escenario (red→green) en `tests/unit/api/category-names.test.ts`** — mockear `createAdminClient`. Dos builders thenables distintos (uno por tabla), porque la primera query usa `.single()` y devuelve `{id}` y la segunda devuelve filas, y el `from` se llama dos veces. Espía la call-chain (precedente exacto `location-directory.test.ts:84-134`):
- **SCEN-007**:
  - `from` llamado con `"rental_companies"` y luego `"vehicle_categories"` (orden).
  - 1ª query: `select("id")`, `eq("code","localiza")`, `.single()` invocados.
  - 2ª query: `select(CATEGORY_NAME_COLUMNS.join(", "))`, `eq("rental_company_id", <id resuelto>)` — el id del 1er resultado se **hila** al 2º `eq` (corazón del invariante §139 del spec).
  - `companyError` lanza; error de filas lanza (contrato de throw, no éxito parcial).
  - devuelve un `Map` cuyas entradas igualan las filas mockeadas.

Razón del cambio (vs. borrador previo): diferir esto a runtime dejaba I/O sin test falsable — un typo en `"localiza"` se desplegaría y el fallback SQL del Step 4 prueba el **contenido de la BD**, no la **query que el código construye**. El precedente #73 que este plan cita (`location-directory.test.ts`) hace justamente esta aserción por spies; no es un mock tautológico.

**Acceptance:** SCEN-007 verde con red-green; `pnpm type-check` exit 0; `pnpm lint` limpio.

### Step 3 — Handler compone con degradación segura (M)

**Dependencias:** Steps 1 y 2.

Editar `app/api/reservations/availability/route.ts:80`. Reemplazar el `const data = await proxyResponse.json(); return NextResponse.json(data);` por:
```ts
const data = await proxyResponse.json();
if (Array.isArray(data)) {
  try {
    const nameMap = await getCategoryNameMap();
    return NextResponse.json(enrichCategoryDescriptions(data, nameMap));
  } catch (e) {
    console.error("[availability] category enrichment failed, serving raw:", e);
  }
}
return NextResponse.json(data);
```

**Escenarios (red→green) en `tests/unit/api/availability-route.test.ts`** (mock `fetch` del proxy + mock `getCategoryNameMap`):
- **SCEN-003**: `getCategoryNameMap` mockeado para lanzar → el handler responde **200** con la lista cruda (PT) + `console.error` spy. Disponibilidad no se rompe.
- **SCEN-005** (confirma existente, **ambas ramas**): (a) proxy `!ok` con body `{error, message ES, shortText:"LLNRAG009"}` → el handler reenvía ese JSON con el **status del proxy** (assert status, no solo body); (b) proxy `!ok` con body **no-parseable** (HTML/texto) → el handler cae al genérico `{error:"..."}` 502. Bracketea las dos ramas, no solo la positiva.
- **SCEN-008** (composición): proxy ok con array PT + `getCategoryNameMap` mockeado con mapa → respuesta enriquecida (ES) con la forma de array preservada. Es la única prueba del cableado real `enrich(data, await getCategoryNameMap())`; nombrada para que el holdout-integrity del Step 5 la proteja.

**Acceptance:** SCEN-003, SCEN-005 (a+b) y SCEN-008 verdes con red-green; suite `tests/unit/api/` completa verde.

### Step 4 — Runtime: enriquecimiento real end-to-end + doc OpenAPI (M)

**Dependencias:** Steps 1-3.

1. **Doc:** editar `docs/apidog-rentacar-api.json` — añadir `description: "Nombre de la gama (categoría) en español"` a la propiedad `categoryDescription` del schema de availability. Verificar por inspección que el JSON sigue siendo válido (parsea).
2. **Runtime SCEN-001 real:** levantar dev server con `.env.testing` (patrón `set -a && . ./.env.testing && set +a && PORT=<p> pnpm dev`), hacer un request real a `/api/reservations/availability` (x-api-key) con fechas/sede válidas, y verificar que `categoryDescription` viene en español para los códigos curados — la prueba end-to-end de que el endpoint traduce.
   - La cobertura del **código** de `getCategoryNameMap` ya la da SCEN-007 (Step 2, unit por spies) y la composición SCEN-008 (Step 3). El runtime aquí es la confirmación end-to-end adicional, no el único sostén del I/O.
   - Si el entorno de testing no permite un availability real (proxy/Localiza), documentar la limitación. El fallback `mcp__supabase__execute_sql` contra la branch de testing **solo confirma que los datos curados existen** (`vehicle_categories` de Localiza devuelve los pares `code→name`) — NO sustituye SCEN-001 (que es "el endpoint traduce", cubierto por SCEN-007+008 a nivel de código).

**Acceptance:** OpenAPI parsea y muestra el `description`; evidencia runtime end-to-end de traducción (o, si el entorno lo impide, evidencia de SCEN-007/008 verdes + confirmación SQL de datos curados, con la limitación documentada). Documentar comando y salida (verification-before-completion).

### Step 5 — Quality gate + verificación final (M)

**Dependencias:** Steps 1-4.

- Lanzar los 4 agentes de revisión (code-reviewer, security-reviewer, edge-case-detector, performance-engineer) sobre el diff.
- `/verification-before-completion`: `pnpm test` (suite completa), `pnpm type-check`, `pnpm lint`, `pnpm build` — todos con evidencia fresca. Confirmar 8/8 escenarios satisfechos por ejecución.
- Anti-reward-hacking: `git diff` de los archivos de test — ningún test modificado tras escribir el código para forzar verde.

**Acceptance:** 4 agentes sin CRITICAL/HIGH; suite completa verde; type-check/lint/build exit 0; 8/8 escenarios satisfechos con evidencia.

## Testing strategy

- **Unit puro** (sin red): SCEN-001/002/004/006 sobre `enrichCategoryDescriptions`. Rápido, determinista, grueso de la garantía anti-reward-hacking.
- **Unit de I/O** (mock `createAdminClient`, spies): SCEN-007 sobre `getCategoryNameMap` — call-chain de las dos queries, hilado del id, throw. Pinta la query que el código construye, no el contenido de la BD.
- **Unit handler** (mocks de `fetch` + `getCategoryNameMap`): SCEN-003 (degradación) + SCEN-005 a+b (errores) + SCEN-008 (composición).
- **Runtime** (Step 4): SCEN-001 real end-to-end contra BD — confirmación, no único sostén.
- El proxy tiene su propio vitest; **no se toca** aquí.

## Rollout

- PR contra `main` con `Closes #74` (issue de una sola fase, no parcial → `Closes`, no `Refs`).
- Deploy automático Vercel al merge. **Gotcha conocido** (memoria #73): si el merge no dispara build, suele ser un webhook miss transitorio — verificar antes de culpar config.
- **Verificación post-deploy:** request real a `/api/reservations/availability` en prod → `categoryDescription` en español. Es el ground-truth final.
- **Rollback:** revert del PR. Sin migraciones ni estado persistente → rollback limpio, sin pasos de datos.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Código Localiza nuevo sin curar en `vehicle_categories` | Degradación: conserva PT + log `localiza_category_unmapped` para descubrirlo. Nunca blanco. |
| Fallo del lookup de categorías (DB/admin) | Degradación: lista cruda con 200. Disponibilidad intacta. |
| Una 2ª empresa comparte un `code` | Filtro por empresa Localiza (no global). Invariante `code` unique en `rental_companies`. |
| Entorno testing sin availability real | Fallback Step 4: SQL directo a branch testing confirma el mapa `code→name`. |
