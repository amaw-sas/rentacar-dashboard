# Rough Idea — Issue #72: MCP server de reservas

**Fecha:** 2026-06-12 · **Discovery previo:** [discovery.md](./discovery.md) (4 decisiones de arquitectura cerradas)

## Concepto
Servidor MCP en el dashboard (Vercel) que expone 2 herramientas a clientes de IA, envolviendo los endpoints HTTP existentes del dashboard:

```
buscar_disponibilidad(ciudad, fecha_recogida, fecha_devolucion, hora?, sede?)
  → categorías con precio total, IVA, seguro, descuento + estado opaco de cotización

crear_solicitud_reserva(<estado de cotización elegido>, nombres, apellidos, tipo_id, numero_id, email, telefono, franchise)
  → { estado, numero_solicitud, mensaje }
```

## Decisiones ya cerradas (discovery)
- **Transporte:** Streamable HTTP (un endpoint POST, `runtime = "nodejs"`).
- **Auth:** `x-api-key` Fase 1; OAuth Fase 2 (sin reescribir herramientas).
- **Semántica booking:** wrap del flujo real — crea reserva real en Localiza (`reservado`/`pendiente`), no un modo "solicitud ligera".
- **Topología:** MCP en Vercel sobre endpoints del dashboard; Railway es hop único encapsulado, nunca directo.

## Sub-decisiones para el plan
1. **A (in-process, extraer lógica a `lib/`) vs B (HTTP self-call)** para reusar la lógica de los endpoints.
2. Gap del `AvailabilityResponseItem` incompleto en el OpenAPI (`/api/openapi`).
3. Cómo se transporta el **estado opaco** (`referenceToken` + `rateQualifier` + contexto de cotización) entre las 2 herramientas.

## Restricciones duras (de CLAUDE.md / discovery)
- No alterar el flujo de pago ni el contrato actual de `/api/reservations*` que consumen **los dos funnels activos (`rentacar-web` + `rentacar-reservas`)** — un cambio de estructura de la API incide en ambos.
- No mutar customers existentes (ya garantizado por el endpoint).
- Service-role solo en API routes; `runtime = "nodejs"` si toca admin client.
- `@modelcontextprotocol/sdk` debe pasar a dependencia directa.
