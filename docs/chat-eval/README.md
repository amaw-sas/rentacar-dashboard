# Kit de evaluación de chatbots (self-play limpio + build-measure-learn)

Método y herramientas para medir y mejorar un chatbot conversacional **con evidencia, no
intuición**. Nació evaluando el chat de rentacar (ver `SESSION-LOG-2026-06-27.md`), pero el
método y los scripts son **reutilizables para cualquier negocio** (cambiando personas y endpoint).

## Por qué este método

Parchar el prompt frase por frase no escala y engaña: no sabes si una mejora real movió algo o
fue ruido. Este kit cierra el loop:

> **construir** un fix → **medir** sobre un eval limpio y repetible → **aprender** del delta → decidir.

Dos principios que aprendimos a los golpes:
1. **El eval debe estar LIMPIO.** Replicar chats viejos contra el bot vivo contamina la medición
   (fechas que el proveedor rechaza, contexto desfasado). La solución es **self-play con datos
   frescos** (personas con fechas futuras reales).
2. **Los fixes de PROMPT casi no pegan.** Lo que mueve métricas son cambios DETERMINISTAS en
   código. Si solo un cambio de arquitectura puede arreglar algo, el eval te lo demuestra.

## Las piezas

| Archivo | Qué hace |
|---|---|
| `wf-personas.js` | Genera N personas-cliente realistas con guion (workflow multi-agente) |
| `personas.json` | El set actual (30 personas car-rental, futuro-fechadas, 57% con señal de compra) |
| `selfplay-runner.mjs` | Corre las personas contra el endpoint del chat y guarda transcripciones |
| `wf-selfplay-template.js` | Analiza las transcripciones (frecuencias de fallo + close-rate + veredicto) |
| `overnight-runner.mjs` | Variante: replay de chats REALES exportados (con timeout + reintentos) |

Requisitos: Node 22+. Los workflows (`wf-*.js`) se ejecutan con la tool `Workflow` de Claude Code
(agentes en paralelo con salida estructurada). El runner es Node puro.

## Cómo correr el eval (este chat)

```bash
# 1. (opcional) generar personas nuevas o para otro negocio:
#    Workflow({ scriptPath: "docs/chat-eval/wf-personas.js" })  → guarda el output en personas.json

# 2. correr el self-play contra el bot (ajusta la URL dentro de selfplay-runner.mjs):
OUT=selfplay-results CONCURRENCY=3 TURN_DELAY=1500 node docs/chat-eval/selfplay-runner.mjs

# 3. analizar (inyecta personas.json en la plantilla y lanza el workflow):
#    construir wf-selfplay.js = wf-selfplay-template.js con __CONVS__ = el payload de transcripciones,
#    luego Workflow({ scriptPath: "...wf-selfplay.js" })
```

El análisis devuelve, por cada conversación: `outcome`, `reachedBooking`, `customerWasReadyToBook`,
`botClosedOrProgressed`, y `patternsPresent` (etiquetas de fallo). El cálculo de frecuencias y
close-rate se hace determinista sobre esas etiquetas (más confiable que pedírselo al sintetizador).

## Adaptarlo a OTRO negocio

1. **Personas** (`wf-personas.js`): reescribe las CATEGORías y el prompt con el dominio nuevo
   (qué pide el cliente, qué objeciones tiene, qué datos da). Mantén: fechas/datos FRESCOS (no
   pasados), ~50% con "señal de compra" diseñada (para medir cierre), y diversidad real.
2. **Endpoint**: cambia la `URL` en `selfplay-runner.mjs` y el shape del body (`brand`,
   `conversationId`, `messages`) al de tu API. El runner asume streaming SSE con eventos
   `text-delta` y partes `data-*`; ajusta el parser si difiere.
3. **Etiquetas de fallo** (`PATTERN_TAGS` en `wf-selfplay-template.js`): adapta los modos de fallo
   a tu negocio (los actuales son de cotizar+reservar carros).
4. **Métrica norte**: define ANTES de medir cuál es tu "close-rate" y tu "defecto de fidelidad"
   (en rentacar fue: cerró la reserva / reservó el producto correcto).

## Cómo leer los resultados (no engañarte)

- **n=30 de una corrida tiene ~±10pp de ruido** (el bot tiene IA no determinista). Confía solo en
  señales grandes y persistentes entre corridas. Para efectos chicos: promedia 2-3 corridas o sube n.
- **Pre-registra el criterio de decisión** antes de medir (ej.: "si el defecto sigue >10% tras los
  fixes baratos → re-arquitectura"). Evita mover el poste después.
- **Separa el ruido de evaluación de los bugs reales** (en rentacar, el 36-43% de "errores" eran
  fechas del replay, no del bot).
- **Muestrea al azar**, no cures las "malas" (sesgo de selección infla los problemas).
- **Las personas guionadas NO reaccionan como un humano.** Confirman aunque el bot muestre la
  opción equivocada, así que un guardrail (ej.: una alerta "pediste automático y esto es
  mecánica") **no baja la métrica del eval** aunque proteja al cliente real. No descartes una
  mejora porque no mueve el número: pregúntate si el eval puede siquiera medirla. (Para medir
  esos casos se necesita un cliente simulado REACTIVO, no guionado — ver "self-play reactivo".)

## El patrón de mejora que funcionó

1. Diagnóstico multi-agente sobre conversaciones reales → hipótesis de modos de fallo.
2. Baseline limpio (self-play) → frecuencias y close-rate reales.
3. Rondas de fixes DETERMINISTAS, una métrica objetivo por ronda, re-medir cada vez.
4. Cuando los fixes baratos llegan a una MESETA y el residual es semántico (referencias,
   contexto) → ahí, y solo ahí, se justifica la re-arquitectura (un "Controlador" con contexto).

Ver el caso completo y los números en `SESSION-LOG-2026-06-27.md`.

## Mejora futura: self-play REACTIVO

Las personas actuales son **guiones fijos** (no reaccionan al bot). Limpio y repetible, pero no
modela a un humano que objeta cuando ve algo mal. El siguiente nivel es un **cliente simulado por
LLM**: en cada turno otra IA lee la respuesta del bot y genera el mensaje del cliente reaccionando
de verdad (objeta el precio, corrige "no, yo quería automático", se despide si lo ignoran).

Requiere una llave de API para el simulador (p. ej. el mismo Vercel AI Gateway que usa el bot).
El runner cambiaría: en vez de leer `messages` de `personas.json`, llamaría al LLM-cliente con
el historial para producir el siguiente turno. Con eso SÍ se medirían cosas que el guion no ve
(guardrails, recuperación ante confusión, abandono por mal trato).
