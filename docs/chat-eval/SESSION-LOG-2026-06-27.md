# Registro de sesión — Chatbot rentacar: medición y mejora (2026-06-25 → 06-27)

Documento de traspaso. Resume **qué se hizo, cómo se trabajó, qué movió los números y qué falta**,
para retomar la construcción del **Controlador** en una sesión nueva sin ir a ciegas, y para
reusar el método en chatbots de otros negocios.

Branch: `preview/chat-test`. El chat NO está en producción todavía (se prueba en preview).

---

## 1. El punto de partida y la pregunta de fondo

Veníamos parchando el orquestador del chat frase por frase (transcripciones de WhatsApp pegadas
a mano). El usuario hizo la pregunta correcta:

> «¿Esta forma de parchar el prompt es la indicada, o es algo más de arquitectura? ¿Quizás
> necesitamos más agentes?»

Eso disparó todo: dejar de adivinar y **medir** antes de decidir si el problema se arregla con
parches o exige re-arquitectura (un "Controlador" que entienda lo que el cliente eligió).

## 2. La arquitectura actual del chat (contexto para el Controlador)

Orquestador **híbrido** (`lib/chat/orchestrator/`):
- **FSM determinista** (código) dueña del embudo: fases `greeting → collecting → quoted →
  choosing_gama → collecting_customer → confirming → booked`. Emite los bloques fijos (saludo,
  requisitos, tabla de cotización, preguntas de slot, resumen, reserva real vía `executeBooking`).
- **LLM en dos roles estrechos**: (a) `extract.ts` — UNA lectura por turno que saca `{intent, slots}`;
  (b) `prompts.ts` free-form — respuesta corta para preguntas fuera del embudo.
- Archivos clave: `index.ts` (dispatch/FSM), `slots.ts` (estado + schema de extracción),
  `blocks.ts` (bloques de texto deterministas), `extract.ts`, `prompts.ts`, `quote-service.ts`,
  `booking-core.ts`, `customer-validation.ts`. Flag: `CHAT_ORCHESTRATOR=on`.

El **defecto raíz** que encontramos: la FSM puede validar y ejecutar, pero **no resuelve
referencias** ("ese el blanco", "el Picanto", "la intermedia", "perfecto esa"). El extractor las
pierde y el código mete un default. Ese es el dominio del Controlador.

## 3. Cómo trabajamos (el método que funcionó)

**Build → measure → learn**, con un giro clave a mitad de camino:

1. **Análisis multi-agente** de conversaciones reales (workflows con `Workflow` tool, agentes en
   paralelo con salida estructurada por schema). Primero 10 curadas → diagnóstico arquitectónico.
2. **Baseline aleatorio** (28 al azar) para quitar sesgo de selección → reveló que el sesgo
   inflaba el "no-cierre".
3. **Descubrimiento crítico del método**: replicar chats viejos contra el bot vivo **contamina la
   medición** — el proveedor (Localiza) rechaza fechas pasadas con su propio reloj, y ~36-43% de
   las conversaciones salían con errores fantasma de fecha. **El eval estaba sucio.**
4. **Solución: self-play con fechas futuras** (la decisión del usuario). Clientes simulados
   (personas con guion, fechas de julio 2026) → Localiza acepta → **cero contaminación**, medición
   **repetible** y con **señales de compra diseñadas** (resuelve el n=4 que impedía medir cierre).
5. Cada ronda de fixes: desplegar a preview → re-correr el self-play → re-analizar → comparar.

**Lecciones de método (valen para cualquier negocio):**
- **Los fixes basados en PROMPT casi no pegan.** Decirle al modelo "no re-preguntes datos" no
  cambió la conducta (reasoning bajo no obedece). Lo que mueve la aguja son cambios DETERMINISTAS
  en código. Esto confirmó que el residual es arquitectónico.
