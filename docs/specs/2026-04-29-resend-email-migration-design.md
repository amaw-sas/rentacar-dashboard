# Migración de envío de correos: SMTP → Resend (alquilatucarro como piloto)

**Fecha**: 2026-04-29
**Estado**: aprobado, pre-implementación
**Autor**: Pablo Diaz
**Branch destino**: `main` (push directo, sin PR — restricción operativa por permisos de Vercel)

---

## Contexto

El dashboard de rentacar usa nodemailer + SMTP por franquicia (`ALQUILATUCARRO_MAIL_*`, `ALQUILAME_MAIL_*`, `ALQUICARROS_MAIL_*`) para notificaciones transaccionales. El código actual ya advierte un riesgo de DMARC alignment (`lib/email/send.ts:36-40`): cuando el `From` del email no coincide con el SMTP_USER autenticado, Gmail/Outlook pueden marcar como spam. La solución que el propio código sugiere — "migrar a un provider con DKIM para el From domain" — es lo que esta migración ejecuta.

**Restricciones operativas**:
- Estado del proyecto: alfa. Velocidad > rigor de testing pre-deploy.
- PRs no se deployan a Vercel por motivo de permisos → push directo a `main`.
- Sin testing de preview/smoke/dogfood. Sí mantenemos los gates de CI (typecheck, lint, test, build) porque su falla bloquea Vercel deploy.
- 2 de 3 franquicias (alquicarros, alquilame) **no están operativas actualmente** → no hay tráfico que proteger; aceptable que queden sin envío hasta que se migren más adelante.

**Estado pre-cutover (verificado vía MCP de Resend y `dig`)**:
- Dominio `mail.alquilatucarro.com` → status `verified` en Resend (DKIM ✅, SPF MX ✅, SPF TXT ✅), región `sa-east-1`.
- Dominio `mail.alquicarros.com` → status `failed` (admin no agregó registros DNS).
- Dominio `mail.alquilame.com` → status `not_started` (delegación DNS rota: NS Azure responden REFUSED, "lame delegation").
- API key dedicada `rentacar-dashboard-alquilatucarro-prod` creada con scope `sending_access` y `domainId` restringido a `mail.alquilatucarro.com`.
- Env var `ALQUILATUCARRO_RESEND_API_KEY` ya configurada en Vercel (Production + Preview).

---

## 1. Arquitectura

```
ANTES                                       DESPUÉS

sendEmail(franchise)                        sendEmail(franchise)
  → createTransporter(franchise)              → getResendClient(franchise)
  → nodemailer.sendMail()                     → resend.emails.send()
  → notification_logs                         → notification_logs
```

**Cambios principales**:

1. `lib/email/client.ts` se reescribe completo: en vez de devolver un `nodemailer.Transporter`, devuelve un `Resend` client lookupeado por `${PREFIX}_RESEND_API_KEY`. Throw con mensaje claro si la env var falta para la franquicia.
2. `lib/email/send.ts` cambia el body de `sendEmail()`: reemplaza `transporter.sendMail()` por `resend.emails.send()`, adapta el shape del payload y del error handling.
3. `lib/email/notifications.ts` cambia **mínimamente**: se eliminan las 4 llamadas a `delay()` (entre emails a Localiza). La abstracción `sendEmail()` queda intacta; toda la orquestación de templates por estado de reserva (460 líneas) sigue igual.
4. `lib/email/render.ts` no cambia (puro react-email render).
5. DB: migración SQL actualiza `franchises.sender_email` para alquilatucarro de `info@alquilatucarro.com` → `info@mail.alquilatucarro.com` (porque el dominio verificado en Resend es el subdominio, no el apex).
6. Vercel env: agregar `ALQUILATUCARRO_RESEND_API_KEY` (ya hecho). Las 4 vars `ALQUILATUCARRO_MAIL_*` y `EMAIL_DELAY_MS` se borran en cleanup posterior, no en este PR (el código deja de usar `EMAIL_DELAY_MS` con esta migración).
7. `package.json`: agregar `resend`. Mantener `nodemailer` por ahora (cleanup separado cuando las 3 franquicias estén migradas).

