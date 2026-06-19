# Spike WS2 — ¿ChatGPT re-dispara OAuth ante un 401 mid-session?

**Fecha:** 2026-06-19
**Epic:** #172 — Eslabón OAuth para conectar el MCP/API desde ChatGPT y Claude
**Workstream:** WS2 (comportamiento tiered-auth — el punto de riesgo)
**Tipo:** Spike. Instrumento desechable, no producción.

## Pregunta de riesgo

Toda la arquitectura de #172 (tiered/lazy auth: consultas anónimas, reserva gateada por OAuth) cuelga de un punto no confirmado:

> Cuando una tool protegida responde **HTTP 401 con `WWW-Authenticate: Bearer`** a mitad de sesión, ¿el cliente de IA re-dispara el flujo OAuth y reintenta la llamada?

Claude lo hace según la documentación de lazy-authentication de Anthropic. De **ChatGPT** hay un reporte de comunidad no refutado de que no lo hace de forma fiable. Es un gap del cliente, no del servidor. Si ChatGPT falla, el diseño de #172 cambia de raíz —conectar autenticado desde el inicio, o partir en dos servidores—, así que la validación empírica precede al build de WS1.

Este spike construye el instrumento mínimo para responder esa pregunta con evidencia.

## Qué NO cubre

- **Producción.** El código se tira al terminar; no se mergea a `main`.
- **Prefill de identidad (nombre+email desde Google).** Eso es WS1 y exige federar Google con scopes OIDC. El AS de este spike es un mock que no federa a nadie.
- **Step-up `insufficient_scope` (403).** Segundo bullet de WS2, fuera de alcance. La infra mock lo soporta si se decide añadir luego.
- **WorkOS AuthKit u otro broker.** Evaluar el broker real es WS1.

## Restricción que ordena el trabajo

No hay acceso confirmado todavía a ChatGPT (developer mode) ni a Claude (custom connector). La pregunta de riesgo **solo** se responde conectando clientes reales, así que el spike se parte en dos fases:

- **Fase A — fidelidad del servidor. Ejecutable ahora, sin clientes.** Construir el MCP mínimo + AS mock y probar con un cliente de referencia scripteado que el loop OAuth completo funciona end-to-end. Retira el riesgo "¿el servidor está bien construido?". Su valor real: cuando llegue el acceso, un fallo de ChatGPT queda atribuido inequívocamente al cliente, y la Fase B pasa de sesión de debugging a "conectar y mirar".
- **Fase B — la pregunta de riesgo. Gated por acceso a clientes.** Conectar Claude (control) y ChatGPT (incógnita) al mismo servidor y observar el comportamiento mid-session. Runbook y matriz de observación quedan listos para ejecutar en cuanto se consiga el acceso.

El spike entrega Fase A construida y verificada hoy; Fase B queda como runbook accionable.

## Entregable

El producto durable **no es el código** — es un **artefacto de decisión**: un reporte en `docs/spikes/2026-06-19-ws2-oauth-retrigger.md` que responde *sí / no* a la pregunta de riesgo con la evidencia (timeline de requests + screenshots), y cierra la "Pregunta abierta 1" del epic #172. El código del spike es desechable; el reporte queda.

## Arquitectura

Un solo proceso `tsx` (reinicio instantáneo, logs en terminal), expuesto por **un** túnel con nombre estable. La URL del **endpoint MCP** tras el túnel (`https://<tunnel>/mcp`, con path) es el `resource` de RFC 9728 — no el origen pelado — y debe coincidir exacto en todos los metadatos y en la validación de `aud`. Confundir `resource` con el origen rompe silenciosamente el exact-match.

