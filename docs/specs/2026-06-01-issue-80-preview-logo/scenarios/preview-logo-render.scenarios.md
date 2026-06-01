---
name: preview-logo-render
created_by: pablo-diaz
created_at: 2026-06-01T00:00:00Z
issue: 80
---

# Preview logo render — issue #80

El correo entregado renderiza el logo bien (verificado en Gmail real). El bug es
solo el **preview** del dashboard: inyecta el HTML del correo —que referencia el
logo como `cid:franchise-logo`— en un `<iframe>` de navegador, donde un URI `cid:`
nunca resuelve. Fix: reescribir `cid:franchise-logo` → `logo_url` https de la
franquicia antes de inyectar. Sin tocar el path de envío.

Unidad central: función pura `inlineLogoForPreview(html, logoUrl)` en
`lib/email/preview.ts`. Constante compartida `LOGO_CONTENT_ID` (= `franchise-logo`)
en `lib/email/constants.ts`, importada por envío y preview para evitar drift.

## SCEN-001: logo inline reescrito en header y footer
**Given**: un HTML de correo guardado que referencia el logo como
`cid:franchise-logo` en 3 puntos (`<link rel="preload">`, `<img width="180">` del
header, `<img width="120">` del footer), y `logoUrl = "https://blob.example/logo.png"`
**When**: se llama `inlineLogoForPreview(html, logoUrl)`
**Then**: el string resultante no contiene la subcadena `cid:franchise-logo`, y
las 3 referencias quedan apuntando a `https://blob.example/logo.png`
**Evidence**: valor de retorno de la función — `expect(out).not.toContain("cid:franchise-logo")`, `expect(count(out, logoUrl)).toBe(3)`

## SCEN-002: HTML con fallback de texto queda intacto
**Given**: un HTML cuyo envío cayó al fallback de texto (logo no disponible al
enviar) — no contiene `cid:franchise-logo`, muestra el nombre de la franquicia como
`<p>` — y cualquier `logoUrl`
**When**: se llama `inlineLogoForPreview(html, logoUrl)`
**Then**: el HTML retorna idéntico al de entrada (sin cambios, idempotente)
**Evidence**: valor de retorno — `expect(out).toBe(html)`

## SCEN-003: sin logoUrl degrada limpio (sin imagen rota)
**Given**: un HTML con `cid:franchise-logo` y `logoUrl` vacío/`null`/`undefined`
(franquicia sin logo configurado)
**When**: se llama `inlineLogoForPreview(html, "")`
**Then**: el resultado no contiene `cid:franchise-logo` y las referencias apuntan a
un pixel transparente (`data:image/gif;base64,`...) — el navegador no muestra icono
de imagen rota
**Evidence**: valor de retorno — `expect(out).not.toContain("cid:franchise-logo")`, `expect(out).toContain("data:image/gif;base64")`, sin `src=""`

## SCEN-004: idempotencia
**Given**: el resultado de aplicar `inlineLogoForPreview` una vez
**When**: se aplica `inlineLogoForPreview` de nuevo con el mismo `logoUrl`
**Then**: el resultado no cambia respecto a la primera aplicación (no quedan `cid:`
residuales ni doble reemplazo)
**Evidence**: valor de retorno — `expect(inlineLogoForPreview(once, url)).toBe(once)`

## SCEN-005: render real en el preview del dashboard (runtime)
**Given**: el detalle de una reserva con al menos una notificación email logueada
(franquicia con logo, p.ej. alquilatucarro), sesión autenticada en el dashboard
**When**: el usuario abre el historial y pulsa "Ver" en esa notificación
**Then**: el `<iframe>` del diálogo muestra el logo de la franquicia en el header y
en el footer — sin icono de imagen rota; cero errores de consola por el `cid:`
**Evidence**: estado del DOM del iframe (img con `naturalWidth > 0`) + screenshot vía /agent-browser; verificable para las 3 franquicias (alquilatucarro, alquicarros, alquilame)

## SCEN-006: no regresión del envío
**Given**: el path de envío `lib/email/notifications.ts` + `lib/email/send.ts`
**When**: se construye y envía una notificación tras el cambio
**Then**: el correo sigue usando `cid:franchise-logo` como adjunto inline (no se
cambia a https) — el `html` enviado conserva `cid:`, garantizando que no se
reintroduce el mismatch de dominio que motivó #9
**Evidence**: el `html` pasado a `sendEmail()` aún contiene `cid:franchise-logo` (los archivos de envío no se modifican; sólo se extrae la constante compartida sin cambiar su valor)