**Lo que se simplifica**:
- `warnIfFromMismatch()` y el Set `mismatchWarned` (`send.ts:27-42`) se eliminan. Resend firma con DKIM directamente; el "SMTP_USER vs From mismatch" deja de ser un riesgo.
- `EMAIL_DELAY_MS` y las llamadas `delay()` en `notifications.ts` se eliminan. El delay (5s default) era un workaround de cuando se usaba Mailtrap (que rate-limiteaba a 1 email cada 3-5s). Resend no tiene esa restricción → emails se envían inmediatamente. Esto baja el peor caso de tiempo total inline (4 emails de Localiza × 5s delay + retries) de ~35s a ~8s, eliminando la preocupación de timeout de Vercel function durante el flow inline de reservas (`route.ts:312`).

---

## 2. Componentes en detalle

### `lib/email/client.ts` (reemplazo)

```ts
import { Resend } from "resend";

const FRANCHISE_ENV_PREFIX = {
  alquilatucarro: "ALQUILATUCARRO",
  alquilame: "ALQUILAME",
  alquicarros: "ALQUICARROS",
} as const;

export function getResendClient(franchise: string): Resend {
  const prefix = FRANCHISE_ENV_PREFIX[franchise as keyof typeof FRANCHISE_ENV_PREFIX];
  if (!prefix) throw new Error(`Unknown franchise: ${franchise}`);

  const apiKey = process.env[`${prefix}_RESEND_API_KEY`];
  if (!apiKey) {
    throw new Error(
      `Missing Resend API key for "${franchise}". Required: ${prefix}_RESEND_API_KEY`
    );
  }
  return new Resend(apiKey);
}
```

**Comportamiento**: alquilatucarro funciona; alquicarros/alquilame throw "Missing Resend API key" si se invocan (acceptable — no tráfico real, falla loud para detectar errores de invocación).

### `lib/email/send.ts` (modificado)

Signature pública de `sendEmail()` no cambia. Cambios internos:

- `createTransporter(franchise)` → `getResendClient(franchise)`
- `transporter.sendMail(opts)` → `resend.emails.send(opts)` envuelto en `AbortSignal.timeout(10000)` por intento (Node 20 fetch no tiene timeout default; sin esto, un cuelgue de TLS/red bloquea hasta el timeout de la function).
- Helper nuevo: `deriveReplyTo(senderEmail)` con algoritmo explícito:
  - Split en `@`. Si no hay `@`, return input unchanged (defensive).
  - Sobre el host (después del `@`): regex `^mail\.` case-insensitive (`/^mail\./i`).
  - Si match: stripear ese prefix exacto. Si no match: return input unchanged.
  - Null/undefined input: return input unchanged (caller maneja).
  - Anclaje al inicio del host evita corrupción en dominios como `info@email.com` (no contiene `mail.` como subdominio leading) o multi-TLD `info@mail.example.co.uk` (solo stripea el `mail.` leading, no toca el `.co.uk`).
- Payload adaptado a Resend SDK:
  ```ts
  await resend.emails.send({
    from: `${franchiseData.sender_name} <${franchiseData.sender_email}>`,
    to: [to],
    replyTo: deriveReplyTo(franchiseData.sender_email),
    subject,
    html,
    ...(text ? { text } : {}),
    ...(bcc ? { bcc: [bcc] } : {}),
    headers: {
      "List-Unsubscribe": `<mailto:${deriveReplyTo(franchiseData.sender_email)}?subject=Unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  ```
- Error handling adaptado a `{ data, error }` shape del SDK (Resend no throw — devuelve error en el response). Caso `{ data: null, error: null }`: tratar como fallo (defensive — no debería ocurrir, pero blindamos).
- Eliminar `warnIfFromMismatch()` y `mismatchWarned` (en `send.ts`).
- **Verificar via Context7 al implementar** (CLAUDE.md mandate, no asumir desde training):
  - Nombres exactos de `error.name` (`validation_error`, `rate_limit_exceeded`, etc.)
  - Casing de `replyTo` vs `reply_to` en el SDK
  - Si `error.statusCode` existe en el shape del error
  - Si Resend auto-inyecta `List-Unsubscribe` (precedencia de headers custom)

### `lib/email/notifications.ts` (modificación menor)

Eliminar las 4 llamadas a `delay()` (líneas ~238, 294, 328, 370) y la constante:

```ts
const delay = () => new Promise((resolve) =>
  setTimeout(resolve, parseInt(process.env.EMAIL_DELAY_MS || "5000")));