- **El eval debe estar limpio antes de medir.** Una medición sucia dio veredictos falsos ("75% no
  cierra") que casi nos hacen sobre-construir.
- **El self-play de una corrida (n=30) tiene ruido de ~±10pp** porque el bot tiene piezas de IA
  (extractor, free-form) no deterministas. Solo confiar en señales GRANDES y persistentes entre
  corridas; para detectar efectos chicos hay que promediar varias corridas o subir n.
- **Sesgo de selección**: curar las conversaciones "malas" infla los problemas. Muestrear al azar.

## 4. Qué se hizo, por rondas (con checkpoints de commit)

Cada commit pasó tsc + eslint + suite (vitest, ~1336 tests al final) antes de desplegar.

**Ronda 1 — 5 fixes (parcialmente equivocados, lección aprendida):**
- `01e35a2` slot memory (campo `transmision` + regla prompt "no re-pedir datos conocidos")
- `97ee44b` commit de la gama recomendada ante señal de compra ← *este causó reservas defectuosas*
- `0766329` nudge de gama con tope + skip en despedida
- `8894d71` `safeQuoteError` (no filtrar 500/SOAP) + guarda de handoff a asesor
- `84993f0` + `8ce8bfb` override `_now` (gated `CHAT_ALLOW_TEST_NOW=1` en preview) + enhebrado a la cotización
- **Resultado medido: plano.** Los fixes de prompt no pegaron; el eval seguía sucio.

**Ronda 2 — determinista:**
- `f68d9a1` ledger escalado de pregunta de slot (`last_slot_ask_count`): 1 normal → 2 con ejemplo
  → 3+ formato + ofrecer asesor (nunca verbatim dos veces)
- `8eff54a` responder la pregunta off-funnel ANTES de volcar requisitos

**Ronda 3 — primer delta CLARO (sobre eval limpio):**
- `eee7e0c` aceptar cédulas con puntos (`normalizeIdentification`) ← *recuperó 2/3 no-cierres + bug real*
- `8674c26` ledger escalado de preguntas de DATOS + responder pregunta en media recolección
- `eeb8fb9` `recommendedGama` respeta la transmisión; si no hay match, PREGUNTA

**Ronda 4 — meseta (el residual es semántico):**
- `27bbfb2` slot `tipo_vehiculo` (camioneta/SUV) + `gamaByLabel` ("el más económico"/"el intermedio")
- **Resultado: no movió el defectuoso** (dentro del ruido). El residual ya es deixis/modelo.

## 5. Los números (mediciones CONTROLADAS, self-play limpio, mismas 30 personas)

| Métrica | Self-play #1 (post-R2, `8eff54a`) | #2 (post-R3, `eeb8fb9`) | #3 (post-R4, `27bbfb2`) |
|---|---|---|---|
| Close-rate (reservó/listo) | 14/17 = **82%** | 16/17 = **94%** | 16/17 = **94%** |
| **Reservas defectuosas (gama mal)** | 8/14 = **57%** | 5/16 = **31%** | 6/16 = **38%** |
| repeated_question_verbatim | 47% | 30% | 40% |
| stateless_repeat_answer | 33% | 10% | 23% |
| gama_not_committed | 17% | 17% | 7% |
| model_gama_mismatch | 33% | 17% | 23% |

Task outputs (análisis con IA, en el scratchpad de ESTA sesión — efímeros, ver §7):
`wwpqhk42y` (#1), `wo6iennq0` (#2), `w85e9vdkz` (#3). Evals previos sucios: `w66qeqr5t`, `w7o94cr6n`.

**Lectura honesta:** el salto 82→94% de cierre (fix de cédula) y la caída 57→31% del defectuoso
(fix de transmisión) son **reales** (grandes). El wiggle #2→#3 (31→38%) es **ruido** de una sola
corrida. La señal confiable: **cierre resuelto en 94%; defectuoso estancado en ~31-38%.**

## 6. La decisión del Controlador (criterio pre-registrado)

Criterio fijado ANTES de medir: *si las reservas-con-gama-equivocada siguen >10% tras los fixes
baratos → el Controlador queda justificado.*

**Estado: ~35% defectuoso, persistente tras 4 rondas atacando ese punto. Criterio cumplido.**
El residual es **resolución de referencias**: deixis ("ese el blanco automático"), nombres de
modelo (Sandero→F, Picanto→C), cambios de categoría ("la intermedia"), confirmaciones ambiguas
("perfecto esa"), y tipo de vehículo que el extractor no etiqueta confiablemente. **Eso es lo que
el Controlador resuelve.**

**Decisión del usuario:** parar y consolidar; construir el Controlador en **sesión nueva**.

### Diseño propuesto del Controlador (del análisis multi-agente)
"Controlador + Ejecutor determinista" — UN agente, no router+especialistas, NO agente libre:
- **Context Builder (código)**: arma fase + TODOS los slots (incl. `transmision`, `tipo_vehiculo`)
  + las filas de la última cotización con nombre+precio + la gama en foco + últimos turnos.
- **Controlador (1 llamada LLM, reemplaza extract.ts + el switch)**: devuelve una **acción tipada**
  (ASK_SLOT, QUOTE, COMMIT_GAMA, COLLECT_FIELD, SHOW_SUMMARY, BOOK, ANSWER, ESCALATE, …) +
  resuelve la referencia ("ese"/modelo/etiqueta) a una FILA concreta de la cotización.
- **Validador/Ejecutor (código, lo de hoy)**: rechaza acciones ilegales, ejecuta efectos,
  conserva TODA la seguridad determinista ganada (caps, blobs firmados, `executeBooking`).
- Antes de reservar: **gate de confirmación** — eco de la gama por código+precio, requiere "sí".

### Cómo verificar el Controlador (regla de decisión)
Tras construirlo: re-correr el **mismo self-play de 30 personas** (idealmente 2-3 corridas para
bajar el ruido) y comparar contra el baseline de §5. Éxito = **defectuoso < ~5-10%** manteniendo
el cierre ~94%. Si no baja, el diseño del Controlador necesita revisión.

## 7. Dónde vive el eval y cómo retomar (IMPORTANTE)

Los **scripts reutilizables** están en este repo: `docs/chat-eval/` (ver `README.md`).
- `selfplay-runner.mjs` — corre las personas contra el bot.
- `personas.json` — las 30 personas (futuro-fechadas, 57% con señal de compra).
- `wf-personas.js` — genera personas nuevas (para otro negocio o más cobertura).
- `wf-selfplay-template.js` — el análisis (frecuencias + close-rate + veredicto).
- `overnight-runner.mjs` — el replay de chats reales (con timeout + tope de reintentos).

**Los RESULTADOS crudos y task outputs de esta sesión estaban en el scratchpad efímero** (se
pierden con la sesión). Para el Controlador NO se necesitan: se **re-genera** el baseline corriendo
el self-play de nuevo (~15 min + análisis). Los NÚMEROS clave quedaron en §5 de este doc.

Para activar el override de fecha del replay viejo: env `CHAT_ALLOW_TEST_NOW=1` en preview (el
self-play NO lo necesita — usa fechas futuras reales).

## 8. Pendientes / bugs reales conocidos

1. 🔴 **Precio cotizado ≠ cobrado**: la gama híbrida LU se cotizó $3.100.399 y se reservó
   $3.316.049 (IVA+tasa que la cotización no muestra). El cliente acepta un precio y se reserva
   otro. Es el IVA+tasa diferido en rentacar-web. **Cerrar antes de prod.**
2. 🟡 **Ciudad sin sede** (Pitalito/Garzón): la cotización determinista muestra el fallback
   genérico "No pude calcular el precio" en vez de "no hay sede ahí". Cosmético (el free-form ya
   redirige bien a la sede más cercana). NO es motor roto.
3. 🟡 **~35% reservas defectuosas** (el residual semántico) → el Controlador.
4. KB compartida dice "AlquilaTuCarro" para las 3 marcas (mitigado en prompt; fix durable = editar KB).
5. Formato de precio en tabla muestra milésimas en algunos casos.

## 9. Resumen ejecutivo

- **Logrado**: close-rate real **94%** (era percibido como roto); cédula válida ya no se rechaza;
  repetición y mismatch de transmisión reducidos; un eval **limpio y repetible** que es el activo
  más valioso (sirve para este chat y para otros negocios).
- **Aprendido**: el problema NO era el cierre; es la **fidelidad** (reservar la gama correcta) y la
  **memoria conversacional** — ambos con una raíz: el bot es ciego a lo que el cliente ya eligió.
- **Decidido**: el Controlador queda **justificado con evidencia** (no intuición). Se construye en
  sesión nueva, con el self-play como regla de verificación.
