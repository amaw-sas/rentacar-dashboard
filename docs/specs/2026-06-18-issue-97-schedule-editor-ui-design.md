# Issue #97 (Ola D3) — Editor de horario por día + festivo

**Estado:** diseño aprobado · **Fecha:** 2026-06-18 · **Issue:** #97 · **Bloquea:** `rentacar-web#47`
**Predecesores:** #95 (D1, schema estructurado v2) · #96 (D2, migración de datos)

---

## 1. Problema

Dos problemas atacados por la misma pieza:

1. **Feature faltante.** No existe UI para editar el `schedule` estructurado v2 (D1) por día. El
   operador no puede fijar horarios desde el dashboard.
2. **Bug latente crítico (data loss).** `components/forms/location-form.tsx` construye su `FormData`
   saltando objetos (`typeof value !== "object"`), por lo que **nunca envía `schedule`**. La action
   (`createLocation`/`updateLocation`) hace `locationSchema.safeParse(raw)`, y como `schedule` no
   viene en el `FormData`, el `.default({})` del schema lo rellena con `{}`. El `update` entonces
   escribe `schedule = {}`. **Consecuencia: cualquier edición de una sucursal por el dashboard borra
   su horario.** La data recién migrada en D2 está a una edición de ser destruida.

El round-trip del editor **es** el fix del bug: al persistir `schedule` real, deja de aplicarse el
default destructivo.

## 2. Alcance

Editor de horario en el formulario de sucursal. Por cada día (`mon`…`sun`) + festivo (`hol`):

- Modo: **Cerrado** | **24 h** | **Horario** (un rango `HH:MM-HH:MM`).
- En modo Horario: selección de inicio/fin en grilla de 30 min (`:00`/`:30`).
- Validación con `locationSchema` (D1) antes de persistir; errores inline.
- Al guardar, el dashboard **deriva `display`** desde el estructurado (canónico) → la web sigue
  leyendo `schedule.display` sin cambios, ahora siempre coherente.

**Fuera de alcance (YAGNI):** múltiples rangos por día (turnos partidos). El schema D1 los permite
(arrays), pero el 100 % de la data de D2 es un-rango/cerrado/24 h. Se amplía si una sede lo requiere.

## 3. Decisiones de producto (aprobadas)

