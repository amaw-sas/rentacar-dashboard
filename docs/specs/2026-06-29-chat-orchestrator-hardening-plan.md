# Chat — plan de endurecimiento del orquestador

Fecha: 2026-06-29. Surge de probar el chat en vivo (preview) y encontrar varios
fallos de embudo. No es un rediseño: el híbrido (FSM determinista + roles LLM
angostos) se queda; le falta una capa.

## Diagnóstico (una sola raíz)

El FSM determinista decide bien el flujo, pero **actúa sobre los slots que el
Controller (LLM) extrae cada turno, y esa extracción no se valida contra la
realidad del catálogo.** Si el LLM extrae mal, el FSM o se atasca o explota.
Todos los casos vistos son el mismo problema:

| Síntoma observado | Causa |
|---|---|
| "No encuentro sede para Tuluá" tras elegir Palmira | `ciudad` quedó inválida/pegada; nadie la valida ni reconcilia con `sede` |
| Nunca cotiza (Cali) pese a dar todo | fechas/ciudad no se asentaron → `freshQuotePending` nunca se cumple → bucle en el free-form |
| Cotiza un Mobi a quien pidió diésel/estacas | no se valida tipo/combustible contra el catálogo |
| Ofrece reservar sin confirmar horas | el gate de "listo para reservar" no exige las horas |

Amplificadores: el primer mensaje llegó **duplicado** y el cliente mandó **ráfagas**
de mensajes; cada mensaje dispara un turno que re-extrae y envenena el estado.

## Principios (no negociables)

- Todo detrás de feature flag, **default off**. Nada cambia el comportamiento actual sin poder apagarlo.
- **Verificar en vivo (preview)** siempre — los tests mockean el modelo, no prueban el comportamiento real.
- No romper el flujo de cotización/reserva existente.
- No reescribir el híbrido.

---

## P0 — Grounding determinista de slots (el cambio grande, mayor leverage)

Un paso **entre la extracción y el FSM** que valida y corrige los slots contra la
verdad del catálogo, en código (sin LLM). Arregla 4 síntomas de un solo concepto.

Módulo nuevo: `lib/chat/orchestrator/ground.ts`. Se aplica sobre el resultado del
Controller/extractor antes de `applyExtraction`. Flag: `CHAT_SLOT_GROUNDING`.

Sub-piezas:

- **(a) Ciudad serviciable.** Valida `ciudad` contra las ciudades reales
  (`location-directory`). Si no es serviciable (ej. Tuluá), NO la persiste y marca
  para que el FSM ofrezca la cercana de forma determinista.
- **(b) Reconciliar ciudad↔sede.** Si el cliente nombra un punto de otra ciudad, la
  `ciudad` se deriva del directorio `sede→ciudad`. (Complementa la regla de prompt
  que ya agregué en `extract.ts`/`controller.ts`, pero sin depender del LLM.)
- **(c) Gama / tipo / combustible.** Valida que la gama exista; si el cliente pide
  algo que no manejamos (diésel, eléctrico, van, estacas, blindado), marca para
  avisarlo ANTES de cotizar en vez de cotizar un económico cualquiera.
- **(d) Gate de reserva completo.** Exigir los slots requeridos (incl. **horas**)
  antes de pasar a `collecting_customer` / ofrecer separar.

Por qué es robusto: la lógica de validación es **pura y testeable sin LLM** — deja
de depender de que el modelo extraiga perfecto cada turno. Riesgo bajo (tras flag).

## P1 — Higiene de entrada

- **Deduplicar** mensajes idénticos consecutivos del cliente.
- **Coalescer ráfagas**: agrupar mensajes seguidos del cliente (sin respuesta del
  bot en medio) en un solo turno (~1–2 s de espera) para no re-extraer en carrera.
- Dónde: `app/api/chat/route.ts` + widget. Flag.

Barato y de alto impacto: la mitad del envenenamiento de slots viene de aquí.

## P2 — Frontera FSM / free-form más estricta

- El free-form re-llamó `info_sedes` 4 veces algo que el estado ya tenía. Pasarle el
  estado y **prohibir re-consultar** lo ya conocido; acotarlo a Q&A off-funnel puro.
- Dónde: `lib/chat/orchestrator/index.ts` (config del free-form) + `prompts.ts`.

## P3 — Link de autoservicio / compartir (Fase 5 del issue #199)

- Ofrecer un enlace para que el cliente reserve por su lado / comparta la cotización
  cuando NO quiere reservar en el chat. Hoy el link solo sale como fallback de error.
- Dónde: orquestador + deep-link a la web. Ya está en el backlog del issue #199.

---

## Orden recomendado

1. **P0 grounding** — arregla Tuluá, nunca-cotiza, diésel/estacas y reservar-sin-horas.
2. **P1 higiene de entrada** — corta el envenenamiento por ráfagas/duplicados.
3. **P2 frontera free-form** — quita las re-consultas redundantes.
4. **P3 link de autoservicio** — completa la experiencia.

## Estado ya avanzado

- Regla de consistencia ciudad↔sede en los prompts (`extract.ts`, `controller.ts`)
  — en el working tree, sin pushear. Es el complemento a nivel prompt de P0(b);
  P0 lo hace robusto en código.
