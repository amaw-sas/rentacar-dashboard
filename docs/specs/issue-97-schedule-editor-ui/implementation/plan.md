# Plan de implementación — Issue #97 (Ola D3) editor de horario por día

**Fecha:** 2026-06-18 · **Spec:** `docs/specs/2026-06-18-issue-97-schedule-editor-ui-design.md` (aprobada, 2 revisiones hostiles) · **Worktree:** `.worktrees/issue-97-schedule-editor-ui`

> Las fases de clarificación / research / design de sop-planning están satisfechas por la spec aprobada y sus 12 escenarios observables (SCEN-D3.1…D3.12). Este documento cubre file structure + plan ordenado + estrategia de verificación. SDD: cada paso define escenario → código → satisface; no hay pasos "solo-tests".

## Chunk 1: File structure + plan

### File structure

| Archivo | Acción | Responsabilidad única | Depende de |
|---|---|---|---|
| `lib/schedule/derive-display.ts` | **crear** | Función pura `deriveScheduleDisplay(schedule): string` (estructurado → texto agrupado ES) **+ helper `stripDisplay(schedule)`** (`const { display, ...days } = schedule; return days;`) — ambos operan sobre la frontera display/días, viven juntos. Sin I/O, client-safe, NO importa `parse-schedule.ts`. | `lib/schemas/location` (tipo `LocationSchedule`) |
| `tests/unit/schedule/derive-display.test.ts` | **crear** | Unit de la pura: agrupación, fusión `Dom y fest`, semana vacía, solo-hol, token `24 horas`, ignora display, round-trip normalizado vs `parseSchedule`. | derive-display, `scripts/migration/parse-schedule` (oráculo) |
| `lib/actions/locations.ts` | **modificar** | En `createLocation` y `updateLocation`: `JSON.parse(raw.schedule)` (try/catch) → `safeParse` → inyecta `display` derivado → persiste. Fix del bug latente (round-trip). | derive-display, `locationSchema` |
| `tests/unit/actions/locations.test.ts` | **crear** | Unit de action (no existe hoy; convención `<entity>.test.ts`): JSON malformado → error; rango invertido → error; no-bypass de display; round-trip preserva schedule. | locations action (mock supabase) |
| `components/forms/schedule-editor.tsx` | **crear** | Client component: 8 filas (Lun…Dom, Festivos), modo Cerrado/24h/Horario + `<select>` nativos grilla 30 min, validación per-fila. Emite `LocationSchedule` (solo claves de día). | `LocationSchedule`, derive-display (preview opcional aquí o en el form) |
| `tests/unit/components/schedule-editor.test.tsx` | **crear** | Component (jsdom): grilla :00/:30, cerrado→clave ausente, 24h→`["00:00-24:00"]`, rango invertido→error+bloqueo, precarga migrada. | schedule-editor |
| `components/forms/location-form.tsx` | **modificar** | Integra `<ScheduleEditor>`; `schedule` en RHF; `onSubmit` añade `JSON.stringify(días)` conservando el guard `value != null`; preview en vivo `deriveScheduleDisplay`. | schedule-editor, derive-display |
| `tests/unit/components/location-form-schedule.test.tsx` | **crear** | Regresión: editar solo `name` preserva schedule (no `{}`); create con horario; preview en vivo. | location-form (mock actions) |
| `lib/schedule/labels.ts` *(opcional)* | crear si crece | Constantes de etiquetas ES (`Lun`…`Dom`, `fest`) compartidas por editor y derive, si la duplicación lo amerita. | — |

**Decisión de decomposición:** `derive-display` (pura) y `schedule-editor` (UI) son independientes entre sí; la action y el form son los integradores. Esto permite construir y testear la lógica de derivación y el editor en paralelo conceptual, integrándolos al final. Archivos pequeños y enfocados; la fila del editor puede ser un subcomponente `ScheduleDayRow` dentro del mismo archivo si no supera ~200 líneas.

### Steps

