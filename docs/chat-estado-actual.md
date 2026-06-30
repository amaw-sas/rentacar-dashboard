# Estado actual del chatbot (preview)

> Notas de trabajo. Rama `preview/chat-test`. NO es producción.
> Última actualización: 2026-06-25.

## Qué es y dónde

- **Bot:** asesor virtual ("Valeria") de alquiler de carros. Marcas: alquilatucarro, alquilame, alquicarros.
- **Link de prueba:** `https://rentacar-dashboard-git-preview-c-5e09c0-info-42181061s-projects.vercel.app/chat-test`
- **Motor (IA):** gpt-5, razonamiento "low". Cambiable por la variable `CHAT_MODEL` sin tocar código.
- **Capacidades:** cotiza precios reales (Localiza) y crea reservas reales de punta a punta.

## Lo que funciona (verificado en vivo)

- Cotización real por ciudad / fechas / sede.
- Creación de reserva end-to-end (cuando Localiza responde a tiempo).
- Punto de recogida **sin** dirección exacta, **sin** mapa, **sin** nombrar "Localiza" (protege la comisión).
- Híbridos verificados por ciudad (con la herramienta de cotización).
- El aviso de filtro crediticio **no** sale en el chat (va después de la reserva).
- Botones de fallback (web + WhatsApp) aparecen con URLs bien construidas cuando una reserva falla.
- "Dame un momento, estoy creando tu reserva…" antes de procesar.

## Arreglos de esta sesión (desplegados)

| Tema | Estado |
|---|---|
| Recogida sin mapa/dirección/Localiza | ✅ |
| Híbridos por ciudad | ✅ |
| Filtro crediticio fuera del chat | ✅ |
| Teléfonos de asesores bancarios eliminados | ✅ |
| Doble "¿confirmo?" | ✅ |
| Confusión de horarios de noche | ✅ |
| Frase de espera "dame un momento" | ✅ |
| Botones web/WhatsApp en la página de prueba | ✅ |
| Botón WhatsApp del asesor cuando llega solo (hablar_asesor) | ✅ verificado en vivo (alquicarros → wa.me/573146826821) |

## Temas ABIERTOS (los 4 frentes)

- **A — Repetición** (saludo, lista de precios y respuestas que se repiten cada turno). **NO se resuelve con prompt** (ya se intentó 3 veces). Es comportamiento del modelo: tiene memoria completa y reglas explícitas, y aun así repite. Alternativas a estudiar: andamiaje determinista (sacar lo fijo del control de la IA), prompt corto, cambiar el modelo, o filtro por código.
- **B — Link prellenado + WhatsApp del asesor a pedido.** Hoy NO existe como función: el link "listo para reservar" solo aparece cuando una reserva falla, y el prompt prohíbe dar el WhatsApp del asesor (que sí existe: 573016729250). Hay que construirlo.
- **C — Imágenes de los carros.** Factible: la data existe (tabla `category_models`, ~46 modelos con foto). Falta exponerla y renderizarla.
- **D — Mostrar 2+ vehículos por gama en la cotización.** Factible con la misma data (cada gama tiene varios modelos, uno marcado "default").

## Mejora puntual pendiente

- ~~**Horas extra:**~~ ✅ RESUELTO — ver "Replay en vivo" abajo. La solución NO fue "exponer un renglón escondido": Localiza solo entrega el cargo cuando se cotiza CON horas extra, así que el orquestador re-cotiza con la devolución en la banda facturable (+3 h) y reporta la cifra real por gama.

## Replay en vivo (2026-06-25, post-Etapa 4, alquicarros)

Batería contra el orquestador (`CHAT_ORCHESTRATOR=on`) en `/chat-test`:

- **Mensual ✅:** "carro por un mes en Bogotá" → pide fecha + tier km (1000/2000), aclara km LIMITADO, cotiza Gama C $4.252.000/30d/2000km (agosto). Verificado: el número sale de `category_pricing` (fila vigente para el MES del alquiler, no hoy); si no hay fila, **devuelve error** ("un asesor te ayuda"), no inventa. Agosto está seeded (migración 026). Ruta arquitectónicamente sólida.
- **Conductor adicional ✅ (despeja duda abierta):** "$12.000/día por seguro del conductor" es REAL — está en la KB (migración 070, varias entradas). El bot NO lo inventó.
- **✅ Hora extra — RESUELTO (verificado en vivo local):** ante "¿cuánto vale la hora extra?" el orquestador re-cotiza la misma ciudad/fechas/sede con la devolución en la banda facturable de Localiza (recogida + 3 h) y responde la cifra REAL por gama: "Para la Gama C en Bogotá, cada hora extra cuesta **$23.107**…". **Patrón de Localiza descubierto:** gracia de 1 h (devolución +1h da 0), banda facturable 2–4 h (precio lineal, $23.107/h en este caso), y >4 h pasa a día completo (0 horas extra). Por eso el bump es +3 h y se divide `precio/horas`. Si la re-cotización falla → cae a la política (freeForm). Código: `answerHoraExtra` + `extraHourDropoff` en `orchestrator/index.ts`, `horaExtraLine` en `blocks.ts`.
- **✅ Re-pegado (Frente A) — RESUELTO (verificado en vivo local):** dos fuentes de re-pegado eliminadas: (1) la rama off-funnel de `advanceBooking` y el `phaseReprompt` de `choosing_gama` ahora usan `gamaNudgeLine` ("¿Con cuál gama te quedas?") en vez de re-listar las 10 gamas; (2) la rama `wantsVehicles` sin gama de `handleOnDemand` ahora devuelve `false` (deja que freeForm responda la pregunta real) en vez de re-pegar la lista. Verificado: 2 tangenciales seguidas → conteo de "Tenemos:" en toda la conversación = **0**, y el bot SÍ responde la pregunta. NO era prompt (3 intentos fallidos) — era estado del orquestador, como se predijo. La lista completa se conserva SOLO para gama inválida (uso legítimo).
- **🟡 Visión de túnel al cerrar (abierto, menor):** al elegir gama + preguntar "¿hay sede cerca del aeropuerto?", el bot saltó directo a "¿Me compartes tu nombre completo?" e IGNORÓ la pregunta de sede. Menor, pero molesta.
- **🟡 Extractor mapea "económico" → `gama_elegida:"E"` (abierto, menor):** código de gama inválido (las gamas son C, CX, F…); además a veces fija gama_elegida espuriamente y salta el funnel a recolección. Pre-existente al extractor, no bloquea. Mitigado: `findGama` no resuelve "E" → no rompe; `answerHoraExtra` cae a la gama representativa.
- **🟡 Orden de burbujas (cosmético):** el nudge corto se emite ANTES de la respuesta de freeForm (writeText síncrono vs stream async). Funcional pero el orden ideal sería respuesta→nudge; arreglo requiere esperar el fin del stream. Diferido.

## Hallazgos clave

- **La repetición es adherencia del modelo**, no falta de memoria ni de reglas.
- **Orden en que la IA busca información:** 1) herramientas (verdad en vivo: cotizar, info_sedes, tarifa_mensual, info_gamas) → 2) base de conocimiento editable (políticas, requisitos, objeciones, tono) → 3) reglas del prompt → nunca inventar de su memoria. El hueco: datos que no están limpios ni en herramienta ni en la base (como el precio plano de una hora extra) → la IA falla.
- **Timeout de Localiza:** el 23-jun reservaba en 1–5 s; el 25-jun todos los intentos cortan a ~25 s. Es del lado de Localiza, no del código. Pendiente: probar una reserva completa exitosa cuando se normalice.

## Decisiones tomadas (usuario)

- Reservas reales OK durante pruebas; el usuario las cancela en Localiza.
- No publicar a producción sin probar antes en el preview.
- Para la repetición: "probar otra IA" es la primera opción, pero se quieren estudiar alternativas de arquitectura antes de decidir.

## Accesos / entorno

- Supabase service-role en `.env.local` (usar `NEXT_PUBLIC_SUPABASE_URL`, la `SUPABASE_URL` viene vacía).
- Vercel: token de 1 h (expira). Entorno **preview** ya configurado: reservas ON, límites anti-abuso en 999 para no trabar las pruebas.
- Migraciones 071 + 072 ya aplicadas en la BD.
- **Posibles reservas de prueba huérfanas en Localiza** (a nombre de "Prueba Claude Test", "Test Botones", "Test Momento", ~25-jun) — revisar y cancelar allá.
- Para correr tests localmente: Node 22 portátil en `/tmp`, `COREPACK_INTEGRITY_KEYS=0`, `pnpm exec vitest run`.

## En curso

- **Investigación profunda** (deep-research) sobre cómo construyen los profesionales estos bots: arquitectura determinista vs todo-al-LLM, confiabilidad/anti-repetición, frameworks/repos open-source, empresas referentes, y voz/audio que suene humano. Pendiente: leer el informe y decidir la dirección.

## Próximo paso

Esperar el informe → decidir dirección de fondo (rediseño por etapas + posible voz) → ejecutar por orden de impacto.
