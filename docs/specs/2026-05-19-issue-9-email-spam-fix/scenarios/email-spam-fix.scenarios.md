---
name: email-spam-fix
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-19T00:00:00Z
spec: docs/specs/2026-05-19-issue-9-email-spam-fix-design.md
issue: 9
---

# Scenarios — Email spam fix via CID logo embed

Holdout contract for issue #9. Write-once after first commit.
Mirrors the "Observable scenarios" section of the design spec.

Code paths covered: `lib/email/fetch-logo.ts`, `lib/email/notifications.ts`,
`lib/email/send.ts`. Email layout (`email-layout.tsx`) and 9 transactional
templates inherit the fix without change.

Manual scenarios (SCEN-M*) require post-deploy verification with live
Hotmail/Outlook inboxes and Resend Insights — they are not automatable in
this codebase.

---

## SCEN-01: valid logo URL produces CID payload

**Given**: franquicia con `logo_url = https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/logo.png` (PNG, content-type `image/png`, ~10 KB).
**When**: `sendReservationNotifications` se invoca para una reserva en estado `reservado`.
**Then**: el HTML rendered contiene `src="cid:franchise-logo"` Y el payload pasado a `resend.emails.send` incluye `attachments: [{ filename: "logo.png", content: <Buffer>, contentId: "franchise-logo" }]`.
**Evidence**: Vitest test con mock de `fetch` que devuelve el PNG y spy del SDK Resend que captura el `payload.attachments`. Assertion: `expect(payload.attachments).toEqual([{ filename: "logo.png", content: expect.any(Buffer), contentId: "franchise-logo" }])` Y `expect(html).toContain('src="cid:franchise-logo"')`.

---

## SCEN-02: HTTP 404 → graceful fallback

**Given**: `franchises.logo_url` apunta a un host permitido pero la respuesta es HTTP 404.
**When**: `sendReservationNotifications` se invoca.
**Then**: el HTML rendered NO contiene `cid:franchise-logo`; en su lugar renderiza el fallback de texto (`franchiseName` con `franchiseColor`). El payload a Resend NO incluye `attachments`. `console.warn` se invoca con un mensaje que contiene `"logo fetch 404"`.
**Evidence**: Vitest test con mock de `fetch` → `Response(null, { status: 404 })` y spy de `console.warn`. Assertions: `expect(payload.attachments).toBeUndefined()`, `expect(html).not.toContain('cid:')`, `expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('logo fetch 404'))`.

---

## SCEN-03: host fuera de allowlist (SSRF defense)

**Given**: `franchises.logo_url = "http://169.254.169.254/latest/meta-data/"` (IP literal AWS metadata, fuera de la allowlist).
**When**: `sendReservationNotifications` se invoca.
**Then**: la guarda de allowlist rechaza el host ANTES de ejecutar `fetch`. `fetch` NO se invoca (0 llamadas). HTML renderiza fallback. `console.warn` se invoca con `"logo host not allowed: 169.254.169.254"`. Payload sin attachment.
**Evidence**: Vitest test con `vi.spyOn(global, 'fetch')` para asegurar 0 llamadas. Assertion: `expect(fetch).not.toHaveBeenCalled()`.

---

## SCEN-04: timeout >5s → fallback

**Given**: `logo_url` apunta a un host permitido que no responde en <5s.
**When**: `sendReservationNotifications` se invoca.
**Then**: a los 5s, `AbortController.abort` dispara `AbortError`, el fetch se cancela, `fetchLogoAttachment` devuelve `null`, HTML renderiza fallback, `console.warn` se invoca, email se envía sin attachment.
**Evidence**: Vitest test con `vi.useFakeTimers()` y mock de `fetch` que devuelve una Promise pendiente; avance del reloj 5001ms y assert que `fetch` recibió `signal` cuyo `aborted === true`.

---

## SCEN-05: logo_url null → silent fallback

**Given**: `franchises.logo_url` es `null` (franquicia sin logo configurado).
**When**: `sendReservationNotifications` se invoca.
**Then**: `fetch` NO se invoca (guarda inicial de `!logoUrl`). HTML renderiza fallback. `console.warn` NO se invoca (caso esperado, no warning).
**Evidence**: Vitest test con `vi.spyOn(global, 'fetch')` + spy de `console.warn`. Assertions: `expect(fetch).not.toHaveBeenCalled()`, `expect(consoleWarn).not.toHaveBeenCalled()`.

---

## SCEN-06: content-type inesperado → fallback

**Given**: `logo_url` permitido pero el endpoint devuelve `content-type: text/html` (redirect HTML mal configurado).
**When**: `sendReservationNotifications` se invoca.
**Then**: `fetchLogoAttachment` rechaza el content-type, devuelve `null`, HTML renderiza fallback, `console.warn` se invoca con el content-type rechazado.
**Evidence**: Vitest test con mock de `fetch` → `Response("<html/>", { headers: { "content-type": "text/html" }})`. Assertion: `expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('content-type "text/html" rejected'))`.

---

## SCEN-07: 1 fetch por invocación, N envíos

