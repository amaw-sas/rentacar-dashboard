---
name: schedule-editor
created_by: sdd
created_at: 2026-06-18T00:00:00Z
issue: 97
spec: docs/specs/2026-06-18-issue-97-schedule-editor-ui-design.md
---

# Holdout — Issue #97 (Ola D3) editor de horario por día + derivación de display

Contrato write-once. Las aserciones NO se debilitan para hacer pasar el código (reward hacking).
Trazabilidad: cada SCEN mapea a un AC del issue (#97) y a la tabla §9 de la spec.

## SCEN-001 (AC-D3.1): la grilla de hora solo ofrece :00 y :30
**Given**: el editor de horario con una fila de día en modo "Horario"
**When**: se inspeccionan las opciones de los selectores de inicio y fin
**Then**: cada selector ofrece únicamente horas en grilla de 30 min (`08:00`, `08:30`, …); nunca `08:15`. Inicio cubre `00:00`–`23:30`; fin cubre `00:30`–`24:00`
**Evidence**: las `<option>` renderizadas en el DOM (jsdom) — sus `value` son exactamente la grilla :00/:30

## SCEN-002 (AC-D3.2): marcar "Cerrado" omite la clave del día
**Given**: una fila de día en el editor
**When**: el operador elige modo "Cerrado"
**Then**: el objeto `LocationSchedule` emitido por `onChange` NO contiene la clave de ese día (ausente, no `[]` con valor)
**Evidence**: el objeto pasado al callback `onChange` — `expect(schedule).not.toHaveProperty("<day>")`

## SCEN-003 (AC-D3.3): marcar "24 h" persiste el rango sentinel
**Given**: una fila de día en el editor
**When**: el operador elige modo "24 h"
**Then**: el día emitido es exactamente `["00:00-24:00"]`
**Evidence**: el objeto pasado a `onChange` — `expect(schedule.<day>).toEqual(["00:00-24:00"])`

## SCEN-004a (AC-D3.4 componente): rango invertido bloquea el submit
**Given**: el formulario de sucursal con una fila en modo "Horario", inicio `18:00`, fin `08:00`
**When**: el operador intenta guardar
**Then**: aparece un error inline visible en la fila ofensora y el submit queda bloqueado; la action `updateLocation` no es llamada
**Evidence**: DOM muestra el mensaje de error; `expect(updateLocation).not.toHaveBeenCalled()`

## SCEN-004b (AC-D3.4 server): la action rechaza un rango invertido
**Given**: un `FormData` cuyo `schedule` JSON contiene `{"mon":["18:00-08:00"]}`
**When**: `updateLocation` (o `createLocation`) procesa el guardado
**Then**: devuelve `{ error: <mensaje del primer issue zod> }` y no persiste
**Evidence**: valor de retorno de la action; el cliente Supabase `update`/`insert` no se invoca

## SCEN-005 (AC-D3.5): editar una sucursal migrada precarga sus rangos
**Given**: una sucursal D2 con `schedule = { mon:["08:00-18:00"], sat:["08:00-13:00"], display:"..." }` y `hol` ausente
**When**: se monta el editor con ese schedule como `value`
**Then**: la fila Lunes precarga modo "Horario" con inicio `08:00`/fin `18:00`; Sábado `08:00`/`13:00`; Festivos precarga modo "Cerrado"
**Evidence**: estado de los selectores de modo y hora en el DOM tras el render inicial

## SCEN-006 (AC-D3.6): al guardar, el display se re-deriva coherente
**Given**: una sucursal con `sat:["08:00-13:00"]` y un `display` coherente
**When**: el operador pasa Sábado a "Cerrado" y guarda
**Then**: el `display` persistido se re-deriva desde el estructurado y refleja que el Sábado quedó cerrado (el texto del sábado abierto desaparece)
**Evidence**: el valor `schedule.display` persistido en la fila de `locations` tras el guardado (runtime, recarga dura)

## SCEN-007 (display): fusión "Dom y fest Cerrado"
**Given**: `deriveScheduleDisplay` con al menos un día de semana abierto y `sun` + `hol` ambos cerrados
**When**: se deriva el display
**Then**: el string contiene exactamente el segmento `Dom y fest Cerrado`
**Evidence**: valor de retorno de `deriveScheduleDisplay` — `expect(out).toContain("Dom y fest Cerrado")`

## SCEN-008 (display): round-trip normalizado contra el parser de D2
**Given**: cualquier estructurado `s` del espacio de estados del editor (9 casos nombrados: todos-cerrados, todos-24h, mismo-rango, Lun-Vie+finde, un-día, intermedio-cerrado, hol==sun, hol≠sun, solo-hol) más los 28 estructurados reales de D2
**When**: se calcula `parseSchedule(deriveScheduleDisplay(s))`
**Then**: no lanza excepción y `normalize(parseSchedule(derive(s)))` es igual a `normalize(s)`, donde `normalize` descarta claves `[]`/ausentes y `display`
**Evidence**: `expect(() => parseSchedule(derive(s))).not.toThrow()` y `expect(normalize(parseSchedule(derive(s)))).toEqual(normalize(s))` por cada caso

## SCEN-009 (regresión del bug latente): editar solo el nombre preserva el horario
**Given**: el formulario montado con `defaultValues.schedule = { mon:["08:00-18:00"], sat:["08:00-13:00"] }` poblado
**When**: el operador cambia solo el campo `name` (NO abre el editor de horario) y guarda
**Then**: la action recibe un `schedule` cuyo parseo es igual al original (no `{}`, sin claves perdidas) — el horario migrado sobrevive a la edición
**Evidence**: el `FormData` recibido por `updateLocation`; `JSON.parse(fd.get("schedule"))` deepEquals el schedule original (sin `display` o con el derivado, nunca `{}`)

## SCEN-010 (create): crear sucursal nueva con horario
**Given**: el formulario en modo creación, editor en blanco
**When**: el operador fija Lun–Vie `08:00-18:00`, completa los campos requeridos y crea
**Then**: la action `createLocation` persiste el estructurado (`mon..fri:["08:00-18:00"]`) junto con un `display` derivado coherente
**Evidence**: el payload `insert` a `locations` — contiene las claves de día y `schedule.display` derivado

## SCEN-011 (no-bypass): la action ignora un display inyectado
**Given**: un `FormData` cuyo `schedule` JSON trae `{"mon":["08:00-18:00"],"display":"FALSO"}`
**When**: la action procesa el guardado
**Then**: persiste el `display` DERIVADO desde los días (`"Lun 08:00-18:00 | ..."`), nunca `"FALSO"`
**Evidence**: el valor `schedule.display` en el payload persistido — `expect(display).not.toBe("FALSO")` y coincide con `deriveScheduleDisplay(días)`

## SCEN-012 (solo-hol): festivo configurado con semana cerrada
**Given**: `deriveScheduleDisplay` con `mon..sun` cerrados y `hol:["08:00-18:00"]`
**When**: se deriva el display
**Then**: devuelve `Lun-Dom Cerrado | Fest 08:00-18:00` (el festivo se preserva; NO devuelve `""`)
**Evidence**: valor de retorno de `deriveScheduleDisplay`
