# WS2 spike — hallazgos Fase B (sesión 2026-06-19)

Reporte de decisión del spike WS2 (epic #172). Diseño y contrato en
`docs/specs/2026-06-19-spike-ws2-oauth-retrigger-design.md`. **En curso** — esta
sesión no cerró la pregunta de riesgo; abajo el estado y cómo retomar.

## Pregunta de riesgo

¿ChatGPT dispara/completa el flujo OAuth cuando una tool MCP responde 401 +
`WWW-Authenticate`, mientras las tools de consulta siguen anónimas (tiered auth)?

## Respuesta provisional

**El framing original ("ChatGPT no re-dispara OAuth") resultó demasiado simple y
parcialmente equivocado.** Con la configuración correcta, ChatGPT **sí** corre el
flujo OAuth completo. El riesgo real no es "no lo dispara" sino la **fiabilidad de
la asociación del token post-`/token`** y la sensibilidad a la configuración. Falta
observar el último eslabón (`crear_reserva` con Bearer → 200) para cerrar.

## Lo que se probó y aprendió

### Fase A — servidor correcto (cerrado, verde)
`npm run verify:all` → SCEN-A1/A2/A2b/A3/A4 PASS, `tsc` limpio. El MCP+AS mock
implementa el contrato wire fielmente. Esto hace que cualquier fallo en Fase B sea
atribuible al cliente o a la config, no al servidor.

### Fase B — ChatGPT (developer mode, cuenta personal, túnel cloudflared)

Tres hallazgos duros, todos respaldados por el log del servidor:

1. **El modo de auth del conector es determinante.** Al crear el conector, ChatGPT
   ofrece `OAuth` / `Sin autenticación` / `Mixta`.
   - Con **"Sin autenticación"** (primer intento): ChatGPT **nunca** intenta OAuth.
     Ante el 401 rehúsa con *"no tengo acceso operativo"* y no toca `/authorize`.
     **Esto confundió la lectura inicial como "gap" — era artefacto de config.**
   - Con **"Mixta"**: ChatGPT corre el **dance OAuth completo** (ver timeline):
     discovery → DCR (`/register` 201) → `/authorize` (302) → `/token` (200).
     **Prueba que ChatGPT SÍ hace tiered OAuth.**

2. **Las anotaciones de tool son obligatorias para que ChatGPT ejecute.** Sin
   `readOnlyHint`/`destructiveHint`/`openWorldHint`, ChatGPT marca *ambas* tools como
   **DESTRUCTIVO · ESCRITURA PÚBLICA · MUNDO ABIERTO** (defaults peligrosos) y se
   niega a ejecutar incluso la consulta. Tras anotar `buscar_disponibilidad` como
   `readOnlyHint:true`, ChatGPT la ejecutó (`→ 200`). `crear_reserva` además mostraba
   "ARGUMENTOS POCO CLAROS" hasta describir los campos del `inputSchema`.

3. **Bug del servidor (corregido esta sesión): PRM no estaba en la ruta canónica RFC
   9728.** Para `resource = <origin>/mcp`, ChatGPT prueba primero
   `/.well-known/oauth-protected-resource/mcp` → daba **404** (solo servíamos la raíz).
   Encontraba el PRM por fallback en la raíz, pero la discrepancia ruta-vs-`resource`
   es sospechosa de romper la asociación del token. **Fix:** servir PRM en ambas rutas
   y apuntar el `WWW-Authenticate` a la canónica. Verificado 200 en ambas tras el fix.

### El punto donde quedó abierto

Tras el dance completo, el `/token` devolvió 200 (token emitido) **pero nunca se
observó `crear_reserva auth=Bearer → 200`**. La UX post-auth de ChatGPT fue confusa
("apareció algo de auth pero me devolvió a config de la app") y el conector quedó en
estado roto (en chat nuevo ni la consulta anónima llegaba al servidor). Se aplicó el
fix de PRM canónico y se reinició; en el último re-discovery la ruta canónica ya da
200 y el reto `crear_reserva → 401` volvió a disparar, pero la sesión se detuvo antes
de confirmar el `Bearer → 200`.

## Otros datos de observación (no confundir con el resultado)
- **406**: el probe de conexión de ChatGPT a veces da 406 (el transport exige
  `Accept: application/json, text/event-stream`). Es conformidad de transporte, no
  señal sobre OAuth.
- ChatGPT corre su propio paso de confirmación ("confirma con sí") antes de tools
  consecuentes (write/openworld). Eso **no** es el consent OAuth.

## Timeline del servidor (evidencia)

```
22:30  GET PRM 200 · GET AS 200 · crear_reserva 401          (probe connect-time, "Sin auth")
22:50  buscar_disponibilidad 200                              (tras anotar readOnlyHint → ejecuta)
22:59  crear_reserva 200                                      (experimento gate OFF: sin 401, ChatGPT sí llama)
23:03  crear_reserva 401                                      (gate restaurado ON)
--- conector recreado en "Mixta" ---
23:05  406 · PRM/mcp 404 · /mcp/PRM 404 · PRM 200 · AS 200 · openid 200
23:06  register 201 · authorize 302 · token 200              (DANCE OAUTH COMPLETO)
        (no se observó crear Bearer→200; UX post-token confusa, conector quedó roto)
--- fix PRM canónico aplicado + server reiniciado ---
23:13  PRM/mcp 200 (antes 404) · PRM 200 · crear_reserva 401  (reto re-disparó; sesión detenida aquí)
```

## Cómo retomar (otra máquina, mañana)

El túnel y el server eran locales y efímeros — **no existen mañana**. Reconstruir:

1. Worktree/branch: `spike/ws2-oauth-retrigger`. `cd spikes/ws2-mcp-oauth && npm install`.
2. Gate de Fase A: `npm run verify:all` (debe dar SCEN-A1..A4 PASS).
3. Levantar túnel: `cloudflared tunnel --url http://localhost:8787` → copiar la URL.
4. `PORT=8787 SPIKE_BASE_URL="https://<tunnel>" npm run server` (gate ON por defecto).
5. En ChatGPT: crear conector con **Autenticación = "Mixta"**, URL = `https://<tunnel>/mcp`.
   Completar el auth en la config del conector (botón Conectar/Autenticar).
6. Chat nuevo → buscar → crear + confirmar. **Objetivo: ver `crear_reserva auth=Bearer → 200`.**
7. Si la asociación del token sigue rompiéndose pese al PRM canónico → es **gap de UX
   del cliente ChatGPT**; documentar y evaluar fallback (`securitySchemes` per-tool —
   propietario, no portable a Claude — o pre-auth a nivel conexión).

## Pendiente además
- **Claude como control** (no ejecutado aún): mismo servidor, conector custom por URL.
- Decisión de portabilidad: el camino que funcionó en ChatGPT ("Mixta") es de ChatGPT;
  validar que el mismo 401 portable funcione en Claude antes de declarar el diseño
  agnóstico de #172.