| # | Descripción (escenario implícito) | Size | Depende |
|---|---|---|---|
| 1 | **`deriveScheduleDisplay` pura.** Dado un estructurado, produce el texto agrupado ES; semana vacía→`""`; solo-hol preserva festivo; token `24 horas`; ignora `display` entrante. Holdout: SCEN-D3.7, D3.8, D3.12 + casos del §7. **El round-trip se escribe como 9 casos nombrados y discretos** (todos-cerrados, todos-24h, mismo-rango, Lun-Vie+finde, un-día, intermedio-cerrado, hol==sun, hol≠sun, solo-hol), cada uno con su assert de string esperado **y** `expect(() => parseSchedule(derive(s))).not.toThrow()` antes del deepEquals normalizado — así un fallo señala el estado culpable, no un throw genérico. Corpus D2 como regresión adicional. | M | none |
| 2 | **Action round-trip + derive (fix del bug).** Al guardar, la action parsea el JSON de `schedule`, valida, deriva `display` server-side y persiste; JSON malformado o rango invertido → `{error}`; `display` falso entrante se sobrescribe. Holdout: SCEN-D3.4b, D3.11, D3.9 (lado server). | M | 1 |
| 3 | **`ScheduleEditor` componente.** El operador ve 8 filas; elige Cerrado/24h/Horario; el selector de hora solo ofrece :00/:30; cerrado→clave ausente; 24h→`["00:00-24:00"]`; rango invertido→error inline + bloqueo; editar sucursal migrada precarga modo+rango. Holdout: SCEN-D3.1, D3.2, D3.3, D3.4a, D3.5. **Vigilar techo ~200 líneas / 2h:** si validación per-fila + precarga + 48 opciones lo empujan, partir en `schedule-day-row.tsx` (presentacional) + `schedule-editor.tsx` (estado). | L | none (solo schema) |
| 4 | **Integración en `location-form`.** El editor vive en el form (RHF), `schedule` registrado vía `setValue("schedule", next, { shouldDirty: true })`. **`onSubmit` lee `data.schedule` del payload validado de RHF (no un `watch` paralelo)** y lo serializa con un helper `stripDisplay(schedule)` (descarta la clave `display` para enviar solo días) → `formData.append("schedule", JSON.stringify(...))`, conservando el guard `value != null` para los nullables. Preview en vivo del display. Editar solo `name` (sin abrir el editor) preserva el horario intacto porque `data.schedule` arrastra el `defaultValues.schedule`; crear sucursal nueva con horario persiste estructurado+display. Holdout: SCEN-D3.9 (regresión), D3.10 (create). | M | 1, 3 |
| 5 | **Verificación runtime + gate.** **Review agents post-implementación** (code-reviewer + edge-case-detector, vía `/pull-request` o directo) sobre el diff. `/dogfood` exploratorio del editor (estados límite: 48 opciones, fila inválida ida-y-vuelta, cambiar modo repetido, sucursal vacía). agent-browser sobre `/locations/[id]/edit` y `/locations/new`: cero errores consola/red; guardar + **recarga dura** (revalidatePath no cubre `[id]/edit`) muestra display coherente (SCEN-D3.6). `verification-before-completion` con evidencia fresca (type-check, lint, test, build). | M | 2, 4 |

## Prerequisites
- Worktree ya creado (`.worktrees/issue-97-schedule-editor-ui`).
- Sin dependencias nuevas (no fast-check: el round-trip se enumera estructuralmente). Sin migración SQL, sin `db:types`.
- **Precondición de precarga VERIFICADA:** `getLocation` (`lib/queries/locations.ts:24`) usa `select("*")` → `schedule` llega a `defaultValues` de la página de edición. SCEN-D3.5 tiene su fuente de datos garantizada.
- Para QA runtime: dev server con `.env.testing` o branch Supabase de testing con login sembrado (ver memoria `reference_supabase_branch_qa_login`).

## Testing Strategy
- **Unit (vitest):** derive-display (Step 1), action (Step 2). Round-trip normalizado usa `parseSchedule` como oráculo sobre el espacio de estados del editor + corpus D2.
- **Component (vitest + jsdom):** schedule-editor (Step 3), location-form regresión (Step 4). `<select>` nativo → opciones renderizan en jsdom (evita gotcha #90 de Radix).
- **Runtime (agent-browser):** Step 5. Recarga dura porque `revalidatePath("/locations")` no revalida `[id]/edit`.
- **CI gate:** type-check → lint → test → build, todo verde antes de PR.

## Rollout Plan
- **Deploy:** merge a `main` → Vercel auto-deploy. Sin pasos manuales (solo código/UI).
- **Sin migración de datos.** La data de D2 ya está en prod; este cambio la protege (deja de borrarla en edición) y la hace editable. Crear sucursal nueva: `city`/`slug` siguen su flujo normal (`z.string().default("")`), independiente de `schedule`.
- **Monitoreo:** tras deploy, editar 1 sucursal de prueba y verificar que `schedule` + `display` quedan coherentes; confirmar que la web (`rentacar-web`) sigue leyendo `display`.
- **Rollback:** revert atómico del PR (modifica 2 archivos, crea hasta 6: `derive-display.ts`, `schedule-editor.tsx` + hasta 4 de tests). Sin estado persistente que revertir.

## Riesgos y mitigación
- **R1 — derive produce display que el parser rechaza:** mitigado por el round-trip test (Step 1, 9 casos nombrados + no-throw) sobre el espacio de estados del editor; token `24 horas` exacto.
- **R2 — el round-trip del form rompe campos nullable o pierde el horario:** mitigado leyendo `data.schedule` del payload validado (no `watch`), conservando el guard `value != null` (Step 4), + test de regresión SCEN-D3.9 que monta el form con `defaultValues.schedule` poblado, NO toca el editor, y afirma que `updateLocation` recibió el `schedule` original (no `{}`, sin perder claves).
- **Trade-off aceptado (no riesgo abierto) — `<select>` nativo vs shadcn:** decisión de producto aprobada en spec §3 (control crítico → testabilidad CI sobre el gotcha #90 de Radix). Se estiliza con Tailwind para matchear; no se revierte.
