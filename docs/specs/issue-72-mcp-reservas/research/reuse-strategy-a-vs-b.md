# Research — Estrategia de reuso: A (in-process) vs B (HTTP self-call)

**Fecha:** 2026-06-12 · **Tipo:** análisis interno de código (no web). Basado en el grounding del discovery.

## El problema
`app/api/mcp/[transport]/route.ts` y los endpoints públicos (`/api/reservations`, `/api/reservations/availability`, `/api/locations`) viven en el **mismo deployment de Vercel**. ¿Cómo alcanza la herramienta MCP la lógica que esos endpoints ya implementan?

## Estado actual del código
Hoy la lógica está **inline dentro de los route handlers**: auth (`x-api-key`) + parse + validación + resolución de referencias + `fetch` al proxy Railway + persistencia Supabase + notificaciones, todo en `app/api/reservations/route.ts` (POST, ~290 líneas) y `app/api/reservations/availability/route.ts`. No hay una capa de servicio en `lib/` que el handler simplemente invoque.

## Opciones

### A · In-process (extraer a `lib/`) — ✅ ELEGIDA
Extraer el **núcleo de negocio** (todo lo posterior a auth+parse) de cada route handler a funciones de servicio en `lib/api/`:
- `lib/api/availability-service.ts` → `searchAvailability(input): Promise<AvailabilityResult>`
- `lib/api/reservation-service.ts` → `createReservation(input): Promise<ReservationResult>`

Tanto el route handler público **como** la herramienta MCP llaman a estas funciones. La auth y el parsing quedan en cada borde (el handler público sigue con `x-api-key`/`RESERVATION_API_KEY`; el MCP con su `verifyToken`).

**Pros:** cero round-trip de red extra; una sola auth por llamada; tipado compartido end-to-end; testeable sin levantar servidor. Crítico para `crear_solicitud_reserva` que **ya es lento** (proxy Localiza + email inline, 20s–2min — issue #100 / incidente 504): un hop Vercel→Vercel encima sería inaceptable.

**Contras / riesgo:** refactor que toca el path de producción `/api/reservations` que **consumen los dos funnels activos (`rentacar-web` + `rentacar-reservas`)**. Mitigación dura: la extracción es **behavior-preserving** — se mueve el cuerpo verbatim a la función de servicio y el handler pasa a ser `auth → parse → return service(input)`. El contrato request/response del endpoint público **no cambia**. Se verifica con los tests existentes del endpoint + nuevos tests de la función de servicio.

### B · HTTP self-call — ❌ descartada para Fase 1
La herramienta MCP hace `fetch(\`${baseUrl}/api/reservations\`, { headers: { "x-api-key": RESERVATION_API_KEY } })`.

**Pros:** cero refactor; reusa el endpoint tal cual.
**Contras:** (1) hop Vercel→Vercel = latencia + posible cold start, inaceptable sobre el path ya lento de reserva; (2) requiere resolver la URL absoluta propia (`VERCEL_URL`/`VERCEL_PROJECT_PRODUCTION_URL`), frágil entre preview/prod; (3) doble auth (el MCP server tendría que custodiar `RESERVATION_API_KEY` para llamarse a sí mismo); (4) doble serialización JSON.

## Decisión
**A (in-process), behavior-preserving.** El refactor de extracción es un paso explícito y temprano del plan, validado por tests antes de tocar el MCP. La regla de arquitectura del repo (mutaciones en `lib/actions/`, reads en `lib/queries/`) ya favorece lógica en `lib/`; estas funciones de servicio de API encajan en `lib/api/` (donde ya viven `resolve-references.ts`, `category-names.ts`, `availability-enrichment.ts`).

## Nota de alcance
`buscar_disponibilidad` también resuelve `ciudad/sede → code` vía el directorio de sedes. Esa lógica ya está extraída en `lib/api/location-directory.ts` (la usa `/api/locations`) → la herramienta MCP la reusa directo, sin pasar por HTTP. Confirma que el patrón de extracción ya existe parcialmente en el repo.