**Given**: una reserva en estado `pendiente` con `total_insurance = true` (dispara 3 emails: cliente pendiente, Localiza pendiente, Localiza seguro total).
**When**: `sendReservationNotifications` se invoca.
**Then**: `fetchLogoAttachment` se invoca **exactamente 1 vez**. Las 3 llamadas a `sendEmail` reciben el **mismo objeto `attachments`** por identidad de referencia.
**Evidence**: Vitest test que mockea `fetchLogoAttachment` (con `vi.mock`) y `sendEmail`. Assertions: `expect(fetchLogoAttachment).toHaveBeenCalledTimes(1)` Y `expect(sendEmail.mock.calls.map(c => c[0].attachments)).toEqual([attachmentsRef, attachmentsRef, attachmentsRef])` donde la igualdad es por referencia (no deep-equal solamente).

---

## SCEN-08: apex de franquicia es allowlist match

**Given**: `franchises.logo_url = "https://alquilatucarro.com/assets/email/logo.png"` (apex de franquicia, no Vercel Blob). Endpoint devuelve `image/png`.
**When**: `sendReservationNotifications` se invoca.
**Then**: la allowlist acepta el host por match exacto (`hostname === "alquilatucarro.com"`). HTML contiene `src="cid:franchise-logo"`. Attachment presente en payload.
**Evidence**: Vitest test con mock de `fetch` → PNG válido. Mismas assertions que SCEN-01.

---

## SCEN-09: suffix-bypass attempt rechazado

**Given**: `franchises.logo_url = "https://evil-alquilatucarro.com/logo.png"` (host que con un `endsWith` ingenuo pasaría como subdominio de `alquilatucarro.com`).
**When**: `sendReservationNotifications` se invoca.
**Then**: la guarda de allowlist (dot-boundary: `hostname === h || hostname.endsWith("." + h)`) RECHAZA el host. `fetch` NO se invoca. HTML renderiza fallback. `console.warn` con `"logo host not allowed: evil-alquilatucarro.com"`.
**Evidence**: Vitest test con spy de `fetch`. Assertion: `expect(fetch).not.toHaveBeenCalled()`.

---

## SCEN-10: oversize logo (>100KB) → fallback

**Given**: `logo_url` permitido, content-type `image/png`, body legítimo pero pesa 150_000 bytes (>`MAX_LOGO_BYTES = 100_000`).
**When**: `sendReservationNotifications` se invoca.
**Then**: el guard de tamaño dispara fallback DESPUÉS del fetch (porque el tamaño se mide sobre el `arrayBuffer` ya descargado). `console.warn` con `"logo too large (150000 bytes > 100000)"`. HTML renderiza fallback. Payload sin attachment.
**Evidence**: Vitest test con mock de `fetch` que devuelve un `Buffer.alloc(150_000)` con content-type válido. Assertion: `expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('logo too large (150000 bytes'))`.

---

## SCEN-M1: Hotmail inbox delivery (manual, post-deploy)

**Given**: el fix está deployado en producción. Una cuenta personal `@hotmail.com` no ha recibido correos transaccionales de esta franquicia previamente (o ha sido limpiada de Junk para reset de reputación).
**When**: se crean 5 reservas de prueba consecutivas que disparan el email "Reserva Aprobada" hacia esa cuenta.
**Then**: 5 de 5 correos aterrizan en Inbox (no en Junk/Spam).
**Evidence**: capturas de pantalla del cliente Hotmail mostrando los 5 correos en Inbox. Si alguno cae a Junk, anotar timestamp + asunto + Resend Insights ID para diagnóstico.

> **Variable de confusión**: la entrega a Microsoft también depende de la reputación del sender que se calienta gradualmente post-cutover a Resend. Si SCEN-M3 ✅ pero Junk persiste, esperar 48-72h antes de declarar regresión.

---

## SCEN-M2: Outlook.com inbox delivery (manual, post-deploy)

**Given**: el fix está deployado. Cuenta `@outlook.com` con condiciones equivalentes a SCEN-M1.
**When**: 5 reservas de prueba consecutivas.
**Then**: 5 de 5 aterrizan en Inbox.
**Evidence**: mismo formato que SCEN-M1.

---

## SCEN-M3: Resend Insights warnings = 0

**Given**: un correo transaccional enviado tras el deploy del fix.
**When**: se inspecciona ese correo en el dashboard de Resend → Emails → [ID] → Insights tab.
**Then**: el warning "Host images on the sending domain" NO aparece en la lista. Total de warnings = 0 (o no relacionados al fix).
**Evidence**: captura del Insights tab del correo en Resend dashboard.

---

## SCEN-M4: mail-tester score ≥ 9/10

**Given**: el fix está deployado.
**When**: se envía un correo de prueba a la dirección única generada por `mail-tester.com` y se carga el reporte.
**Then**: score ≥ 9/10. Las secciones de "Authentication", "Content", "Sender", e "Image hosting" todas en verde.
**Evidence**: URL del reporte mail-tester guardada (válida 7 días).

---

## SCEN-M5: cross-client rendering

**Given**: un correo transaccional enviado tras el fix.
**When**: se abre en 4 clientes distintos: Gmail web, Outlook desktop (Windows), Outlook web (outlook.live.com), Apple Mail (iOS o macOS).
**Then**: en los 4 clientes, el logo de franquicia se renderiza correctamente en header y footer (no se ve el ícono de imagen rota, no aparece sólo el alt-text).
**Evidence**: 4 capturas, una por cliente.
