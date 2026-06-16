# Runbook — Servidor MCP de reservas (issue #72)

Cómo provisionar, registrar y probar el servidor MCP que expone la búsqueda de
disponibilidad y la creación de reservas a clientes de IA.

## Qué es

Un endpoint MCP (Model Context Protocol) montado en el propio dashboard
(`app/api/mcp/[transport]/route.ts`), transporte **Streamable HTTP**, servidor
**stateless**. Envuelve el mismo flujo Localiza que ya usan los dos funnels; no
abre un camino nuevo a Railway ni a la base de datos.

Expone dos herramientas:

- **`buscar_disponibilidad`** — recibe ciudad y fechas, devuelve las gamas
  disponibles con precio en COP y descripción en español, y un `quote` opaco por
  gama.
- **`crear_solicitud_reserva`** — recibe el `quote` de la gama elegida más los
  datos del cliente, y crea la reserva real en Localiza.

El `quote` es un blob opaco: la IA lo recibe de la primera herramienta y lo
reenvía tal cual a la segunda. El servidor no guarda sesión; todo el contexto de
la cotización viaja en ese `quote`.

### Fuera de alcance (Fase 1)

- Reservas mensuales (`selected_days >= 30`).
- Seguro total — si llega `total_insurance: true`, la herramienta lo rechaza.
- OAuth / registro en Claude.ai o ChatGPT (eso es Fase 2).

## Autenticación

`x-api-key` en el header, comparado contra la variable **`MCP_API_KEY`**.

**`MCP_API_KEY` es un secreto distinto de `RESERVATION_API_KEY`** (la key de los
funnels públicos). No reuses el mismo valor: separarlos permite rotar o revocar
el acceso de la IA sin tumbar los funnels.

Sin key, o con una key incorrecta, el servidor responde 401.

## Provisionar la key

1. Genera un secreto fuerte:

   ```bash
   openssl rand -hex 32
   ```

2. Cárgalo en Vercel (proyecto del dashboard, team `info-42181061`) como
   `MCP_API_KEY`, en los entornos donde aplique (Preview y Production).
   **No reuses el valor de `RESERVATION_API_KEY`.**

3. Para pruebas locales, ponlo en `.env.testing` (o `.env.local`):

   ```
   MCP_API_KEY=<el-secreto-de-prueba>
   ```

## Registrar el conector

- **URL:** `https://<dominio-del-dashboard>/api/mcp/mcp`
- **Transporte:** Streamable HTTP
- **Header de auth:** `x-api-key: <MCP_API_KEY>`

El segmento final (`/mcp`) es el `[transport]` que resuelve `mcp-handler`.

## Flujo de dos pasos

1. La IA llama `buscar_disponibilidad`:

   ```json
   { "ciudad": "bogota", "fecha_recogida": "2026-07-01", "fecha_devolucion": "2026-07-05" }
   ```

   Devuelve, por gama, `{ categoria, descripcion, dias, precio_total, precio_a_pagar, iva, quote }`.

   - `hora` (opcional, default `10:00`) se aplica a recogida y devolución.
   - `sede` (opcional) desambigua ciudades con varias sedes.

2. La IA elige una gama y llama `crear_solicitud_reserva` con ese `quote` más los
   datos del cliente:

   ```json
   {
     "quote": "<el-quote-opaco-de-la-gama>",
     "fullname": "Juan Pérez",
     "identification_type": "CC",
     "identification": "123456789",
     "email": "juan@example.com",
     "phone": "3001234567",
     "franchise": "alquilatucarro"
   }
   ```

   Extras opcionales: `extra_driver`, `baby_seat`, `wash`, `flight`, `aeroline`,
   `flight_number`. Devuelve `{ estado, numero_solicitud, mensaje }`.

   Si el `quote` está corrupto o expiró, la herramienta responde con error en
   español **sin** crear nada. La IA debe volver a buscar disponibilidad.

## QA local con MCP Inspector

Prueba contra la branch de testing de Supabase, nunca contra producción.

1. Arranca el dashboard con el entorno de testing:

   ```bash
   set -a && . ./.env.testing && set +a && pnpm dev
   ```

2. En otra terminal, abre el Inspector:

   ```bash
   npx @modelcontextprotocol/inspector
   ```

3. Conecta:
   - URL: `http://localhost:3000/api/mcp/mcp`
   - Transporte: Streamable HTTP
   - Header: `x-api-key` con el valor de `MCP_API_KEY` de `.env.testing`

4. Verifica:
   - Lista exactamente dos herramientas.
   - `buscar_disponibilidad` devuelve gamas con su `quote`.
   - Copia un `quote`, ejecútalo en `crear_solicitud_reserva` y confirma la reserva
     en la branch de testing.
   - Sin el header `x-api-key`, la conexión es rechazada (401).

## Notas de despliegue

- **`maxDuration`:** el route pide 300s. La creación puede tardar minutos en el
  peor caso (proxy Localiza + email inline, ver #100/#99); con menos margen, una
  función cortada a mitad dejaría una reserva fantasma. Confirma el techo real del
  plan Vercel del proyecto; si queda por debajo de ~120s, mueve el envío de email
  a `after()` para esta ruta.
- **Monitoreo:** logs de Vercel del endpoint `/api/mcp`. Si creas una reserva de
  prueba, cruza con `notification_logs` (el snapshot de verdad).
- **Rollback:** el endpoint es aditivo. Revertir = quitar la ruta `/api/mcp` y su
  prefijo en `middleware.ts`. Las extracciones a `lib/api/*-service.ts` son
  behavior-preserving y se quedan: no rompen ninguno de los dos funnels.