```

Razón: workaround obsoleto de cuando se usaba Mailtrap (rate-limit a 1 email cada 3-5s). Resend no tiene esa restricción.

### Env vars (Vercel)

| Variable | Acción | Cuándo |
|---|---|---|
| `ALQUILATUCARRO_RESEND_API_KEY` | Ya configurada | — |
| `ALQUILATUCARRO_MAIL_HOST/_PORT/_USER/_PASS` | Dejar | Cleanup posterior tras confirmar prod estable |
| 8 vars SMTP de alquicarros + alquilame | Dejar | Cleanup junto con migración futura de esas franquicias |
| `EMAIL_DELAY_MS` | Dejar (sin uso) | Cleanup posterior; el código deja de leerla |

### DB migration

`supabase/migrations/NNN_alquilatucarro_resend_sender.sql`:

```sql
UPDATE franchises
SET sender_email = 'info@mail.alquilatucarro.com',
    updated_at = NOW()
WHERE code = 'alquilatucarro';
```

`NNN` se determina al implementar (siguiente número en la secuencia).

### `package.json`

- Agregar: `resend` (latest stable, ^4.x — confirmar versión exacta vía Context7 al implementar).
- No remover `nodemailer` (cleanup separado).

### Tests

| Archivo | Cambio |
|---|---|
| `tests/unit/email/send.test.ts` | Reemplazar mock de nodemailer por mock de Resend SDK |
| `tests/unit/email/notifications.test.ts` | Update — ya no mockea `delay()` ni `EMAIL_DELAY_MS`; verifica que NO hay esperas inyectadas entre emails de Localiza |
| `tests/unit/email/templates/*.test.tsx` | Sin cambios (puro render) |

---

## 3. Data flow

```
Customer creates reservation
        │
        ▼
app/api/reservations/route.ts
  └─ saves reservation
  └─ after() → sendReservationNotifications()
        │
        ▼
lib/email/notifications.ts
  └─ fetchReservationContext()    (Supabase)
  └─ getFranchiseBranding()        (Supabase)
  └─ renderEmail(<Template/>)      (react-email → HTML)
  └─ sendEmail({ franchise, to, ...})
        │
        ▼
lib/email/send.ts → sendEmail()
  ├─ supabase.from("franchises").select("sender_email, sender_name")
  ├─ deriveReplyTo(sender_email)
  ├─ getResendClient(franchise)    → reads ${PREFIX}_RESEND_API_KEY
  └─ resend.emails.send({...})
        │
        ├──── success ───▶ notification_logs INSERT (status=sent, resend_id en console)
        │
        └──── error ─────▶ retry on rate_limit / 5xx / network (3× × 8s)
                            │
                            └──── final fail ───▶ notification_logs INSERT
                                                  (status=failed, error_message)
                                                  + throw → caller catch en notifications.ts:401
```

### Diferencias vs el flow actual

| Paso | Antes (nodemailer) | Después (Resend) |
|---|---|---|
| Cliente | SMTP transporter por franquicia | Resend client con API key por franquicia |
| Envío | SMTP handshake + DATA | HTTPS POST a `api.resend.com` |
| `from` | `<name> <info@alquilatucarro.com>` | `<name> <info@mail.alquilatucarro.com>` |
| `replyTo` | mismo que from (apex) | apex, derivado del subdomain |
| DKIM | ausente o desalineado | firmado por Resend, alineado a `mail.alquilatucarro.com` |
| SPF | depende del provider SMTP | `include:amazonses.com` via `send.mail.alquilatucarro.com` |
| DMARC alignment | risk (warning explícito en código) | aligned por DKIM |
| `messageId` | header SMTP del provider | UUID que devuelve Resend |
| Retry trigger | `"Too many emails"` / `"550"` | `rate_limit_exceeded` / status 5xx / network throw |

### Window del cutover

**Orden corregido**: código primero, SQL segundo.

```
T-0:00  pnpm typecheck && lint && test && build (local)
T-0:01  Pre-flight: dig MX alquilatucarro.com → confirmar que apex tiene inbox (Reply-To target)
T-0:02  git push origin main → CI corre
T-0:05  CI green → Vercel deploy rolling
T-0:07  Vercel deploy live (código nuevo: Resend, lee sender_email viejo del DB)
T-0:07  supabase db push → sender_email = subdomain
T-0:08  monitor Vercel logs ~10 min
```

**Window de riesgo (~6 min, T-0:02 → T-0:07)**: el código viejo (nodemailer) sigue corriendo y la DB tiene apex igual que siempre — sin cambios efectivos para el envío durante este window. Cero riesgo de DMARC fail.

**Window de "Resend rechaza apex" (~1 min, T-0:07 → T-0:08)**: el código nuevo está live pero la migración SQL aún no aplicó. Resend recibe `from: info@alquilatucarro.com` (apex no verificado) → devuelve `validation_error` → emails fallan loud (status='failed' en `notification_logs`). Aceptable porque ya estás monitoreando logs activamente en este momento; si un email falla, lo reenviás manualmente post-cutover. **Mejor que la alternativa anterior** (DMARC fail silencioso por SPF mismatch).

**Riesgo aceptado en alfa — cron `/api/cron/check-pending`**: corre cada 30 min según `vercel.json`. Probabilidad ~20% (6/30) de tickear durante el window de cutover. Si tickea durante T-0:07 → T-0:08, fanout de emails para reservas pendientes fallarán loud (`validation_error` por apex no verificado). Quedan registrados en `notification_logs` con `status='failed'`; reenvío manual post-cutover. **Aceptado por el equipo** dado el estado alfa del proyecto.

---

## 4. Error handling

### Categorización de errores de Resend

| Categoría | Detección | Política |
|---|---|---|
| `validation_error` (422) | `error.name === 'validation_error'` | No retry. Throw. Log status='failed'. |
| `invalid_api_key` (401) | status 401 / nombre del error | No retry. Severity ERROR. Throw. |
| `rate_limit_exceeded` (429) | `error.name === 'rate_limit_exceeded'` | Retry 3× × 8s |
| 5xx server error | `error.statusCode >= 500` | Retry 3× × 8s |
| Network/timeout | excepción throw del SDK | Retry 3× × 8s |
| Quota exceeded | `error.name` específico | No retry. Escalar manual. |

### Caller-side (notifications.ts)

**Comportamiento del catch en `notifications.ts:401-406` no cambia**: envuelve toda la orquestación. Una falla de Resend nunca bloquea el flujo de reservas — la reserva queda persistida, el email falla silenciosamente desde la perspectiva del API, pero queda en `notification_logs` y Vercel logs.

**Riesgo conocido aceptado**: fallas que ocurren **antes** de `sendEmail()` (ej. `renderEmail` throw, `fetchReservationContext` fail, `getFranchiseBranding` fail) son cacheadas por este catch a nivel orquestador y **NO** quedan en `notification_logs` (porque la fila se inserta solo desde dentro de `send.ts`). Aparecen únicamente en `console.error` de Vercel logs. **No agregamos logging del orquestador en este PR** — fuera de scope. Si una migración futura requiere audit trail completo, agregar un wrapper de logging al inicio de `sendReservationNotifications` con un row preliminar en `notification_logs`.

### Logging strategy

| Evento | Console | notification_logs |
|---|---|---|
| Success | `[email] Sent "{subject}" to {to} (resend_id: {id})` | INSERT status=sent |
| Retry | `[email] Retryable error, retrying...` | (sin row hasta el final) |
| Final fail | `[email] Failed (...)` | INSERT status=failed, error_message |

### Observabilidad cruzada (debug post-incident)

1. Vercel logs → buscar por `reservationId` o tag `[email]`.
2. `notification_logs` table → query por `reservation_id`.
3. Resend dashboard → buscar por `resend_id` (en console logs) → ver delivery status real.

### Decisión deferida

Agregar columna `provider_message_id` a `notification_logs` para guardar el `data.id` de Resend de manera estructurada — **no en este PR** (YAGNI mientras solo monitoreamos desde Vercel logs + Resend dashboard).

---

## 5. Testing strategy

### Cobertura del nuevo `send.test.ts`

**Setup mock**:
```ts
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn() }
  }))
}));
```

**Casos** (mapean a observable scenarios S1-S15):
1. `getResendClient`:
   - Devuelve cliente con `${PREFIX}_RESEND_API_KEY` set (S1)
   - Throw `"Unknown franchise"` para franquicia desconocida (S2)
   - Throw `"Missing Resend API key for "{franchise}". Required: {PREFIX}_RESEND_API_KEY"` cuando env var no existe (S2.1)
   - Lazy lookup — no crash en module load (S15)
2. `deriveReplyTo` (S10, S11):
   - Subdomain → apex: `info@mail.alquilatucarro.com` → `info@alquilatucarro.com`
   - Sin prefix: `info@alquilatucarro.com` → `info@alquilatucarro.com` (idempotente)
   - Plus addressing: `info+marketing@mail.alquilatucarro.com` → `info+marketing@alquilatucarro.com`
   - Uppercase: `info@MAIL.alquilatucarro.com` → `info@alquilatucarro.com` (case-insensitive)
   - Sin `mail.` leading pero contiene "mail": `info@email.com` → `info@email.com` (no corruption)
   - Multi-TLD: `info@mail.example.co.uk` → `info@example.co.uk`
   - Null/undefined: returns input unchanged
   - Sin `@`: returns input unchanged (defensive)
3. `sendEmail` golden path (S1, S3, S9):
   - Lee Supabase (`sender_email`, `sender_name`)
   - Llama `resend.emails.send` con payload correcto (`from`, `to: [...]`, `replyTo`, `subject`, `html`, `headers`)
   - Inserta `notification_logs` con columnas existentes + `status='sent'`
4. `sendEmail` error paths (S4, S5, S12, S13):
   - `validation_error` → 1 llamada, throw, log failed
   - `rate_limit_exceeded` × 1 → 2 llamadas, success, log sent
   - `rate_limit_exceeded` × 3 → 3 llamadas, throw, log failed
   - 5xx → retry
   - Network throw → retry, eventual throw + log
   - `{ data: null, error: null }` (defensive) → tratado como fallo, log failed
   - `AbortSignal.timeout(10000)` dispara → retry, eventual throw + log

### Tests intencionalmente NO escritos

- Llamadas reales a Resend API (requeriría key en CI, brittle, costoso).
- Verificación de DKIM/SPF en headers reales (responsabilidad de Resend; validamos manualmente con `dig` una vez — ya hecho).
- Verificación de delivery / inbox placement (responsabilidad de Resend).
- E2E flow reserva → email (no wireado en CI, fuera del scope alfa).

### Bar mínimo del CI (no se puede saltar)

```
pnpm install --frozen-lockfile
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Falla cualquiera → Vercel deploy bloqueado. Política: correrlos local antes del push.

---

## 6. Observable scenarios (puente a SDD)

### S1 — Resend reemplaza completamente a nodemailer
**Given** `ALQUILATUCARRO_RESEND_API_KEY` está set.
**When** `sendEmail({ franchise: "alquilatucarro", ... })` es invocado.
**Then** `resend.emails.send` se llama una vez con payload correcto **AND** `nodemailer` no es importado/llamado por el código de envío.

### S2 — Franquicia desconocida produce error específico
**Given** se invoca con un código no registrado en `FRANCHISE_ENV_PREFIX` (ej. `"foo"`).
**When** `getResendClient("foo")` o `sendEmail({ franchise: "foo", ... })` es invocado.
**Then** se arroja un Error cuyo mensaje contiene literalmente `"Unknown franchise"`.

### S2.1 — Franquicia conocida sin API key falla loud (distinto error)
**Given** `ALQUICARROS_RESEND_API_KEY` no está set en env (franquicia conocida pero no configurada).
**When** `sendEmail({ franchise: "alquicarros", ... })` es invocado.
**Then** se arroja un Error cuyo mensaje contiene literalmente `"ALQUICARROS_RESEND_API_KEY"` **AND** **NO** contiene `"Unknown franchise"`.

### S3 — From subdominio, Reply-To apex
**Given** `franchises.sender_email = "info@mail.alquilatucarro.com"` y `sender_name = "Alquila tu Carro"`.
**When** `sendEmail()` envía a `customer@example.com`.
**Then** el payload entregado a `resend.emails.send` tiene:
- `from === '"Alquila tu Carro" <info@mail.alquilatucarro.com>'`
- `replyTo === "info@alquilatucarro.com"`

### S4 — Reintento exitoso en rate limit
**Given** `resend.emails.send` devuelve `{ error: { name: "rate_limit_exceeded" } }` una vez y luego `{ data: { id: "abc" } }`.
**When** `sendEmail()` es invocado.
**Then** `send` se llama 2 veces, resultado exitoso, `notification_logs` con `status='sent'`.

### S5 — Validation error: sin retry, throw, log de fallo
**Given** `resend.emails.send` devuelve `{ error: { name: "validation_error", message: "Invalid `from` field" } }`.
**When** `sendEmail()` es invocado.
**Then** `send` se llama exactamente una vez, `sendEmail` arroja, `notification_logs` con `status='failed'` y `error_message` conteniendo el mensaje original.

### S6 — Falla de email no bloquea creación de reserva
**Given** Resend rechaza todas las llamadas para alquilatucarro.
**When** se crea una reserva via `POST /api/reservations` con franquicia alquilatucarro.
**Then** la respuesta HTTP es exitosa, la reserva queda persistida, `notification_logs` con `status='failed'`.

### S7 — DB migration aplica el subdominio
**Given** la migración SQL se ejecuta contra una DB con `franchises.sender_email = "info@alquilatucarro.com"`.
**When** se aplica la migración.
**Then** `SELECT sender_email FROM franchises WHERE code = 'alquilatucarro'` devuelve `'info@mail.alquilatucarro.com'`.

### S8 — DKIM/SPF/DMARC pasan en entrega real (manual post-deploy)
**Given** el deploy en producción está live.
**When** se dispara una reserva real con email de prueba a Gmail.
**Then** los headers `Authentication-Results` muestran `dkim=pass`, `spf=pass`, `dmarc=pass`.

**Único scenario manual del set, ejecutado una vez post-deploy.**

### S9 — notification_logs schema sin cambios
**Given** `notification_logs` table con su schema actual.
**When** Resend completa un envío.
**Then** la fila insertada usa exactamente las columnas existentes: `reservation_id, channel='email', notification_type, recipient, subject, html_content, status` (más `error_message` cuando falla). **Ninguna migración de schema requerida.**

### S10 — Reply-To preserva plus addressing
**Given** `sender_email = "info+marketing@mail.alquilatucarro.com"` (caso edge).
**When** `deriveReplyTo()` procesa el valor.
**Then** devuelve `"info+marketing@alquilatucarro.com"`.

### S11 — `deriveReplyTo` cubre boundary cases
**Given** los siguientes inputs:
- `null` / `undefined`
- `"info@alquilatucarro.com"` (sin `mail.`)
- `"info@MAIL.alquilatucarro.com"` (uppercase)
- `"info@email.com"` (contiene `"mail"` pero no como subdomain leading)
- `"info@mail.example.co.uk"` (multi-TLD)
- `"info"` (sin `@`, defensive)

**When** `deriveReplyTo(input)` es llamado para cada uno.
**Then**:
- null/undefined → return input unchanged
- `"info@alquilatucarro.com"` → `"info@alquilatucarro.com"` (no-op)
- `"info@MAIL.alquilatucarro.com"` → `"info@alquilatucarro.com"` (case-insensitive)
- `"info@email.com"` → `"info@email.com"` (no corruption)
- `"info@mail.example.co.uk"` → `"info@example.co.uk"`
- `"info"` → `"info"` (no `@`, return unchanged)

### S12 — Resend SDK devuelve null/null se trata como fallo
**Given** `resend.emails.send` devuelve `{ data: null, error: null }` (caso defensivo, no debería ocurrir pero blindamos).
**When** `sendEmail()` es invocado.
**Then** `sendEmail` arroja, `notification_logs` con `status='failed'` y `error_message` indicando "no data, no error from Resend SDK".

### S13 — Network timeout dispara retry
**Given** `resend.emails.send` cuelga (`AbortSignal.timeout(10000)` dispara).
**When** `sendEmail()` es invocado.
**Then** se reintenta hasta `MAX_RETRIES`, eventualmente throw, `notification_logs` con `status='failed'`.

### S14 — Vercel function timeout no se excede en orquestación con retries (NO test, smoke check)
**Given** una reserva mensual con `total_insurance` + extras (4 emails: cliente + Localiza × 3).
**When** uno de los emails de Localiza hace 1 retry (8s).
**Then** el tiempo total inline no excede `~10s` (4 emails × ~200ms + 8s retry = ~9s), holgadamente bajo el timeout de 300s de Vercel function.

*Sin EMAIL_DELAY_MS, este es un smoke check conceptual — no es un test automatizado, pero es el racional que cierra el riesgo C5 del review.*

### S15 — Module load no crashea sin env vars
**Given** ninguna `*_RESEND_API_KEY` está configurada en el entorno.
**When** se importa `lib/email/client.ts` (ej. en `pnpm test` con `.env.test` vacío).
**Then** la importación NO arroja. Solo arroja al invocar `getResendClient(franchise)` (lookup lazy, no eager).

---

## 7. Rollback plan + Runbook de deploy

### Runbook de deploy (orden CORREGIDO: código primero, SQL después)

```
PRE-FLIGHT (local)
[ ] git pull origin main
[ ] Implementar cambios
[ ] pnpm install (si cambió package.json)
[ ] pnpm type-check / lint / test / build → todos pasan
[ ] Diff review
[ ] dig MX alquilatucarro.com → confirmar que apex tiene MX (Reply-To target funcional)
    → debe resolver a un mailserver con inbox real (Hostinger en este caso)

ENV VARS (Vercel) — ya hecho
[x] ALQUILATUCARRO_RESEND_API_KEY configurada en Production + Preview

CODE PUSH (PRIMERO)
[ ] git commit
[ ] git push origin main
[ ] Watch CI → typecheck + lint + test + build pass
[ ] Watch Vercel deploy → Ready
    → durante este window (~6 min): código viejo + DB vieja (sin riesgo)

DB MIGRATION (SEGUNDO, post-deploy verde)
[ ] supabase db push → aplica NNN_alquilatucarro_resend_sender.sql
[ ] Verify: SELECT sender_email FROM franchises WHERE code = 'alquilatucarro';
    → debe ser 'info@mail.alquilatucarro.com'

POST-DEPLOY (~10 min monitoring)
[ ] Tail Vercel logs por errores [email]
[ ] Disparar reserva de prueba (S8 — DKIM/SPF/DMARC)
[ ] Inspeccionar headers Authentication-Results
[ ] Query notification_logs últimos 15 min:
    SELECT created_at, status, recipient, error_message
    FROM notification_logs
    WHERE created_at > NOW() - INTERVAL '15 minutes'
    ORDER BY created_at DESC;
    → confirmar no hay status='failed' inesperado
```

**Rationale del orden**: si CI falla después del push, el deploy nunca sale → cero impacto en prod. Si pusheamos SQL primero y CI fallara después, prod quedaría con DB nueva + código viejo (nodemailer firmando con SMTP Hostinger pero From subdomain) → SPF fail garantizado y silencioso (DMARC misalignment marca como spam, no como falla loud).

### Rollback paths

**Triggers**: errores `[email]` en Vercel logs, `notification_logs.status='failed'` para reservas reales, Resend dashboard rejections, reporte directo.

**Path A — Rollback de código solo: ❌ INVÁLIDO POR SÍ SOLO**.

Si revertimos solo el código (vuelve nodemailer) y dejamos la DB con `info@mail.alquilatucarro.com`, nodemailer envía via SMTP de Hostinger autenticado como `info@alquilatucarro.com` (apex) pero con `From: info@mail.alquilatucarro.com` (subdomain). Resultado:
- DKIM no firma para el subdomain (Hostinger firma para apex).
- SPF de Hostinger no incluye `mail.alquilatucarro.com`.
- DMARC strict alignment falla en ambas dimensiones.

→ Gmail puede **rechazar outright**, no solo spam-foldear. **Siempre pairear con DB revert (= Path C)**.

**Path B — Rollback de DB solo: ❌ INVÁLIDO**. Rompe el código nuevo (Resend rechaza apex como From porque solo `mail.<domain>` está verificado).

**Path C — Rollback completo (ÚNICO path válido)** (estado pre-cutover):
```bash
# 1. Revert código
git revert <commit-sha> && git push origin main
# Wait ~5 min para CI + Vercel deploy

# 2. Revert DB inmediatamente después del deploy verde
UPDATE franchises SET sender_email = 'info@alquilatucarro.com'
WHERE code = 'alquilatucarro';
```
**Window de fallo loud durante el revert (~5 min)**: el código nuevo (Resend) sigue live mientras CI procesa el revert, devolviendo `validation_error` por el apex no verificado. Aceptable: emails fallan loud (no silencioso), monitor activo, reenvío manual posible.

### Tabla de decisión rápida

| Síntoma | Path | Recovery |
|---|---|---|
| Resend rechaza emails (validation/auth) | C | ~5 min |
| `getResendClient` arroja para alquilatucarro | C (env var problem) | ~5 min |
| DB migration falló parcialmente | C | ~5 min |
| CI falla en push | No rollback (no llegó a deploy) | 0 min |
| Resend OK pero deliverability mala | Investigar primero, no rollback automático | — |

### Lo que NO está en este plan (por scope)

- Alertas automáticas (PagerDuty / Slack) — no en alfa.
- Canary / progressive rollout — no aplica con un solo dominio.
- Auto-rollback en Vercel — requiere config previa que no tenemos.

---

## 8. Scope del commit

### IN

**Código**:
- `lib/email/client.ts` (rewrite — `getResendClient`)
- `lib/email/send.ts` (modify — Resend SDK call, `deriveReplyTo`, `AbortSignal.timeout`, eliminar `warnIfFromMismatch`)
- `lib/email/notifications.ts` (modify menor — eliminar 4 calls a `delay()` y la constante)
- `package.json` + `pnpm-lock.yaml` (add `resend`)

**Tests**:
- `tests/unit/email/send.test.ts` (rewrite mocks de nodemailer → Resend, agregar S2/S2.1/S11/S12/S13/S15)
- `tests/unit/email/notifications.test.ts` (update — remover mocks de `delay()`)

**DB**:
- `supabase/migrations/NNN_alquilatucarro_resend_sender.sql` (new)

**Env templates**:
- `.env.local.example`, `.env.staging.example` (add `ALQUILATUCARRO_RESEND_API_KEY` placeholder)

**Docs**:
- `docs/specs/2026-04-29-resend-email-migration-design.md` (este archivo)
- `CHANGELOG.md` (entrada `### Changed` y `### Removed`)

### OUT (deferred)

| Item | Razón | Cuándo |
|---|---|---|
| Migración alquicarros | Bloqueada en DNS | Cuando admin agregue registros |
| Migración alquilame | Bloqueada en delegación Azure DNS rota | Cuando IT destrabe |
| Borrar `nodemailer` de package.json | Otras 2 franquicias siguen referenciando | Cleanup PR cuando las 3 estén en Resend |
| Borrar 12 env vars `*_MAIL_*` de Vercel | Idem | Cleanup PR final |
| Columna `provider_message_id` en notification_logs | YAGNI | Si operación lo requiere |
| Open/click tracking | No requerido en alfa | Cuando producto madure |
| Webhooks de Resend (bounces/complaints) | No requerido en alfa | Idem |
| E2E tests del flow de email | Fuera de scope alfa | — |

### Branch strategy (resuelta)

El spec doc ya vive como commit `8e4eaa4` en branch `chore/email-cleanup-post-cutover` (mismo branch donde habíamos trabajado el cleanup post-cutover anterior). En vez de cherry-pickear a un branch nuevo:

1. **Reusar `chore/email-cleanup-post-cutover`** para los commits de implementación. El nombre del branch no es preciso (esto es feature, no cleanup), pero como vamos directo a `main` sin PR review, el nombre del feature branch es cosmético.
2. Commits de implementación encima de `8e4eaa4`.
3. Fast-forward `main` desde el branch local.
4. Push `main` directo a GitHub (autorización explícita del usuario, sin PR).

### Commit message preview

```
feat(email): migrate alquilatucarro from SMTP to Resend

- Replace nodemailer transporter with Resend SDK in lib/email/client.ts
- Update sendEmail() to call resend.emails.send with adapted error
  handling (rate_limit_exceeded retry, validation_error fail-fast,
  AbortSignal.timeout per attempt, defensive null/null branch)
- Add deriveReplyTo() to map subdomain From to apex Reply-To, with
  case-insensitive ^mail. anchor and null/multi-TLD safety
- Remove EMAIL_DELAY_MS workaround (was for Mailtrap rate limit;
  Resend handles bursts natively); strip 4 delay() calls in
  notifications.ts
- DB migration: franchises.sender_email for alquilatucarro is now
  info@mail.alquilatucarro.com (matches verified Resend domain)
- Remove obsolete warnIfFromMismatch (Resend signs with DKIM)

Other 2 franchises (alquicarros, alquilame) throw if invoked; they
have no traffic in alpha. Their migration follows once DNS is fixed.
```

### CHANGELOG entry preview

```markdown
## [Unreleased]

### Changed
- **email**: alquilatucarro now sends via Resend instead of SMTP. From
  changed to `info@mail.alquilatucarro.com` (Reply-To preserves apex).
  Closes the DMARC alignment risk previously flagged in `send.ts`.
- **email**: notifications between Localiza emails are no longer
  artificially delayed. The 5s `EMAIL_DELAY_MS` was a workaround for
  Mailtrap's per-second rate limit and has no equivalent in Resend.

### Removed
- **email**: `warnIfFromMismatch` runtime check — obsolete with Resend's
  DKIM signing.
- **email**: `EMAIL_DELAY_MS` env var and `delay()` calls in
  `notifications.ts`.
```

---

## TL;DR

Cambia el provider de envío de correos de SMTP (nodemailer) a Resend para alquilatucarro únicamente. La abstracción `sendEmail()` se preserva. `notifications.ts` cambia mínimamente para borrar el delay obsoleto de Mailtrap. La DB se actualiza vía migración para que `sender_email` apunte al subdominio verificado en Resend. Orden del deploy: **código primero, SQL después** (revierte el orden inicial; ver Sección 3 + 7 para rationale). Otras franquicias quedan en "no configurado, throw si se invocan" hasta que se resuelvan sus bloqueos de DNS. Rollback único válido: Path C (revert código + revert DB), ~5-10 min recovery.
