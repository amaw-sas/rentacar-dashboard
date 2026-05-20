# Fix: correos transaccionales aterrizan en spam en Hotmail/Outlook — embed de logo via CID

**Fecha**: 2026-05-19
**Estado**: aprobado, pre-implementación
**Autor**: Pablo Diaz (con Claude)
**Branch destino**: `main` vía PR
**Worktree**: `.worktrees/fix-issue-9-email-spam-cid`
**Issue**: [#9](https://github.com/amaw-sas/rentacar-dashboard/issues/9)

---

## Contexto

Los correos transaccionales del dashboard (reservas, cancelaciones, recordatorios) aterrizan en **spam en `@hotmail.com` y `@outlook.com`** mientras Gmail los entrega al inbox correctamente. El panel de Resend Insights muestra dos warnings consistentes en cada envío:

1. **`Host images on the sending domain`** — el `<img src="https://...public.blob.vercel-storage.com/...">` del logo no comparte dominio con el `From: noreply@mail.<franquicia>`.
2. **`Ensure link URLs match sending domain`** — los enlaces del email deben alinearse al dominio remitente.

La auditoría del código actual confirma que el warning #1 es la causa raíz operativa: dos `<Img>` (header + footer en `lib/email/templates/components/email-layout.tsx`) leen `franchiseLogo = franchises.logo_url`, que apunta a Vercel Blob. El warning #2 es benigno en la práctica: `franchiseWebsite` ya apunta al apex de cada franquicia (`alquilatucarro.com`, `alquilame.com`, `alquicarros.com`), que comparte parent con `mail.<franquicia>`; los demás targets (`tel:`, `wa.me`, `maps.app.goo.gl`, `www.google.com/maps`) son destinos estándar tolerados por Microsoft.

La fix elimina el mismatch reemplazando la URL externa del logo por un **attachment inline embebido en el cuerpo MIME del email**, referenciado desde el HTML con `<img src="cid:franchise-logo">`. El logo viaja con el email, no hay request externo desde el cliente de correo, y el warning desaparece.

**Constraints operativos**:
- 3 franquicias con dominios remitentes `mail.<franquicia>` ya verificados en Resend (DKIM/SPF/DMARC OK).
- `franchises.logo_url` se gestiona desde admin UI (`<ImageUpload>` → Vercel Blob). Workflow debe preservarse — cambiar logo desde admin debe seguir aplicándose al próximo email sin redeploy.
- Estado del proyecto: alfa. Velocidad > rigor de testing pre-deploy. PRs deployan a Vercel.
- Sin DNS changes, sin cross-repo coordination, sin nuevas env vars.

---

## 1. Arquitectura

```
ANTES                                          DESPUÉS

notifications.ts                               notifications.ts
  branding.franchiseLogo = logo_url              branding.franchiseLogo = logo_url
  → renderEmail(<T franchiseLogo={url}/>)        → prepareLogoForEmail(branding)
  → sendEmail({ html })                            ├─ fetchLogoAttachment(logo_url, 5s)
                                                   └─ Buffer | null
                                                 → renderEmail(<T franchiseLogo="cid:franchise-logo"/>)
                                                 → sendEmail({ html, attachments })

send.ts                                        send.ts
  resend.emails.send({ html })                   resend.emails.send({ html, attachments? })

email-layout.tsx                               email-layout.tsx
  <Img src={franchiseLogo}>                      <Img src={franchiseLogo}> (SIN CAMBIOS)
```

**Cambios mínimos**:
1. Helper nuevo `lib/email/fetch-logo.ts`: server-side fetch de `logo_url` con allowlist de hosts, timeout 5s, validación de content-type. Output: `{ filename, content: Buffer, contentType } | null`. Nunca throw.
2. `lib/email/notifications.ts`: helper privado `prepareLogoForEmail(branding)` que invoca `fetchLogoAttachment` una sola vez por invocación, reemplaza `branding.franchiseLogo` por `"cid:franchise-logo"` cuando hay éxito, y devuelve `attachments` para reusar en todos los `sendEmail()` que dispara esa invocación.
3. `lib/email/send.ts`: `SendEmailOptions` acepta `attachments?: SendAttachment[]`, el payload Resend lo incluye condicional.
4. Templates: sin cambios. `franchiseLogo` sigue siendo `string | undefined`.

**Source of truth de `franchises.logo_url`**: intacto. Admin UI sigue editando el URL, próximo email lo fetchea. Cero cambios de schema, cero migraciones SQL.

---

## 2. Componentes

### `lib/email/fetch-logo.ts` (nuevo)

```ts
const FETCH_TIMEOUT_MS = 5000;
const MAX_LOGO_BYTES = 100_000;
const ALLOWED_PREFIXES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Each entry is matched exactly (apex) OR with a dot-boundary suffix
// (subdomain). Plain endsWith would let `evil-alquilatucarro.com` slip through.
const ALLOWED_HOSTS = [
  "public.blob.vercel-storage.com",
  "alquilatucarro.com",
  "alquilame.com",
  "alquicarros.com",
];

export interface LogoAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith("." + h)
  );
}

export async function fetchLogoAttachment(
  logoUrl: string | null | undefined
): Promise<LogoAttachment | null> {
  if (!logoUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(logoUrl);
  } catch {
    console.warn(`[email] logo url unparseable: ${logoUrl}`);
    return null;
  }
  if (parsed.protocol !== "https:") {
    console.warn(`[email] logo non-https rejected: ${logoUrl}`);
    return null;
  }
  if (!isAllowedHost(parsed.hostname)) {
    console.warn(`[email] logo host not allowed: ${parsed.hostname}`);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(logoUrl, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[email] logo fetch ${res.status}: ${logoUrl}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!ALLOWED_PREFIXES.some((p) => contentType.startsWith(p))) {
      console.warn(`[email] logo content-type "${contentType}" rejected: ${logoUrl}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_LOGO_BYTES) {
      console.warn(`[email] logo too large (${buf.byteLength} bytes > ${MAX_LOGO_BYTES}): ${logoUrl}`);
      return null;
    }
    const ext = contentType.split("/")[1].split(";")[0].trim();
    return { filename: `logo.${ext}`, content: buf, contentType };
  } catch (err) {
    console.warn(`[email] logo fetch failed: ${logoUrl}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

**Contrato**:
- Input opcional → output `LogoAttachment | null`. Nunca throw.
- 5 guard clauses fail-closed: URL unparseable, non-https, host fuera de allowlist, fetch/HTTP/content-type inválido, tamaño > 100 KB.
- Timeout duro de 5s con `AbortController`.
- Allowlist matching: exact-equal o dot-boundary suffix (`"alquilatucarro.com"` no matchea `evil-alquilatucarro.com`).
- `MAX_LOGO_BYTES = 100_000`: cota conservadora que aplica el mismo principio "fail-closed → fallback" a la falla de tamaño que Resend rechazaría con `validation_error`. Los 3 logos actuales pesan <20 KB.

### `lib/email/notifications.ts` (modificado)

Agregar al inicio del archivo:

```ts
import { fetchLogoAttachment } from "./fetch-logo";

const LOGO_CONTENT_ID = "franchise-logo";

interface SendAttachment {
  filename: string;
  content: Buffer;
  contentId: string;
}

async function prepareLogoForEmail(branding: FranchiseBranding): Promise<{
  branding: FranchiseBranding;
  attachments: SendAttachment[] | undefined;
}> {
  const logo = await fetchLogoAttachment(branding.franchiseLogo);
  if (!logo) {
    return {
      branding: { ...branding, franchiseLogo: undefined },
      attachments: undefined,
    };
  }
  return {
    branding: { ...branding, franchiseLogo: `cid:${LOGO_CONTENT_ID}` },
    attachments: [
      { filename: logo.filename, content: logo.content, contentId: LOGO_CONTENT_ID },
    ],
  };
}
```

**Boundary**: `prepareLogoForEmail` se mantiene como helper **privado** de `notifications.ts` (no exportado). Las pruebas lo observan **indirectamente** via mock de `fetchLogoAttachment` — SCEN-07 asserta `fetchLogoAttachment.toHaveBeenCalledTimes(1)` para una invocación que dispara N envíos, y `sendEmail` mock recibe el mismo objeto `attachments` (object identity) en todas las llamadas.

Modificar `sendReservationNotifications()`:

```ts
const reservation = await fetchReservationContext(reservationId);
const ctx = await getFranchiseContext(franchiseCode);
const { branding, attachments } = await prepareLogoForEmail(ctx.branding); // NUEVO
const localizaBccEmail = ctx.localizaBccEmail;
```

Cada `await sendEmail({ ... })` (9 call sites en `notifications.ts` + 1 en `sendReservationRequestEmail`) recibe `attachments`:

```ts
await sendEmail({
  franchise: franchiseCode,
  to: customerEmail,
  subject: "Reserva Aprobada",
  html,
  reservationId,
  notificationType: "reservado_cliente",
  attachments, // NUEVO
});
```

Mismo patrón en `sendReservationRequestEmail`.

### `lib/email/send.ts` (modificado)

```ts
interface SendAttachment {
  filename: string;
  content: Buffer;
  contentId: string;
}

interface SendEmailOptions {
  franchise: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  bcc?: string;
  reservationId?: string;
  notificationType?: string;
  attachments?: SendAttachment[]; // NUEVO
}
```

Y en el `payload`:

```ts
const payload = {
  from: `"${franchiseData.sender_name}" <${franchiseData.sender_email}>`,
  to: [to],
  replyTo: replyToAddress,
  subject,
  html,
  ...(text ? { text } : {}),
  ...(bcc ? { bcc: [bcc] } : {}),
  ...(attachments && attachments.length > 0 ? { attachments } : {}), // NUEVO
  headers: { ... },
};
```

**Verificar via Context7 al implementar** (CLAUDE.md mandate, no asumir):
- Casing del SDK Resend: ¿`contentId` o `content_id` en `attachments[]`?
- ¿`content: Buffer` está soportado o requiere `content: string` (base64)?
- ¿El HTML referencia el attachment con `cid:<id>` o `<id>@<host>`?

### `lib/email/templates/components/email-layout.tsx`

Sin cambios. `<Img src={franchiseLogo}>` acepta tanto URLs como strings `cid:`.

### Tests

| Archivo | Cambio |
|---|---|
| `tests/unit/email/fetch-logo.test.ts` | **Nuevo** — SCEN-01..06, SCEN-08, SCEN-09, SCEN-10 |
| `tests/unit/email/send.test.ts` | Modificar — agregar caso "passes attachments to Resend SDK" |
| `tests/unit/email/notifications.test.ts` | Modificar — verificar `franchiseLogo: "cid:..."` cuando hay attachment, `undefined` cuando falla; SCEN-07 (1 fetch por invocación, N envíos) |

---

## 3. Data flow

```
Customer creates reservation
        │
        ▼
app/api/reservations/route.ts
  └─ after() → sendReservationNotifications(reservationId, status, franchise)
        │
        ▼
lib/email/notifications.ts :: sendReservationNotifications()
  ├─ fetchReservationContext()                    ← Supabase admin
  ├─ getFranchiseContext()                        ← Supabase admin
  │     └─ ctx.branding.franchiseLogo = franchises.logo_url
  ├─ prepareLogoForEmail(ctx.branding)            ← NUEVO
  │     ├─ fetchLogoAttachment(logo_url)
  │     │   ├─ URL parse + protocol + host check
  │     │   ├─ fetch(logo_url, AbortSignal.timeout(5s))
  │     │   ├─ content-type starts with image/*?
  │     │   └─ Buffer.from(arrayBuffer)
  │     ├─ success → { branding.franchiseLogo: "cid:franchise-logo",
  │     │              attachments: [{ filename, content: Buffer, contentId }] }
  │     └─ fail/null → { branding.franchiseLogo: undefined, attachments: undefined }
  ├─ switch(status):
  │     ├─ "reservado"     → renderEmail(<ReservedClient .../>) → sendEmail({ ..., attachments })
  │     ├─ "pendiente"     → renderEmail(<PendingClient .../>) → sendEmail({ ..., attachments })
  │     │                  → renderEmail(<PendingLocaliza .../>) → sendEmail({ ..., attachments, bcc })
  │     ├─ "sin_disponibilidad" → ...
  │     └─ "mensualidad"  → ...
  └─ if total_insurance / extras → sendEmail(Localiza, attachments)
        │
        ▼
lib/email/send.ts :: sendEmail({ ..., attachments })
  ├─ supabase.from("franchises").select(sender_*)
  ├─ getResendClient(franchise)
  └─ resend.emails.send({ from, to, replyTo, subject, html, attachments?, headers })
        │
        ├──── success ───▶ notification_logs INSERT (status=sent)
        └──── error ─────▶ retry / final fail → status=failed
```

### Invariants

1. **1 fetch del logo por invocación de `sendReservationNotifications()`**, no por email. Una reserva con `status=pendiente` y `total_insurance=true` puede disparar 3 emails — todos reusan el mismo Buffer y mismo `contentId`.
2. **Falla del fetch nunca aborta el email**. Layout ya tiene fallback (`{franchiseLogo ? <Img/> : <Text>{franchiseName}</Text>}`).
3. **CID es local al email**: `"franchise-logo"` como string fijo es seguro porque cada email Resend es un envío independiente.
4. **`franchises.logo_url` permanece intacto**. Admin sigue editando libremente.
5. **`pickup-sender.ts` no se toca**. WhatsApp-only; los templates `pickup-reminder.tsx`/`post-pickup-reminder.tsx` no están conectados a ningún sender activo. Si en el futuro se reactivan, deberán adoptar el mismo patrón.

### Performance

- Logo fetch (~5-15 KB PNG) sobre HTTPS desde Vercel Blob: ~50-150 ms en path frío.
- Se ejecuta dentro de `after()` → no bloquea respuesta del API al cliente.
- Cero impacto sobre crons; el cron `check-pending` que dispara emails también pasa por este path.

---

## 4. Error handling

| Punto de falla | Detección | Comportamiento | Logging |
|---|---|---|---|
| `logo_url` null/empty | check inicial | Return null, layout renderiza fallback de texto | silencioso |
| URL unparseable | `new URL` throw | Return null | `console.warn("[email] logo url unparseable: <url>")` |
| Protocol no https | check `parsed.protocol` | Return null | `console.warn("[email] logo non-https rejected: <url>")` |
| Host fuera de allowlist | `isAllowedHost` | Return null. Fetch NO se invoca. | `console.warn("[email] logo host not allowed: <host>")` |
| HTTP 4xx/5xx | `res.ok === false` | Return null | `console.warn("[email] logo fetch <status>: <url>")` |
| Timeout >5s | `AbortError` en catch | Return null | `console.warn("[email] logo fetch failed: <url>", err)` |
| Network throw (DNS/TLS) | catch del fetch | Return null | mismo console.warn |
| Content-type ≠ image/* | check de prefijo | Return null | `console.warn("[email] logo content-type <ct> rejected: <url>")` |
| Resend rechaza attachment | `response.error` no null | Retry si rate_limit/5xx; sino notification_logs failed + throw | comportamiento existente |

### Invariantes de error handling

1. **Falla del fetch del logo nunca aborta el email**. El cliente recibe su confirmación; branding visual es opcional.
2. **Resend no recibe attachments inválidos** — content-type validado antes de devolver el Buffer.
3. **Sin retries del fetch**. Una falla = fallback. Vercel Blob es muy estable; un retry suma complejidad y latencia sin valor.
4. **Allowlist fail-closed**. Cualquier host nuevo requiere PR + revisión.

### SSRF defense

La allowlist (`*.public.blob.vercel-storage.com` + apex de las 3 franquicias) bloquea explícitamente:
- IPs literales (`http://169.254.169.254/`, `http://localhost/`, `http://127.0.0.1/`)
- Hosts arbitrarios que un admin con acceso a `franchises.logo_url` pudiera inyectar

Defense-in-depth porque el atacante ya necesitaría acceso al dashboard como admin, pero el costo de la guarda es ~10 líneas.

### Casos no manejados (fuera de scope)

- **Logo > 100KB**: cubierto por el guard `MAX_LOGO_BYTES = 100_000` en `fetchLogoAttachment` — falla silenciosa con fallback (consistente con el resto de fallas). Los 3 logos actuales pesan <20KB.
- **MIME spoofing**: irrelevante — el Buffer se serializa base64 dentro del MIME del email; Resend valida server-side.

---

## 5. Testing strategy

### Observable scenarios

| # | Given | When | Then |
|---|---|---|---|
| **SCEN-01** | franquicia con `logo_url` válido (Vercel Blob, PNG 10KB) | se envía email transaccional | HTML contiene `src="cid:franchise-logo"` Y payload de `resend.emails.send` incluye `attachments: [{ filename, content: Buffer, contentId: "franchise-logo" }]` |
| **SCEN-02** | `logo_url` devuelve HTTP 404 | se envía email | HTML renderiza fallback (texto con `franchiseName`), `attachments` NO en payload, `console.warn` llamado con `"logo fetch 404"` |
| **SCEN-03** | `logo_url` apunta a host fuera de allowlist (ej. `http://169.254.169.254/`) | se envía email | `fetch` NO se invoca, HTML renderiza fallback, `console.warn` con `"logo host not allowed"` |
| **SCEN-04** | `logo_url` excede timeout 5s | se envía email | HTML renderiza fallback, `console.warn` llamado, email enviado sin attachment |
| **SCEN-05** | `logo_url` es `null` | se envía email | `fetch` NO se invoca, HTML renderiza fallback, NO hay `console.warn` |
| **SCEN-06** | `logo_url` devuelve content-type `text/html` | se envía email | HTML renderiza fallback, `console.warn` con content-type |
| **SCEN-07** | reserva en `pendiente` + `total_insurance=true` (3 emails) | se procesa la notificación | `fetchLogoAttachment.toHaveBeenCalledTimes(1)` Y las 3 invocaciones a `sendEmail` reciben el **mismo objeto `attachments`** (object identity, no deep-equal solamente — la misma referencia se propaga) |
| **SCEN-08** | `logo_url` apunta al apex de una franquicia (`https://alquilatucarro.com/logo.png`, content-type `image/png`) | se envía email | HTML contiene `src="cid:franchise-logo"`, allowlist acepta el host, attachment presente en payload |
| **SCEN-09** | `logo_url` apunta a `https://evil-alquilatucarro.com/logo.png` (suffix-bypass attempt) | se envía email | host RECHAZADO por la guarda de allowlist (no es match exact ni dot-boundary), `fetch` NO se invoca, fallback renderiza |
| **SCEN-10** | `logo_url` devuelve content-type `image/png` pero el body pesa 150 KB | se envía email | guard `MAX_LOGO_BYTES` dispara fallback, `console.warn` con bytes, attachment NO en payload |

### Manual validation (post-deploy, criterio de éxito del issue)

| # | Acción | Verificación |
|---|---|---|
| **SCEN-M1** | Crear reserva de prueba que dispare email a `@hotmail.com` (5x consecutivos) | 5/5 aterrizan en Inbox, ninguno en Junk |
| **SCEN-M2** | Crear reserva de prueba que dispare email a `@outlook.com` (5x consecutivos) | 5/5 aterrizan en Inbox |
| **SCEN-M3** | Inspeccionar email en Resend Insights | 0 warnings ("Host images on the sending domain" desaparece) |
| **SCEN-M4** | Enviar a `mail-tester.com` | score ≥ 9/10 |
| **SCEN-M5** | Abrir email en Gmail web, Outlook desktop, Outlook web, Apple Mail | logo se renderiza correctamente (no broken-image icon) en los 4 clientes |

> **Variable de confusión para SCEN-M1/M2**: la entrega a Microsoft también depende de la reputación del sender que se calienta gradualmente. Si los primeros sends post-deploy caen a Junk, no atribuir automáticamente al CID; revisar Resend Insights primero — si el warning desapareció (SCEN-M3 ✅) pero Junk persiste, esperar 48–72h de warm-up antes de declarar regresión.

### Verificación pre-PR (`/verification-before-completion`)

1. `pnpm type-check`
2. `pnpm lint`
3. `pnpm test` (foco en `tests/unit/email/`)
4. `pnpm build`
5. Smoke local: crear reserva apuntando a Supabase staging, capturar payload Resend via dashboard, inspeccionar attachments en el JSON del email.

---

## 6. Blast radius

**Archivos modificados** (3):
- `lib/email/send.ts` — añadir `attachments` al `SendEmailOptions` y al payload (~10 líneas)
- `lib/email/notifications.ts` — invocar `prepareLogoForEmail()` 1 vez por invocación, pasar `attachments` a cada `sendEmail()` (~30 líneas; ~10 call sites)
- `lib/email/notifications.ts` (mismo archivo) — helper privado nuevo `prepareLogoForEmail`

**Archivos nuevos** (2):
- `lib/email/fetch-logo.ts` — fetcher con allowlist + content-type + timeout + size guard (~70 líneas)
- `tests/unit/email/fetch-logo.test.ts` — SCEN-01..06, SCEN-08, SCEN-09, SCEN-10

**Tests modificados** (2):
- `tests/unit/email/send.test.ts` — caso de `attachments` en payload
- `tests/unit/email/notifications.test.ts` — SCEN-07 + verificación de `cid:` en HTML

**Sin cambios**:
- `lib/email/templates/components/email-layout.tsx`
- 9 templates en `lib/email/templates/`
- `lib/email/client.ts`, `lib/email/render.ts`
- `lib/reminders/pickup-sender.ts` (WhatsApp-only)
- `franchises` schema; `franchises.logo_url` valor
- `components/forms/franchise-form.tsx` (admin UI)
- Env vars, DNS, `vercel.json`

**Consumers downstream**:
- 9 templates de email transaccional → heredan el fix vía `email-layout.tsx`.
- Crons `/api/cron/*` que envían emails → cubiertos.
- `pickup-sender.ts` (WhatsApp) → no afectado.

**Riesgos**:
- **R1**: SDK Resend cambia shape de `attachments`. Mitigación: verificar via Context7 al implementar.
- **R2**: Allowlist demasiado estricta — si admin cambia provider de hosting, deja de funcionar. Mitigación: log claro facilita diagnóstico + actualizar allowlist en una sola línea.
- **R3**: Logo cacheado en CDN puede tardar tras upload nuevo desde admin. Mitigación: ninguna — flujo normal de Blob.

**Reversibilidad**: total. Revert del commit deshace el cambio. `franchises.logo_url` no se modifica.

---

## 7. Observable scenarios bridge → SDD

Las scenarios listadas en sección 5 son el holdout set para `/scenario-driven-development`. Cada decisión del diseño tiene al menos una scenario observable que la valida:

| Decisión de diseño | Scenarios |
|---|---|
| CID over external URL | SCEN-01, SCEN-M3 |
| Graceful fallback on fetch fail | SCEN-02, SCEN-04, SCEN-06 |
| SSRF allowlist | SCEN-03 |
| Null logo_url path | SCEN-05 |
| 1 fetch por invocación (no por email) | SCEN-07 |
| Inbox delivery in Hotmail/Outlook | SCEN-M1, SCEN-M2 |
| Visual rendering across clients | SCEN-M5 |

---

## 8. Implementación esperada

Handoff a `/sop-planning` para producir el plan ordenado con acceptance criteria por paso. La estructura tentativa del plan:

1. **Context7 first** — verificar la forma exacta del SDK Resend para `attachments[]`: casing (`contentId` vs `content_id`), tipo del campo `content` (`Buffer` vs base64 string), formato de referencia desde el HTML (`cid:<id>` vs `<id>@<host>`). Bloqueante para los pasos siguientes — la firma de `SendAttachment` depende de esto.
2. Crear `lib/email/fetch-logo.ts` con allowlist + guards + tests `tests/unit/email/fetch-logo.test.ts` (SCEN-01..06, SCEN-08, SCEN-09, SCEN-10).
3. Extender `lib/email/send.ts` con `attachments` opcional usando la firma verificada en (1) + test que verifica payload.
4. Modificar `lib/email/notifications.ts`: helper `prepareLogoForEmail`, llamarlo 1 vez, pasar `attachments` a cada `sendEmail`. Actualizar tests (SCEN-07).
5. `pnpm type-check && lint && test && build` localmente.
6. Smoke manual: envío a Hotmail/Outlook personal + revisión Resend Insights.
7. PR a `main`.

Validación final (SCEN-M1..M5) ocurre post-merge y post-deploy.
