# Discovery — Issue #72: MCP server de reservas

**Mode:** interactive · **Fecha:** 2026-06-12 · **Origen:** auditoría agéntica 2026-05-26 (#1a), épico `amaw-sas/rentacar-web#63`
**Goal:** Grounding del issue #72 contra el código real del dashboard — cerrar 4 decisiones (transporte, auth, hosting, mapeo a Localiza) antes de planear.

> Este discovery es **empírico**: las decisiones se cierran contra el código, no contra supuestos. Tres sub-agentes (solo-lectura, opus) investigaron disponibilidad+Localiza, creación de reserva, y auth/hosting/precedente MCP. Hallazgos cruzados y consistentes.

---

## Arquitectura real (confirmada)

Proxy delgado de **dos saltos**: **Dashboard** (Next.js 16.2.1, Vercel) → **`proxy/`** (Express, paquete separado, Railway) → **Localiza** (SOAP/OTA). El dashboard NO habla SOAP; el proxy traduce JSON↔XML. **La reserva ya funciona hoy**: un *funnel* → `POST /api/reservations` del dashboard → proxy → Localiza. El MCP es un *wrapper* sobre los endpoints HTTP del dashboard — no toca el proxy ni Localiza directamente.

#### Consumidores de la API del dashboard (blast radius — confirmado por el usuario 2026-06-12)
Un **funnel** = web de cara al cliente que recorre el embudo de reserva (elige ciudad/fechas → ve disponibilidad+precios → llena datos → crea reserva), consumiendo `/api/reservations/availability` + `/api/reservations`.

**Hoy hay DOS funnels activos en prod, AMBOS consumen la misma data del dashboard:**
- **`rentacar-web`** — funnel; iba a *reemplazar* a rentacar-reservas, pero directiva lo mantiene como el sucesor activo.
- **`rentacar-reservas`** — funnel Nuxt SPA (branches por franquicia); directiva decidió mantenerlo vivo pese al plan de reemplazo.

⇒ **Cualquier cambio en la estructura de datos de la API del dashboard incide en LOS DOS.** El MCP de #72 es, en efecto, un **tercer funnel (para agentes IA)** sobre los mismos endpoints. Toda afirmación "contrato a preservar" / "fuente del mapeo de precios" en este spec aplica a **ambos** funnels, no a uno. (Corrección: una versión previa nombraba solo `rentacar-web`.)

Endpoints existentes relevantes:
- `POST /api/reservations/availability` — cotización. Auth `x-api-key` = `RESERVATION_API_KEY`. (`app/api/reservations/availability/route.ts:5-13`)
- `POST /api/reservations` — creación. Misma auth. (`app/api/reservations/route.ts:90-98`)
- `GET /api/locations` — directorio sedes, público sin key, CORS `*` (#73). Resuelve `ciudad/slug → code`. (`app/api/locations/route.ts`)
- `GET /api/openapi` — contrato fetchable, **ya construido "for the MCP server (#72)"** (`app/api/openapi/route.ts:6`).

---

## Las 4 decisiones — estado tras grounding

### D1 · Mapeo a la integración Localiza — ✅ CERRADA por código

El flujo es **obligatoriamente de dos pasos con estado opaco**:

1. `buscar_disponibilidad` ⇒ se implementa como: (a) `GET /api/locations` para resolver `ciudad`/`sede` → `code` (ej `bogota`→`AABOT`); (b) combinar fecha+hora en `YYYY-MM-DDTHH:mm:ss`; (c) `POST /api/reservations/availability` con `{pickupLocation, returnLocation, pickupDateTime, returnDateTime}` + `x-api-key`. La respuesta **ya viene en español** (#74 PR #128, traducción en origen, degradación segura). (`app/api/reservations/availability/route.ts:82-91`)

2. **`referenceToken` SÍ existe — pero es un par acoplado**: cada item de disponibilidad emite `referenceToken` + `rateQualifier` + `categoryCode`. (`proxy/src/localiza/availability.ts:153,172,173`)

3. **CRÍTICO — la creación NO es token-only.** `POST /api/reservations` exige ~16 campos requeridos: datos de cliente (`fullname, identification_type, identification, phone, email`) **+ todo el contexto de cotización** (`category, pickup_location, return_location, pickup_date, pickup_hour, return_date, return_hour, selected_days, total_price, total_price_to_pay, franchise`) **+** `reference_token` + `rate_qualifier` (obligatorios para reservas estándar `selected_days < 30`). (`app/api/reservations/route.ts:111-116,185-190`) El `referenceToken` por sí solo NO reconstituye el contexto.
   - **find-or-create de customer es seguro: NO muta** registros existentes (fix #25/#26). El wrapper puede pasar datos crudos sin riesgo. (`lib/api/resolve-references.ts:60-62`)

**Implicación de diseño:** la firma del issue `crear_solicitud_reserva(referenceToken?, nombres, ...)` es **insuficiente**. La herramienta de creación debe recibir de vuelta el item completo elegido (token + qualifier + categoryCode + precios + fechas + sedes + franchise). Esto se resuelve manteniendo estado en el cliente MCP entre las dos llamadas, o devolviendo en `buscar_disponibilidad` un "blob" opaco por item que `crear_*` reenvía intacto.

### D2 · Hosting / runtime — ✅ MAYORMENTE CERRADA por código

- Vercel, Next 16.2.1 App Router. `vercel.json` solo define crons; `next.config.ts` vacío; sin `maxDuration` (defaults de Vercel por plan).
- Si el MCP toca el admin client / DB ⇒ **obligatorio `export const runtime = "nodejs"`** (precedente `app/api/locations/route.ts:11`; el admin client no corre en edge).
- **Cero precedente de SSE/streaming** en el repo — todos los handlers devuelven `NextResponse.json` de un golpe. El MCP sería el primer endpoint con conexión sostenida.
- SDK `@modelcontextprotocol/sdk` v1.29.0 está en el lockfile pero **solo transitivo vía `shadcn` CLI** — hay que añadirlo como dependencia directa.
- **No existe ningún MCP server / `/api/mcp` hoy.** Sería nuevo.

#### Topología — el MCP NO habla con Railway directamente

```
Cliente MCP ──(Streamable HTTP, x-api-key)──▶ app/api/mcp/  ┐
                                                            │  mismo deployment Vercel
   reutiliza la lógica de /api/reservations(/availability) ·· /api/locations  ┘
                                                            │
                  fetch(LOCALIZA_PROXY_URL, x-api-key: PROXY_API_KEY)
                                                            ▼
                                          proxy/ (Express, Railway) ──SOAP/XML OTA──▶ Localiza
```

El MCP vive en Vercel y **envuelve los endpoints que ya existen**. **Solo esos endpoints hablan con Railway** (`availability/route.ts:52-59`, `reservations/route.ts:206-225`). El salto a Railway ya está encapsulado; Railway es **un único hop** detrás de la capa Vercel.

**Por qué el MCP NO debe pegarle a Railway directo:** toda la lógica de negocio vive en la capa Vercel entre el endpoint público y el proxy — traducción PT→ES (#74), resolución `slug→code` (#73), find-or-create sin mutar (#25/#26), persistencia Supabase, notificaciones (email inline + WATI/GHL en `after()`), par `referenceToken`/`rateQualifier`, snapshot-at-booking. Pegarle directo al proxy se saltaría todo eso y exigiría las credenciales del proxy en el MCP. El MCP se queda en la capa Vercel.

#### ⚠️ Sub-decisión diferida a planning — cómo el MCP alcanza la lógica del dashboard

Como `app/api/mcp/` y `/api/reservations` están en el **mismo app**, "reutilizar los endpoints" admite dos formas (Railway sigue siendo un solo hop en ambas; difiere solo el alcance MCP→lógica):

| Opción | Cómo | Trade-off |
|---|---|---|
| **A · In-process** (preferida a priori) | Extraer la lógica de los route handlers a funciones compartidas en `lib/`; endpoint público y herramienta MCP las llaman | Cero round-trip extra, una sola auth. Requiere refactor (hoy la lógica está inline en los handlers) |
| **B · HTTP self-call** | La herramienta MCP hace `fetch` a su propio `/api/reservations` con `x-api-key` | Sin refactor, reusa el endpoint tal cual. Añade hop Vercel→Vercel (latencia + posible cold start + doble auth) |

Decisión A vs B: **diferida a `sop-planning`.**

### D3 · Transporte (HTTP/SSE) — ✅ DECIDIDA: Streamable HTTP

Sin precedente en el repo. El estándar MCP moderno para servidores **hosted** es **Streamable HTTP** (un solo endpoint POST, reemplazó al transporte SSE legacy). `stdio` es solo para servidores locales — no aplica a un conector hosted. **Decisión del usuario (2026-06-12): Streamable HTTP.** Un solo endpoint POST en Vercel con `runtime = "nodejs"`.

### D4 · Auth del conector — ✅ DECIDIDA: x-api-key ahora, OAuth fase 2

- **El repo solo conoce shared-secret en header** (`x-api-key` + env var, comparación estricta en el handler). **Cero OAuth** en todo el código de app. (`middleware.ts:5-19`, `app/api/reservations/route.ts:92-98`)
- **Decisión del usuario (2026-06-12): consumidor "ambos / aún no definido"** → diseñar la **Fase 1 con shared-secret `x-api-key`** (env var dedicada, p.ej. `MCP_API_KEY`, réplica del patrón `reservations/route.ts:92-98`; nuevo prefijo en `PUBLIC_API_PREFIXES`). **OAuth (MCP Authorization spec) = Fase 2**, solo si/ cuando se registre en Claude.ai/ChatGPT. La arquitectura de Fase 1 debe dejar la puerta abierta a añadir OAuth sin reescribir las herramientas.

---

## Contradicciones del issue vs. realidad (las 3 que importan)

1. **No existe el estado `pendiente_confirmacion` ni un modo "solo registrar solicitud sin tocar Localiza".** `RESERVATION_STATUSES` no lo incluye. El endpoint **siempre crea la reserva real en Localiza** para estándar y la deja en `reservado`/`pendiente` (`LOCALIZA_STATUS_MAP`, `route.ts:60-64,254`). El único camino que NO llama a Localiza es el mensual (`selected_days >= 30` → `mensualidad`). **RESUELTO (decisión del usuario 2026-06-12): el MCP envuelve el flujo real** — crea la reserva real en Localiza igual que `rentacar-web` hoy. El "no procesa pago" ya es cierto (pago presencial). La herramienta MCP renombra el concepto a "solicitud" en su salida pero el estado interno real es `reservado`/`pendiente`; `crear_solicitud_reserva` mapea/sintetiza `{ estado, numero_solicitud, mensaje }` desde `{ reserveCode, reservationStatus }`.
2. **La respuesta no trae `numero_solicitud`/`mensaje`.** Devuelve `{ reserveCode, reservationStatus }`. El wrapper MCP debe mapear/sintetizar la forma del issue.
3. **La firma de `crear_solicitud_reserva` es insuficiente** (ver D1) — token-only no basta.

---

## Constraints

- **Técnicos:** Next 16.2.1 App Router; admin client ⇒ node runtime; auth nativa = shared-secret header; el MCP es wrapper, NO debe alterar el flujo de pago ni el proxy/Localiza. Multi-marca: `franchise` NO interviene en disponibilidad (brand-agnostic); solo aplica a creación (enruta notificaciones). El SDK MCP debe pasar a dependencia directa.
- **No-negociables:** no mutar customers existentes (ya garantizado por el endpoint); **no romper el contrato actual de `/api/reservations*` que consumen los DOS funnels (`rentacar-web` + `rentacar-reservas`)**; service-role solo en API routes.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Estado opaco entre 2 llamadas** (token+qualifier+contexto) se pierde si el cliente MCP no lo retiene | `buscar_disponibilidad` devuelve un blob opaco por item que `crear_*` reenvía intacto; validar presencia antes de llamar a creación |
| **Latencia**: creación incluye proxy Localiza (red externa, ver incidente 504) + email inline bloqueante (`route.ts:350-355`) | Diseñar timeouts del MCP tolerando varios segundos; documentar que WhatsApp/GHL son fire-and-forget post-respuesta |
| **OAuth greenfield** si el consumidor lo exige (registro Claude.ai/ChatGPT) | Decidir consumidor primero (D4); empezar con API-key si es server-to-server interno |
| **Modelo "solicitud sin pago" no existe** | Decisión de producto: ¿wrap del flujo real (crea reserva en Localiza) o construir flujo ligero nuevo? |
| **Primer endpoint con conexión sostenida** en Vercel, sin `maxDuration` | Confirmar límites de duración del plan; Streamable HTTP minimiza conexión abierta vs SSE |

## Prior art reusable
- Patrón handler protegido-con-key: `app/api/reservations/route.ts:92-98`.
- Patrón handler público con CORS+OPTIONS: `app/api/locations/route.ts:8-52`, `openapi/route.ts:7-19`.
- Contrato OpenAPI ya construido para #72: `app/api/openapi/route.ts` (ojo: `AvailabilityResponseItem` está incompleto — fuente de verdad del shape es `proxy/src/localiza/availability.ts:152-174`).

---

## Resumen

- **Factor más restrictivo:** el flujo de reserva es un **round-trip obligatorio de dos pasos con estado opaco** (`referenceToken`+`rateQualifier`+contexto de cotización). Esto define la forma de ambas herramientas MCP — no se puede reservar solo con un token.
- **Riesgo de mayor impacto:** el modelo "solo registrar solicitud sin pago / `pendiente_confirmacion`" del issue **no existe en el código** — hay que decidir si el MCP envuelve el flujo real (crea reserva en Localiza) o si se construye un flujo nuevo, antes de planear.
- **Decisiones cerradas (usuario 2026-06-12):** D3 transporte = **Streamable HTTP**; D4 auth = **x-api-key Fase 1, OAuth Fase 2**; semántica booking = **wrap del flujo real** (crea reserva en Localiza). D1 mapeo y D2 hosting ya cerradas por código.

## Alcance resultante (Fase 1)
- Nuevo route handler `app/api/mcp/` (Streamable HTTP, `runtime = "nodejs"`), nuevo prefijo en `PUBLIC_API_PREFIXES`, auth `x-api-key` dedicada.
- `@modelcontextprotocol/sdk` como dependencia directa.
- 2 herramientas que envuelven endpoints existentes: `buscar_disponibilidad` (locations + availability) y `crear_solicitud_reserva` (creación real). Manejo del estado opaco token+qualifier+contexto entre ambas.
- OpenAPI (`/api/openapi`) ya existe como contrato; verificar/cerrar el gap del `AvailabilityResponseItem` incompleto.
- **Fuera de alcance Fase 1:** OAuth, modo "solicitud ligera sin Localiza".

## Próximo paso
Todas las decisiones cerradas → **`sop-planning`** para el plan de implementación detallado.