| Decisión | Elección | Razón |
|---|---|---|
| Rangos por día | **Uno** (cerrado / 24h / un rango) | Cubre 100 % de la data; UI simple; YAGNI |
| Derivación de `display` | **Server-side autoritativo + preview en vivo** | No bypasseable; el operador ve el resultado antes de guardar |
| Formato de `display` | **Agrupado** (`Lun-Vie 08:00-18:00 \| Sáb 08:00-13:00 \| Dom y fest Cerrado`) | Coincide con el texto original y el ejemplo del issue; legible |
| Control de hora | **`<select>` nativo (no Radix)** | jsdom no renderiza opciones de Radix (gotcha #90); control crítico para integridad → tests vitest en CI, no solo agent-browser |
| Representación de "Cerrado" | **Clave de día omitida** | JSON mínimo; coincide con semántica D1/D2 (ausente = cerrado) |

## 4. Arquitectura

Cuatro piezas con fronteras explícitas.

### 4.1 `lib/schedule/derive-display.ts` (nuevo) — función pura

```ts
export function deriveScheduleDisplay(schedule: LocationSchedule): string
```

- **Reimplementación independiente** de la inversa del parser de D2
  (`scripts/migration/parse-schedule.ts`): **NO importa** `parse-schedule.ts` (eso arrastraría
  lógica de migración al bundle del cliente). Su correspondencia con el parser se verifica por el
  round-trip test, no por compartir código. Sin I/O, client-safe (la usan la action y el form).
- **Ignora cualquier clave `display` entrante**: solo recorre `mon..sun` + `hol`. El server siempre
  re-deriva; el `display` que venga en el objeto no influye en la salida.
- Algoritmo determinista:
  1. **Regla de semana vacía (precedencia máxima):** si **todas** las claves `mon..sun` **y** `hol`
     están ausentes o `[]` → devuelve `""` (no afirma "Cerrado" para las 4 sucursales aún sin
     configurar). En cualquier otro caso se aplican los pasos siguientes.
  2. Recorre `mon..sun` en orden, colapsando corridas consecutivas de **valor idéntico** en un
     segmento (`Lun-Vie 08:00-18:00`; día único → `Sáb 08:00-13:00`). `hol` **nunca** entra en este
     colapso de corridas; se evalúa aparte en el paso 4.
  3. Valor de cada día: `Cerrado` | `24 horas` | `HH:MM-HH:MM` (el único rango). El token de 24h es
     **exactamente `24 horas`** (palabra completa, no `24 h`) — requerido por el regex del parser
     (`/\s+24\s+horas$/i`); emitir `24 h` haría que el round-trip lance excepción.
  4. `hol`: si su valor es igual al del **último segmento** de `mon..sun` (típicamente `sun`) → lo
     fusiona como `Dom y fest <valor>`. Si difiere → segmento propio `Fest <valor>`.
  5. **Siempre** renderiza segmentos cerrados de `mon..sun` (salvo el caso de semana vacía del paso
     1): el display describe la semana completa → AC-D3.6 es observable (pasar `sat` a Cerrado cambia
     el string). El caso "solo `hol` configurado" NO es vacío (el paso 1 no aplica) → produce
     `Lun-Dom Cerrado | Fest <valor>`, preservando el festivo.
- Etiquetas ES con capitalización canónica: `Lun Mar Mié Jue Vie Sáb Dom`, festivo → `fest`. Las
  aserciones de string en los tests usan esta capitalización exacta (el parser normaliza acentos al
  leer, así que el round-trip tolera `Mié`/`Sáb`).

### 4.2 `components/forms/schedule-editor.tsx` (nuevo) — client component

```ts
interface ScheduleEditorProps {
  value: LocationSchedule;
  onChange: (next: LocationSchedule) => void;
  errors?: Partial<Record<DayKey, string>>;
}
```

- 8 filas: `Lunes … Domingo`, `Festivos`. Cada fila:
  - Modo (`<select>` nativo): `Cerrado` | `24 h` | `Horario`.
  - En `Horario`: dos `<select>` nativos (inicio/fin). Inicio ofrece `00:00..23:30`; fin
    `00:30..24:00`; ambos en grilla `:00`/`:30` (48 / 48 opciones). Cumple AC-D3.1 por construcción.
  - Validación per-fila inline (`inicio < fin`); una fila inválida marca error y bloquea submit.
- Estilo Tailwind para matchear los controles shadcn del resto del form (desviación nativa
  justificada por testabilidad).
- Precarga: por cada día, clave ausente o `[]` → `Cerrado`; `["00:00-24:00"]` → `24 h`; un rango →
  `Horario` con inicio/fin (AC-D3.5).

### 4.3 `components/forms/location-form.tsx` (modificado)

- `schedule` pasa a vivir en RHF (estado del form). El editor lee `watch("schedule")` y escribe vía
  `setValue("schedule", next, { shouldDirty: true })`.
- `onSubmit`: **conserva** el loop genérico actual (incluido el guard `value != null && typeof value
  !== "object"`, que protege los campos nullable `return_address`/`return_map`) y **añade aparte**
  `formData.append("schedule", JSON.stringify(días))` con solo las claves de día. **No** envía
  `display` (el server es autoritativo). El loop genérico seguiría saltando `schedule` por ser
  objeto, por eso el append explícito.
- Muestra un preview read-only en vivo: `deriveScheduleDisplay(scheduleActual)`.

### 4.4 `lib/actions/locations.ts` (modificado, create + update)

```ts
const raw = Object.fromEntries(formData.entries());
try { raw.schedule = raw.schedule ? JSON.parse(raw.schedule as string) : {}; }
catch { return { error: "schedule: JSON inválido" }; }

const parsed = locationSchema.safeParse(raw);
if (!parsed.success) return { error: parsed.error.issues[0].message };

const days = parsed.data.schedule;                     // puede traer un display falso
const schedule = { ...days, display: deriveScheduleDisplay(days) };  // derive lo sobrescribe
// persiste { ...parsed.data, schedule }
```

- Derivación server-side autoritativa → imposible de bypassear desde el cliente o la API.
- **No-bypass del `display`:** aunque un cliente inyecte `{"mon":[...],"display":"FALSO"}` en el JSON,
  `locationScheduleSchema` lo acepta (`display` es `.optional()`) pero `deriveScheduleDisplay` lo
  ignora y el spread `{ ...days, display: derive }` lo sobrescribe → siempre gana el derivado.
- **`.strict()` fail-loud:** una clave de día mal escrita (`monday`, `lun`) en el JSON hace fallar
  `safeParse` (por `.strict()` de D1) → `{ error }`, nunca se persiste silenciosamente como cerrado.

## 5. Flujo de datos

```
edit page → getLocation (select * incl. schedule) → defaultValues.schedule
  → schedule-editor precarga modo+rango por día
  → operador edita → preview display en vivo
  → submit → JSON en FormData
  → action: JSON.parse (try/catch) → zod safeParse → derive display (server)
  → update locations → revalidatePath("/locations")
```

## 6. Manejo de errores

- **JSON malformado** en la action → `{ error: "schedule: JSON inválido" }` (no throw al cliente,
  convención `lib/actions/`).
- **Rango inválido** (invertido / fuera de grilla) → el editor lo marca inline y bloquea submit; la
  action re-valida con `locationSchema` (defensa en profundidad) y devuelve el primer issue zod.
- **Fila per-día**: error local mostrado junto a la fila ofensora.

## 7. Estrategia de satisfacción (testing)

CI = vitest (type-check → lint → test → build). Runtime = agent-browser.

**Unit — `derive-display` (`tests/unit/schedule/derive-display.test.ts`):**
- Agrupación de días consecutivos (`Lun-Vie`).
- Fusión `Dom y fest` cuando `sun == hol`; `Fest` propio cuando difieren; `hol` igual a un día
  intermedio (no `sun`) → segmento `Fest` separado.
- Semana entera vacía (mon..sun y hol ausentes) → `""`.
- Caso "solo `hol`" (mon..sun cerrados, hol con rango) → `Lun-Dom Cerrado | Fest <valor>`.
- Token de 24h emitido como `24 horas` (no `24 h`).
- Derive ignora una clave `display` falsa presente en la entrada.
- **Round-trip property NORMALIZADO:** sea `normalize(x)` = el objeto con solo las claves de día cuyo
  array es no vacío, descartando `display` y descartando claves `[]`/ausentes. Entonces
  `normalize(parseSchedule(deriveScheduleDisplay(s))) deepEquals normalize(s)`. La igualdad cruda NO
  es invariante porque `parseSchedule` inserta claves con `[]` para días cerrados (el editor las
  omite) y conserva `display` — por eso se normaliza. La property se afirma sobre **el espacio de
  estados que el editor puede producir** (enumeración estructural representativa, no solo el corpus
  D2): todos-cerrados, todos-24h, todos-mismo-rango, Lun-Vie abierto + finde cerrado, un-solo-día
  abierto, día-cerrado-intermedio, `hol==sun`, `hol≠sun`, solo-`hol`. **Adicionalmente** se corre
  sobre los 28 estructurados reales de D2 como corpus de regresión.

**Component (jsdom, `tests/unit/components/schedule-editor.test.tsx`):**
- AC-D3.1 — la grilla de hora solo ofrece `:00`/`:30` (sin `08:15`).
- AC-D3.2 — modo Cerrado → la clave del día queda ausente en el objeto emitido por `onChange`.
- AC-D3.3 — modo 24 h → `["00:00-24:00"]`.
- AC-D3.4a — rango invertido (inicio 18:00, fin 08:00) → error inline visible y submit bloqueado:
  `expect(updateLocation).not.toHaveBeenCalled()`.
- AC-D3.5 — editar sucursal migrada precarga modo+rango por día.

**Unit — action (`tests/unit/actions/locations.test.ts` o vía mock):**
- AC-D3.4b (defensa server) — `schedule` con rango invertido en el JSON → `safeParse` falla →
  `{ error }`, no persiste.
- No-bypass — JSON con `display` falso → persiste el `display` **derivado**, no el falso.
- JSON malformado → `{ error: "schedule: JSON inválido" }`.

**Regresión del bug (crítico):**
- SCEN-D3.9 — editar solo `name` (sin tocar el editor) preserva `schedule` intacto — **no** `{}`.

**Runtime (agent-browser):**
- `/locations/[id]/edit`: cero errores de consola/red; guardar y **recargar duro** (o navegar
  fuera-y-volver, porque `revalidatePath("/locations")` no revalida la ruta `[id]/edit`) muestra
  display coherente; AC-D3.6 (pasar `sat` a Cerrado se refleja en el texto).

## 8. Blast radius

- **Modifica:** `components/forms/location-form.tsx`, `lib/actions/locations.ts`.
- **Crea:** `lib/schedule/derive-display.ts`, `components/forms/schedule-editor.tsx`,
  `tests/unit/schedule/derive-display.test.ts`, `tests/unit/components/schedule-editor.test.tsx`.
- **Consumidores:** páginas `locations/new` y `locations/[id]/edit` (sin cambio de API pública). La
  web sigue leyendo `schedule.display` (ahora siempre derivado y coherente). Desbloquea
  `rentacar-web#47`.
- **Sin migración SQL, sin `db:types`** (solo lógica + UI).

## 9. Escenarios observables (puente a SDD)

| ID | Given | When | Then |
|---|---|---|---|
| SCEN-D3.1 | Editor en modo Horario | El operador abre el selector de inicio/fin | Solo aparecen opciones `:00`/`:30` (nunca `08:15`) |
| SCEN-D3.2 | Una fila de día | El operador elige "Cerrado" y guarda | El estructurado persistido omite la clave de ese día |
| SCEN-D3.3 | Una fila de día | El operador elige "24 h" y guarda | El día persiste `["00:00-24:00"]` |
| SCEN-D3.4a | Modo Horario con inicio 18:00, fin 08:00 | El operador intenta guardar (componente) | Error inline visible; submit bloqueado → `updateLocation` no es llamada |
| SCEN-D3.4b | JSON con un rango invertido llega a la action | La action procesa el guardado (unit) | `safeParse` falla → `{ error }`, no persiste |
| SCEN-D3.5 | Sucursal migrada (D2) con `mon:["08:00-18:00"]`, `hol` ausente | Se abre la página de edición | La fila Lunes precarga Horario 08:00–18:00; Festivos precarga Cerrado |
| SCEN-D3.6 | Sucursal con `sat:["08:00-13:00"]` y display coherente | El operador pasa `sat` a Cerrado y guarda | El `display` re-derivado refleja Sábado cerrado |
| SCEN-D3.7 | `deriveScheduleDisplay` con **al menos un día de semana abierto** y `sun`+`hol` ambos cerrados | Se deriva el display | Contiene exactamente `Dom y fest Cerrado` (precondición evita colisión con la regla de semana vacía) |
| SCEN-D3.8 | `deriveScheduleDisplay` sobre el espacio de estados del editor + corpus D2 | `normalize(parseSchedule(derive(s)))` | Igual a `normalize(s)` (round-trip normalizado) |
| SCEN-D3.9 (regresión) | Sucursal con horario poblado | El operador edita solo `name` y guarda | `schedule` queda intacto (no `{}`) |
| SCEN-D3.10 (create) | Sucursal nueva, editor en blanco | El operador fija Lun-Vie 08:00-18:00 y crea | Persiste el estructurado + `display` derivado coherente |
| SCEN-D3.11 (no-bypass) | JSON enviado con `display:"FALSO"` inyectado | La action procesa el guardado | Persiste el `display` derivado, nunca `"FALSO"` |
| SCEN-D3.12 (solo-hol) | `mon..sun` cerrados, `hol:["08:00-18:00"]` | Se deriva el display | `Lun-Dom Cerrado \| Fest 08:00-18:00` (preserva festivo) |

---

*Diseño aprobado por el usuario el 2026-06-18. Siguiente: sop-planning → scenario-driven-development.*