```
Cliente IA (ChatGPT / Claude / script de referencia)
        │  HTTPS
        ▼
  Túnel con nombre estable  (cloudflared / ngrok dominio reservado)
        │
        ▼
  Proceso único (node:http + @modelcontextprotocol/sdk + jose)
        ├── Resource server (MCP)
        │     POST/GET /mcp                                  tools: buscar_disponibilidad, crear_reserva
        │     GET /.well-known/oauth-protected-resource      RFC 9728
        ├── Authorization server (mock)
        │     GET /.well-known/oauth-authorization-server    RFC 8414 (+ alias openid-configuration)
        │     POST /register                                 DCR permisivo (RFC 7591)
        │     GET /authorize                                 PKCE S256, consent auto-aprobado
        │     POST /token                                    emite JWT firmado
        │     GET /jwks.json                                 clave pública
        └── Logger middleware                                [ts] METHOD path auth=<none|Bearer> → status
```

### Decisiones de implementación

| Decisión | Elección | Razón |
|----------|----------|-------|
| Framework del servidor | Raw `@modelcontextprotocol/sdk` (StreamableHTTP) + `node:http`, **no** `mcp-handler`/`withMcpAuth` | El contrato que el cliente observa es wire-level (HTTP 401 + header). El raw SDK da control total sobre emitir el 401 exacto; mcp-handler lo abstrae. Idéntico al ojo del cliente sea cual sea el framework. |
| AS | Mock autocontrolado, sin federar Google | Aísla exactamente la pregunta de riesgo (¿descubre + corre + reintenta?) sin el costo de AuthKit/Google. El prefill de identidad es WS1. |
| DCR | Incluir `/register` permisivo (RFC 7591) | CIMD es lo preferido en nov-2025, pero ambos clientes pueden intentar DCR. Aceptar cualquiera maximiza la robustez del spike ante lo que el cliente decida. |
| Firma de tokens | `jose` (JWT + JWKS) | Dependencia mínima estándar para firmar/verificar y servir JWKS. |
| Hosting | localhost + túnel con nombre estable | Iteración instantánea sobre formatos de header; logs en vivo. URL estable porque `resource` exige exact-match. |

## Componentes y contratos

### Resource server (MCP) — `/mcp`

Transport StreamableHTTP. Dos tools:

- **`buscar_disponibilidad`** (anónima). Sin token. Devuelve un JSON canned de disponibilidad. Status 200. Representa la familia de tools de consulta que en #172 quedan libres.
- **`crear_reserva`** (gateada). Representa la tool de reserva de #172.
  - Sin Bearer válido → **HTTP 401** a nivel de transporte con header:
    `WWW-Authenticate: Bearer resource_metadata="https://<tunnel>/.well-known/oauth-protected-resource", scope="reservation:create"`
    El 401 es obligatorio: Claude ignora el header si viaja en un 200.
  - Con Bearer válido → 200 con un resultado canned (no crea nada real).

### Protected Resource Metadata — `GET /.well-known/oauth-protected-resource`

RFC 9728. JSON con:
- `resource`: la URL **exacta** del MCP (`https://<tunnel>/mcp`).
- `authorization_servers`: `["https://<tunnel>"]`.
- `bearer_methods_supported`: `["header"]`.
- `scopes_supported`: `["reservation:create"]`.

### Authorization server (mock)

- **`GET /.well-known/oauth-authorization-server`** (+ alias `/.well-known/openid-configuration`) — RFC 8414: `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `jwks_uri`, `code_challenge_methods_supported: ["S256"]`, `response_types_supported`, `grant_types_supported`, `scopes_supported`, `token_endpoint_auth_methods_supported: ["none"]` (clientes públicos + PKCE — el camino que ChatGPT y Claude prefieren).
- **`POST /register`** — DCR permisivo. Acepta cualquier cuerpo, devuelve un `client_id` para un **cliente público** (sin `client_secret`; la seguridad la da PKCE), sin validación.
- **`GET /authorize`** — recibe `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `scope`, `resource`. Consent auto-aprobado (sin pantalla, o una con un solo botón). Guarda en memoria `code → { code_challenge, scope, resource, redirect_uri }` y redirige a `redirect_uri` con `code` + `state`.
- **`POST /token`** — intercambia `code` + `code_verifier`. Verifica PKCE S256 según RFC 7636: `BASE64URL(SHA256(ASCII(code_verifier))) == code_challenge` (el `BASE64URL` sin padding es load-bearing — el cliente de referencia y el AS mock deben codificar idéntico o `/token` falla espuriamente). Emite un JWT de acceso firmado con claims: `iss` (= issuer del AS), `aud` (= `resource` recibido, RFC 8707), `exp`, `scope`.
- **`GET /jwks.json`** — clave pública del par usado para firmar.

