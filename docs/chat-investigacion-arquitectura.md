# Investigación: cómo se construyen chatbots de ventas/atención nivel producción

> Informe de investigación (deep-research, 2026-06-25). 25 fuentes, 24 afirmaciones
> verificadas con votación adversarial (3 verificadores por afirmación, ≥2/3 refutan = se descarta).
> Notas de trabajo para el rediseño del chatbot. Rama `preview/chat-test`.

## Conclusión central

La evidencia de producción (2024–2026) converge: los chatbots transaccionales confiables **NO** se construyen con un único prompt gigante "todo al LLM", sino con una **arquitectura híbrida** donde código determinista (máquina de estados, flujos, validaciones) orquesta y restringe al LLM a roles estrechos. El LLM entiende y conversa; el código manda la lógica de negocio y presenta lo fijo.

## 1. Arquitectura de producción (verificado)

- **Separar lo determinista de lo generativo es el patrón dominante.** Rasa CALM, Taskyto (ACM CUI '24), Decagon AOPs y Genie convergen. *"a direct use of LLMs alone – via monolithic, complex prompts – is not feasible"* (Taskyto, peer-reviewed). [dl.acm.org/doi/10.1145/3640794.3665538]
- **Ganancia medible:** Genie (Stanford, ACL 2025, estudio con 62 usuarios) elevó la completitud de objetivos de **21.8% → 82.8%** al limitar el LLM a (1) parsear input y (2) generar respuestas según contexto, mientras un runtime determinista ejecuta la política. [arxiv.org/pdf/2407.05674]
- **Comando vs ejecución mejora la depuración:** el LLM emite comandos discretos; el código los ejecuta → se puede saber por qué el bot hizo lo que hizo. [rasa.com/docs/learn/concepts/calm/]

## 2. Confiabilidad (verificado)

- **Tool-calling es el mecanismo correcto para datos críticos** (precios, políticas, reservas). FnCTOD (ACL 2024, Meta/UCSB) supera el SOTA previo +5.6% al framear el seguimiento de estado como function-calling. [arxiv.org/pdf/2402.10466]
- **Prompts gigantes dañan la obediencia:** incluso con recuperación perfecta de la info relevante, el desempeño cae **13.9%–85%** al crecer el contexto; persiste aun enmascarando lo irrelevante (aísla la longitud como causa). Favorece prompts cortos/modulares. [arxiv.org/html/2510.05381v1, EMNLP 2025]
- **RAG + razonamiento** son las dos estrategias dominantes contra alucinaciones, PERO RAG **reduce, no elimina** (17–33% de alucinación reportada en RAG legal comercial; depende de la calidad del retrieval). [arxiv.org/pdf/2510.24476]
- La repetición de texto es un fenómeno conocido de la generación local token-a-token (un patrón emitido se auto-refuerza) → se controla mejor con código que con instrucciones.

## 3. Frameworks (verificado parcialmente)

- **Vercel AI SDK (nuestro stack) ya recomienda este enfoque:** *"Start with the simplest approach... Add complexity only when required"*, y framea el diseño como "flexibilidad vs control". Codifica patrones de workflow (chains, routing, parallel, orchestrator-worker, evaluator-optimizer). [ai-sdk.dev/docs/agents/workflows]
- **Scaffolding nativo:** el SDK extrae la tool-call, valida argumentos contra el schema (Zod), ejecuta y guarda en el historial; orquesta multi-step (stopWhen/stepCountIs). AI SDK 6 añade **ToolLoopAgent** (loop de herramientas listo) y **strict mode** (garantiza que los inputs de la tool cumplan el schema exacto). [vercel.com/blog/ai-sdk-6]
- Otros: Rasa CALM (máquina de estados/flujos madura), LangGraph (state machines explícitas), Mastra (TS-native con memoria/orquestación). El SDK actual NO tiene memoria/orquestación durables nativas más allá del tool-loop → la capa de estado se añade alrededor.

## 4. Empresas referentes

- **Sierra** (Bret Taylor): cada agente se arma con **15+ modelos** (frontier, open-weight, propietarios), eligiendo el mejor por tarea — no un solo LLM con prompt gigante. [sierra.ai/blog/constellation-of-models]
- **Decagon:** "ecosistema de agentes" que se revisan entre sí; pasos sensibles (reembolsos, verificación de identidad) en **código determinista**. [decagon.ai/blog/why-we-built-aop]

## 5. Voz / audio (NO verificado a fondo — investigar aparte)

Extraído de fuentes pero sin la verificación adversarial del resto; tratar como preliminar:
- Dos arquitecturas: **cascada** STT→LLM→TTS (~2–4 s, auditable) vs **voz-a-voz** (~500 ms, más natural, menos inspeccionable).
- Meta de latencia para sonar natural: **< 800 ms** (300–800 ms es el punto dulce; > 1500 ms rompe la conversación).
- Costo: **~$0.13–$0.30 USD/min** (suma STT + TTS + LLM + orquestación + transporte).
- Proveedores mencionados (sin verificar): OpenAI Realtime, ElevenLabs, Deepgram, Pipecat, LiveKit, Vapi, Retell.
- **Pendiente:** ronda de investigación dedicada (latencia real en español, proveedores, build-vs-buy) antes de decidir.

## 6. Recomendación accionable

Dirección, en orden:
1. **Mover lo determinista fuera del prompt → a código:** saludo, requisitos, formato de la cotización, datos predecibles (horas extra). Elimina la repetición de raíz y el "no supo responder".
2. **Restringir el LLM** a parsear input y generar respuestas según contexto (patrón Genie/CALM) mediante una máquina de estados / flujos sobre el SDK.
3. **Acortar el prompt monolítico** en prompts por estado/módulo → recupera obediencia.
4. **Usar el scaffolding nativo del SDK** (ToolLoopAgent, strict mode, workflow patterns) en vez de hand-rollear el loop.
5. **Voz:** investigación aparte antes de comprometer.

## Salvedades

- **Voz/audio sin verificar** en este lote → ronda dedicada.
- **Sesgo vendor** en Rasa/Decagon/Vercel (fuentes primarias del propio proveedor): buenas para describir arquitectura, no como prueba de superioridad. Las cifras fuertes (Genie 21.8→82.8, contexto 13.9–85%, FnCTOD +5.6%) sí son de papers peer-reviewed independientes (ACL/EMNLP 2024–2025).
- **Refutado (overclaim):** "los bots de solo-LLM son inservibles para producción" — NO se sostiene; lo correcto es que el híbrido es medible y consistentemente mejor, no que el solo-LLM sea inútil.
- AI SDK 6 / ToolLoopAgent / strict mode son de dic-2025 → verificar versiones/API actuales antes de implementar.

## Preguntas abiertas

- Voz: latencia/costo/turn-taking reales por proveedor, factibilidad en español, sobre Vercel AI SDK.
- Frameworks para ESTE caso: ¿quedarnos en Vercel AI SDK + capa de estado propia, o combinar con Rasa CALM / LangGraph / Mastra? No hay benchmark directo.
- Cómo **medir** la mejora (goal completion, tasa de repetición, exactitud de datos, alucinación de precios) y con qué harness validar antes de producción.