### Validación de token (en `crear_reserva`)

Con Bearer presente, verificar **todo**: firma contra JWKS local, `iss` correcto, `aud === <URL exacta del MCP>`, `exp` no vencido, y `scope` contiene `reservation:create`. Cualquier fallo → 401. Esto prueba que el gate es real (anti token-passthrough / confused deputy), no un sello de goma — el principio de seguridad que #172 fija para WS1.

### Logger (el corazón del spike)

Middleware que registra **cada** request entrante: `[timestamp] METHOD path auth=<none|Bearer> tool=<nombre|−> → status`. Incluir el nombre de la tool en las entradas `/mcp` desambigua los dos `POST /mcp` del flujo (paso 1 y paso 7) sin depender solo del timestamp, dando una clave machine-checkable para el assert de orden de SCEN-A3. El timeline ordenado **es** el observable que retira el riesgo. Tanto el caso positivo (secuencia completa) como el negativo (dónde se detiene) se leen aquí.

## Flujo esperado (caso positivo)

```
1. POST /mcp  (crear_reserva, sin token)                       → 401  WWW-Authenticate: Bearer ...
2. GET  /.well-known/oauth-protected-resource                  → 200  { resource, authorization_servers }
3. GET  /.well-known/oauth-authorization-server                → 200  { authorize, token, jwks, S256 }
4. POST /register            (si el cliente usa DCR)            → 200  { client_id }
5. GET  /authorize?...code_challenge=...                        → 302  redirect_uri?code=...&state=...
6. POST /token               (code + code_verifier)            → 200  { access_token (JWT) }
7. POST /mcp  (crear_reserva, Authorization: Bearer <jwt>)     → 200  resultado canned
```

En el caso negativo (ChatGPT no re-dispara), la secuencia se detiene tras el paso 1 —o en algún punto intermedio— y el log marca exactamente dónde.

## Escenarios observables

### Fase A — scripteable, ejecutable ahora

Un **cliente de referencia** usando el cliente OAuth del `@modelcontextprotocol/sdk` (PKCE + discovery) más un listener loopback para capturar el `code` del redirect. Reproduce el flujo completo headless, sin ChatGPT/Claude.

- **SCEN-A1** — Dado el servidor corriendo tras el túnel, cuando el cliente de referencia llama `buscar_disponibilidad` sin token, entonces responde 200 con datos y el log muestra `auth=none → 200`.
- **SCEN-A2** — Cuando el cliente llama `crear_reserva` sin token, entonces el servidor responde **HTTP 401** con header `WWW-Authenticate: Bearer` que contiene `resource_metadata` y `scope` bien formados (assert sobre la presencia y forma del header).
- **SCEN-A3** — Dado el 401, cuando el proveedor OAuth del cliente corre discovery → authorize (auto-aprobado) → token (PKCE S256) → reintenta `crear_reserva` con el Bearer, entonces el reintento responde 200 y el log muestra la **secuencia ordenada completa** de los 7 pasos del flujo esperado.
- **SCEN-A4** (negativo) — Dado un Bearer forjado, expirado o con `aud` ajeno, cuando se llama `crear_reserva`, entonces el servidor responde 401 (rechaza por firma / `aud` / `exp`).

### Fase B — observación manual, gated por acceso

- **SCEN-B1** (Claude, control) — Dado Claude conectado al spike como conector custom por URL, cuando en una sesión real se usa una tool de consulta anónima y luego se invoca la reserva, entonces Claude muestra el consent OAuth en la llamada de reserva y, tras aprobar, completa la reserva (200). Evidencia: timeline del log + screenshot del consent.
- **SCEN-B2** (ChatGPT, la incógnita) — Dado ChatGPT (developer mode) conectado al spike por URL, cuando se ejecuta la misma secuencia mid-session, entonces **o bien** ChatGPT re-dispara OAuth ante el 401 y reintenta con éxito (riesgo retirado → tiered auth viable) **o bien** no lo hace (gap confirmado → registrar el punto exacto de fallo desde el log y ejecutar la decisión de fallback de #172). El observable es el timeline registrado + la clasificación del resultado.

Si Claude (control) falla SCEN-B1, el servidor está mal construido, no es el cliente: se vuelve a Fase A antes de concluir nada sobre ChatGPT.

## Runbook Fase B (verificado contra docs de OpenAI, 2026-06-19)

### Prerrequisitos de acceso

- **ChatGPT — developer mode** (NO la plataforma de API). Settings → Apps & Connectors → Advanced settings (al fondo) → toggle **developer mode**. Una org/Business puede requerir que un admin lo habilite. Los ChatGPT Apps funcionan en todos los planes desde 2025-11-13, así que el plan no bloquea.
  - **Advertencia:** el tab **"ChatGPT Apps"** de `platform.openai.com` es **submission/publishing** al directorio público (review, identity verification, `api.apps.write`, prohíbe endpoints de testing). **No se usa para el spike.** El path correcto es developer mode dentro de la app de ChatGPT.
- **Claude — custom connector** por URL (plan Pro/Team/Max).

### Procedimiento ChatGPT (la incógnita)

1. Activar developer mode (arriba). Aparece un botón **Create** bajo Settings → Apps & Connectors.
2. Asegurar el MCP alcanzable por HTTPS (el túnel con nombre de Fase A).
3. Settings → Connectors → **Create** → `Connector name`, `Description`, **`Connector URL` = `https://<tunnel>/mcp`** → Create. Si conecta, ChatGPT lista las tools advertidas.
4. Nuevo chat → botón **+** → **More** → elegir el conector (lo añade al contexto).
5. **Permisos:** el default es *"Ask only before important changes"*; `crear_reserva` es cambio consecuente → ChatGPT pedirá confirmación antes de invocarla. No confundir esa confirmación de permiso con el consent OAuth.
6. Ejecutar la secuencia mid-session: primero un prompt que dispare `buscar_disponibilidad` (anónima, espera 200), luego uno que dispare `crear_reserva` (espera 401 → ¿OAuth?).
7. **Observar y clasificar:** o aparece el consent OAuth y tras aprobar la reserva responde 200 (**riesgo retirado**), o no se dispara y la llamada falla (**gap confirmado** → registrar el punto exacto desde el log del servidor + ejecutar fallback de #172).

### Segundo canal de observación (bonus de la cuenta dev OpenAI)

**API Playground** (`platform.openai.com`) → conversación → **Tools → Add → MCP Server** → pegar el mismo endpoint HTTPS. Da **logs crudos de request/response** — evidencia de alto valor para el timeline de SCEN-B2, complementaria al logger del servidor.

### Procedimiento Claude (el control)

Añadir conector custom por URL (`https://<tunnel>/mcp`), misma secuencia mid-session. Esperado: dispara el consent OAuth en `crear_reserva` y reintenta con éxito. Si falla, el servidor está mal (volver a Fase A).

### Redirect URI

ChatGPT cierra el flujo redirigiendo a `https://chatgpt.com/connector/oauth/{callback_id}` (la URL exacta se muestra en la página de gestión del conector). El AS mock acepta cualquier `redirect_uri` por diseño, pero el runbook lo documenta por si se endurece.

### Captura de evidencia

Para cada cliente: (a) timeline del logger del servidor, (b) screenshot del consent OAuth, (c) para ChatGPT, además los logs del API Playground. Todo se consolida en el reporte de decisión `docs/spikes/2026-06-19-ws2-oauth-retrigger.md`.

### Gotchas de observación Fase B (no confundir con el resultado)

- **Un 406 no es señal sobre OAuth.** El transport StreamableHTTP del SDK exige que el `Accept` incluya `application/json` **y** `text/event-stream`; si un cliente manda solo `application/json` recibe **406 del transport**, no el 401 del gate. Si Fase B ve un 406, es conformidad de transporte, no evidencia sobre el contrato OAuth.
- **El gate cubre batch JSON-RPC.** Un `tools/call` de `crear_reserva` envuelto en un array `[ … ]` también se reta con 401 (cerrado en Fase A tras hallazgo de los review agents; SCEN-A2b lo fija). Sin esto, un cliente que batchee crearía la reserva sin token y se leería falsamente como "el cliente no re-disparó OAuth".
- **La confirmación de permiso de ChatGPT ≠ consent OAuth.** Con el default *"Ask only before important changes"*, ChatGPT pide confirmar `crear_reserva` por ser cambio consecuente. Ese diálogo es de permisos de la app, no el consent de OAuth — el observable de riesgo es el **segundo** (el de autorización del AS).

### Evidencia documental que apoya (no sustituye) el spike

Las docs de OpenAI describen el mecanismo exacto bajo prueba: *"If a token arrives without the expected audience or scopes, reject it and rely on the `WWW-Authenticate` challenge to prompt ChatGPT to re-authorize."* Es la **intención documentada**, no prueba de fiabilidad del re-trigger mid-session — por eso el spike empírico sigue siendo necesario.

## Estrategia de satisfacción

- **Fase A** se satisface con asserts automáticos del cliente de referencia (SCEN-A1..A4) sobre status codes, presencia/forma del header `WWW-Authenticate`, y el orden del timeline. Es el gate de "servidor correcto".
- **Fase B** se satisface con evidencia observada manualmente (timeline + screenshots) clasificada como riesgo-retirado o gap-confirmado. No hay test automático posible: el comportamiento bajo prueba vive dentro de un cliente propietario.
- El spike **se da por cerrado** cuando el reporte de decisión existe con la respuesta sí/no y su evidencia. Si en el momento del cierre no hay acceso a clientes, el spike entrega Fase A verde + el runbook de Fase B, y el cierre de la pregunta de riesgo queda explícitamente pendiente de acceso —no se finge retirado.

## Aislamiento y desecho

- Worktree `.worktrees/spike-ws2-oauth`, branch `spike/ws2-oauth-retrigger`. Nunca se codea en la branch base.
- Código bajo `spikes/ws2-mcp-oauth/` con `package.json` propio y deps aisladas (`@modelcontextprotocol/sdk`, `jose`, `tsx`). **No se mergea a `main`.**
- Artefactos durables que sí quedan: este design doc y el reporte de decisión en `docs/spikes/`.
- Secretos: el par de claves del AS mock se genera al vuelo o vive en un `.env` local del spike; nunca se commitea.

## Riesgos del propio spike

- **URL del túnel inestable rompe el exact-match de `resource`.** Mitigación: túnel con nombre/dominio reservado, fijado en una sola constante de config leída por todos los metadatos.
- **El cliente de referencia del SDK podría no ejercitar el mismo camino que ChatGPT/Claude.** Es por eso que Fase A valida el *servidor*, no sustituye a Fase B. La pregunta de riesgo solo la responden los clientes reales.
- **Acceso a clientes no llega.** El spike no puede cerrar la pregunta de riesgo sin él; entrega Fase A + runbook y lo declara abierto. Honestidad sobre el estado, no cierre fingido.

## Fuentes

- MCP authorization 2025-11-25 — https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Anthropic lazy authentication — https://claude.com/docs/connectors/building/lazy-authentication
- OpenAI Apps SDK auth — https://developers.openai.com/apps-sdk/build/auth
- RFC 9728 (Protected Resource Metadata), RFC 8414 (AS Metadata), RFC 7591 (DCR), RFC 8707 (Resource Indicators), PKCE S256 (RFC 7636)
